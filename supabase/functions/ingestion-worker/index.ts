// Ingestion worker: advances ONE job by ONE stage per invocation.
// Called by pg_cron every minute and on-demand by the orchestrator.
//
// Stages:
//   pending        → downloading
//   downloading    → parsing
//   parsing        → structuring
//   structuring    → tagging
//   tagging        → cleaning
//   cleaning       → chunking
//   chunking       → embedding_en      (split into document_chunks + embed English)
//   embedding_en   → translating       (enable translation seeding)
//   translating    → embedding_tr      (waits for translation_status='done')
//   embedding_tr   → audio_seeding     (enable audio seeding)
//   audio_seeding  → publishing        (set published_at, embeddings_status)
//   publishing     → coverage          (refresh coverage_snapshots)
//   coverage       → completed
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const EMBED_MODEL = "openai/text-embedding-3-small"; // 1536 dims, cost-efficient
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const EMBED_BATCH = 32;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Stage → progress %
const PROGRESS: Record<string, number> = {
  pending: 0, downloading: 8, parsing: 18, structuring: 25, tagging: 32,
  cleaning: 42, chunking: 52, embedding_en: 62, translating: 72,
  embedding_tr: 82, audio_seeding: 90, publishing: 95, coverage: 98, completed: 100,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    let body: { job_id?: string; cron?: boolean; max_steps?: number } = {};
    try { body = await req.json(); } catch { /* cron may pass empty */ }

    let job = await pickJob(body.job_id);
    if (!job) return json({ skipped: "no_pending_jobs" });

    const maxSteps = Math.max(1, Math.min(Number(body.max_steps ?? 1) || 1, 20));
    let steps = 0;
    for (; steps < maxSteps; steps++) {
      if (["completed", "failed", "cancelled"].includes(job.state)) break;
      try {
        const next = await advance(job);
        const progress = PROGRESS[next.state] ?? job.progress;
        const document_id = next.document_id ?? job.document_id;
      await admin.from("ingestion_jobs").update({
        state: next.state,
        progress,
        document_id,
        started_at: job.started_at ?? new Date().toISOString(),
        finished_at: next.state === "completed" ? new Date().toISOString() : null,
        last_error: null,
      }).eq("id", job.id);

      await admin.from("ingestion_stage_logs").insert({
        job_id: job.id, stage: next.state, status: "ok", message: next.message ?? null,
      });
        const { data: refreshed } = await admin.from("ingestion_jobs").select("*").eq("id", job.id).maybeSingle();
        job = refreshed ?? { ...job, state: next.state, progress, document_id, started_at: job.started_at ?? new Date().toISOString(), last_error: null };
      } catch (err: any) {
        const attempts = (job.attempts ?? 0) + 1;
        const failed = attempts >= 3;
        await admin.from("ingestion_jobs").update({
          attempts,
          state: failed ? "failed" : job.state,
          last_error: String(err?.message ?? err),
        }).eq("id", job.id);
        await admin.from("ingestion_stage_logs").insert({
          job_id: job.id, stage: job.state, status: failed ? "failed" : "error",
          message: String(err?.message ?? err),
        });
        return json({ job_id: job.id, state: failed ? "failed" : job.state, error: String(err?.message ?? err) }, 500);
      }
    }
    return json({ job_id: job.id, state: job.state, steps });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

async function pickJob(jobId?: string) {
  if (jobId) {
    const { data } = await admin.from("ingestion_jobs").select("*").eq("id", jobId).maybeSingle();
    return data;
  }
  const { data } = await admin.from("ingestion_jobs")
    .select("*")
    .not("state", "in", "(completed,failed,cancelled)")
    .order("updated_at", { ascending: true })
    .limit(1).maybeSingle();
  return data;
}

interface AdvanceResult { state: string; document_id?: string; message?: string }

async function advance(job: any): Promise<AdvanceResult> {
  switch (job.state) {
    case "pending":       return await stageDownload(job);
    case "downloading":   return await stageParse(job);
    case "parsing":       return await stageStructure(job);
    case "structuring":   return await stageTag(job);
    case "tagging":       return await stageClean(job);
    case "cleaning":      return await stageChunk(job);
    case "chunking":      return await stageEmbedEnglish(job);
    case "embedding_en":  return await stageTranslate(job);
    case "translating":   return await stageEmbedTranslations(job);
    case "embedding_tr":  return await stageAudio(job);
    case "audio_seeding": return await stagePublish(job);
    case "publishing":    return await stageCoverage(job);
    case "coverage":      return await stageComplete(job);
    default: return { state: job.state, message: "noop" };
  }
}

// ----- Stage implementations -----------------------------------------------

async function stageDownload(job: any): Promise<AdvanceResult> {
  // For raw_text / upload_path, nothing to download.
  if (job.input_raw_text || job.input_upload_path) {
    return { state: "downloading", message: "input already available" };
  }
  if (!job.input_url) throw new Error("no input provided");
  const res = await fetch(job.input_url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const path = `ingest/${job.id}/source.bin`;
  const { error } = await admin.storage.from("uploads").upload(path, buf, {
    upsert: true,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  });
  if (error) throw error;
  await admin.from("ingestion_jobs").update({ input_upload_path: path }).eq("id", job.id);
  return { state: "downloading", message: `downloaded ${buf.byteLength} bytes` };
}

async function stageParse(job: any): Promise<AdvanceResult> {
  // Pull bytes; if HTML strip tags; if text keep as-is; if PDF store raw text best-effort.
  let text = job.input_raw_text ?? "";
  if (!text && job.input_upload_path) {
    const { data } = await admin.storage.from("uploads").download(job.input_upload_path);
    if (data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const sniff = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 2048));
      const looksHtml = /<html|<body|<!doctype html/i.test(sniff);
      if (looksHtml) {
        const html = new TextDecoder().decode(bytes);
        text = htmlToText(html);
      } else if (sniff.startsWith("%PDF")) {
        // Naive PDF: extract printable ASCII as a placeholder; admins can re-run via extract-document if needed.
        text = Array.from(bytes).map((b) => (b >= 32 && b < 127) || b === 10 ? String.fromCharCode(b) : "").join("");
      } else {
        text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      }
    }
  }
  text = text.replace(/\u0000/g, "").trim();
  if (text.length < 200) throw new Error("extracted text too short");
  // Cache raw_text on the job for later stages.
  await admin.from("ingestion_jobs").update({ input_raw_text: text.slice(0, 1_500_000) }).eq("id", job.id);
  return { state: "parsing", message: `extracted ${text.length} chars` };
}

async function stageStructure(job: any): Promise<AdvanceResult> {
  // Lightweight heuristic structure detection — no AI call needed for v1.
  const text = job.input_raw_text ?? "";
  const chapters = (text.match(/^\s*(chapter|section|unit)\s+[\divxlc]+/gim) ?? []).length;
  return { state: "structuring", message: `detected ~${chapters} chapter headings` };
}

async function stageTag(job: any): Promise<AdvanceResult> {
  // Use AI gateway if available; otherwise fall back to hints.
  let grade = job.grade, subject = job.subject, curriculum = job.curriculum ?? "CAPS", country = job.country ?? "ZA";
  let topic: string | null = null, subtopic: string | null = null, confidence = 0.4;
  const text = (job.input_raw_text ?? "").slice(0, 4000);
  if (LOVABLE_API_KEY && text.length > 200) {
    try {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "Classify the document for the South African CAPS curriculum. Reply ONLY with compact JSON: {grade,subject,topic,subtopic,confidence}." },
            { role: "user", content: text },
          ],
        }),
      });
      if (r.ok) {
        const j = await r.json();
        const raw = j.choices?.[0]?.message?.content ?? "{}";
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          grade = parsed.grade ?? grade;
          subject = parsed.subject ?? subject;
          topic = parsed.topic ?? null;
          subtopic = parsed.subtopic ?? null;
          confidence = Number(parsed.confidence) || confidence;
        }
      }
    } catch (_) { /* fall through */ }
  }
  await admin.from("ingestion_jobs").update({ grade, subject, curriculum, country }).eq("id", job.id);
  // Tags written after document exists (chunking stage). Stash hints on the job.
  return { state: "tagging", message: `grade=${grade ?? "?"} subject=${subject ?? "?"} topic=${topic ?? "?"}` };
}

async function stageClean(job: any): Promise<AdvanceResult> {
  const text: string = job.input_raw_text ?? "";
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/_{2,}/g, " ")
    .replace(/\.{4,}/g, " ")
    .replace(/^\s*\d{1,4}\s*$/gm, "")               // page numbers
    .replace(/^\s*(table\s+of\s+contents?)\s*$/gim, "")
    .replace(/^(.+)\n\1$/gm, "$1")                  // duplicate adjacent lines
    .replace(/\b(exit|exeunt|enter)\b\.?/gi, "")    // stage cues
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  await admin.from("ingestion_jobs").update({ input_raw_text: cleaned }).eq("id", job.id);
  return { state: "cleaning", message: `cleaned to ${cleaned.length} chars` };
}

async function stageChunk(job: any): Promise<AdvanceResult> {
  const text: string = job.input_raw_text ?? "";
  if (!text || text.length < 200) throw new Error("no text after cleaning");
  const hash = await sha256(text);

  // Duplicate detection — reuse existing document if same hash, OR if a document
  // already exists for this source (prevents importing the same textbook twice
  // when the publisher tweaks the HTML and the content hash shifts).
  const { data: existing } = await admin.from("documents").select("id").eq("content_hash", hash).maybeSingle();
  let docId = existing?.id ?? null;
  if (!docId && job.source_id) {
    const { data: bySource } = await admin
      .from("documents")
      .select("id")
      .eq("source_id", job.source_id)
      .limit(1)
      .maybeSingle();
    docId = bySource?.id ?? null;
  }


  if (!docId) {
    const { data: src } = await admin.from("content_sources").select("license_type,name,publisher").eq("id", job.source_id).maybeSingle();
    const publisher = (src as any)?.publisher
      ?? (src?.name ? String(src.name).split(" ")[0] : null); // e.g. "Siyavula"
    const baseTitle = job.title_hint
      ?? (job.input_url ? new URL(job.input_url).pathname.split("/").filter(Boolean).pop() : null)
      ?? "Imported document";
    // Ensure a distinct, learner-friendly title: "<Publisher> <Subject> Grade <N>"
    const titleBits = [
      publisher,
      job.subject ?? null,
      job.grade ? `Grade ${job.grade}` : null,
    ].filter(Boolean);
    const title = titleBits.length >= 2 ? titleBits.join(" ") : baseTitle;

    // Map free-form subject → subject_type enum (novel/history/science/other)
    const s = String(job.subject ?? "").toLowerCase();
    const subjectType =
      /physic|chem|biolog|life scien|natural scien|science/.test(s) ? "science"
      : /history|geograph|social/.test(s) ? "history"
      : /literature|english|novel|story/.test(s) ? "novel"
      : "other";

    const tags = {
      publisher: publisher ?? null,
      subject: job.subject ?? null,
      grade: job.grade ?? null,
      curriculum: job.curriculum ?? "CAPS",
      country: job.country ?? "ZA",
      source: src?.name ?? null,
    };

    const { data: doc, error } = await admin.from("documents").insert({
      content_hash: hash,
      title,
      raw_text: text,
      clean_text: text,
      char_count: text.length,
      language: "en",
      grade_level: job.grade ?? null,
      doc_type: job.subject ?? null,
      subject_type: subjectType,
      tags,
      is_seeded: true,
      source_id: job.source_id,
      source_url: job.input_url ?? null,
      license_type: src?.license_type ?? null,
      curriculum: job.curriculum ?? null,
      country: job.country ?? null,
      import_job_id: job.id,
    }).select("id").single();
    if (error) throw error;
    docId = doc.id;

    // Bump source counters
    await admin.from("content_sources").update({
      import_count: 1, last_import_at: new Date().toISOString(),
    }).eq("id", job.source_id);
  }

  // Materialize chunk-level English rows (idempotent, no embeddings yet).
  await ensureChunks(docId!, text);


  // Curriculum tag row (legacy index — kept for back-compat)
  if (job.grade || job.subject) {
    await admin.from("curriculum_tags").insert({
      document_id: docId,
      country: job.country ?? null,
      curriculum: job.curriculum ?? null,
      grade: job.grade ?? null,
      subject: job.subject ?? null,
    });
  }

  // CAPS auto-mapping: score taxonomy rows against title + content + headings.
  try {
    const mappings = await inferCapsMappings({
      docId,
      title: job.title_hint ?? "",
      text,
      country: job.country ?? "ZA",
      curriculum: job.curriculum ?? "CAPS",
      gradeHint: job.grade ?? null,
      subjectHint: job.subject ?? null,
    });
    if (mappings.length) {
      await admin.from("content_topic_mapping")
        .delete()
        .eq("document_id", docId)
        .eq("source", "auto");
      const { error: mapErr } = await admin.from("content_topic_mapping").insert(mappings);
      if (mapErr) throw mapErr;
    }
    return { state: "chunking", document_id: docId, message: `document ${docId}; ${mappings.length} CAPS mappings` };
  } catch (e) {
    return { state: "chunking", document_id: docId, message: `document ${docId}; mapping skipped: ${String((e as any)?.message ?? e)}` };
  }
}

// ----- CAPS auto-mapping ---------------------------------------------------

interface InferArgs {
  docId: string;
  title: string;
  text: string;
  country: string;
  curriculum: string;
  gradeHint: string | null;
  subjectHint: string | null;
}

async function inferCapsMappings(a: InferArgs) {
  const { data: tax } = await admin
    .from("curriculum_taxonomy")
    .select("grade,subject,topic,subtopic")
    .eq("country", a.country)
    .eq("curriculum", a.curriculum);
  if (!tax || tax.length === 0) return [];

  const title = (a.title ?? "").toLowerCase();
  const head = (a.text ?? "").slice(0, 12000).toLowerCase();
  const headings = (a.text.match(/^\s*(chapter|section|unit|topic|module)\s+[^\n]{0,80}/gim) ?? [])
    .join("\n").toLowerCase();
  const haystack = `${title}\n${headings}\n${head}`;

  // Detect grade from text if hint missing.
  let detectedGrade: string | null = a.gradeHint;
  if (!detectedGrade) {
    const m = haystack.match(/\bgrade[\s\-]*([89]|1[0-2])\b/);
    if (m) detectedGrade = m[1];
  }

  const tokenize = (s: string) =>
    s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);

  const scored = tax.map((row: any) => {
    const subjectTokens = tokenize(row.subject ?? "");
    const topicTokens = tokenize(row.topic ?? "");
    let score = 0;
    const signals: Record<string, unknown> = {};

    // Subject keyword hits
    let subjHits = 0;
    for (const t of subjectTokens) if (haystack.includes(t)) subjHits++;
    if (subjectTokens.length) {
      const s = subjHits / subjectTokens.length;
      score += s * 0.35;
      if (s > 0) signals.subject_kw = Number(s.toFixed(2));
    }

    // Topic keyword hits (stronger)
    let topHits = 0;
    for (const t of topicTokens) if (haystack.includes(t)) topHits++;
    if (topicTokens.length) {
      const s = topHits / topicTokens.length;
      score += s * 0.45;
      if (s > 0) signals.topic_kw = Number(s.toFixed(2));
    }

    // Grade match
    if (detectedGrade && row.grade === detectedGrade) {
      score += 0.2;
      signals.grade_match = true;
    } else if (a.gradeHint && row.grade !== a.gradeHint) {
      score -= 0.15;
    }

    // Subject hint exact match
    if (a.subjectHint && row.subject?.toLowerCase() === a.subjectHint.toLowerCase()) {
      score += 0.25;
      signals.subject_hint = true;
    }

    return { row, score: Math.max(0, Math.min(1, score)), signals };
  });

  // Pick rows above threshold; if nothing crosses, fall back to top-1 from hint if present.
  const THRESHOLD = 0.35;
  let kept = scored.filter((s) => s.score >= THRESHOLD);
  if (kept.length === 0 && (a.gradeHint || a.subjectHint)) {
    const fallback = scored
      .filter((s) =>
        (!a.gradeHint || s.row.grade === a.gradeHint) &&
        (!a.subjectHint || s.row.subject?.toLowerCase() === a.subjectHint.toLowerCase()))
      .sort((x, y) => y.score - x.score)
      .slice(0, 1);
    kept = fallback.map((s) => ({ ...s, score: Math.max(s.score, 0.4) }));
  }

  // Cap to top 6 to avoid noise.
  kept.sort((x, y) => y.score - x.score);
  kept = kept.slice(0, 6);

  return kept.map((s) => ({
    document_id: a.docId,
    chunk_index: null,
    country: a.country,
    curriculum: a.curriculum,
    grade: s.row.grade,
    subject: s.row.subject,
    topic: s.row.topic ?? null,
    subtopic: s.row.subtopic ?? null,
    confidence: Number(s.score.toFixed(3)),
    signals: s.signals,
    source: "auto",
  }));
}

async function stageEmbedEnglish(job: any): Promise<AdvanceResult> {
  if (!job.document_id) throw new Error("no document_id");
  const { data: rows, error } = await admin
    .from("document_chunks")
    .select("id,text")
    .eq("document_id", job.document_id)
    .is("embedding", null)
    .order("chunk_index", { ascending: true })
    .limit(EMBED_BATCH);
  if (error) throw error;

  if (!rows || rows.length === 0) {
    return { state: "embedding_en", message: "english embeddings ready" };
  }
  if (!LOVABLE_API_KEY) {
    // No key — skip embeddings gracefully but still advance.
    return { state: "embedding_en", message: "no LOVABLE_API_KEY; skipping embeddings" };
  }

  const vectors = await embedBatch(rows.map((r: any) => r.text));
  for (let i = 0; i < rows.length; i++) {
    await admin.from("document_chunks").update({
      embedding: vectors[i] as any,
      embedding_model: EMBED_MODEL,
    }).eq("id", rows[i].id);
  }
  // Stay on `cleaning` -> `embedding_en` transition only after first batch; subsequent
  // ticks re-enter with state='embedding_en' (handled below).
  return { state: "embedding_en", message: `embedded ${rows.length} english chunks` };
}

async function stageTranslate(job: any): Promise<AdvanceResult> {
  if (!job.document_id) throw new Error("no document_id");
  // Make sure all English chunks are embedded before flipping to translation.
  const { count } = await admin
    .from("document_chunks")
    .select("id", { count: "exact", head: true })
    .eq("document_id", job.document_id)
    .is("embedding", null);
  if ((count ?? 0) > 0) {
    // Re-run embedding on the same tick path: process another batch, stay in embedding_en.
    return await stageEmbedEnglish(job);
  }
  await admin.from("documents").update({
    seed_translation: true,
    translation_status: "pending",
  }).eq("id", job.document_id);
  return { state: "translating", message: "translation seeding enabled" };
}

async function stageEmbedTranslations(job: any): Promise<AdvanceResult> {
  if (!job.document_id) throw new Error("no document_id");
  // Wait until the translation pipeline has finished.
  const { data: doc } = await admin
    .from("documents")
    .select("translation_status")
    .eq("id", job.document_id)
    .maybeSingle();
  if (doc?.translation_status !== "done") {
    return { state: "translating", message: `waiting on translations (${doc?.translation_status ?? "unknown"})` };
  }

  const { data: rows, error } = await admin
    .from("translation_assets")
    .select("id,translated_text")
    .eq("document_id", job.document_id)
    .is("embedding", null)
    .limit(EMBED_BATCH);
  if (error) throw error;

  if (!rows || rows.length === 0) {
    return { state: "embedding_tr", message: "translated embeddings ready" };
  }
  if (!LOVABLE_API_KEY) {
    return { state: "embedding_tr", message: "no LOVABLE_API_KEY; skipping translation embeddings" };
  }

  const vectors = await embedBatch(rows.map((r: any) => r.translated_text ?? ""));
  for (let i = 0; i < rows.length; i++) {
    await admin.from("translation_assets").update({
      embedding: vectors[i] as any,
      embedding_model: EMBED_MODEL,
    }).eq("id", rows[i].id);
  }
  return { state: "embedding_tr", message: `embedded ${rows.length} translated chunks` };
}

async function stageAudio(job: any): Promise<AdvanceResult> {
  if (!job.document_id) throw new Error("no document_id");
  // Drain any remaining translation embeddings before moving on.
  const { count } = await admin
    .from("translation_assets")
    .select("id", { count: "exact", head: true })
    .eq("document_id", job.document_id)
    .is("embedding", null);
  if ((count ?? 0) > 0) {
    return await stageEmbedTranslations(job);
  }
  await admin.from("documents").update({
    seed_audio: true,
    seed_audio_status: "pending",
  }).eq("id", job.document_id);
  return { state: "audio_seeding", message: "audio seeding enabled" };
}

async function stagePublish(job: any): Promise<AdvanceResult> {
  if (!job.document_id) throw new Error("no document_id");
  await admin.from("documents").update({
    published_at: new Date().toISOString(),
    embeddings_status: "complete",
  }).eq("id", job.document_id);
  return { state: "publishing", message: "document published" };
}

async function stageCoverage(job: any): Promise<AdvanceResult> {
  // Refresh coverage_snapshots for this curriculum/country.
  try {
    const country = job.country ?? "ZA";
    const curriculum = job.curriculum ?? "CAPS";
    const { data: tax } = await admin
      .from("curriculum_taxonomy")
      .select("topic")
      .eq("country", country).eq("curriculum", curriculum);
    const total = tax?.length ?? 0;
    const { data: covered } = await admin
      .from("content_topic_mapping")
      .select("topic")
      .eq("country", country).eq("curriculum", curriculum)
      .not("topic", "is", null);
    const coveredSet = new Set((covered ?? []).map((r: any) => r.topic));
    const { count: resourcesCount } = await admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("country", country).eq("curriculum", curriculum);
    await admin.from("coverage_snapshots").insert({
      country, curriculum,
      total_topics: total,
      covered_topics: coveredSet.size,
      resources: resourcesCount ?? 0,
      source_id: job.source_id ?? null,
      note: `auto-refresh after job ${job.id}`,
    });
  } catch (_) { /* non-fatal */ }
  return { state: "coverage", message: "coverage snapshot updated" };
}

async function stageComplete(job: any): Promise<AdvanceResult> {
  if (job.document_id) {
    await admin.from("content_quality_metrics").upsert({
      document_id: job.document_id,
      ocr_score: null,
      cleaning_success_rate: 1.0,
      duplicate_score: 0,
      translation_health: null,
      english_leakage_pct: null,
      missing_chunks: 0,
      computed_at: new Date().toISOString(),
    });
  }
  return { state: "completed", message: "done" };
}

// ----- chunking + embedding helpers ----------------------------------------

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + CHUNK_SIZE, text.length);
    if (end < text.length) {
      // Try to break on paragraph or sentence boundary.
      const slice = text.slice(i, end);
      const lastPara = slice.lastIndexOf("\n\n");
      const lastSent = slice.lastIndexOf(". ");
      const cut = lastPara > CHUNK_SIZE * 0.5 ? lastPara
        : lastSent > CHUNK_SIZE * 0.5 ? lastSent + 1
        : -1;
      if (cut > 0) end = i + cut;
    }
    const piece = text.slice(i, end).trim();
    if (piece.length > 0) chunks.push(piece);
    if (end >= text.length) break;
    i = Math.max(end - CHUNK_OVERLAP, i + 1);
  }
  return chunks;
}

async function ensureChunks(docId: string, fullText: string): Promise<void> {
  const { count } = await admin
    .from("document_chunks")
    .select("id", { count: "exact", head: true })
    .eq("document_id", docId);
  if ((count ?? 0) > 0) return;
  const pieces = splitIntoChunks(fullText);
  if (pieces.length === 0) return;
  const rows = await Promise.all(pieces.map(async (text, idx) => ({
    document_id: docId,
    chunk_index: idx,
    text,
    char_count: text.length,
    content_hash: await sha256(text),
  })));
  // Insert in batches of 100 to avoid request-size limits.
  for (let i = 0; i < rows.length; i += 100) {
    const slice = rows.slice(i, i + 100);
    const { error } = await admin.from("document_chunks").insert(slice);
    if (error) throw error;
  }
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`embedding failed ${res.status}: ${body.slice(0, 300)}`);
  }
  const j = await res.json();
  return (j.data ?? []).map((d: any) => d.embedding as number[]);
}

// ----- helpers -------------------------------------------------------------

function htmlToText(html: string): string {
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

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
