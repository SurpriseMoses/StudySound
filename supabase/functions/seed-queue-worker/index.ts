// seed-queue-worker — single global worker that processes seed_queue.
//
// Routes per document title:
//   * Titles in GEMINI_VOICE_BY_TITLE → Gemini TTS (free under Lovable AI key)
//   * Everything else → Azure TTS
// Storage paths and audio_assets columns match generate-audio so cache hits
// align when the player requests the same chunk later.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------- Azure config (fallback for non-Gemini titles) ----------
const STUDY_VOICE_NAME = "en-GB-LibbyNeural";
const STORY_VOICE_NAME = "en-GB-RyanNeural";
const VOICE_LOCALE = "en-GB";
const STUDY_SPEAKING_STYLE = "general";
const STORY_SPEAKING_STYLE = "narration-professional";
const LANGUAGE = "en";
const AZURE_REGION = "southafricanorth";

// ---------- Gemini per-book voice mapping (matches generate-audio) ----------
const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const GEMINI_VOICE_BY_TITLE: Record<string, string> = {
  "frankenstein": "Enceladus",
  "the strange case of dr jekyll and mr hyde": "Enceladus",
  "macbeth": "Charon",
  "othello": "Charon",
  "a tale of two cities": "Charon",
  "romeo and juliet": "Sulafat",
  "great expectations": "Sulafat",
  "treasure island": "Algieba",
  "the adventures of sherlock holmes": "Algieba",
};
function geminiVoiceForDoc(title: string | null | undefined): string | null {
  if (!title) return null;
  return GEMINI_VOICE_BY_TITLE[title.trim().toLowerCase()] ?? null;
}

// Worker pacing — tuned for faster sustained throughput via parallel TTS
// calls. Rate-limit handler below auto-backs-off when providers push back.
const POST_RATELIMIT_COOLDOWN_MS = 3_000;
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_DELAY_MIN_MS = 5_000;
const RATE_LIMIT_DELAY_MAX_MS = 15_000;
const RATE_LIMIT_DELAY_HARD_CAP_MS = 30_000;
const LOCK_TIMEOUT_MS = 90_000;
const HARD_DEADLINE_MS = 55_000;
const MAX_CHUNKS_PER_INVOCATION = 60;
// Per-provider concurrency. Azure handles many parallel calls easily; Gemini
// TTS is quota-constrained so we keep it sequential.
const AZURE_CONCURRENCY = 4;
const GEMINI_CONCURRENCY = 1;
const TARGET_CHUNK_SIZE = 1800;

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
function buildSSML(text: string, mode: "story" | "study", voiceName: string) {
  const processed = escapeXml(addNaturalPauses(text));
  if (mode === "story") {
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${VOICE_LOCALE}">
  <voice name="${voiceName}">
    <mstts:express-as style="${STORY_SPEAKING_STYLE}" styledegree="2.0">
      <prosody rate="0.82" pitch="-2%" contour="(0%,+0%) (50%,+8%) (100%,-4%)">${processed}</prosody>
    </mstts:express-as>
  </voice>
</speak>`;
  }
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${VOICE_LOCALE}">
  <voice name="${voiceName}">
    <mstts:express-as style="${STUDY_SPEAKING_STYLE}" styledegree="1.0">
      <prosody rate="0.95">${processed}</prosody>
    </mstts:express-as>
  </voice>
</speak>`;
}
function chunkText(text: string, size = TARGET_CHUNK_SIZE): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]+|\S+$/g) ?? [clean];
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + " " + s).length > size && buf.length > 0) {
      chunks.push(buf.trim());
      buf = s;
    } else {
      buf = buf ? buf + " " + s : s;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

class RateLimitedError extends Error {
  retryAfterMs?: number;
  constructor(msg: string, retryAfterMs?: number) {
    super(msg); this.name = "RateLimitedError"; this.retryAfterMs = retryAfterMs;
  }
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new RateLimitedError(`Upstream timeout after ${timeoutMs}ms`, 5000);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function ttsAzure(text: string, apiKey: string, mode: "story" | "study", voiceName: string): Promise<ArrayBuffer> {
  const ssml = buildSSML(text, mode, voiceName);
  const res = await fetchWithTimeout(
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
    45_000,
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


// ---------- Gemini TTS (PCM 24kHz mono → wrapped as WAV) ----------
function wrapPcm16ToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

async function ttsGemini(text: string, voiceName: string, apiKey: string): Promise<ArrayBuffer> {
  const cleaned = addNaturalPauses(text);
  const prompt = `Narrate the following passage in a calm, expressive storytelling tone:\n\n${cleaned}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    }),
  }, 60_000);

  if (!res.ok) {
    const body = await res.text();
    const errMsg = `Gemini ${res.status}: ${body.slice(0, 200)}`;
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
      throw new RateLimitedError(errMsg, retryAfterMs);
    }
    throw new Error(errMsg);
  }
  const json = await res.json();
  const part = json?.candidates?.[0]?.content?.parts?.[0];
  const b64 = part?.inlineData?.data ?? part?.inline_data?.data;
  if (!b64) throw new Error(`Gemini TTS: no audio payload`);
  const bin = atob(b64);
  const pcm = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i);
  const wav = wrapPcm16ToWav(pcm, 24000);
  return wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
}

type ChunkCacheEntry = {
  title: string;
  chunks: string[];
  mode: "story" | "study";
  provider: "azure" | "gemini";
  voiceName: string;
  speakingStyle: string;
};

// deno-lint-ignore no-explicit-any
async function processOneChunk(
  admin: any,
  azureKey: string | undefined,
  geminiKey: string | undefined,
  chunkCache: Map<string, ChunkCacheEntry>,
): Promise<{ result: "done" | "empty" | "rate_limited" | "error"; detail?: string; queue_id?: string }> {
  const nowIso = new Date().toISOString();

  // One-book-at-a-time: lock onto the document that already has the oldest
  // ready row, then take that doc's lowest-index chunk. This finishes a book
  // before starting another, instead of interleaving across the whole queue.
  const { data: activeRow, error: activeErr } = await admin
    .from("seed_queue")
    .select("document_id")
    .eq("status", "pending")
    .or(`delayed_until.is.null,delayed_until.lte.${nowIso}`)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (activeErr) throw activeErr;
  if (!activeRow) return { result: "empty" };

  const { data: queueRow, error: pickErr } = await admin
    .from("seed_queue")
    .select("id, document_id, chunk_index, attempts")
    .eq("status", "pending")
    .eq("document_id", activeRow.document_id)
    .or(`delayed_until.is.null,delayed_until.lte.${nowIso}`)
    .order("chunk_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pickErr) throw pickErr;
  if (!queueRow) return { result: "empty" };

  const { data: claimed, error: claimErr } = await admin
    .from("seed_queue")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", queueRow.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimErr) throw claimErr;
  if (!claimed) return { result: "empty" };

  await admin.from("seed_worker_state").update({
    current_queue_id: queueRow.id,
    current_document_id: queueRow.document_id,
    last_heartbeat: new Date().toISOString(),
  }).eq("id", 1);

  const retryCount = queueRow.attempts ?? 0;

  await admin.from("seed_logs").insert({
    document_id: queueRow.document_id,
    chunk_index: queueRow.chunk_index,
    status: "started",
    retry_count: retryCount,
  });
  await admin.from("documents").update({
    current_chunk_index: queueRow.chunk_index,
    last_error: null,
  }).eq("id", queueRow.document_id);

  let docEntry = chunkCache.get(queueRow.document_id);
  if (!docEntry) {
    const { data: doc, error: docErr } = await admin
      .from("documents")
      .select("id, title, clean_text, subject_type")
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

    const mode: "story" | "study" = doc.subject_type === "novel" ? "story" : "study";
    const gv = geminiVoiceForDoc(doc.title);
    let provider: "azure" | "gemini";
    let voiceName: string;
    let speakingStyle: string;
    if (gv && geminiKey) {
      provider = "gemini";
      voiceName = gv;
      speakingStyle = "narration-professional";
    } else {
      provider = "azure";
      voiceName = mode === "story" ? STORY_VOICE_NAME : STUDY_VOICE_NAME;
      speakingStyle = mode === "story" ? STORY_SPEAKING_STYLE : STUDY_SPEAKING_STYLE;
    }

    docEntry = {
      title: doc.title,
      chunks: chunkText(doc.clean_text),
      mode,
      provider,
      voiceName,
      speakingStyle,
    };
    chunkCache.set(queueRow.document_id, docEntry);
    console.log(`[worker] doc=${doc.title} → provider=${provider} voice=${voiceName} chunks=${docEntry.chunks.length}`);
  }

  const { provider, voiceName, speakingStyle, mode } = docEntry;

  if (queueRow.chunk_index >= docEntry.chunks.length) {
    await admin.from("seed_queue").update({
      status: "failed", last_error: `chunk_index ${queueRow.chunk_index} out of range (${docEntry.chunks.length})`,
      attempts: (queueRow.attempts ?? 0) + 1,
    }).eq("id", queueRow.id);
    return { result: "error", detail: "out of range" };
  }
  const doc = { id: queueRow.document_id, title: docEntry.title };
  const text = docEntry.chunks[queueRow.chunk_index];

  const expectedHash = await sha256Hex(text);

  const { data: existing } = await admin
    .from("audio_assets")
    .select("id, clean_text_hash, storage_path")
    .eq("document_id", doc.id)
    .eq("chunk_index", queueRow.chunk_index)
    .eq("language", LANGUAGE)
    .eq("voice_provider", provider)
    .eq("voice_name", voiceName)
    .eq("speaking_style", speakingStyle)
    .maybeSingle();
  if (existing && existing.clean_text_hash === expectedHash) {
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
    return { result: "done", detail: "cached" };
  }

  const ext = provider === "gemini" ? "wav" : "mp3";
  const contentType = provider === "gemini" ? "audio/wav" : "audio/mpeg";
  const path = `audio/${doc.id}/${LANGUAGE}/${provider}/${voiceName}/${speakingStyle}/${queueRow.chunk_index}.${ext}`;

  try {
    let audio: ArrayBuffer;
    if (provider === "gemini") {
      if (!geminiKey) throw new Error("Gemini key not configured");
      audio = await ttsGemini(text, voiceName, geminiKey);
    } else {
      if (!azureKey) throw new Error("Azure key not configured");
      audio = await ttsAzure(text, azureKey, mode, voiceName);
    }

    let upErr: { message: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await admin.storage.from("assets").upload(path, new Uint8Array(audio), {
          contentType, upsert: true,
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

    if (existing?.id) {
      const { error: updErr } = await admin.from("audio_assets").update({
        storage_path: path,
        char_count: text.length,
        clean_text_hash: expectedHash,
        cleaning_version: 2,
      }).eq("id", existing.id);
      if (updErr) throw new Error(`Update audio_asset: ${updErr.message}`);
    } else {
      const { error: insErr } = await admin.from("audio_assets").insert({
        document_id: doc.id,
        chunk_index: queueRow.chunk_index,
        language: LANGUAGE,
        voice_provider: provider,
        voice_name: voiceName,
        speaking_style: speakingStyle,
        storage_path: path,
        char_count: text.length,
        clean_text_hash: expectedHash,
        cleaning_version: 2,
      });
      if (insErr && insErr.code !== "23505") {
        throw new Error(`Insert audio_asset: ${insErr.message}`);
      }
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

    await admin.from("documents").update({
      seed_audio_progress: queueRow.chunk_index,
    }).eq("id", doc.id).lt("seed_audio_progress", queueRow.chunk_index);

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

    console.log(`[worker] ✓ ${provider} doc=${doc.title} chunk=${queueRow.chunk_index} (${text.length} chars)`);
    return { result: "done" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const attempts = (queueRow.attempts ?? 0) + 1;
    const docId = queueRow.document_id;
    const chunkIdx = queueRow.chunk_index;

    if (e instanceof RateLimitedError) {
      // Upstream quota/timeout — NOT the chunk's fault. Do not count toward
      // MAX_ATTEMPTS; keep as pending with a long backoff so it resumes
      // automatically once the provider quota refreshes.
      const baseDelay = e.retryAfterMs ?? RATE_LIMIT_DELAY_MIN_MS;
      const jitter = Math.floor(Math.random() * (RATE_LIMIT_DELAY_MAX_MS - RATE_LIMIT_DELAY_MIN_MS));
      const delayMs = Math.min(Math.max(baseDelay, RATE_LIMIT_DELAY_MIN_MS) + jitter, RATE_LIMIT_DELAY_HARD_CAP_MS);
      const delayedUntil = new Date(Date.now() + delayMs).toISOString();

      await admin.from("seed_queue").update({
        status: "pending",
        started_at: null,
        // Keep attempts where it was — rate-limits don't burn the retry budget.
        attempts: queueRow.attempts ?? 0,
        delayed_until: delayedUntil,
        last_error: `rate-limited (quota/timeout, will auto-retry): ${msg.slice(0, 300)}`,
      }).eq("id", queueRow.id);

      await admin.from("seed_logs").insert({
        document_id: docId,
        chunk_index: chunkIdx,
        status: "rate_limited",
        error_message: msg,
        retry_count: queueRow.attempts ?? 0,
      });
      await admin.from("documents").update({
        last_error: `rate-limited: ${msg.slice(0, 300)}`,
      }).eq("id", docId);

      return { result: "rate_limited", detail: msg, queue_id: queueRow.id };
    }

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

    console.error(`[worker] ✗ doc=${docId} chunk=${chunkIdx} attempts=${attempts}: ${msg}`);
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
    const GEMINI_KEY = Deno.env.get("Gemini_Secret_Key");
    if (!AZURE_KEY && !GEMINI_KEY) throw new Error("Neither Azure nor Gemini TTS key configured");

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

    const { data: state } = await admin.from("seed_worker_state").select("*").eq("id", 1).maybeSingle();
    if (!state?.is_running) {
      return new Response(JSON.stringify({ ok: true, status: "paused", processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
    await admin.from("seed_worker_state").update({
      last_heartbeat: new Date().toISOString(),
    }).eq("id", 1);

    let processed = 0;
    let rateLimited = false;
    let lastResult: { result: string; detail?: string } | null = null;

    const chunkCache = new Map<string, ChunkCacheEntry>();

    while (Date.now() - startedAt < HARD_DEADLINE_MS && processed < MAX_CHUNKS_PER_INVOCATION) {
      const { data: liveState } = await admin.from("seed_worker_state").select("is_running").eq("id", 1).maybeSingle();
      if (!liveState?.is_running) break;

      const res = await processOneChunk(admin, AZURE_KEY, GEMINI_KEY, chunkCache);
      lastResult = res;

      if (res.result === "empty") break;

      if (res.result === "done") {
        processed++;
        await admin.from("seed_worker_state").update({
          last_heartbeat: new Date().toISOString(),
          total_processed: (state.total_processed ?? 0) + processed,
        }).eq("id", 1);
        if (processed >= MAX_CHUNKS_PER_INVOCATION) break;
        const remaining = HARD_DEADLINE_MS - (Date.now() - startedAt);
        if (remaining < INTER_CHUNK_DELAY_MS + 10_000) break;
        await sleep(INTER_CHUNK_DELAY_MS);
      } else if (res.result === "rate_limited") {
        rateLimited = true;
        const remaining = HARD_DEADLINE_MS - (Date.now() - startedAt);
        if (remaining < POST_RATELIMIT_COOLDOWN_MS + 5_000) break;
        await sleep(POST_RATELIMIT_COOLDOWN_MS);
      } else {
        const remaining = HARD_DEADLINE_MS - (Date.now() - startedAt);
        if (remaining < INTER_CHUNK_DELAY_MS + 10_000) break;
        await sleep(INTER_CHUNK_DELAY_MS);
      }
    }

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
