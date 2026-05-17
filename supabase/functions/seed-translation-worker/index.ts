// seed-translation-worker — single global worker that drains
// translation_seed_queue, translating chunks into zu/xh/tn/nso via Azure
// Translator and writing into translation_assets.
//
// Behaviour mirrors seed-queue-worker (audio): single lock via
// translation_worker_state, batched processing per invocation, exponential
// back-off on 429s, idempotent on cached translations.
//
// Optional cron: ping POST every ~30s while is_running = true.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { isInvalidChunk } from "../_shared/clean-text.ts";
import {
  CURRENT_TRANSLATION_VERSION,
  preprocessForTranslation,
  sha256Hex,
  detectEnglishLeak,
  geminiTranslateMulti,
  TranslationRateLimitError,
} from "../_shared/translation-pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TARGET_CHUNK_SIZE = 700;
const HARD_MIN = 400;

const INTER_CHUNK_DELAY_MS = 0;
const MAX_ATTEMPTS = 8;
// Exponential back-off for rate-limited rows: base * 2^(attempt-1) + jitter,
// clamped to [MIN, HARD_CAP]. Honours Azure's Retry-After when supplied.
const RATE_LIMIT_BASE_MS = 2_000;
const RATE_LIMIT_DELAY_MIN_MS = 2_000;
const RATE_LIMIT_DELAY_HARD_CAP_MS = 5 * 60_000; // 5 min
const RATE_LIMIT_JITTER_MS = 1_500;
// Generic transient errors back off more gently
const ERROR_BASE_MS = 10_000;
const ERROR_HARD_CAP_MS = 2 * 60_000;
const LOCK_TIMEOUT_MS = 90_000;
const HARD_DEADLINE_MS = 50_000;
const MAX_CHUNKS_PER_INVOCATION = 200;
// If the only remaining work is delayed, wait up to this long inside the
// invocation for the soonest row to become ready (avoids cron-only requeue lag).
const MAX_INLINE_WAIT_MS = 8_000;

function expBackoffMs(attempts: number, base: number, cap: number, jitter = RATE_LIMIT_JITTER_MS): number {
  // attempts is the new attempt count (1 = first failure)
  const exp = Math.min(cap, base * Math.pow(2, Math.max(0, attempts - 1)));
  const j = Math.floor(Math.random() * jitter);
  return Math.min(cap, Math.max(RATE_LIMIT_DELAY_MIN_MS, exp + j));
}

const AZURE_TRANSLATOR_REGION = Deno.env.get("AZURE_TRANSLATOR_REGION") ?? "southafricanorth";

const AZURE_TRANSLATOR_LANG: Record<string, string> = {
  en: "en", af: "af", zu: "zu", xh: "xh", nso: "nso", tn: "tn", fr: "fr",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// --- preprocessing: normalize ALL CAPS / title-case to fix translation bugs ---
function toSentenceCaseHeading(line: string): string {
  let out = line.toLowerCase();
  out = out.replace(/\b(mr|mrs|ms|dr|prof|st)\./g, (a) => a.charAt(0).toUpperCase() + a.slice(1));
  out = out.replace(/(^|[\s“"'‘’(\[])([a-z])/g, (_, p: string, c: string) => `${p}${c.toUpperCase()}`);
  out = out.replace(/([.!?:;]\s+)([a-z])/g, (_, p: string, c: string) => `${p}${c.toUpperCase()}`);
  out = out.replace(/\b([ivxlcdm]+)\b/gi, (r) => r.toUpperCase());
  return out;
}

function normalizeAllCaps(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    const letters = trimmed.match(/[A-Za-z]/g) ?? [];
    const upper = trimmed.match(/[A-Z]/g) ?? [];
    const ratio = letters.length > 0 ? upper.length / letters.length : 0;
    if (letters.length >= 4 && ratio >= 0.8) {
      const lead = line.match(/^\s*/)?.[0] ?? "";
      const trail = line.match(/\s*$/)?.[0] ?? "";
      return `${lead}${toSentenceCaseHeading(trimmed)}${trail}`;
    }
    return line;
  });
  return lines.join("\n").replace(/\b[A-Z][A-Z'’\-]*[A-Z]\b/g, (w) =>
    w.charAt(0) + w.slice(1).toLowerCase());
}

// Translate one source text into N target languages via Lovable AI (Gemini).
// Re-uses the shared geminiTranslateMulti helper. Maps its 429 rate-limit
// error onto the worker's back-off path via the existing pending-row delay.
async function translateMulti(text: string, sourceLang: string, targetLangs: string[]): Promise<Record<string, string>> {
  try {
    return await geminiTranslateMulti(text, sourceLang, targetLangs);
  } catch (e) {
    if (e instanceof TranslationRateLimitError) {
      // Re-throw as plain Error so existing catch path treats as transient/retry.
      const err = new Error(e.message) as Error & { retryAfterMs?: number };
      err.retryAfterMs = e.retryAfterMs;
      throw err;
    }
    throw e;
  }
}

type DocCacheEntry = { chunks: string[]; sourceLang: string; title: string };

// deno-lint-ignore no-explicit-any
async function processOne(admin: any, _unused: string, cache: Map<string, DocCacheEntry>) {
  const nowIso = new Date().toISOString();
  // Pick one pending row to determine (document_id, chunk_index) batch
  const { data: row, error: pickErr } = await admin
    .from("translation_seed_queue")
    .select("id, document_id, chunk_index, target_language, attempts")
    .eq("status", "pending")
    .or(`delayed_until.is.null,delayed_until.lte.${nowIso}`)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pickErr) throw pickErr;
  if (!row) return { result: "empty" as const, count: 0 };

  // Grab all sibling pending rows for same doc+chunk (different target langs)
  const { data: siblings } = await admin
    .from("translation_seed_queue")
    .select("id, document_id, chunk_index, target_language, attempts")
    .eq("status", "pending")
    .eq("document_id", row.document_id)
    .eq("chunk_index", row.chunk_index)
    .or(`delayed_until.is.null,delayed_until.lte.${nowIso}`);

  const batch = (siblings && siblings.length > 0 ? siblings : [row]) as Array<typeof row>;
  const ids = batch.map((b) => b.id);

  // Atomically claim
  const { data: claimed, error: claimErr } = await admin
    .from("translation_seed_queue")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .in("id", ids).eq("status", "pending")
    .select("id, target_language, attempts");
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length === 0) return { result: "empty" as const, count: 0 };

  const claimedRows = batch.filter((b) => claimed.some((c: any) => c.id === b.id));
  const claimedIds = claimedRows.map((b) => b.id);

  await admin.from("translation_worker_state").update({
    current_queue_id: row.id,
    current_document_id: row.document_id,
    current_language: claimedRows.map((c) => c.target_language).join(","),
    last_heartbeat: new Date().toISOString(),
  }).eq("id", 1);

  // Load doc + chunks
  let entry = cache.get(row.document_id);
  if (!entry) {
    const { data: doc, error: docErr } = await admin
      .from("documents")
      .select("id, title, clean_text, language")
      .eq("id", row.document_id)
      .maybeSingle();
    if (docErr) throw docErr;
    if (!doc?.clean_text) {
      await admin.from("translation_seed_queue").update({
        status: "failed", last_error: "Document missing clean_text",
      }).in("id", claimedIds);
      return { result: "error" as const, count: 0, detail: "missing clean_text" };
    }
    entry = {
      chunks: chunkText(doc.clean_text),
      sourceLang: (doc.language ?? "en").toLowerCase(),
      title: doc.title,
    };
    cache.set(row.document_id, entry);
  }

  if (row.chunk_index >= entry.chunks.length) {
    await admin.from("translation_seed_queue").update({
      status: "failed",
      last_error: `chunk_index ${row.chunk_index} out of range (${entry.chunks.length})`,
    }).in("id", claimedIds);
    return { result: "error" as const, count: 0, detail: "out of range" };
  }

  const sourceText = entry.chunks[row.chunk_index];

  // Skip junk fragments
  if (isInvalidChunk(sourceText)) {
    await admin.from("translation_seed_queue").update({
      status: "done", completed_at: new Date().toISOString(),
      last_error: "skipped: invalid chunk",
    }).in("id", claimedIds);
    return { result: "done" as const, count: claimedRows.length, detail: "invalid chunk skipped" };
  }

  // Compute hash of the preprocessed source up-front so cache validation matches generate-translation.
  const preparedSource = preprocessForTranslation(sourceText);
  const currentHash = await sha256Hex(preparedSource);

  // Idempotency: only treat rows as "cached" if version + hash match AND no leak.
  const { data: existing } = await admin
    .from("translation_assets")
    .select("id, target_language, translated_text, source_text_hash, translation_version, english_leak_detected")
    .eq("document_id", row.document_id)
    .eq("chunk_index", row.chunk_index)
    .in("target_language", claimedRows.map((c) => c.target_language));

  const validCachedLangs = new Set<string>();
  const staleRowIds: string[] = [];
  for (const e of existing ?? []) {
    const ver = e.translation_version ?? 1;
    const dirty =
      e.english_leak_detected === true ||
      ver < CURRENT_TRANSLATION_VERSION ||
      (e.source_text_hash && e.source_text_hash !== currentHash) ||
      detectEnglishLeak(e.translated_text ?? "", e.target_language).leaked;
    if (dirty) {
      staleRowIds.push(e.id);
    } else {
      validCachedLangs.add(e.target_language);
    }
  }
  if (staleRowIds.length > 0) {
    console.log(`[t-worker] deleting ${staleRowIds.length} stale translation_assets for doc=${row.document_id} chunk=${row.chunk_index}`);
    await admin.from("translation_assets").delete().in("id", staleRowIds);
  }

  const cachedRows = claimedRows.filter((c) => validCachedLangs.has(c.target_language));
  const todoRows = claimedRows.filter((c) => !validCachedLangs.has(c.target_language));

  if (cachedRows.length > 0) {
    await admin.from("translation_seed_queue").update({
      status: "done", completed_at: new Date().toISOString(),
      last_error: "cached",
    }).in("id", cachedRows.map((c) => c.id));
  }

  if (todoRows.length === 0) {
    return { result: "done" as const, count: cachedRows.length, detail: "all cached" };
  }

  try {
    const targetLangs = todoRows.map((c) => c.target_language);
    const translations = await translateMulti(preparedSource, entry.sourceLang, targetLangs);

    const inserts = todoRows
      .map((c) => {
        const t = translations[c.target_language];
        if (!t) return null;
        const leak = detectEnglishLeak(t, c.target_language);
        return {
          document_id: c.document_id,
          chunk_index: c.chunk_index,
          source_language: entry!.sourceLang,
          target_language: c.target_language,
          translated_text: t,
          char_count: t.length,
          source_text_hash: currentHash,
          translation_version: CURRENT_TRANSLATION_VERSION,
          english_leak_detected: leak.leaked,
        };
      })
      .filter(Boolean);

    if (inserts.length > 0) {
      const { error: insErr } = await admin.from("translation_assets").insert(inserts);
      if (insErr && insErr.code !== "23505") {
        throw new Error(`Insert translation_assets: ${insErr.message}`);
      }
    }

    await admin.from("translation_seed_queue").update({
      status: "done", completed_at: new Date().toISOString(), last_error: null,
    }).in("id", todoRows.map((c) => c.id));

    // Mark doc done if no outstanding
    const { count: pendingForDoc } = await admin.from("translation_seed_queue")
      .select("id", { count: "exact", head: true })
      .eq("document_id", row.document_id)
      .in("status", ["pending", "processing", "failed"]);
    if (pendingForDoc === 0) {
      await admin.from("documents").update({
        translation_status: "done",
      }).eq("id", row.document_id);
    }

    console.log(`[t-worker] ✓ doc=${row.document_id} chunk=${row.chunk_index} langs=${targetLangs.join(",")}`);
    return { result: "done" as const, count: cachedRows.length + todoRows.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    const retryAfterMs = (e as { retryAfterMs?: number })?.retryAfterMs;
    if (retryAfterMs !== undefined || /rate.?limit|429/i.test(msg)) {
      // Per-row exponential back-off; honour Retry-After as a floor.
      for (const c of todoRows) {
        const attempts = (c.attempts ?? 0) + 1;
        const exhausted = attempts >= MAX_ATTEMPTS;
        const expDelay = expBackoffMs(attempts, RATE_LIMIT_BASE_MS, RATE_LIMIT_DELAY_HARD_CAP_MS);
        const delayMs = Math.max(retryAfterMs ?? 0, expDelay);
        await admin.from("translation_seed_queue").update({
          status: exhausted ? "failed" : "pending",
          started_at: null, attempts,
          delayed_until: exhausted ? null : new Date(Date.now() + delayMs).toISOString(),
          last_error: `rate-limited (${attempts}/${MAX_ATTEMPTS}, retry in ${Math.round(delayMs / 1000)}s): ${msg}`,
        }).eq("id", c.id);
      }
      return { result: "rate_limited" as const, count: 0, detail: msg };
    }

    for (const c of todoRows) {
      const attempts = (c.attempts ?? 0) + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      const delayMs = expBackoffMs(attempts, ERROR_BASE_MS, ERROR_HARD_CAP_MS);
      await admin.from("translation_seed_queue").update({
        status: exhausted ? "failed" : "pending",
        started_at: null, attempts,
        delayed_until: exhausted ? null : new Date(Date.now() + delayMs).toISOString(),
        last_error: `error (${attempts}/${MAX_ATTEMPTS}, retry in ${Math.round(delayMs / 1000)}s): ${msg}`,
      }).eq("id", c.id);
    }
    return { result: "error" as const, count: 0, detail: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Auth: allow either an admin user JWT OR a cron/internal call (any valid JWT
    // — anon or service role — is fine since this is a non-destructive worker
    // that only drains a queue and writes to admin-only tables via service role).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: state } = await admin.from("translation_worker_state").select("*").eq("id", 1).maybeSingle();
    if (!state?.is_running) {
      return new Response(JSON.stringify({ ok: true, status: "paused", processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lock: refuse if another worker heartbeated recently
    const now = Date.now();
    if (state.last_heartbeat) {
      const last = new Date(state.last_heartbeat).getTime();
      if (now - last < LOCK_TIMEOUT_MS) {
        return new Response(JSON.stringify({
          ok: true, status: "another_worker_active", processed: 0,
          last_heartbeat: state.last_heartbeat,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    await admin.from("translation_worker_state").update({
      last_heartbeat: new Date().toISOString(),
    }).eq("id", 1);

    const cache = new Map<string, DocCacheEntry>();
    let processed = 0;
    let stop = false;
    while (!stop && processed < MAX_CHUNKS_PER_INVOCATION) {
      if (Date.now() - startedAt > HARD_DEADLINE_MS) break;
      const r = await processOne(admin, LOVABLE_KEY, cache);
      if (r.result === "empty") {
        // Nothing immediately ready. If a delayed row is due soon AND we still
        // have deadline budget, sleep briefly and try once more — this keeps
        // the rate-limit recovery loop tight without waiting for cron.
        const remaining = HARD_DEADLINE_MS - (Date.now() - startedAt);
        if (remaining < 2_000) { stop = true; break; }
        const { data: nextDelayed } = await admin
          .from("translation_seed_queue")
          .select("delayed_until")
          .eq("status", "pending")
          .not("delayed_until", "is", null)
          .order("delayed_until", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!nextDelayed?.delayed_until) { stop = true; break; }
        const waitMs = Math.max(
          0,
          Math.min(MAX_INLINE_WAIT_MS, remaining - 2_000,
            new Date(nextDelayed.delayed_until).getTime() - Date.now()),
        );
        if (waitMs > MAX_INLINE_WAIT_MS) { stop = true; break; }
        if (waitMs > 0) await sleep(waitMs);
        continue; // retry pick on next iteration
      }
      if (r.result === "done") processed += r.count ?? 1;
      await admin.from("translation_worker_state").update({
        last_heartbeat: new Date().toISOString(),
        total_processed: (state.total_processed ?? 0) + processed,
      }).eq("id", 1);
      if (INTER_CHUNK_DELAY_MS > 0) await sleep(INTER_CHUNK_DELAY_MS);
    }

    // Release the soft lock when this invocation exits cleanly. If the
    // function crashes, the heartbeat remains and LOCK_TIMEOUT_MS still lets a
    // later cron tick recover after it goes stale.
    await admin.from("translation_worker_state").update({
      current_queue_id: null,
      current_document_id: null,
      current_language: null,
      last_heartbeat: null,
    }).eq("id", 1);

    return new Response(JSON.stringify({ ok: true, processed, ms: Date.now() - startedAt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seed-translation-worker]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
