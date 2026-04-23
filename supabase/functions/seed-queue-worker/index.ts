// seed-queue-worker — single global worker that processes seed_queue.
//
// Concurrency model:
//   * seed_worker_state has exactly one row (id=1).
//   * On invoke: if is_running=false → exit (paused).
//   * Acquire lock by atomic update where last_heartbeat IS NULL OR is older
//     than LOCK_TIMEOUT_MS. If we don't get the row, another worker is alive — exit.
//   * Process one chunk at a time, sleep INTER_CHUNK_DELAY_MS between calls,
//     longer pause every BATCH_SIZE chunks. Exit before edge timeout (~140s).
//
// Throttling:
//   * 5s between requests (INTER_CHUNK_DELAY_MS)
//   * After every 10 chunks, extra 30s pause (LONG_PAUSE_MS)
//   * On 429: 10s → 20s → 40s exponential, max 3 retries
//
// To run continuously: client polls / calls every ~30s while is_running=true,
// or set up a pg_cron job that pings this endpoint.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VOICE_NAME = "en-GB-LibbyNeural";
const VOICE_LOCALE = "en-GB";
const SPEAKING_STYLE = "general";
const LANGUAGE = "en";
const VOICE_PROVIDER = "azure";
const AZURE_REGION = "southafricanorth";

// Tuned for Azure Standard (S0) tier — 200 TPS quota in southafricanorth.
// Single global worker, dedicated resource → push hard.
const INTER_CHUNK_DELAY_MS = 300;        // 300ms between successful chunks (was 1.5s)
const POST_RATELIMIT_COOLDOWN_MS = 1500;  // brief pause after a 429 (was 4s)
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_DELAY_MIN_MS = 5_000;   // defer 5s (was 15s)
const RATE_LIMIT_DELAY_MAX_MS = 15_000;  // up to 15s (was 30s)
const RATE_LIMIT_DELAY_HARD_CAP_MS = 30_000; // hard cap 30s (was 60s)
const LOCK_TIMEOUT_MS = 90_000;
const HARD_DEADLINE_MS = 50_000;         // stay well below runtime budget
const MAX_CHUNKS_PER_INVOCATION = 12;    // smaller batches avoid cumulative CPU exhaustion
const TARGET_CHUNK_SIZE = 700;
const HARD_MIN = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function addNaturalPauses(text: string) {
  return text
    .replace(/\.(?!\s)/g, ". ").replace(/,(?!\s)/g, ", ")
    .replace(/\?(?!\s)/g, "? ").replace(/!(?!\s)/g, "! ")
    .replace(/\s+/g, " ").trim();
}
function buildSSML(text: string) {
  const processed = escapeXml(addNaturalPauses(text));
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${VOICE_LOCALE}">
  <voice name="${VOICE_NAME}">
    <mstts:express-as style="${SPEAKING_STYLE}" styledegree="1.0">
      <prosody rate="0.95">${processed}</prosody>
    </mstts:express-as>
  </voice>
</speak>`;
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

class RateLimitedError extends Error {
  retryAfterMs?: number;
  constructor(msg: string, retryAfterMs?: number) {
    super(msg); this.name = "RateLimitedError"; this.retryAfterMs = retryAfterMs;
  }
}

async function ttsAzure(text: string, apiKey: string): Promise<ArrayBuffer> {
  const ssml = buildSSML(text);
  const res = await fetch(
    `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "studysound-queue-worker",
      },
      body: ssml,
    },
  );
  if (res.ok) return res.arrayBuffer();
  const body = await res.text();
  const errMsg = `Azure ${res.status}: ${body.slice(0, 200)}`;
  if (res.status === 429 || res.status >= 500) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
    throw new RateLimitedError(errMsg, retryAfterMs);
  }
  throw new Error(errMsg);
}

type ChunkCacheEntry = {
  title: string;
  chunks: string[];
};

// deno-lint-ignore no-explicit-any
async function processOneChunk(
  admin: any,
  azureKey: string,
  chunkCache: Map<string, ChunkCacheEntry>,
): Promise<{ result: "done" | "empty" | "rate_limited" | "error"; detail?: string; queue_id?: string }> {
  // Pick the next pending row globally that is NOT delayed.
  // delayed_until IS NULL OR delayed_until <= now()
  const nowIso = new Date().toISOString();
  const { data: queueRow, error: pickErr } = await admin
    .from("seed_queue")
    .select("id, document_id, chunk_index, attempts")
    .eq("status", "pending")
    .or(`delayed_until.is.null,delayed_until.lte.${nowIso}`)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pickErr) throw pickErr;
  if (!queueRow) return { result: "empty" };

  // Atomically claim it (only if still pending — avoids races even though we're "single worker").
  const { data: claimed, error: claimErr } = await admin
    .from("seed_queue")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", queueRow.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimErr) throw claimErr;
  if (!claimed) return { result: "empty" }; // someone else grabbed it

  await admin.from("seed_worker_state").update({
    current_queue_id: queueRow.id,
    current_document_id: queueRow.document_id,
    last_heartbeat: new Date().toISOString(),
  }).eq("id", 1);

  const retryCount = queueRow.attempts ?? 0;

  // Log: started
  await admin.from("seed_logs").insert({
    document_id: queueRow.document_id,
    chunk_index: queueRow.chunk_index,
    status: "started",
    retry_count: retryCount,
  });
  // Live debug fields on documents
  await admin.from("documents").update({
    current_chunk_index: queueRow.chunk_index,
    last_error: null,
  }).eq("id", queueRow.document_id);

  // Load doc + clean_text + chunk text
  let docEntry = chunkCache.get(queueRow.document_id);
  if (!docEntry) {
    const { data: doc, error: docErr } = await admin
      .from("documents")
      .select("id, title, clean_text")
      .eq("id", queueRow.document_id)
      .maybeSingle();
    if (docErr) throw docErr;
    if (!doc?.clean_text) {
      await admin.from("seed_queue").update({
        status: "failed", last_error: "Document missing clean_text",
        attempts: (queueRow.attempts ?? 0) + 1,
      }).eq("id", queueRow.id);
      return { result: "error", detail: "missing clean_text" };
    }

    docEntry = {
      title: doc.title,
      chunks: chunkText(doc.clean_text),
    };
    chunkCache.set(queueRow.document_id, docEntry);
  }

  if (queueRow.chunk_index >= docEntry.chunks.length) {
    await admin.from("seed_queue").update({
      status: "failed", last_error: `chunk_index ${queueRow.chunk_index} out of range (${docEntry.chunks.length})`,
      attempts: (queueRow.attempts ?? 0) + 1,
    }).eq("id", queueRow.id);
    return { result: "error", detail: "out of range" };
  }
  const doc = { id: queueRow.document_id, title: docEntry.title };
  const text = docEntry.chunks[queueRow.chunk_index];

  // Idempotency: skip if already cached.
  const { data: existing } = await admin
    .from("audio_assets")
    .select("id")
    .eq("document_id", doc.id)
    .eq("chunk_index", queueRow.chunk_index)
    .eq("language", LANGUAGE)
    .eq("voice_provider", VOICE_PROVIDER)
    .eq("voice_name", VOICE_NAME)
    .eq("speaking_style", SPEAKING_STYLE)
    .maybeSingle();
  if (existing) {
    await admin.from("seed_queue").update({
      status: "done", completed_at: new Date().toISOString(),
      attempts: (queueRow.attempts ?? 0) + 1,
    }).eq("id", queueRow.id);
    await admin.from("seed_logs").insert({
      document_id: doc.id,
      chunk_index: queueRow.chunk_index,
      status: "success",
      error_message: "cached",
      retry_count: retryCount,
    });
    console.log(`[worker] skip (cached) doc=${doc.id} chunk=${queueRow.chunk_index}`);
    return { result: "done", detail: "cached" };
  }

  const path = `audio/${doc.id}/${LANGUAGE}/${VOICE_PROVIDER}/${queueRow.chunk_index}.mp3`;

  try {
    const audio = await ttsAzure(text, azureKey);

    // Storage upload with 3 retries for transient gateway errors.
    let upErr: { message: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await admin.storage.from("assets").upload(path, new Uint8Array(audio), {
          contentType: "audio/mpeg", upsert: true,
        });
        upErr = r.error;
      } catch (ex) {
        upErr = { message: ex instanceof Error ? ex.message : String(ex) };
      }
      if (!upErr) break;
      console.warn(`[worker] storage upload retry ${attempt + 1}: ${upErr.message}`);
      await sleep(1500 * (attempt + 1));
    }
    if (upErr) throw new Error(`Storage upload: ${upErr.message}`);

    const { error: insErr } = await admin.from("audio_assets").insert({
      document_id: doc.id,
      chunk_index: queueRow.chunk_index,
      language: LANGUAGE,
      voice_provider: VOICE_PROVIDER,
      voice_name: VOICE_NAME,
      speaking_style: SPEAKING_STYLE,
      storage_path: path,
      char_count: text.length,
    });
    if (insErr && insErr.code !== "23505") {
      throw new Error(`Insert audio_asset: ${insErr.message}`);
    }

    await admin.from("seed_queue").update({
      status: "done", completed_at: new Date().toISOString(),
      attempts: (queueRow.attempts ?? 0) + 1, last_error: null,
    }).eq("id", queueRow.id);

    await admin.from("seed_logs").insert({
      document_id: doc.id,
      chunk_index: queueRow.chunk_index,
      status: "success",
      retry_count: retryCount,
    });

    // Update document progress
    await admin.from("documents").update({
      seed_audio_progress: queueRow.chunk_index,
    }).eq("id", doc.id).lt("seed_audio_progress", queueRow.chunk_index);

    // If this was the last chunk for this doc, mark done.
    const { count: pendingForDoc } = await admin.from("seed_queue")
      .select("id", { count: "exact", head: true })
      .eq("document_id", doc.id)
      .in("status", ["pending", "processing", "failed"]);
    if (pendingForDoc === 0) {
      await admin.from("documents").update({
        seed_audio_status: "done", seed_audio_error: null,
      }).eq("id", doc.id);
      console.log(`[worker] 🎉 doc complete: ${doc.title}`);
    }

    console.log(`[worker] ✓ doc=${doc.id} chunk=${queueRow.chunk_index} (${text.length} chars)`);
    return { result: "done" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const attempts = (queueRow.attempts ?? 0) + 1;
    const docId = queueRow.document_id;
    const chunkIdx = queueRow.chunk_index;

    if (e instanceof RateLimitedError) {
      // DEFER: schedule a retry 60-120s in the future and move on.
      const exhausted = attempts >= MAX_ATTEMPTS;
      const baseDelay = e.retryAfterMs ?? RATE_LIMIT_DELAY_MIN_MS;
      const jitter = Math.floor(Math.random() * (RATE_LIMIT_DELAY_MAX_MS - RATE_LIMIT_DELAY_MIN_MS));
      const delayMs = Math.min(Math.max(baseDelay, RATE_LIMIT_DELAY_MIN_MS) + jitter, RATE_LIMIT_DELAY_HARD_CAP_MS);
      const delayedUntil = new Date(Date.now() + delayMs).toISOString();

      await admin.from("seed_queue").update({
        status: exhausted ? "failed" : "pending",
        started_at: null,
        attempts,
        delayed_until: exhausted ? null : delayedUntil,
        last_error: `rate-limited (attempt ${attempts}/${MAX_ATTEMPTS}): ${msg}`,
      }).eq("id", queueRow.id);

      await admin.from("seed_logs").insert({
        document_id: docId,
        chunk_index: chunkIdx,
        status: "rate_limited",
        error_message: msg,
        retry_count: attempts,
      });
      await admin.from("documents").update({
        last_error: `rate-limited: ${msg}`,
      }).eq("id", docId);

      console.warn(
        `[worker] current_chunk_id=${queueRow.id} doc=${docId} chunk=${chunkIdx} ` +
        `retry_count=${attempts}/${MAX_ATTEMPTS} last_error="rate-limited" ` +
        (exhausted ? "→ MARKED FAILED (queue continues)" : `→ deferred ${Math.round(delayMs / 1000)}s`)
      );
      return { result: "rate_limited", detail: msg, queue_id: queueRow.id };
    }

    // Hard failure (non-rate-limit). After MAX_ATTEMPTS mark failed.
    const exhausted = attempts >= MAX_ATTEMPTS;
    await admin.from("seed_queue").update({
      status: exhausted ? "failed" : "pending",
      started_at: null,
      attempts,
      delayed_until: exhausted ? null : new Date(Date.now() + 30_000).toISOString(),
      last_error: msg,
    }).eq("id", queueRow.id);

    await admin.from("seed_logs").insert({
      document_id: docId,
      chunk_index: chunkIdx,
      status: "failed",
      error_message: msg,
      retry_count: attempts,
    });
    await admin.from("documents").update({
      last_error: msg,
    }).eq("id", docId);

    console.error(
      `[worker] current_chunk_id=${queueRow.id} doc=${docId} chunk=${chunkIdx} ` +
      `retry_count=${attempts}/${MAX_ATTEMPTS} last_error="${msg}" ` +
      (exhausted ? "→ MARKED FAILED (queue continues)" : "→ will retry in 30s")
    );
    return { result: "error", detail: msg, queue_id: queueRow.id };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const AZURE_KEY = Deno.env.get("Azure_Secret_Key_SpeechServices");
    if (!AZURE_KEY) throw new Error("Azure TTS key not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from("user_roles")
      .select("id").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check is_running flag
    const { data: state } = await admin.from("seed_worker_state").select("*").eq("id", 1).maybeSingle();
    if (!state?.is_running) {
      return new Response(JSON.stringify({ ok: true, status: "paused", processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lock acquisition: refuse if another worker heartbeated within LOCK_TIMEOUT_MS.
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
    // Claim the lock by stamping our heartbeat.
    await admin.from("seed_worker_state").update({
      last_heartbeat: new Date().toISOString(),
    }).eq("id", 1);

    let processed = 0;
    let rateLimited = false;
    let lastResult: { result: string; detail?: string } | null = null;

    const chunkCache = new Map<string, ChunkCacheEntry>();

    while (Date.now() - startedAt < HARD_DEADLINE_MS && processed < MAX_CHUNKS_PER_INVOCATION) {
      // Re-check is_running so pause takes effect mid-run.
      const { data: liveState } = await admin.from("seed_worker_state").select("is_running").eq("id", 1).maybeSingle();
      if (!liveState?.is_running) break;

      const res = await processOneChunk(admin, AZURE_KEY, chunkCache);
      lastResult = res;

      if (res.result === "empty") break;

      if (res.result === "done") {
        processed++;
        await admin.from("seed_worker_state").update({
          last_heartbeat: new Date().toISOString(),
          total_processed: (state.total_processed ?? 0) + processed,
        }).eq("id", 1);
        if (processed >= MAX_CHUNKS_PER_INVOCATION) break;
        // Only sleep if we have time for it + another chunk (~10s budget).
        const remaining = HARD_DEADLINE_MS - (Date.now() - startedAt);
        if (remaining < INTER_CHUNK_DELAY_MS + 10_000) break;
        await sleep(INTER_CHUNK_DELAY_MS);
      } else if (res.result === "rate_limited") {
        // Chunk was deferred. Track it but DO NOT stop — pick the next available chunk.
        rateLimited = true;
        const remaining = HARD_DEADLINE_MS - (Date.now() - startedAt);
        if (remaining < POST_RATELIMIT_COOLDOWN_MS + 5_000) break;
        // Brief cooldown before next chunk so we don't immediately re-trigger 429.
        await sleep(POST_RATELIMIT_COOLDOWN_MS);
      } else {
        // error: small pause then continue if time allows
        const remaining = HARD_DEADLINE_MS - (Date.now() - startedAt);
        if (remaining < INTER_CHUNK_DELAY_MS + 10_000) break;
        await sleep(INTER_CHUNK_DELAY_MS);
      }
    }

    // Release lock so next invocation is allowed sooner.
    await admin.from("seed_worker_state").update({
      current_queue_id: null,
      current_document_id: null,
      last_heartbeat: null,
      last_error: rateLimited ? "rate_limited" : null,
    }).eq("id", 1);

    return new Response(JSON.stringify({
      ok: true,
      status: rateLimited ? "rate_limited" : "ok",
      processed,
      duration_ms: Date.now() - startedAt,
      last: lastResult,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seed-queue-worker]", msg);
    // Best-effort lock release.
    try {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await admin.from("seed_worker_state").update({
        last_heartbeat: null, last_error: msg,
      }).eq("id", 1);
    } catch { /* ignore */ }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
