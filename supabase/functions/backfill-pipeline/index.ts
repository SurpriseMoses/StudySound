// Backfill pipeline: applies the new ingestion steps (re-clean → chunk → cache → embed → publish → coverage)
// to documents that were imported before those stages existed.
//
// Steps applied per document:
//   4  Re-clean       — re-run cleanRawText() on documents.raw_text and rewrite clean_text
//                       For navigation/TOC docs (e.g. Siyavula landing pages) we use a
//                       TOC-preserving cleaner so the contents list is NOT dropped.
//   5  Chunk          — split clean_text into 1800-char pieces (matches generate-audio CHUNK_SIZE)
//   6  Cache English  — insert into public.document_chunks (wiped first if cleaning changed)
//   8  Embed English  — openai/text-embedding-3-small via Lovable AI Gateway
//   9  Queue translations  — flip documents.seed_translation = true
//   12 Embed translations  — embed translation_assets rows that have no embedding yet
//   13 Publish               — set published_at + embeddings_status='complete'
//   14 Coverage              — append a row to coverage_snapshots
//
// POST body:
//   { document_id?: string, limit?: number (default 5, max 10),
//     reclean?: boolean (default true),
//     publish_without_translations?: boolean (default true) }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { cleanRawText, type DocKind } from "../_shared/clean-text.ts";
import {
  deepCrawlFromIndex,
  tryFetchTextbookPdf,
  validateTextbook,
  cleanTextbookPreservingTOC,
  htmlToText,
  MIN_TEXTBOOK_CHARS,
  MIN_CHAPTERS,
} from "../_shared/deep-crawl.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const EMBED_MODEL = "openai/text-embedding-3-small";
// Match generate-audio's CHUNK_SIZE so cached chunks line up 1:1 with the
// sections the lesson player produces at runtime.
const CHUNK_SIZE = 1800;
const CHUNK_OVERLAP = 150;
const EMBED_BATCH = 32;
const DEADLINE_MS = 55_000;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  try {
    let body: {
      document_id?: string;
      limit?: number;
      reclean?: boolean;
      publish_without_translations?: boolean;
    } = {};
    try { body = await req.json(); } catch { /* allow empty */ }

    const limit = Math.max(1, Math.min(Number(body.limit ?? 5) || 5, 10));
    const reclean = body.reclean ?? true;
    const publishWithoutTr = body.publish_without_translations ?? true;

    const sel = "id, title, doc_type, subject_type, clean_text, raw_text, cleaning_version, country, curriculum, source_id, source_url, published_at, embeddings_status, seed_translation, translation_status, seed_audio, tags";

    let targets: any[] = [];
    if (body.document_id) {
      const { data } = await admin.from("documents").select(sel).eq("id", body.document_id).maybeSingle();
      if (data) targets = [data];
    } else {
      const { data } = await admin.from("documents")
        .select(sel)
        .or("published_at.is.null,embeddings_status.neq.complete")
        .order("created_at", { ascending: true })
        .limit(limit);
      targets = data ?? [];
    }

    if (targets.length === 0) {
      return json({ ok: true, processed: 0, message: "no documents need backfill" });
    }

    const results: any[] = [];
    let didCoverage = false;

    for (const doc of targets) {
      if (Date.now() - startedAt > DEADLINE_MS) {
        results.push({ document_id: doc.id, skipped: "deadline" });
        break;
      }
      const r = await backfillDoc(doc, { reclean, publishWithoutTr, startedAt });
      results.push(r);
      if (!didCoverage && r.published) {
        try { await refreshCoverage(doc); didCoverage = true; } catch { /* non-fatal */ }
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});

// ---------- per-document ----------

async function backfillDoc(
  doc: any,
  opts: { reclean: boolean; publishWithoutTr: boolean; startedAt: number },
) {
  const out: any = { document_id: doc.id, title: doc.title, stages: [] };
  let raw: string = doc.raw_text ?? doc.clean_text ?? "";
  if (!raw || raw.length < 50) {
    return { ...out, error: "no raw_text/clean_text available" };
  }

  // 0  Deep-crawl: if this is a Siyavula/OpenStax/etc. landing page that was
  //    only ingested as TOC (raw_text < 100k), fetch chapter pages and rebuild
  //    raw_text from the full body.
  const subjectStr = String(doc.tags?.subject ?? doc.doc_type ?? "").toLowerCase();
  const isLiterature = /literature|english|novel|story|play|shakespeare/.test(subjectStr);
  if (
    !isLiterature &&
    doc.source_url &&
    raw.length < MIN_TEXTBOOK_CHARS &&
    /siyavula|openstax|wikibooks|cnx\.org|dbe|education\.gov/i.test(doc.source_url)
  ) {
    try {
      const res = await fetch(doc.source_url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; StudySoundBot/1.0)" },
        redirect: "follow",
      });
      if (res.ok) {
        const html = await res.text();

        // Preferred path: a single, downloadable Learner English PDF that
        // contains the whole textbook. Siyavula chapter pages are JS-rendered
        // SPAs so deep-crawling them yields only nav chrome — the PDF is the
        // real source of truth.
        let usedPdf = false;
        try {
          const pdf = await tryFetchTextbookPdf(doc.source_url, html, { maxBytes: 40 * 1024 * 1024 });
          if (pdf && pdf.text.length > raw.length) {
            raw = pdf.text;
            await admin.from("documents").update({
              raw_text: raw.slice(0, 8_000_000),
            }).eq("id", doc.id);
            out.stages.push({ pdf_download: { url: pdf.pdfUrl, pages: pdf.pageCount, chars: pdf.text.length, bytes: pdf.bytes } });
            usedPdf = true;
          }
        } catch (e: any) {
          out.stages.push({ pdf_download: `error: ${String(e?.message ?? e)}` });
        }

        // Fallback: walk the chapter index.
        if (!usedPdf) {
          const crawl = await deepCrawlFromIndex(doc.source_url, html, { maxPages: 80 });
          if (crawl.text.length > raw.length) {
            raw = crawl.text;
            await admin.from("documents").update({
              raw_text: raw.slice(0, 4_000_000),
            }).eq("id", doc.id);
            out.stages.push({ deep_crawl: { pages: crawl.pagesFetched, chars: crawl.text.length } });
          } else {
            out.stages.push({ deep_crawl: `no improvement (pages=${crawl.pagesFetched})` });
          }
        }
      } else {
        out.stages.push({ deep_crawl: `fetch failed ${res.status}` });
      }
    } catch (e: any) {
      out.stages.push({ deep_crawl: `error: ${String(e?.message ?? e)}` });
    }
  }

  // 2  Validation gate: refuse to publish broken / TOC-only imports.
  if (!isLiterature) {
    const v = validateTextbook(raw);
    if (!v.ok) {
      await admin.from("documents").update({
        embeddings_status: "import_failed",
      }).eq("id", doc.id);
      return {
        ...out,
        error: "Only TOC page imported",
        validation: { chars: v.chars, chapters: v.chapters },
      };
    }
    out.stages.push({ validation: "passed" });
  }

  // 4  Re-clean
  let cleanText: string = doc.clean_text ?? "";
  let cleaningChanged = false;
  if (opts.reclean) {
    const kind = detectKind(doc);
    let cleaned: string;
    if (!isLiterature) {
      // Textbooks: preserve TOC + chapter/section headings + numbering.
      cleaned = cleanTextbookPreservingTOC(raw);
    } else if (kind === "toc") {
      cleaned = cleanTocDoc(raw);
    } else {
      cleaned = cleanRawText(raw, kind).text;
    }
    if (cleaned && cleaned.length >= Math.max(200, Math.floor((doc.clean_text?.length ?? 0) * 0.5))) {
      if (cleaned !== doc.clean_text) {
        await admin.from("documents").update({ clean_text: cleaned }).eq("id", doc.id);
        cleaningChanged = true;
      }
      cleanText = cleaned;
      out.stages.push({ reclean: { kind: isLiterature ? kind : "textbook", before: doc.clean_text?.length ?? 0, after: cleaned.length, changed: cleaningChanged } });
    } else {
      out.stages.push({ reclean: `skipped (cleaner output too short: ${cleaned?.length ?? 0})` });
    }
  }
  if (!cleanText || cleanText.length < 50) {
    return { ...out, error: "clean_text empty after re-clean" };
  }

  // 5+6 Chunk + cache English (wipe & re-insert when cleaning changed)
  if (cleaningChanged) {
    await admin.from("document_chunks").delete().eq("document_id", doc.id);
  }
  const chunksInserted = await ensureChunks(doc.id, cleanText);
  out.stages.push({ chunk_cache: chunksInserted });

  // 8 Embed English
  let embedded = 0;
  while (Date.now() - opts.startedAt < DEADLINE_MS) {
    const { data: rows } = await admin.from("document_chunks")
      .select("id,text").eq("document_id", doc.id).is("embedding", null)
      .order("chunk_index", { ascending: true }).limit(EMBED_BATCH);
    if (!rows || rows.length === 0) break;
    if (!LOVABLE_API_KEY) { out.stages.push({ embed_en: "skipped (no LOVABLE_API_KEY)" }); break; }
    const vectors = await embedBatch(rows.map((r: any) => r.text));
    for (let i = 0; i < rows.length; i++) {
      await admin.from("document_chunks").update({
        embedding: vectors[i] as any, embedding_model: EMBED_MODEL,
      }).eq("id", rows[i].id);
    }
    embedded += rows.length;
  }
  out.stages.push({ embed_en: embedded });

  // 9 Queue translations
  if (!doc.seed_translation) {
    await admin.from("documents").update({
      seed_translation: true, translation_status: "pending",
    }).eq("id", doc.id);
    out.stages.push({ queue_translations: "enabled" });
  } else {
    out.stages.push({ queue_translations: `already (${doc.translation_status ?? "?"})` });
  }

  // 12 Embed translations that already exist
  let embeddedTr = 0;
  while (Date.now() - opts.startedAt < DEADLINE_MS) {
    const { data: rows } = await admin.from("translation_assets")
      .select("id,translated_text").eq("document_id", doc.id)
      .not("translated_text", "is", null).is("embedding", null).limit(EMBED_BATCH);
    if (!rows || rows.length === 0) break;
    if (!LOVABLE_API_KEY) { out.stages.push({ embed_tr: "skipped (no LOVABLE_API_KEY)" }); break; }
    const vectors = await embedBatch(rows.map((r: any) => (r.translated_text ?? "").slice(0, 8000)));
    for (let i = 0; i < rows.length; i++) {
      await admin.from("translation_assets").update({
        embedding: vectors[i] as any, embedding_model: EMBED_MODEL,
      }).eq("id", rows[i].id);
    }
    embeddedTr += rows.length;
  }
  out.stages.push({ embed_tr: embeddedTr });

  // 13 Publish
  const { count: pendingEn } = await admin.from("document_chunks")
    .select("id", { count: "exact", head: true }).eq("document_id", doc.id).is("embedding", null);
  const englishReady = (pendingEn ?? 0) === 0;
  if (englishReady && (opts.publishWithoutTr || doc.translation_status === "done")) {
    await admin.from("documents").update({
      published_at: new Date().toISOString(),
      embeddings_status: "complete",
    }).eq("id", doc.id);
    out.stages.push({ publish: "ok" });
    out.published = true;
  } else {
    out.stages.push({ publish: `deferred (en_pending=${pendingEn ?? "?"}, tr=${doc.translation_status ?? "?"})` });
  }

  return out;
}

// ---------- kind detection & TOC-preserving cleaner ----------

function detectKind(doc: any): DocKind | "toc" {
  const title = String(doc.title ?? "").toLowerCase();
  const raw = String(doc.raw_text ?? "");
  const head = raw.slice(0, 4000).toLowerCase();
  // Siyavula and similar source-website landing pages — the "content" IS the
  // table of contents / navigation. Don't strip it.
  if (
    title.includes("siyavula") ||
    head.includes("table of contents") ||
    /\bsiyavula\b|\bdbe\b\s+workbook|openstax/i.test(raw.slice(0, 2000))
  ) {
    // Only treat as TOC when it's clearly not a full novel/play (short text)
    if (raw.length < 60_000) return "toc";
  }
  if (/\bACT\s+(?:I|1|THE\s+FIRST)\b/i.test(raw.slice(0, 8000)) &&
      /\b(SCENE|DRAMATIS\s+PERSONAE)\b/i.test(raw.slice(0, 8000))) return "play";
  return "novel";
}

// Minimal cleaner for navigation/TOC documents. Preserves the table of contents
// (chapter list, topic headings) as the document's narratable body. We only
// strip site-chrome noise: nav blocks, copyright tails, social/legal links.
function cleanTocDoc(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ");
  // Drop massive runs of blank/whitespace-only lines
  text = text.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trimEnd()).join("\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  // Trim site footer: Creative Commons / Terms / Privacy boilerplate
  const footerRx = /(All\s+\w+\s+textbook\s+content\s+made\s+available|Creative\s+Commons\s+Attribution\s+License|Terms\s+and\s+Conditions|Privacy\s+Policy)/i;
  const footerMatch = text.match(footerRx);
  if (footerMatch && footerMatch.index !== undefined && footerMatch.index > 200) {
    text = text.slice(0, footerMatch.index).trimEnd();
  }

  // Drop nav-chrome lines (Home / Practice / For teachers / Past papers ...)
  const NAV_LINES = new Set([
    "home", "practice", "past papers", "textbooks", "for teachers and schools",
    "for learners and parents", "log in", "sign up", "menu",
  ]);
  const lines = text.split("\n").filter((l) => {
    const t = l.trim().toLowerCase();
    if (!t) return true;
    if (NAV_LINES.has(t)) return false;
    return true;
  });
  text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

// ---------- coverage ----------

async function refreshCoverage(doc: any) {
  const country = doc.country ?? "ZA";
  const curriculum = doc.curriculum ?? "CAPS";
  const { data: tax } = await admin.from("curriculum_taxonomy")
    .select("topic").eq("country", country).eq("curriculum", curriculum);
  const { data: covered } = await admin.from("content_topic_mapping")
    .select("topic").eq("country", country).eq("curriculum", curriculum).not("topic", "is", null);
  const coveredSet = new Set((covered ?? []).map((r: any) => r.topic));
  const { count: resourcesCount } = await admin.from("documents")
    .select("id", { count: "exact", head: true }).eq("country", country).eq("curriculum", curriculum);
  await admin.from("coverage_snapshots").insert({
    country, curriculum,
    total_topics: tax?.length ?? 0,
    covered_topics: coveredSet.size,
    resources: resourcesCount ?? 0,
    source_id: doc.source_id ?? null,
    note: "backfill-pipeline",
  });
}

// ---------- helpers ----------

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + CHUNK_SIZE, text.length);
    if (end < text.length) {
      const slice = text.slice(i, end);
      const lastPara = slice.lastIndexOf("\n\n");
      const lastSent = slice.lastIndexOf(". ");
      const cut = lastPara > CHUNK_SIZE * 0.5 ? lastPara
        : lastSent > CHUNK_SIZE * 0.5 ? lastSent + 1 : -1;
      if (cut > 0) end = i + cut;
    }
    const piece = text.slice(i, end).trim();
    if (piece.length > 0) chunks.push(piece);
    if (end >= text.length) break;
    i = Math.max(end - CHUNK_OVERLAP, i + 1);
  }
  return chunks;
}

async function ensureChunks(docId: string, fullText: string): Promise<number> {
  const { count } = await admin.from("document_chunks")
    .select("id", { count: "exact", head: true }).eq("document_id", docId);
  if ((count ?? 0) > 0) return 0;
  const pieces = splitIntoChunks(fullText);
  if (pieces.length === 0) return 0;
  const rows = await Promise.all(pieces.map(async (text, idx) => ({
    document_id: docId,
    chunk_index: idx,
    text,
    char_count: text.length,
    content_hash: await sha256(text),
  })));
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await admin.from("document_chunks").insert(rows.slice(i, i + 100));
    if (error) throw error;
  }
  return rows.length;
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  });
  if (!res.ok) throw new Error(`embedding failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return (j.data ?? []).map((d: any) => d.embedding as number[]);
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
