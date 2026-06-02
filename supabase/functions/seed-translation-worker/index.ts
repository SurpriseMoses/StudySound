// seed-translation-worker — Gemini Batch API mode.
//
// Each tick (called from cron or manually):
//   1) POLL: for every distinct batch_job_name in translation_seed_queue
//      where status='batched', GET its status. On SUCCEEDED, write
//      translation_assets and mark rows 'done'. On row-level errors, return
//      them to 'pending' with exp-backoff.
//   2) SUBMIT: if we're below the in-flight job cap, claim up to N pending
//      rows for the oldest active document, submit them as one batch, and
//      mark them 'batched' with the operation name.
//
// No per-request retry loops or sleeps — the batch API absorbs that. Saves
// ~50% on per-token cost vs. interactive generateContent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { isInvalidChunk } from "../_shared/clean-text.ts";
import {
  CURRENT_TRANSLATION_VERSION,
  LANGUAGE_LABELS,
  preprocessForTranslation,
  sha256Hex,
  detectEnglishLeak,
} from "../_shared/translation-pipeline.ts";
import {
  submitBatch,
  pollBatch,
  extractText,
  type BatchRequestItem,
} from "../_shared/gemini-batch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "gemini-2.5-flash";
const TARGET_CHUNK_SIZE = 700;
const HARD_MIN = 400;

// One batch holds at most this many requests across at most this many docs.
const MAX_REQUESTS_PER_BATCH = 200;
const MAX_INFLIGHT_BATCHES = 2;
const MAX_ATTEMPTS = 6;

// Row-level error back-off.
const ERROR_BASE_MS = 30_000;
const ERROR_HARD_CAP_MS = 30 * 60_000;

function expBackoffMs(attempts: number, base: number, cap: number): number {
  const exp = Math.min(cap, base * Math.pow(2, Math.max(0, attempts - 1)));
  return Math.min(cap, exp + Math.floor(Math.random() * 5_000));
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S+$/g) ?? [clean];
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    const sentence = s.trim();
    if (!sentence) continue;
    if (buf.length === 0) { buf = sentence; continue; }
    const candidate = `${buf} ${sentence}`;
    if (candidate.length >= TARGET_CHUNK_SIZE && buf.length >= HARD_MIN) {
      chunks.push(buf); buf = sentence;
    } else { buf = candidate; }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function buildSystemPrompt(sourceLabel: string, targetLabel: string, blueprint?: string): string {
  const base =
    `You are a professional translator for South African high-school study material. ` +
    `Translate the user's text from ${sourceLabel} to ${targetLabel}. ` +
    `Rules:\n` +
    `1. Output ONLY the translated text. No preface, no quotes, no notes, no source.\n` +
    `2. Preserve line breaks and paragraph structure exactly.\n` +
    `3. Translate ALL words — do NOT leave English words, headings, or ALL-CAPS phrases untranslated, unless they are proper names.\n` +
    `4. Keep numbers, dates, and proper nouns as-is.\n` +
    `5. Use natural, clear ${targetLabel} suitable for a teenage learner.`;
  if (!blueprint) return base;
  return `${base}\n\n=== PER-BOOK TRANSLATION BLUEPRINT ===\nApply every detail below as ground truth when translating this chunk. Use the character glossary for consistent naming, the idiom guide for archaic phrases, and the plot summary for register/tone.\n\n${blueprint}`;
}

function buildRequest(
  text: string,
  sourceLang: string,
  targetLang: string,
  blueprint: string | undefined,
): BatchRequestItem {
  const sourceLabel = LANGUAGE_LABELS[sourceLang] ?? sourceLang;
  const targetLabel = LANGUAGE_LABELS[targetLang] ?? targetLang;
  return {
    request: {
      systemInstruction: { parts: [{ text: buildSystemPrompt(sourceLabel, targetLabel, blueprint) }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { temperature: 0.2 },
    },
  };
}

type DocCacheEntry = { chunks: string[]; sourceLang: string; title: string; blueprint?: string };

// deno-lint-ignore no-explicit-any
async function loadDocEntry(admin: any, documentId: string, cache: Map<string, DocCacheEntry>): Promise<DocCacheEntry | null> {
  const cached = cache.get(documentId);
  if (cached) return cached;
  const [{ data: doc }, { data: bp }] = await Promise.all([
    admin.from("documents").select("id, title, clean_text, language").eq("id", documentId).maybeSingle(),
    admin.from("translation_blueprints").select("blueprint_text").eq("document_id", documentId).maybeSingle(),
  ]);
  if (!doc?.clean_text) return null;
  const entry: DocCacheEntry = {
    chunks: chunkText(doc.clean_text),
    sourceLang: (doc.language ?? "en").toLowerCase(),
    title: doc.title,
    blueprint: bp?.blueprint_text ?? undefined,
  };
  cache.set(documentId, entry);
  return entry;
}

// ─── POLL PHASE ──────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function pollInFlightBatches(admin: any, apiKey: string, cache: Map<string, DocCacheEntry>) {
  const { data: distinct, error } = await admin
    .from("translation_seed_queue")
    .select("batch_job_name")
    .eq("status", "batched")
    .not("batch_job_name", "is", null);
  if (error) throw error;
  const jobNames = Array.from(new Set((distinct ?? []).map((r: any) => r.batch_job_name as string)));

  const results: Array<Record<string, unknown>> = [];

  for (const jobName of jobNames) {
    try {
      const status = await pollBatch(jobName, apiKey);
      if (status.state !== "JOB_STATE_SUCCEEDED") {
        if (
          status.state === "JOB_STATE_FAILED" ||
          status.state === "JOB_STATE_CANCELLED" ||
          status.state === "JOB_STATE_EXPIRED"
        ) {
          // Whole batch died — return all member rows to pending with exp-backoff.
          const { data: members } = await admin
            .from("translation_seed_queue")
            .select("id, attempts")
            .eq("batch_job_name", jobName);
          for (const m of members ?? []) {
            const attempts = (m.attempts ?? 0) + 1;
            const exhausted = attempts >= MAX_ATTEMPTS;
            const delay = expBackoffMs(attempts, ERROR_BASE_MS, ERROR_HARD_CAP_MS);
            await admin.from("translation_seed_queue").update({
              status: exhausted ? "failed" : "pending",
              attempts,
              started_at: null,
              delayed_until: exhausted ? null : new Date(Date.now() + delay).toISOString(),
              batch_job_name: null,
              batch_index: null,
              batch_submitted_at: null,
              last_error: `batch ${status.state}: ${status.error?.message ?? ""}`.slice(0, 400),
            }).eq("id", m.id);
          }
          results.push({ job: jobName, state: status.state, requeued: members?.length ?? 0 });
        } else {
          results.push({ job: jobName, state: status.state });
        }
        continue;
      }

      // SUCCEEDED — apply per-row results.
      const inlined = status.inlinedResponses ?? [];
      const { data: rows } = await admin
        .from("translation_seed_queue")
        .select("id, document_id, chunk_index, target_language, attempts, batch_index")
        .eq("batch_job_name", jobName)
        .order("batch_index", { ascending: true });

      let okCount = 0, failCount = 0;
      const inserts: Array<Record<string, unknown>> = [];
      const doneIds: string[] = [];
      const retryUpdates: Array<{ id: string; attempts: number; error: string }> = [];

      for (const row of rows ?? []) {
        const item = inlined[row.batch_index ?? -1];
        if (!item || item.error) {
          retryUpdates.push({
            id: row.id,
            attempts: (row.attempts ?? 0) + 1,
            error: item?.error?.message ?? "missing batch slot",
          });
          failCount++;
          continue;
        }
        try {
          const docEntry = await loadDocEntry(admin, row.document_id, cache);
          if (!docEntry || row.chunk_index >= docEntry.chunks.length) {
            retryUpdates.push({ id: row.id, attempts: MAX_ATTEMPTS, error: "doc/chunk missing on poll" });
            failCount++;
            continue;
          }
          const preparedSource = preprocessForTranslation(docEntry.chunks[row.chunk_index]);
          const currentHash = await sha256Hex(preparedSource);
          const translated = extractText(item.response)
            .replace(/^```[a-z]*\n?/i, "")
            .replace(/```$/i, "")
            .trim();
          if (!translated) {
            retryUpdates.push({ id: row.id, attempts: (row.attempts ?? 0) + 1, error: "empty translation" });
            failCount++;
            continue;
          }
          const leak = detectEnglishLeak(translated, row.target_language);
          inserts.push({
            document_id: row.document_id,
            chunk_index: row.chunk_index,
            source_language: docEntry.sourceLang,
            target_language: row.target_language,
            translated_text: translated,
            char_count: translated.length,
            source_text_hash: currentHash,
            translation_version: CURRENT_TRANSLATION_VERSION,
            english_leak_detected: leak.leaked,
          });
          doneIds.push(row.id);
          okCount++;
        } catch (e) {
          retryUpdates.push({
            id: row.id,
            attempts: (row.attempts ?? 0) + 1,
            error: e instanceof Error ? e.message : String(e),
          });
          failCount++;
        }
      }

      if (inserts.length > 0) {
        // Best-effort: ignore 23505 dupes.
        const { error: insErr } = await admin.from("translation_assets").insert(inserts);
        if (insErr && insErr.code !== "23505") {
          console.warn(`[t-worker] insert assets failed: ${insErr.message}`);
        }
      }
      if (doneIds.length > 0) {
        await admin.from("translation_seed_queue").update({
          status: "done",
          completed_at: new Date().toISOString(),
          last_error: null,
        }).in("id", doneIds);
      }
      for (const r of retryUpdates) {
        const exhausted = r.attempts >= MAX_ATTEMPTS;
        const delay = expBackoffMs(r.attempts, ERROR_BASE_MS, ERROR_HARD_CAP_MS);
        await admin.from("translation_seed_queue").update({
          status: exhausted ? "failed" : "pending",
          attempts: r.attempts,
          started_at: null,
          delayed_until: exhausted ? null : new Date(Date.now() + delay).toISOString(),
          batch_job_name: null,
          batch_index: null,
          batch_submitted_at: null,
          last_error: `batch row failed (${r.attempts}/${MAX_ATTEMPTS}): ${r.error}`.slice(0, 400),
        }).eq("id", r.id);
      }

      // Doc-level done check for every doc touched.
      const touchedDocIds = Array.from(new Set((rows ?? []).map((r: any) => r.document_id as string)));
      for (const docId of touchedDocIds) {
        const { count } = await admin.from("translation_seed_queue")
          .select("id", { count: "exact", head: true })
          .eq("document_id", docId)
          .in("status", ["pending", "processing", "batched", "failed"]);
        if (count === 0) {
          await admin.from("documents").update({ translation_status: "done" }).eq("id", docId);
        }
      }

      results.push({ job: jobName, state: status.state, ok: okCount, fail: failCount });
    } catch (e) {
      results.push({ job: jobName, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { polled: results, inflight: jobNames.length };
}

// ─── SUBMIT PHASE ─────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function submitNextBatch(admin: any, apiKey: string, cache: Map<string, DocCacheEntry>) {
  const nowIso = new Date().toISOString();

  // Pick the oldest doc with ready pending rows.
  const { data: docPick } = await admin
    .from("translation_seed_queue")
    .select("document_id")
    .eq("status", "pending")
    .or(`delayed_until.is.null,delayed_until.lte.${nowIso}`)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!docPick) return { submitted: 0, reason: "no pending rows" };

  // Claim up to MAX_REQUESTS_PER_BATCH for that doc.
  const { data: candidates } = await admin
    .from("translation_seed_queue")
    .select("id, document_id, chunk_index, target_language, attempts")
    .eq("status", "pending")
    .eq("document_id", docPick.document_id)
    .or(`delayed_until.is.null,delayed_until.lte.${nowIso}`)
    .order("chunk_index", { ascending: true })
    .order("target_language", { ascending: true })
    .limit(MAX_REQUESTS_PER_BATCH);
  if (!candidates || candidates.length === 0) return { submitted: 0, reason: "no candidates" };

  const docEntry = await loadDocEntry(admin, docPick.document_id, cache);
  if (!docEntry) {
    // Mark all rows for this doc failed — no clean_text.
    await admin.from("translation_seed_queue").update({
      status: "failed", last_error: "doc missing clean_text",
    }).eq("document_id", docPick.document_id).in("id", candidates.map((c: any) => c.id));
    return { submitted: 0, reason: "no clean_text" };
  }

  // Build per-row request payload + skip invalid/out-of-range/cached.
  type Pending = { row: typeof candidates[number]; sourceHash: string; preparedText: string };
  const pendings: Pending[] = [];
  const skipImmediate: string[] = []; // queue ids to mark done as "skipped"

  // Pre-compute hashes and skip invalid/out-of-range rows.
  for (const row of candidates) {
    if (row.chunk_index >= docEntry.chunks.length) {
      skipImmediate.push(row.id);
      continue;
    }
    const sourceText = docEntry.chunks[row.chunk_index];
    if (isInvalidChunk(sourceText)) {
      skipImmediate.push(row.id);
      continue;
    }
    const prepared = preprocessForTranslation(sourceText);
    const hash = await sha256Hex(prepared);
    pendings.push({ row, sourceHash: hash, preparedText: prepared });
  }

  if (skipImmediate.length > 0) {
    await admin.from("translation_seed_queue").update({
      status: "done",
      completed_at: new Date().toISOString(),
      last_error: "skipped: invalid/out-of-range",
    }).in("id", skipImmediate);
  }

  if (pendings.length === 0) return { submitted: 0, reason: "all skipped" };

  // Idempotency: skip rows already cached with matching hash + version + no leak.
  const { data: existing } = await admin
    .from("translation_assets")
    .select("id, chunk_index, target_language, translated_text, source_text_hash, translation_version, english_leak_detected")
    .eq("document_id", docPick.document_id)
    .in("chunk_index", Array.from(new Set(pendings.map((p) => p.row.chunk_index))));

  const cachedKey = new Set<string>();
  const staleIds: string[] = [];
  for (const e of existing ?? []) {
    const dirty =
      e.english_leak_detected === true ||
      (e.translation_version ?? 1) < CURRENT_TRANSLATION_VERSION ||
      detectEnglishLeak(e.translated_text ?? "", e.target_language).leaked;
    // We can't compare hash without knowing the matching pending row's hash; do it inline:
    const matching = pendings.find((p) => p.row.chunk_index === e.chunk_index && p.row.target_language === e.target_language);
    if (matching && e.source_text_hash && e.source_text_hash !== matching.sourceHash) {
      staleIds.push(e.id);
      continue;
    }
    if (!dirty) cachedKey.add(`${e.chunk_index}:${e.target_language}`);
  }
  if (staleIds.length > 0) {
    await admin.from("translation_assets").delete().in("id", staleIds);
  }

  const cachedRowIds = pendings
    .filter((p) => cachedKey.has(`${p.row.chunk_index}:${p.row.target_language}`))
    .map((p) => p.row.id);
  if (cachedRowIds.length > 0) {
    await admin.from("translation_seed_queue").update({
      status: "done",
      completed_at: new Date().toISOString(),
      last_error: "cached",
    }).in("id", cachedRowIds);
  }

  const todo = pendings.filter((p) => !cachedKey.has(`${p.row.chunk_index}:${p.row.target_language}`));
  if (todo.length === 0) return { submitted: 0, reason: "all cached" };

  // Build batch requests in deterministic order, then submit.
  const requests: BatchRequestItem[] = todo.map((p) =>
    buildRequest(p.preparedText, docEntry.sourceLang, p.row.target_language, docEntry.blueprint));

  // Atomically claim TODO rows.
  const claimedIds = todo.map((p) => p.row.id);
  const { data: claimed, error: claimErr } = await admin
    .from("translation_seed_queue")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .in("id", claimedIds)
    .eq("status", "pending")
    .select("id");
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length === 0) return { submitted: 0, reason: "claim race" };

  // Filter todo + requests to actually-claimed rows (in case of races).
  const claimedSet = new Set(claimed.map((c: any) => c.id));
  const finalTodo: typeof todo = [];
  const finalRequests: BatchRequestItem[] = [];
  for (let i = 0; i < todo.length; i++) {
    if (claimedSet.has(todo[i].row.id)) {
      finalTodo.push(todo[i]);
      finalRequests.push(requests[i]);
    }
  }
  if (finalTodo.length === 0) return { submitted: 0, reason: "no claims survived" };

  let jobName: string;
  try {
    const submitted = await submitBatch(MODEL, finalRequests, apiKey, `translations-${docPick.document_id.slice(0, 8)}-${Date.now()}`);
    jobName = submitted.name;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Submit failed — return rows to pending with backoff.
    await admin.from("translation_seed_queue").update({
      status: "pending",
      started_at: null,
      delayed_until: new Date(Date.now() + 60_000).toISOString(),
      last_error: `batch submit failed: ${msg.slice(0, 300)}`,
    }).in("id", Array.from(claimedSet));
    throw e;
  }

  // Mark rows 'batched' with their slot index.
  for (let i = 0; i < finalTodo.length; i++) {
    await admin.from("translation_seed_queue").update({
      status: "batched",
      batch_job_name: jobName,
      batch_index: i,
      batch_submitted_at: new Date().toISOString(),
      last_error: null,
    }).eq("id", finalTodo[i].row.id);
  }

  console.log(`[t-worker] submitted batch ${jobName} doc=${docPick.document_id} rows=${finalTodo.length}`);
  return {
    submitted: finalTodo.length,
    batch_job_name: jobName,
    document_id: docPick.document_id,
    cached: cachedRowIds.length,
    skipped: skipImmediate.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GEMINI_KEY = Deno.env.get("Gemini_Secret_Key");
    if (!GEMINI_KEY) throw new Error("Gemini_Secret_Key not configured (required for Batch API)");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: state } = await admin.from("translation_worker_state").select("*").eq("id", 1).maybeSingle();
    if (!state?.is_running) {
      return new Response(JSON.stringify({ ok: true, status: "paused" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("translation_worker_state").update({
      last_heartbeat: new Date().toISOString(),
      last_error: null,
    }).eq("id", 1);

    const cache = new Map<string, DocCacheEntry>();

    // 1) Poll any in-flight batches.
    const pollOut = await pollInFlightBatches(admin, GEMINI_KEY, cache);

    // 2) Submit fresh batches up to the in-flight cap.
    const submissions: Array<Record<string, unknown>> = [];
    let inflightCount = pollOut.inflight;
    while (inflightCount < MAX_INFLIGHT_BATCHES) {
      const sub = await submitNextBatch(admin, GEMINI_KEY, cache);
      submissions.push(sub);
      if ((sub.submitted as number) === 0) break;
      inflightCount++;
    }

    return new Response(JSON.stringify({
      ok: true,
      mode: "batch",
      poll: pollOut.polled,
      submit: submissions,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[t-worker]", msg);
    try {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await admin.from("translation_worker_state").update({
        last_error: msg, last_heartbeat: null,
      }).eq("id", 1);
    } catch { /* ignore */ }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
