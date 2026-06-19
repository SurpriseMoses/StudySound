// Backfill pipeline: applies the new ingestion steps (chunk → cache → embed → publish → coverage)
// to documents that were imported before those stages existed.
//
// Steps applied per document (Import/Validate/Extract/Clean already done):
//   5  Chunk          — split documents.clean_text into ~1200-char pieces
//   6  Cache English  — insert into public.document_chunks
//   7  CAPS auto-map  — skipped (already done at original ingestion time)
//   8  Embed English  — openai/text-embedding-3-small via Lovable AI Gateway
//   9  Queue translations    — flip documents.seed_translation = true (if not already)
//   10 Translate chunk       — handled async by seed-translation-worker
//   11 Cache translated      — already in translation_assets
//   12 Embed translations    — embed translation_assets rows that have no embedding yet
//   13 Publish               — set published_at + embeddings_status='complete'
//   14 Coverage              — append a row to coverage_snapshots
//
// POST body: { document_id?: string, limit?: number (default 3, max 10), publish_without_translations?: boolean }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const EMBED_MODEL = "openai/text-embedding-3-small";
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const EMBED_BATCH = 32;
const DEADLINE_MS = 50_000;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  try {
    let body: { document_id?: string; limit?: number; publish_without_translations?: boolean } = {};
    try { body = await req.json(); } catch { /* allow empty */ }

    const limit = Math.max(1, Math.min(Number(body.limit ?? 3) || 3, 10));
    const publishWithoutTr = body.publish_without_translations ?? true;

    // Pick targets
    let targets: any[] = [];
    if (body.document_id) {
      const { data } = await admin.from("documents")
        .select("id, clean_text, raw_text, country, curriculum, source_id, published_at, embeddings_status, seed_translation, translation_status, seed_audio")
        .eq("id", body.document_id).maybeSingle();
      if (data) targets = [data];
    } else {
      const { data } = await admin.from("documents")
        .select("id, clean_text, raw_text, country, curriculum, source_id, published_at, embeddings_status, seed_translation, translation_status, seed_audio")
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
      const r = await backfillDoc(doc, publishWithoutTr, startedAt);
      results.push(r);
      // Refresh coverage at most once per invocation
      if (!didCoverage && r.published) {
        try { await refreshCoverage(doc); didCoverage = true; } catch (_) { /* non-fatal */ }
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});

async function backfillDoc(doc: any, publishWithoutTr: boolean, startedAt: number) {
  const out: any = { document_id: doc.id, stages: [] };
  const fullText: string = doc.clean_text ?? doc.raw_text ?? "";
  if (!fullText || fullText.length < 50) {
    return { ...out, error: "no clean_text available" };
  }

  // 5+6 Chunk + cache English
  const chunksInserted = await ensureChunks(doc.id, fullText);
  out.stages.push({ chunk_cache: chunksInserted });

  // 8 Embed English (loop until done or deadline)
  let embedded = 0;
  while (Date.now() - startedAt < DEADLINE_MS) {
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

  // 9 Queue translations (idempotent — only flip if not already enabled)
  if (!doc.seed_translation) {
    await admin.from("documents").update({
      seed_translation: true, translation_status: "pending",
    }).eq("id", doc.id);
    out.stages.push({ queue_translations: "enabled" });
  } else {
    out.stages.push({ queue_translations: `already (${doc.translation_status ?? "?"})` });
  }

  // 12 Embed translations that already exist (don't wait for new ones)
  let embeddedTr = 0;
  while (Date.now() - startedAt < DEADLINE_MS) {
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

  // Enable audio seeding if not already on
  if (!doc.seed_audio) {
    await admin.from("documents").update({
      seed_audio: true, seed_audio_status: "pending",
    }).eq("id", doc.id);
    out.stages.push({ queue_audio: "enabled" });
  }

  // 13 Publish — only if English embeddings exist and (translations done OR publishWithoutTr=true)
  const { count: pendingEn } = await admin.from("document_chunks")
    .select("id", { count: "exact", head: true }).eq("document_id", doc.id).is("embedding", null);
  const englishReady = (pendingEn ?? 0) === 0;
  if (englishReady && (publishWithoutTr || doc.translation_status === "done")) {
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
