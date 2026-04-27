// seed-audio-assets — admin-only batch narrator for seeded public-domain books.
//
// Walks `documents` where `seed_audio=true AND seed_audio_status<>'done'`,
// chunks `clean_text` into ~700-char sentence-bounded pieces, generates Azure
// TTS audio for any chunks not already in `audio_assets`, uploads them to the
// shared `assets` bucket, and inserts a cache row. Designed to run inside the
// 150s edge-function ceiling and be re-invoked safely:
//
//   * Resumes from `documents.seed_audio_progress`
//   * Skips chunks already in `audio_assets` (global cache)
//   * Marks the doc `done` once every chunk is cached
//   * Marks `failed` and stores the error if anything blows up mid-batch
//
// Body params (all optional):
//   {
//     document_id?: string,   // narrate just this doc (else next pending)
//     max_chunks?: number     // how many new chunks to generate this call (default 25)
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { cleanRawText, isInvalidChunk, type DocKind } from "../_shared/clean-text.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Match the brief: 500–800 chars; aim for ~700 with sentence-bounded splits.
const TARGET_CHUNK_SIZE = 700;
const HARD_MIN = 400;

const VOICE_NAME = "en-GB-LibbyNeural";
const VOICE_LOCALE = "en-GB";
const SPEAKING_STYLE = "general";
const LANGUAGE = "en";
const VOICE_PROVIDER = "azure";
const AZURE_REGION = "southafricanorth";
const DEFAULT_MAX_CHUNKS = 5;
// Pause between successful chunks to stay under Azure's per-second quota.
const INTER_CHUNK_DELAY_MS = 2500;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function addNaturalPauses(text: string): string {
  return text
    .replace(/\.(?!\s)/g, ". ")
    .replace(/,(?!\s)/g, ", ")
    .replace(/\?(?!\s)/g, "? ")
    .replace(/!(?!\s)/g, "! ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSSML(text: string): string {
  const processed = escapeXml(addNaturalPauses(text));
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${VOICE_LOCALE}">
  <voice name="${VOICE_NAME}">
    <mstts:express-as style="${SPEAKING_STYLE}" styledegree="1.0">
      <prosody rate="0.95">${processed}</prosody>
    </mstts:express-as>
  </voice>
</speak>`;
}

// Sentence-aware splitter. Targets TARGET_CHUNK_SIZE but never goes below
// HARD_MIN unless it's the last fragment of the doc.
function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S+$/g) ?? [clean];
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    const sentence = s.trim();
    if (!sentence) continue;
    if (buf.length === 0) {
      buf = sentence;
      continue;
    }
    const candidate = `${buf} ${sentence}`;
    if (candidate.length >= TARGET_CHUNK_SIZE && buf.length >= HARD_MIN) {
      chunks.push(buf);
      buf = sentence;
    } else {
      buf = candidate;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

class RateLimitedError extends Error {
  constructor(msg: string) { super(msg); this.name = "RateLimitedError"; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ttsAzure(text: string, apiKey: string): Promise<ArrayBuffer> {
  const ssml = buildSSML(text);
  // Up to 4 attempts (=> 3 retries) with exponential backoff on 429/5xx: 2s, 5s, 10s, 20s.
  const delays = [2000, 5000, 10000, 20000];
  let lastErr = "";
  for (let attempt = 0; attempt < delays.length; attempt++) {
    const res = await fetch(
      `https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": apiKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "studysound-seeder",
        },
        body: ssml,
      },
    );
    if (res.ok) {
      if (attempt > 0) {
        console.log(`[seed-audio-assets] Azure recovered after ${attempt} retr${attempt === 1 ? "y" : "ies"}`);
      }
      return res.arrayBuffer();
    }
    const body = await res.text();
    lastErr = `Azure ${res.status}: ${body.slice(0, 200)}`;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable) throw new Error(lastErr);
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.max(retryAfter * 1000, delays[attempt])
      : delays[attempt];
    console.warn(`[seed-audio-assets] Azure ${res.status} (rate limit), backoff ${wait}ms (attempt ${attempt + 1}/${delays.length})`);
    await sleep(wait);
  }
  throw new RateLimitedError(lastErr || "Azure rate limited after 3 retries");
}

type DocRow = {
  id: string;
  title: string;
  clean_text: string | null;
  raw_text: string | null;
  subject_type: string;
  tags: unknown;
  seed_audio_status: string;
  seed_audio_progress: number;
};

function inferKind(doc: DocRow): DocKind {
  // tags may carry { kind: "play" | "novel" }
  if (Array.isArray(doc.tags)) {
    for (const t of doc.tags as Array<Record<string, unknown>>) {
      if (t && typeof t.kind === "string" && (t.kind === "play" || t.kind === "novel")) {
        return t.kind as DocKind;
      }
    }
  }
  // Fallback heuristic: titles we know are plays
  const playTitles = ["macbeth", "romeo and juliet", "othello", "hamlet", "julius caesar", "the merchant of venice"];
  if (playTitles.includes(doc.title.toLowerCase())) return "play";
  return "novel";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY")!;
    const AZURE_KEY = Deno.env.get("Azure_Secret_Key_SpeechServices");
    if (!AZURE_KEY) {
      return new Response(JSON.stringify({ error: "Azure TTS key not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------- Admin auth ----------
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
    const { data: roleRow } = await admin
      .from("user_roles").select("id")
      .eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------- Parse body ----------
    const body = await req.json().catch(() => ({}));
    const requestedDocId: string | undefined = body?.document_id;
    const forceReclean: boolean = body?.force_reclean === true;
    const maxChunks = Math.max(
      1,
      Math.min(200, Number(body?.max_chunks ?? DEFAULT_MAX_CHUNKS)),
    );

    // ---------- Pick a document ----------
    const docQuery = admin
      .from("documents")
      .select("id, title, clean_text, raw_text, subject_type, tags, seed_audio_status, seed_audio_progress")
      .eq("seed_audio", true);
    const { data: doc, error: docErr } = requestedDocId
      ? await docQuery.eq("id", requestedDocId).maybeSingle()
      : await docQuery.neq("seed_audio_status", "done")
          .order("seed_audio_status", { ascending: true })
          .limit(1).maybeSingle();
    if (docErr) throw docErr;
    if (!doc) {
      return new Response(JSON.stringify({
        success: true, message: "No documents pending narration.",
        total_documents_processed: 0, total_chunks_generated: 0,
        total_chunks_skipped: 0, failed_chunks: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- Re-clean if needed (or forced) ----------
    let cleanText = doc.clean_text;
    if (forceReclean || !cleanText || cleanText.length < 1000) {
      if (!doc.raw_text) {
        await admin.from("documents").update({
          seed_audio_status: "failed",
          seed_audio_error: "Missing raw_text; cannot clean.",
        }).eq("id", doc.id);
        return new Response(JSON.stringify({
          success: false, document_id: doc.id, error: "Missing raw_text",
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await admin.from("documents").update({ seed_audio_status: "cleaning" }).eq("id", doc.id);
      const kind = inferKind(doc as DocRow);
      const cleaned = cleanRawText(doc.raw_text, kind);
      cleanText = cleaned.text;
      await admin.from("documents").update({
        clean_text: cleanText, char_count: cleaned.charCount,
      }).eq("id", doc.id);
    }

    const chunks = chunkText(cleanText!);
    const totalChunks = chunks.length;
    if (totalChunks === 0) {
      await admin.from("documents").update({
        seed_audio_status: "failed",
        seed_audio_error: "Cleaned text produced 0 chunks.",
      }).eq("id", doc.id);
      return new Response(JSON.stringify({
        success: false, document_id: doc.id, error: "No chunks",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Mark processing
    await admin.from("documents").update({
      seed_audio_status: "processing", seed_audio_error: null,
    }).eq("id", doc.id);

    // ---------- Find which chunks already exist (global cache) ----------
    const { data: existingRows } = await admin
      .from("audio_assets")
      .select("chunk_index")
      .eq("document_id", doc.id)
      .eq("language", LANGUAGE)
      .eq("voice_provider", VOICE_PROVIDER)
      .eq("voice_name", VOICE_NAME)
      .eq("speaking_style", SPEAKING_STYLE);
    const existingSet = new Set((existingRows ?? []).map((r) => r.chunk_index));

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    const failures: Array<{ chunk_index: number; error: string }> = [];
    let highestCompleted = doc.seed_audio_progress ?? -1;

    // Resume from progress, but don't trust it if existingSet says we're further along.
    const startFrom = Math.max(0, highestCompleted + 1);

    for (let i = startFrom; i < totalChunks; i++) {
      if (generated >= maxChunks) break;

      if (existingSet.has(i)) {
        skipped++;
        if (i > highestCompleted) highestCompleted = i;
        continue;
      }

      const text = chunks[i];
      const path = `audio/${doc.id}/${LANGUAGE}/${VOICE_PROVIDER}/${i}.mp3`;
      try {
        const audio = await ttsAzure(text, AZURE_KEY);

        // Retry storage upload up to 3 times. The Storage API occasionally
        // returns an HTML gateway page (502/504) which the SDK then fails to
        // parse as JSON ("Unexpected token '<'"). Treat those as transient.
        let upErr: { message: string } | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await admin.storage
              .from("assets")
              .upload(path, new Uint8Array(audio), {
                contentType: "audio/mpeg", upsert: true,
              });
            upErr = r.error;
          } catch (uploadEx) {
            // SDK threw (e.g. JSON parse on HTML error page).
            upErr = { message: uploadEx instanceof Error ? uploadEx.message : String(uploadEx) };
          }
          if (!upErr) break;
          console.warn(`[seed-audio-assets] storage upload retry ${attempt + 1}: ${upErr.message}`);
          await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        }
        if (upErr) throw new Error(`Storage upload: ${upErr.message}`);

        const { error: insErr } = await admin.from("audio_assets").insert({
          document_id: doc.id,
          chunk_index: i,
          language: LANGUAGE,
          voice_provider: VOICE_PROVIDER,
          voice_name: VOICE_NAME,
          speaking_style: SPEAKING_STYLE,
          storage_path: path,
          char_count: text.length,
        });
        if (insErr) {
          // Race-safe: if another invocation just inserted it, treat as skipped.
          if (insErr.code === "23505") {
            skipped++;
          } else {
            throw new Error(`Insert audio_asset: ${insErr.message}`);
          }
        } else {
          generated++;
          console.log(`[seed-audio-assets] ✓ chunk ${i}/${totalChunks - 1} cached (doc=${doc.id})`);
        }
        if (i > highestCompleted) highestCompleted = i;
        await admin.from("documents").update({
          seed_audio_progress: highestCompleted,
        }).eq("id", doc.id);
        // Throttle to avoid Azure per-second quota — skip wait on the final chunk of this batch.
        if (generated < maxChunks && i < totalChunks - 1) {
          await sleep(INTER_CHUNK_DELAY_MS);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isStorageBlip = /Storage upload:/.test(msg) && (
          /Unexpected token/.test(msg) || /<!DOCTYPE/.test(msg) ||
          /\b50\d\b/.test(msg) || /timeout/i.test(msg) || /fetch failed/i.test(msg)
        );
        const isRateLimited = e instanceof RateLimitedError || /\b429\b/.test(msg) || isStorageBlip;
        console.error(`[seed-audio-assets] doc=${doc.id} chunk=${i} failed:`, msg);

        if (isRateLimited) {
          // Soft-pause: keep status 'processing' and return 200 so the auto-loop
          // can wait and resume instead of marking the doc failed.
          await admin.from("documents").update({
            seed_audio_status: "processing",
            seed_audio_progress: highestCompleted,
            seed_audio_error: `rate_limited at chunk ${i}`,
          }).eq("id", doc.id);
          return new Response(JSON.stringify({
            success: true,
            rate_limited: true,
            retry_after_ms: 30000,
            document_id: doc.id,
            title: doc.title,
            total_documents_processed: 1,
            total_chunks: totalChunks,
            total_chunks_generated: generated,
            total_chunks_skipped: skipped,
            failed_chunks: 0,
            highest_completed: highestCompleted,
            status: "processing",
            remaining: Math.max(0, totalChunks - (highestCompleted + 1)),
            message: "Azure rate limit hit; pausing. Re-invoke after a short wait.",
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        failed++;
        failures.push({ chunk_index: i, error: msg });
        await admin.from("documents").update({
          seed_audio_status: "failed",
          seed_audio_error: `chunk ${i}: ${msg}`,
        }).eq("id", doc.id);
        return new Response(JSON.stringify({
          success: false,
          document_id: doc.id,
          title: doc.title,
          total_documents_processed: 1,
          total_chunks_generated: generated,
          total_chunks_skipped: skipped,
          failed_chunks: failed,
          failures,
          total_chunks: totalChunks,
          highest_completed: highestCompleted,
        }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Determine done state.
    const doneAfter = highestCompleted >= totalChunks - 1
      // Confirm by counting cached rows so we never mark done with gaps.
      ? (await admin.from("audio_assets")
          .select("chunk_index", { count: "exact", head: true })
          .eq("document_id", doc.id)
          .eq("language", LANGUAGE)
          .eq("voice_provider", VOICE_PROVIDER)
          .eq("voice_name", VOICE_NAME)
          .eq("speaking_style", SPEAKING_STYLE)).count
      : null;

    const isDone = doneAfter !== null && doneAfter >= totalChunks;
    await admin.from("documents").update({
      seed_audio_status: isDone ? "done" : "processing",
      seed_audio_progress: highestCompleted,
      seed_audio_error: null,
    }).eq("id", doc.id);

    return new Response(JSON.stringify({
      success: true,
      document_id: doc.id,
      title: doc.title,
      total_documents_processed: 1,
      total_chunks: totalChunks,
      total_chunks_generated: generated,
      total_chunks_skipped: skipped,
      failed_chunks: failed,
      highest_completed: highestCompleted,
      status: isDone ? "done" : "processing",
      remaining: Math.max(0, totalChunks - (highestCompleted + 1)),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("seed-audio-assets error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
