// Shared helpers for deep-crawling navigation/TOC pages (e.g. Siyavula chapter
// indexes) and for cleaning textbook content while PRESERVING the table of
// contents, chapter/section headings, and numbering hierarchy.
//
// Used by both the live `ingestion-worker` and the `backfill-pipeline`.

import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

export const MIN_TEXTBOOK_CHARS = 100_000;
export const MIN_CHAPTERS = 5;

const DEFAULT_MAX_PAGES = 120;
const DEFAULT_PAGE_TIMEOUT_MS = 15_000;
const DEFAULT_TOTAL_BYTES = 12 * 1024 * 1024; // 12 MB safety cap

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

/**
 * Extract ONLY textbook content from a page, discarding site chrome
 * (header, nav menus, footer, login links, curriculum selectors, grade
 * listings, related-textbook links, breadcrumbs, prev/next nav).
 *
 * Returns plain text plus diagnostics on what was kept vs discarded.
 */
export function extractMainContent(html: string, pageUrl?: string): {
  text: string;
  rawHtmlBytes: number;
  contentHtmlBytes: number;
  discardedHtmlBytes: number;
  container: string;
} {
  const rawHtmlBytes = html.length;
  let host = "";
  try { host = pageUrl ? new URL(pageUrl).host.toLowerCase() : ""; } catch { /* noop */ }

  // Always pre-strip global chrome before container selection so any fallback
  // (<main>, <body>) doesn't carry it in.
  let pre = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ");

  // Strip Siyavula-specific chrome blocks even if they live outside <nav>/<header>.
  const SIY_CHROME_CLASSES = [
    "sv-main-menu-wrapper",
    "sv-account-menu-wrapper",
    "sv-authentication-menu",
    "sv-region-select-banner",
    "sv-breadcrumbs",
    "sv-page-header",
    "nav-buttons",
    "footer-legal",
    "footer-text-icon",
    "sv-cell--help",
    "sv-cell--products",
    "sv-cell--pricing",
    "sv-cell--social",
    "sv-section--notice-available",
    "sv-section--notice",
    "sv-section--lead",
    "sv-book-banner",
    "sv-view--textbook-catalogue",
  ];
  const stripSiyChrome = (s: string): string => {
    let r = s;
    for (const cls of SIY_CHROME_CLASSES) {
      const rx = new RegExp(
        `<(\\w+)\\b[^>]*class=\"[^\"]*\\b${cls}\\b[^\"]*\"[\\s\\S]*?<\\/\\1>`,
        "gi",
      );
      r = r.replace(rx, " ");
    }
    return r;
  };
  pre = stripSiyChrome(pre);

  // Try strongest container first (Siyavula lesson body), then chapter-TOC,
  // then generic <main> / <article>, then <body>.
  const CANDIDATES: Array<{ name: string; rx: RegExp }> = [
    { name: "sv-book-section-view", rx: /<div\b[^>]*class=\"[^\"]*\bsv-book-section-view\b[^\"]*\"([\s\S]*?)<\/main>/i },
    { name: "toc-container", rx: /<div\b[^>]*class=\"[^\"]*\btoc-container\b[^\"]*\"([\s\S]*?)<\/main>/i },
    { name: "main", rx: /<main\b[\s\S]*?<\/main>/i },
    { name: "article", rx: /<article\b[\s\S]*?<\/article>/i },
    { name: "body", rx: /<body\b[\s\S]*?<\/body>/i },
  ];

  let chosen = "";
  let chosenName = "none";
  for (const c of CANDIDATES) {
    const m = pre.match(c.rx);
    if (m && m[0].length > 400) {
      chosen = m[0];
      chosenName = c.name;
      break;
    }
  }
  if (!chosen) chosen = pre;

  // After picking container, re-strip chrome (covers anything injected inside
  // <main>) and drop common boilerplate links.
  chosen = stripSiyChrome(chosen)
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ")
    .replace(/<table\b[^>]*class=\"[^\"]*\bnav-buttons\b[^\"]*\"[\s\S]*?<\/table>/gi, " ")
    .replace(/<ul\b[^>]*class=\"[^\"]*\bsv-book__(grades|languages|options|urls)\b[^\"]*\"[\s\S]*?<\/ul>/gi, " ")
    .replace(/<a\b[^>]*>\s*(log\s*in|sign\s*up|register|login|menu|search|share|download|previous|next|back to top)\s*<\/a>/gi, " ");

  const contentHtmlBytes = chosen.length;
  const text = htmlToText(chosen);
  return {
    text,
    rawHtmlBytes,
    contentHtmlBytes,
    discardedHtmlBytes: Math.max(0, rawHtmlBytes - contentHtmlBytes),
    container: chosenName + (host ? `@${host}` : ""),
  };
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
  return { ok: false, chapters, chars, reason: "Only TOC page imported" };
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
  diagnostics: {
    rawHtmlBytes: number;
    extractedChars: number;
    discardedHtmlBytes: number;
    pages: Array<{ url: string; container: string; raw: number; kept: number }>;
    sampleChapter?: { url: string; title?: string; preview: string };
  };
}

/**
 * Given a TOC/landing page, find chapter links, recursively follow them to
 * subsection pages, and concatenate ONLY their textbook content (no site
 * chrome). Designed for Siyavula and similar open-textbook sites.
 */
export async function deepCrawlFromIndex(
  indexUrl: string,
  indexHtml: string,
  opts: CrawlOpts = {},
): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const totalByteCap = opts.totalByteCap ?? DEFAULT_TOTAL_BYTES;
  const ua = opts.userAgent ?? "Mozilla/5.0 (compatible; StudySoundBot/1.0)";

  const diag = {
    rawHtmlBytes: 0,
    extractedChars: 0,
    discardedHtmlBytes: 0,
    pages: [] as Array<{ url: string; container: string; raw: number; kept: number }>,
    sampleChapter: undefined as CrawlResult["diagnostics"]["sampleChapter"],
  };

  // Always extract the index page content too (keeps the TOC list at top).
  const idx = extractMainContent(indexHtml, indexUrl);
  diag.rawHtmlBytes += idx.rawHtmlBytes;
  diag.extractedChars += idx.text.length;
  diag.discardedHtmlBytes += idx.discardedHtmlBytes;
  diag.pages.push({ url: indexUrl, container: idx.container, raw: idx.rawHtmlBytes, kept: idx.text.length });

  const parts: string[] = [idx.text];

  // Two-level BFS: index → chapter pages → subsection pages.
  const seen = new Set<string>([normalize(indexUrl)]);
  const queue: string[] = extractChapterLinks(indexHtml, indexUrl).filter((u) => !seen.has(normalize(u)));
  let bytes = indexHtml.length;
  let pagesFetched = 0;

  while (queue.length && pagesFetched < maxPages && bytes < totalByteCap) {
    const link = queue.shift()!;
    const norm = normalize(link);
    if (seen.has(norm)) continue;
    seen.add(norm);

    let html: string;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(link, {
        headers: { "User-Agent": ua, "Accept": "text/html,*/*" },
        redirect: "follow",
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t));
      if (!res.ok) continue;
      html = await res.text();
    } catch { continue; }
    if (!html || html.length < 500) continue;

    bytes += html.length;
    pagesFetched++;

    const ext = extractMainContent(html, link);
    diag.rawHtmlBytes += ext.rawHtmlBytes;
    diag.extractedChars += ext.text.length;
    diag.discardedHtmlBytes += ext.discardedHtmlBytes;
    diag.pages.push({ url: link, container: ext.container, raw: ext.rawHtmlBytes, kept: ext.text.length });

    // Discover sub-section links from chapter-TOC pages and queue them.
    if (ext.container.startsWith("toc-container")) {
      const subs = extractChapterLinks(html, link).filter((u) => !seen.has(normalize(u)));
      for (const s of subs) queue.push(s);
    }

    if (ext.text.length < 300) continue;

    const heading = headingFromUrl(link);
    parts.push(`\n\n${heading}\n\n${ext.text}`);

    // Capture the first real lesson page (sv-book-section-view) as a sample
    // for log inspection.
    if (!diag.sampleChapter && ext.container.startsWith("sv-book-section-view")) {
      diag.sampleChapter = {
        url: link,
        title: heading.replace(/^#\s*/, ""),
        preview: ext.text.slice(0, 800),
      };
    }
  }

  const text = parts.join("\n\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return { text, pagesFetched, chapterLinks: [], bytes, diagnostics: diag };
}

function normalize(url: string): string {
  try { return new URL(url).toString().split("#")[0]; } catch { return url; }
}

/**
 * Many open-textbook sites publish the entire book as a single downloadable
 * PDF linked from the TOC/landing page. Try to find and extract it.
 */
export async function tryFetchTextbookPdf(
  indexUrl: string,
  indexHtml: string,
  opts: { timeoutMs?: number; maxBytes?: number; userAgent?: string } = {},
): Promise<{ text: string; pageCount: number; pdfUrl: string; bytes: number } | null> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const maxBytes = opts.maxBytes ?? 40 * 1024 * 1024;
  const ua = opts.userAgent ?? "Mozilla/5.0 (compatible; StudySoundBot/1.0)";

  const base = new URL(indexUrl);
  const seen = new Set<string>();
  const candidates: { url: string; score: number }[] = [];
  const rx = /href\s*=\s*["']([^"']+\.pdf)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(indexHtml)) !== null) {
    let abs: URL;
    try { abs = new URL(m[1], base); } catch { continue; }
    const u = abs.toString();
    if (seen.has(u)) continue;
    seen.add(u);
    const p = abs.pathname.toLowerCase();
    if (!/\/downloads?\/|\/books?\/|learner|textbook|grade/i.test(p)) continue;
    let score = 0;
    if (/_eng(\b|[_.\/])|english/i.test(p)) score += 10;
    if (/learner/i.test(p)) score += 8;
    if (/_v\d+\.pdf$/i.test(p)) score += 2;
    if (/teacher|afr|_nd|practical/i.test(p)) score -= 6;
    candidates.push({ url: u, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length === 0) return null;

  for (const c of candidates.slice(0, 3)) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(c.url, {
        headers: { "User-Agent": ua, "Accept": "application/pdf,*/*" },
        redirect: "follow",
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t));
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") ?? "";
      const cl = Number(res.headers.get("content-length") ?? "0");
      if (cl > maxBytes) continue;
      if (!/pdf/i.test(ct) && !c.url.toLowerCase().endsWith(".pdf")) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > maxBytes) continue;
      const pdf = await getDocumentProxy(buf);
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      const merged = Array.isArray(text) ? text.join("\n\n") : text;
      if (!merged || merged.length < 5_000) continue;
      return { text: merged, pageCount: totalPages, pdfUrl: c.url, bytes: buf.byteLength };
    } catch (_) { /* try next */ }
  }
  return null;
}

function headingFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).slice(-2).join(" / ")
      .replace(/[-_]+/g, " ")
      .replace(/\.\w+$/, "");
    if (!seg) return "# Chapter";
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
    if (/(login|signup|register|account|terms|privacy|contact|about|search|cart|profile|pricing|help|teachers?|parents?)/.test(path)) continue;

    // Stay within the same book section: prefer URLs whose first 4 path
    // segments overlap with the index URL (e.g. /read/za/maths/grade-10/...).
    const idxSegs = base.pathname.toLowerCase().split("/").filter(Boolean);
    const linkSegs = path.split("/").filter(Boolean);
    const overlap = Math.min(4, idxSegs.length);
    let matchedOverlap = true;
    for (let i = 0; i < overlap; i++) {
      if (linkSegs[i] !== idxSegs[i]) { matchedOverlap = false; break; }
    }
    if (!matchedOverlap) continue;

    // Heuristic: chapter-like — numeric segment, chapter/section/unit token,
    // or a subsection slug like "01-foo-02".
    const looksChapter =
      /\b(chapter|topic|section|unit|lesson|module|grade)[-_\/]?\d+/i.test(path) ||
      /\/\d{1,3}(?:[\/-]|$)/.test(path) ||
      /-\d{2}(?:[\/-]|$)/.test(path) ||
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
 * Textbook-friendly cleaner. Preserves TOC, chapter/section headings,
 * hierarchical numbering. Strips site chrome lines only.
 */
export function cleanTextbookPreservingTOC(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ");

  const footerRx = /(All\s+\w+\s+textbook\s+content\s+made\s+available|Creative\s+Commons\s+Attribution\s+License|Terms\s+and\s+Conditions|Privacy\s+Policy|©\s*\d{4})/i;
  const footerMatch = text.match(footerRx);
  if (footerMatch && footerMatch.index !== undefined && footerMatch.index > 500) {
    text = text.slice(0, footerMatch.index).trimEnd();
  }

  const NAV_LINES = new Set([
    "home", "practice", "past papers", "textbooks", "for teachers and schools",
    "for learners and parents", "log in", "sign up", "menu", "search",
    "next", "previous", "back to top", "share", "download",
    "south africa", "read online", "afrikaans", "english",
  ]);

  const lines = text.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trimEnd());
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { kept.push(""); continue; }
    const low = t.toLowerCase();
    if (NAV_LINES.has(low)) continue;
    if (/^\d{1,4}$/.test(t)) continue;
    kept.push(line.replace(/\.{4,}/g, " "));
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
