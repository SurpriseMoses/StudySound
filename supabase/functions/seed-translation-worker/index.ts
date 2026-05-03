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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TARGET_CHUNK_SIZE = 700;
const HARD_MIN = 400;

const INTER_CHUNK_DELAY_MS = 0;
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

async function azureTranslateMulti(text: string, sourceLang: string, targetLangs: string[], apiKey: string): Promise<Record<string, string>> {
  const from = AZURE_TRANSLATOR_LANG[sourceLang];
  if (!from) throw new Error(`AZURE_LANG_UNSUPPORTED:${sourceLang}`);
  const tos = targetLangs.map((l) => {
    const t = AZURE_TRANSLATOR_LANG[l];
    if (!t) throw new Error(`AZURE_LANG_UNSUPPORTED:->${l}`);
    return t;
  });
  const toQs = tos.map((t) => `to=${t}`).join("&");
  const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=${from}&${toQs}&textType=plain`;
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
    const translations = json?.[0]?.translations;
    if (!Array.isArray(translations)) throw new Error("Empty Azure response");
    const out: Record<string, string> = {};
    for (const tr of translations) {
      // Map Azure's `to` back to our lang code
      const idx = tos.indexOf(tr.to);
      if (idx >= 0 && typeof tr.text === "string") {
        out[targetLangs[idx]] = tr.text.trim();
      }
    }
    return out;
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

  // Idempotency: drop langs already cached
  const { data: existing } = await admin
    .from("translation_assets")
    .select("target_language")
    .eq("document_id", row.document_id)
    .eq("chunk_index", row.chunk_index)
    .in("target_language", claimedRows.map((c) => c.target_language));
  const cachedLangs = new Set((existing ?? []).map((e: any) => e.target_language));
  const cachedRows = claimedRows.filter((c) => cachedLangs.has(c.target_language));
  const todoRows = claimedRows.filter((c) => !cachedLangs.has(c.target_language));

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
    const prepared = normalizeAllCaps(sourceText);
    const targetLangs = todoRows.map((c) => c.target_language);
    const translations = await azureTranslateMulti(prepared, entry.sourceLang, targetLangs, azureKey);

    const inserts = todoRows
      .map((c) => {
        const t = translations[c.target_language];
        if (!t) return null;
        return {
          document_id: c.document_id,
          chunk_index: c.chunk_index,
          source_language: entry!.sourceLang,
          target_language: c.target_language,
          translated_text: t,
          char_count: t.length,
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

    if (e instanceof RateLimitedError) {
      const baseDelay = e.retryAfterMs ?? RATE_LIMIT_DELAY_MIN_MS;
      const jitter = Math.floor(Math.random() * (RATE_LIMIT_DELAY_MAX_MS - RATE_LIMIT_DELAY_MIN_MS));
      const delayMs = Math.min(Math.max(baseDelay, RATE_LIMIT_DELAY_MIN_MS) + jitter, RATE_LIMIT_DELAY_HARD_CAP_MS);
      // Increment attempts per row; mark exhausted ones failed
      for (const c of todoRows) {
        const attempts = (c.attempts ?? 0) + 1;
        const exhausted = attempts >= MAX_ATTEMPTS;
        await admin.from("translation_seed_queue").update({
          status: exhausted ? "failed" : "pending",
          started_at: null, attempts,
          delayed_until: exhausted ? null : new Date(Date.now() + delayMs).toISOString(),
          last_error: `rate-limited (${attempts}/${MAX_ATTEMPTS}): ${msg}`,
        }).eq("id", c.id);
      }
      return { result: "rate_limited" as const, count: 0, detail: msg };
    }

    for (const c of todoRows) {
      const attempts = (c.attempts ?? 0) + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await admin.from("translation_seed_queue").update({
        status: exhausted ? "failed" : "pending",
        started_at: null, attempts,
        delayed_until: exhausted ? null : new Date(Date.now() + 30_000).toISOString(),
        last_error: msg,
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
      if (r.result === "done") processed += r.count ?? 1;
      await admin.from("translation_worker_state").update({
        last_heartbeat: new Date().toISOString(),
        total_processed: (state.total_processed ?? 0) + processed,
      }).eq("id", 1);
      if (INTER_CHUNK_DELAY_MS > 0) await sleep(INTER_CHUNK_DELAY_MS);
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
