// Shared helpers for deep-crawling navigation/TOC pages (e.g. Siyavula chapter
// indexes) and for cleaning textbook content while PRESERVING the table of
// contents, chapter/section headings, and numbering hierarchy.
//
// Used by both the live `ingestion-worker` and the `backfill-pipeline`.

import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

export const MIN_TEXTBOOK_CHARS = 100_000;
export const MIN_CHAPTERS = 5;

const DEFAULT_MAX_PAGES = 80;
const DEFAULT_PAGE_TIMEOUT_MS = 15_000;
const DEFAULT_TOTAL_BYTES = 8 * 1024 * 1024; // 8 MB safety cap

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h\d|br|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Heuristically count chapter/section/topic headings in narration text. */
export function countChapters(text: string): number {
  if (!text) return 0;
  const rx = /^\s*(?:chapter|section|unit|topic|module|lesson)\s+[\divxlcIVXLC]+/gim;
  const matches = text.match(rx) ?? [];
  return matches.length;
}

/**
 * Validate whether a document's raw_text passes the "real book" gate.
 * Returns { ok, chapters, chars, reason? }.
 */
export function validateTextbook(rawText: string): {
  ok: boolean;
  chapters: number;
  chars: number;
  reason?: string;
} {
  const chars = rawText?.length ?? 0;
  const chapters = countChapters(rawText ?? "");
  if (chars > MIN_TEXTBOOK_CHARS || chapters > MIN_CHAPTERS) {
    return { ok: true, chapters, chars };
  }
  return {
    ok: false,
    chapters,
    chars,
    reason: "Only TOC page imported",
  };
}

interface CrawlOpts {
  maxPages?: number;
  timeoutMs?: number;
  totalByteCap?: number;
  userAgent?: string;
}

interface CrawlResult {
  text: string;
  pagesFetched: number;
  chapterLinks: string[];
  bytes: number;
}

/**
 * Given the HTML of a TOC/landing page, find chapter-like links, fetch each,
 * and concatenate their visible text with clear chapter separators. Designed
 * for sites like Siyavula whose landing page IS the TOC.
 */
export async function deepCrawlFromIndex(
  indexUrl: string,
  indexHtml: string,
  opts: CrawlOpts = {},
): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const totalByteCap = opts.totalByteCap ?? DEFAULT_TOTAL_BYTES;
  const ua = opts.userAgent ?? "StudySoundBot/1.0 (+deep-crawl)";

  const links = extractChapterLinks(indexHtml, indexUrl);
  const indexText = htmlToText(indexHtml);

  const parts: string[] = [];
  // Keep the TOC at the top so navigation/headings survive.
  parts.push(indexText);

  let bytes = indexHtml.length;
  let pagesFetched = 0;
  const seen = new Set<string>();

  for (const link of links) {
    if (pagesFetched >= maxPages) break;
    if (bytes >= totalByteCap) break;
    if (seen.has(link)) continue;
    seen.add(link);

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(link, {
        headers: { "User-Agent": ua, "Accept": "text/html,*/*" },
        redirect: "follow",
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t));
      if (!res.ok) continue;
      const html = await res.text();
      if (!html || html.length < 500) continue;
      bytes += html.length;
      pagesFetched++;

      const body = htmlToText(html);
      if (body.length < 300) continue;

      // Try to derive a stable heading from the URL (e.g. "/chapter-3/...")
      const heading = headingFromUrl(link);
      parts.push(`\n\n${heading}\n\n${body}`);
    } catch (_) {
      // network/timeout — skip silently and continue
    }
  }

  // Collapse excessive blank lines.
  const text = parts.join("\n\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return { text, pagesFetched, chapterLinks: links, bytes };
}

function headingFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).slice(-2).join(" / ")
      .replace(/[-_]+/g, " ")
      .replace(/\.\w+$/, "");
    if (!seg) return "Chapter";
    return `# ${seg.replace(/\b\w/g, (c) => c.toUpperCase())}`;
  } catch {
    return "# Chapter";
  }
}

/**
 * Extract anchor hrefs that look like chapter/topic links, resolved against
 * the index URL. Same-host only. Filters out site chrome, login, search, etc.
 */
export function extractChapterLinks(html: string, indexUrl: string): string[] {
  const base = new URL(indexUrl);
  const out: string[] = [];
  const seen = new Set<string>();
  const rx = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html)) !== null) {
    const href = m[1].trim();
    const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;

    let abs: URL;
    try { abs = new URL(href, base); } catch { continue; }
    if (abs.host !== base.host) continue;
    if (abs.pathname === base.pathname) continue;

    const path = abs.pathname.toLowerCase();
    if (/\.(jpg|jpeg|png|svg|gif|webp|css|js|pdf|zip|mp3|mp4)$/.test(path)) continue;
    if (/(login|signup|register|account|terms|privacy|contact|about|search|cart)/.test(path)) continue;

    // Heuristic: chapter-like — numeric segment or chapter/section/topic/unit token.
    const looksChapter =
      /\b(chapter|topic|section|unit|lesson|module|grade)[-_\/]?\d+/i.test(path) ||
      /\/\d{1,3}(?:[\/-]|$)/.test(path) ||
      /\bchapter\b|\btopic\b|\bsection\b|\bunit\b/i.test(label);
    if (!looksChapter) continue;

    const norm = abs.toString().split("#")[0];
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/**
 * Textbook-friendly cleaner. Unlike the literature cleaner we PRESERVE:
 *   - the Table of Contents block
 *   - chapter / section / unit headings
 *   - hierarchical numbering (1, 1.1, 1.1.1, Chapter 3, etc.)
 *
 * We only strip site chrome: nav bars, login buttons, repeated footers,
 * obvious script/style remnants, page numbers on their own line.
 */
export function cleanTextbookPreservingTOC(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ");

  // Drop site footer / legal boilerplate at the tail.
  const footerRx = /(All\s+\w+\s+textbook\s+content\s+made\s+available|Creative\s+Commons\s+Attribution\s+License|Terms\s+and\s+Conditions|Privacy\s+Policy|©\s*\d{4})/i;
  const footerMatch = text.match(footerRx);
  if (footerMatch && footerMatch.index !== undefined && footerMatch.index > 500) {
    text = text.slice(0, footerMatch.index).trimEnd();
  }

  const NAV_LINES = new Set([
    "home", "practice", "past papers", "textbooks", "for teachers and schools",
    "for learners and parents", "log in", "sign up", "menu", "search",
    "next", "previous", "back to top", "share", "download",
  ]);

  const lines = text.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trimEnd());
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { kept.push(""); continue; }
    const low = t.toLowerCase();
    if (NAV_LINES.has(low)) continue;
    // page number on its own line
    if (/^\d{1,4}$/.test(t)) continue;
    // very long runs of dots (TOC leaders) – collapse but keep the line
    kept.push(line.replace(/\.{4,}/g, " "));
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
