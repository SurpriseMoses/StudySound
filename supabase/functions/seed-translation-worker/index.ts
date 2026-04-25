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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TARGET_CHUNK_SIZE = 700;
const HARD_MIN = 400;

const INTER_CHUNK_DELAY_MS = 250;
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_DELAY_MIN_MS = 5_000;
const RATE_LIMIT_DELAY_MAX_MS = 15_000;
const RATE_LIMIT_DELAY_HARD_CAP_MS = 30_000;
const LOCK_TIMEOUT_MS = 90_000;
const HARD_DEADLINE_MS = 50_000;
const MAX_CHUNKS_PER_INVOCATION = 25;

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

class RateLimitedError extends Error {
  retryAfterMs?: number;
  constructor(msg: string, retryAfterMs?: number) {
    super(msg); this.name = "RateLimitedError"; this.retryAfterMs = retryAfterMs;
  }
}

async function azureTranslate(text: string, sourceLang: string, targetLang: string, apiKey: string): Promise<string> {
  const from = AZURE_TRANSLATOR_LANG[sourceLang];
  const to = AZURE_TRANSLATOR_LANG[targetLang];
  if (!from || !to) throw new Error(`AZURE_LANG_UNSUPPORTED:${sourceLang}->${targetLang}`);

  const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=${from}&to=${to}&textType=plain`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Ocp-Apim-Subscription-Region": AZURE_TRANSLATOR_REGION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([{ Text: text }]),
  });
  if (res.ok) {
    const json = await res.json();
    const out = json?.[0]?.translations?.[0]?.text;
    if (!out || typeof out !== "string") throw new Error("Empty Azure response");
    return out.trim();
  }
  const body = await res.text();
  const errMsg = `Azure ${res.status}: ${body.slice(0, 200)}`;
  if (res.status === 429 || res.status >= 500) {
    const ra = Number(res.headers.get("retry-after"));
    const retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined;
    throw new RateLimitedError(errMsg, retryAfterMs);
  }
  throw new Error(errMsg);
}

type DocCacheEntry = { chunks: string[]; sourceLang: string; title: string };

// deno-lint-ignore no-explicit-any
async function processOne(admin: any, azureKey: string, cache: Map<string, DocCacheEntry>) {
  const nowIso = new Date().toISOString();
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
  if (!row) return { result: "empty" as const };

  const { data: claimed, error: claimErr } = await admin
    .from("translation_seed_queue")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", row.id).eq("status", "pending")
    .select("id").maybeSingle();
  if (claimErr) throw claimErr;
  if (!claimed) return { result: "empty" as const };

  await admin.from("translation_worker_state").update({
    current_queue_id: row.id,
    current_document_id: row.document_id,
    current_language: row.target_language,
    last_heartbeat: new Date().toISOString(),
  }).eq("id", 1);

  const retryCount = row.attempts ?? 0;
  await admin.from("translation_seed_logs").insert({
    document_id: row.document_id,
    chunk_index: row.chunk_index,
    target_language: row.target_language,
    status: "started",
    retry_count: retryCount,
  });

  // Load doc + chunk text
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
        attempts: retryCount + 1,
      }).eq("id", row.id);
      return { result: "error" as const, detail: "missing clean_text" };
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
      attempts: retryCount + 1,
    }).eq("id", row.id);
    return { result: "error" as const, detail: "out of range" };
  }

  const sourceText = entry.chunks[row.chunk_index];

  // Idempotency check
  const { data: existing } = await admin
    .from("translation_assets")
    .select("id")
    .eq("document_id", row.document_id)
    .eq("chunk_index", row.chunk_index)
    .eq("target_language", row.target_language)
    .maybeSingle();
  if (existing) {
    await admin.from("translation_seed_queue").update({
      status: "done", completed_at: new Date().toISOString(),
      attempts: retryCount + 1,
    }).eq("id", row.id);
    await admin.from("translation_seed_logs").insert({
      document_id: row.document_id,
      chunk_index: row.chunk_index,
      target_language: row.target_language,
      status: "success",
      error_message: "cached",
      retry_count: retryCount,
    });
    return { result: "done" as const, detail: "cached" };
  }

  try {
    // Preprocess (normalize caps), then translate
    const prepared = normalizeAllCaps(sourceText);
    const translated = await azureTranslate(prepared, entry.sourceLang, row.target_language, azureKey);

    const { error: insErr } = await admin.from("translation_assets").insert({
      document_id: row.document_id,
      chunk_index: row.chunk_index,
      source_language: entry.sourceLang,
      target_language: row.target_language,
      translated_text: translated,
      char_count: translated.length,
    });
    if (insErr && insErr.code !== "23505") {
      throw new Error(`Insert translation_asset: ${insErr.message}`);
    }

    await admin.from("translation_seed_queue").update({
      status: "done", completed_at: new Date().toISOString(),
      attempts: retryCount + 1, last_error: null,
    }).eq("id", row.id);

    await admin.from("translation_seed_logs").insert({
      document_id: row.document_id,
      chunk_index: row.chunk_index,
      target_language: row.target_language,
      status: "success",
      retry_count: retryCount,
    });

    // Mark doc done if no more outstanding rows
    const { count: pendingForDoc } = await admin.from("translation_seed_queue")
      .select("id", { count: "exact", head: true })
      .eq("document_id", row.document_id)
      .in("status", ["pending", "processing", "failed"]);
    if (pendingForDoc === 0) {
      await admin.from("documents").update({
        translation_status: "done",
      }).eq("id", row.document_id);
    }

    console.log(`[t-worker] ✓ doc=${row.document_id} chunk=${row.chunk_index} ${entry.sourceLang}→${row.target_language}`);
    return { result: "done" as const };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const attempts = retryCount + 1;

    if (e instanceof RateLimitedError) {
      const exhausted = attempts >= MAX_ATTEMPTS;
      const baseDelay = e.retryAfterMs ?? RATE_LIMIT_DELAY_MIN_MS;
      const jitter = Math.floor(Math.random() * (RATE_LIMIT_DELAY_MAX_MS - RATE_LIMIT_DELAY_MIN_MS));
      const delayMs = Math.min(Math.max(baseDelay, RATE_LIMIT_DELAY_MIN_MS) + jitter, RATE_LIMIT_DELAY_HARD_CAP_MS);
      await admin.from("translation_seed_queue").update({
        status: exhausted ? "failed" : "pending",
        started_at: null, attempts,
        delayed_until: exhausted ? null : new Date(Date.now() + delayMs).toISOString(),
        last_error: `rate-limited (${attempts}/${MAX_ATTEMPTS}): ${msg}`,
      }).eq("id", row.id);
      await admin.from("translation_seed_logs").insert({
        document_id: row.document_id,
        chunk_index: row.chunk_index,
        target_language: row.target_language,
        status: "rate_limited",
        error_message: msg,
        retry_count: attempts,
      });
      return { result: "rate_limited" as const, detail: msg };
    }

    const exhausted = attempts >= MAX_ATTEMPTS;
    await admin.from("translation_seed_queue").update({
      status: exhausted ? "failed" : "pending",
      started_at: null, attempts,
      delayed_until: exhausted ? null : new Date(Date.now() + 30_000).toISOString(),
      last_error: msg,
    }).eq("id", row.id);
    await admin.from("translation_seed_logs").insert({
      document_id: row.document_id,
      chunk_index: row.chunk_index,
      target_language: row.target_language,
      status: "failed",
      error_message: msg,
      retry_count: attempts,
    });
    if (exhausted) {
      await admin.from("documents").update({
        translation_status: "failed",
      }).eq("id", row.document_id);
    }
    return { result: "error" as const, detail: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const AZURE_KEY = Deno.env.get("Azure_Secret_Key_Translator");
    if (!AZURE_KEY) throw new Error("Azure Translator key not configured");
    if (!AZURE_KEY) throw new Error("Azure Translator key not configured");

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
      const r = await processOne(admin, AZURE_KEY, cache);
      if (r.result === "empty") { stop = true; break; }
      if (r.result === "done") processed++;
      await admin.from("translation_worker_state").update({
        last_heartbeat: new Date().toISOString(),
        total_processed: (state.total_processed ?? 0) + processed,
      }).eq("id", 1);
      await sleep(INTER_CHUNK_DELAY_MS);
    }

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
