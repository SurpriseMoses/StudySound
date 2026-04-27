// Generate audio for a single chunk of a document.
// Strategy: On-demand chunking. Client requests (lesson_id, chunk_index).
// We chunk the document deterministically server-side (~1800 chars at sentence boundaries),
// route to Azure (zu/af/xh) or ElevenLabs (others), cache globally in audio_assets,
// and charge 1 credit ONCE per user per (document, chunk, language).
// Narration tone is decided automatically by subject_type (novel → story, else → study).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE = 1800;
// All languages route to Azure. Voices are strictly per-language — never silent English fallback.
const AZURE_LANGS = new Set(["zu", "af", "xh", "en", "fr", "nso", "tn"]);

const ELEVEN_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
const ELEVEN_MODEL = "eleven_multilingual_v2";
const TRANSLATABLE_LANGS = new Set(["en", "af", "zu", "xh", "nso", "tn", "fr"]);

// =========================================================================
// VOICE ROUTING
// Single source of truth: per-language { default, literature? } voices.
// Literature voice is used for novel / drama / poetry subjects.
//
// Fallback chain (per spec):
//   1. literature voice (for literature subjects)
//   2. same-language default voice
//   3. same-language emergency fallback (last-resort native voice)
//   4. ERROR — never silently switch to English
//
// We attempt true native voices for every supported SA language. If Azure
// rejects (HTTP 400 voice-not-found), we cascade through the same language
// only.
// =========================================================================
type VoiceConfig = { default: string; literature?: string; emergency?: string };
const VOICE_CONFIG: Record<string, VoiceConfig> = {
  en:  { default: "en-GB-LibbyNeural", literature: "en-GB-RyanNeural" },
  af:  { default: "af-ZA-AdriNeural",  literature: "af-ZA-WillemNeural" },
  zu:  { default: "zu-ZA-ThandoNeural", literature: "zu-ZA-ThembaNeural" },
  fr:  { default: "fr-FR-DeniseNeural", literature: "fr-FR-HenriNeural" },
  // South African languages — native voices attempted first.
  // If Azure rejects, we fall through the per-language chain only (no English).
  xh:  { default: "xh-ZA-BongaNeural",  literature: "xh-ZA-ThandoNeural" },
  nso: { default: "nso-ZA-MorenaNeural" },
  tn:  { default: "tn-ZA-LesediNeural", literature: "tn-ZA-GabuhleNeural" },
};

const EXPRESSIVE_STYLE_LANGS = new Set(["en", "af", "zu", "fr"]);

// Languages whose translated text should be sent to TTS in their own locale.
// All entries in VOICE_CONFIG use native voices, so all are native-eligible.
const NATIVE_VOICE_LANGS = new Set(Object.keys(VOICE_CONFIG));

const LITERATURE_SUBJECTS = new Set(["novel", "drama", "poetry"]);

function isLiteratureContent(subjectType: string | null | undefined, subject?: string | null): boolean {
  if (subjectType && LITERATURE_SUBJECTS.has(subjectType.toLowerCase())) return true;
  if (subject && /english|literature|novel|drama|poetry/i.test(subject)) return true;
  return false;
}

const AZURE_LANG_LOCALE: Record<string, string> = {
  zu: "zu-ZA",
  af: "af-ZA",
  xh: "xh-ZA",
  nso: "nso-ZA",
  tn: "tn-ZA",
  en: "en-GB",
  fr: "fr-FR",
};
const AZURE_REGION = "southafricanorth";

function isUnsupportedTranslationError(message: string): boolean {
  return /TRANSLATION_UNSUPPORTED|Azure translation is not available/i.test(message);
}

function buildTranslationFallbackPayload(args: {
  text: string;
  totalChunks: number;
  chunkIndex: number;
  language: string;
  provider: "azure" | "elevenlabs";
  voiceName: string;
  speakingStyle: string;
  reason: string;
}) {
  return {
    success: true,
    fallback: true,
    audio_unavailable: true,
    audio_url: null,
    chunk_index: args.chunkIndex,
    total_chunks: args.totalChunks,
    text: args.text,
    language: args.language,
    provider: args.provider,
    voice_name: args.voiceName,
    speaking_style: args.speakingStyle,
    reused: false,
    source: "fallback",
    cache_state: "Unavailable",
    credits_charged: 0,
    error: args.reason,
  };
}

function buildAudioUnavailablePayload(args: {
  text: string;
  totalChunks: number;
  chunkIndex: number;
  language: string;
  provider: "azure" | "elevenlabs";
  voiceName: string;
  speakingStyle: string;
  reason: string;
  code?: string;
}) {
  return {
    success: true,
    fallback: true,
    audio_unavailable: true,
    audio_url: null,
    chunk_index: args.chunkIndex,
    total_chunks: args.totalChunks,
    text: args.text,
    language: args.language,
    provider: args.provider,
    voice_name: args.voiceName,
    speaking_style: args.speakingStyle,
    reused: false,
    source: "fallback",
    cache_state: "Unavailable",
    credits_charged: 0,
    error: args.reason,
    code: args.code ?? "AUDIO_UNAVAILABLE",
  };
}

async function describeError(error: unknown): Promise<{
  code?: string;
  fallback: boolean;
  message: string;
  status?: number;
}> {
  if (error instanceof Response) {
    let bodyText = "";
    let payload: Record<string, unknown> | null = null;
    try {
      bodyText = await error.clone().text();
      if (bodyText) payload = JSON.parse(bodyText);
    } catch {
      // Ignore parse failures and fall back to plain text/status below.
    }
    return {
      code: typeof payload?.code === "string" ? payload.code : undefined,
      fallback: payload?.fallback === true || error.status >= 500,
      message:
        (typeof payload?.error === "string" && payload.error) ||
        (typeof payload?.message === "string" && payload.message) ||
        bodyText ||
        `HTTP ${error.status}`,
      status: error.status,
    };
  }

  const err = error as {
    code?: unknown;
    context?: unknown;
    fallback?: unknown;
    message?: unknown;
    status?: unknown;
  } | null;

  if (err?.context instanceof Response) {
    const described = await describeError(err.context);
    return {
      code: typeof err.code === "string" ? err.code : described.code,
      fallback: err.fallback === true || described.fallback,
      message: described.message,
      status: typeof err.status === "number" ? err.status : described.status,
    };
  }

  const message =
    typeof err?.message === "string"
      ? err.message
      : error instanceof Error
        ? error.message
        : String(error ?? "Unknown error");

  return {
    code: typeof err?.code === "string" ? err.code : undefined,
    fallback: err?.fallback === true,
    message,
    status: typeof err?.status === "number" ? err.status : undefined,
  };
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

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// SHA-256 hex of a string. Used to detect when the text behind a cached audio
// chunk has changed (e.g. clean_text was re-cleaned). Cheap, deterministic.
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function pickVoice(lang: string, isLiterature: boolean): string {
  const cfg = VOICE_CONFIG[lang];
  if (!cfg) throw new Error(`Voice not available for selected language: ${lang}`);
  if (isLiterature && cfg.literature) return cfg.literature;
  return cfg.default;
}

function pickFallbackVoice(lang: string): string | null {
  const cfg = VOICE_CONFIG[lang];
  return cfg?.default ?? null;
}

function buildSSML(text: string, voice: string, locale: string, mode: "story" | "study"): string {
  const processed = escapeXml(addNaturalPauses(text));
  const supportsExpressiveStyle = EXPRESSIVE_STYLE_LANGS.has(locale.split("-")[0].toLowerCase());
  if (mode === "story") {
    if (!supportsExpressiveStyle) {
      return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">
  <voice name="${voice}">
    <prosody rate="0.78" pitch="-2%">${processed}</prosody>
  </voice>
</speak>`;
    }
    // Theatrical storyteller: slower, warmer pitch, stronger expressive style.
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">
  <voice name="${voice}">
    <mstts:express-as style="narration-professional" styledegree="2.0">
      <prosody rate="0.75" pitch="-2%" contour="(0%,+0%) (50%,+8%) (100%,-4%)">${processed}</prosody>
    </mstts:express-as>
  </voice>
</speak>`;
  }
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">
  <voice name="${voice}">
    <mstts:express-as style="general" styledegree="1.0">
      <prosody rate="0.90">${processed}</prosody>
    </mstts:express-as>
  </voice>
</speak>`;
}

function chunkText(text: string, size = CHUNK_SIZE): string[] {
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

async function ttsElevenLabs(text: string, apiKey: string): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: ELEVEN_MODEL,
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
}

async function ttsAzure(text: string, lang: string, voice: string, apiKey: string, mode: "story" | "study"): Promise<ArrayBuffer> {
  const locale = AZURE_LANG_LOCALE[lang] ?? "en-GB";
  const ssml = buildSSML(text, voice, locale, mode);
  const res = await fetch(`https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "studysound",
    },
    body: ssml,
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) {
      const err: any = new Error(`Azure 429: ${body || "Quota Exceeded"}`);
      err.code = "RATE_LIMITED";
      err.retryAfter = Number(res.headers.get("retry-after")) || 30;
      throw err;
    }
    const err: any = new Error(`Azure ${res.status}: ${body}`);
    err.status = res.status;
    err.voice = voice;
    throw err;
  }
  return res.arrayBuffer();
}

/**
 * Try the requested voice (literature or default). If it fails with a voice/SSML
 * error (4xx that isn't 429), retry once with the language's default voice.
 * If THAT fails too, surface the error rather than silently switching to English.
 * Returns { audio, voiceUsed }.
 */
async function ttsAzureWithFallback(
  text: string,
  lang: string,
  primaryVoice: string,
  apiKey: string,
  mode: "story" | "study",
): Promise<{ audio: ArrayBuffer; voiceUsed: string }> {
  try {
    const audio = await ttsAzure(text, lang, primaryVoice, apiKey, mode);
    return { audio, voiceUsed: primaryVoice };
  } catch (err: any) {
    const status = err?.status;
    const isVoiceError = status && status >= 400 && status < 500 && status !== 429;
    const fallback = pickFallbackVoice(lang);
    if (isVoiceError && fallback && fallback !== primaryVoice) {
      console.warn(`[audio] primary voice ${primaryVoice} failed (status ${status}); falling back to ${fallback}`);
      try {
        const audio = await ttsAzure(text, lang, fallback, apiKey, mode);
        return { audio, voiceUsed: fallback };
      } catch (err2: any) {
        const status2 = err2?.status;
        if (status2 && status2 >= 400 && status2 < 500 && status2 !== 429) {
          const unsupportedError: any = new Error(`Voice not available for selected language: ${lang}`);
          unsupportedError.code = "VOICE_UNSUPPORTED";
          unsupportedError.fallback = true;
          throw unsupportedError;
        }
        throw err2;
      }
    }
    if (isVoiceError) {
      const unsupportedError: any = new Error(`Voice not available for selected language: ${lang}`);
      unsupportedError.code = "VOICE_UNSUPPORTED";
      unsupportedError.fallback = true;
      throw unsupportedError;
    }
    throw err;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ELEVEN_KEY = Deno.env.get("ElevenLabs_Secret_Key_TTS");
    const AZURE_KEY = Deno.env.get("Azure_Secret_Key_SpeechServices");

    const body = await req.json();
    const {
      lesson_id,
      document_id: bodyDocId,
      chunk_index = 0,
      language,
      preview_only = false,
      check_only = false,
      preview = false,
    } = body ?? {};

    // ---------- Auth (preview tolerates anonymous) ----------
    const authHeader = req.headers.get("Authorization") ?? "";
    let user: { id: string } | null = null;
    if (authHeader && authHeader !== `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`) {
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await userClient.auth.getUser();
      if (userData?.user) user = { id: userData.user.id };
    }

    // Preview mode = explicit `preview: true` OR no authenticated user.
    const previewMode = preview === true || !user;

    if (!previewMode && !lesson_id) {
      return new Response(JSON.stringify({ error: "lesson_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (previewMode && !lesson_id && !bodyDocId) {
      return new Response(JSON.stringify({ error: "lesson_id or document_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Resolve doc + (optional) lesson. Preview can resolve straight from document_id.
    let docId: string;
    let lessonLanguage: string | null = null;
    if (lesson_id) {
      const { data: lesson, error: lessonErr } = await admin
        .from("lessons")
        .select("id, user_id, document_id, content_text, language")
        .eq("id", lesson_id)
        .maybeSingle();
      if (lessonErr || !lesson) throw new Error("Lesson not found");
      if (!previewMode && user && lesson.user_id !== user.id) throw new Error("Forbidden");
      if (!lesson.document_id) throw new Error("Lesson has no linked document");
      docId = lesson.document_id;
      lessonLanguage = lesson.language;
    } else {
      docId = bodyDocId;
    }

    const { data: doc } = await admin
      .from("documents")
      .select("id, clean_text, language, subject_type, cleaning_version")
      .eq("id", docId)
      .maybeSingle();
    if (!doc) throw new Error("Document not found");
    const isLiterature = isLiteratureContent(doc.subject_type, body?.subject ?? body?.category);
    const mode: "story" | "study" = isLiterature ? "story" : "study";

    const lang = (language ?? lessonLanguage ?? doc.language ?? "en").toLowerCase();
    const provider: "azure" | "elevenlabs" = AZURE_LANGS.has(lang) ? "azure" : "elevenlabs";
    if (!VOICE_CONFIG[lang] && provider === "azure") {
      return new Response(
        JSON.stringify({ error: `Voice not available for selected language: ${lang}`, code: "VOICE_UNSUPPORTED" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    let voiceName = provider === "azure" ? pickVoice(lang, isLiterature) : "elevenlabs-multilingual";
    const speakingStyle = mode === "story" ? "narration-professional" : "general";
    console.log(`[audio] route lang=${lang} subject=${doc.subject_type} literature=${isLiterature} voice=${voiceName} style=${speakingStyle}`);

    const chunks = chunkText(doc.clean_text);
    const totalChunks = chunks.length;

    // ---------- Preview mode: cache-first, generate-on-miss, NEVER charge ----------
    if (previewMode) {
      if (chunk_index < 0 || chunk_index >= totalChunks) {
        return new Response(JSON.stringify({ error: "chunk_index out of range", total_chunks: totalChunks }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      let pStoragePath: string | null = null;
      let pSource: "cached" | "generated" = "cached";
      const previewText = chunks[chunk_index];
      const previewHash = await sha256Hex(previewText);
      const { data: cachedRow } = await admin
        .from("audio_assets")
        .select("id, storage_path, clean_text_hash")
        .eq("document_id", doc.id)
        .eq("chunk_index", chunk_index)
        .eq("language", lang)
        .eq("voice_provider", provider)
        .eq("voice_name", voiceName)
        .eq("speaking_style", speakingStyle)
        .maybeSingle();

      // Dirty-detection: if the cached audio was generated from a different
      // version of the cleaned text (hash mismatch), drop it and regenerate.
      const previewCacheUsable =
        cachedRow && cachedRow.clean_text_hash && cachedRow.clean_text_hash === previewHash;

      if (cachedRow && !previewCacheUsable) {
        console.log("Preview audio: stale cache, deleting", { id: cachedRow.id, doc: doc.id, chunk: chunk_index, lang });
        await admin.from("audio_assets").delete().eq("id", cachedRow.id);
      }

      if (previewCacheUsable) {
        console.log("Preview audio: cache hit", { doc: doc.id, chunk: chunk_index, lang });
        pStoragePath = cachedRow!.storage_path;
      } else {
        console.log("Preview audio: generating via Azure", { doc: doc.id, chunk: chunk_index, lang, voice: voiceName });
        const text = previewText;
        const apiKey = provider === "azure" ? AZURE_KEY : ELEVEN_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ success: false, preview: true, error: `${provider} API key not configured`, code: "TTS_NOT_CONFIGURED" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const ttsResult =
          provider === "azure"
            ? await ttsAzureWithFallback(text, lang, voiceName, apiKey, mode)
            : { audio: await ttsElevenLabs(text, apiKey), voiceUsed: voiceName };
        voiceName = ttsResult.voiceUsed;
        const audio = ttsResult.audio;
        const path = `audio/${doc.id}/${lang}/${provider}/${voiceName}/${speakingStyle}/${chunk_index}.mp3`;
        const { error: upErr } = await admin.storage
          .from("assets")
          .upload(path, new Uint8Array(audio), { contentType: "audio/mpeg", upsert: true });
        if (upErr) throw new Error(`Storage upload: ${upErr.message}`);
        await admin.from("audio_assets").insert({
          document_id: doc.id,
          chunk_index,
          language: lang,
          voice_provider: provider,
          voice_name: voiceName,
          speaking_style: speakingStyle,
          storage_path: path,
          char_count: text.length,
          clean_text_hash: previewHash,
          cleaning_version: (doc as any).cleaning_version ?? 1,
        });
        console.log("Preview audio: saved to cache", { path });
        pStoragePath = path;
        pSource = "generated";
      }

      const { data: signed } = await admin.storage
        .from("assets")
        .createSignedUrl(pStoragePath!, 60 * 60 * 6);
      return new Response(
        JSON.stringify({
          success: true,
          preview: true,
          source: pSource,
          cache_state: pSource === "cached" ? "Cached" : "Generated",
          audio_url: signed?.signedUrl,
          chunk_index,
          total_chunks: totalChunks,
          text: chunks[chunk_index],
          language: lang,
          provider,
          voice_name: voiceName,
          speaking_style: speakingStyle,
          credits_charged: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    // From here on, user is guaranteed (preview branch above already returned).
    const authedUserId = user!.id;

    if (preview_only) {
      const { data: paidChunks } = await admin
        .from("user_chunk_access")
        .select("chunk_index")
        .eq("user_id", authedUserId)
        .eq("document_id", doc.id)
        .eq("language", lang)
        .eq("asset_type", "audio");
      const paidSet = new Set((paidChunks ?? []).map((r) => r.chunk_index));
      const remainingChunks = Array.from({ length: totalChunks }, (_, i) => i).filter((i) => !paidSet.has(i));
      await admin.rpc("expire_free_credits", { _user_id: authedUserId });
      const { data: profile } = await admin
        .from("profiles")
        .select("credits_balance")
        .eq("user_id", authedUserId)
        .maybeSingle();
      return new Response(
        JSON.stringify({
          success: true,
          preview: true,
          total_chunks: totalChunks,
          paid_chunks: paidSet.size,
          remaining_credits_for_full_book: remainingChunks.length,
          credits_balance: profile?.credits_balance ?? 0,
          language: lang,
          provider,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (chunk_index < 0 || chunk_index >= totalChunks) {
      return new Response(JSON.stringify({ error: "chunk_index out of range", total_chunks: totalChunks }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve display text for this chunk: translate when lang differs from source.
    // Used by both check_only response and final response so the UI can show translated text.
    async function resolveDisplayText(): Promise<string> {
      const sourceLang = (doc!.language ?? "en").toLowerCase();
      if (lang === sourceLang) return chunks[chunk_index];
      if (!TRANSLATABLE_LANGS.has(lang)) return chunks[chunk_index];
      // Try cached translation first.
      const { data: tr } = await admin
        .from("translation_assets")
        .select("translated_text")
        .eq("document_id", doc!.id)
        .eq("chunk_index", chunk_index)
        .eq("target_language", lang)
        .maybeSingle();
      if (tr?.translated_text) return tr.translated_text;
      // Otherwise generate (also caches it for the audio step below).
      const { data: trData, error: trErr } = await admin.functions.invoke("generate-translation", {
        body: { lesson_id, chunk_index, target_language: lang },
        headers: { Authorization: authHeader },
      });
      if (trErr || !trData?.translated_text) {
        const describedError = trErr ? await describeError(trErr) : null;
        const details =
          (typeof trData?.error === "string" && trData.error) ||
          describedError?.message ||
          `Translation unavailable for ${lang}`;
        const shouldFallback =
          trData?.fallback === true ||
          describedError?.fallback === true ||
          describedError?.status === 429 ||
          (describedError?.status ?? 0) >= 500 ||
          isUnsupportedTranslationError(details) ||
          describedError?.code === "TRANSLATION_UNSUPPORTED";
        console.error(`[audio] translation failed for ${lang} chunk ${chunk_index}: ${details}`);
        if (shouldFallback) {
          return chunks[chunk_index];
        }
        throw new Error(details);
      }
      return trData.translated_text;
    }

    // Lightweight per-chunk status check — no charge, no generation.
    if (check_only) {
      const displayText = await resolveDisplayText();
      const { data: cachedRow } = await admin
        .from("audio_assets")
        .select("id")
        .eq("document_id", doc.id)
        .eq("chunk_index", chunk_index)
        .eq("language", lang)
        .eq("voice_provider", provider)
        .eq("voice_name", voiceName)
        .eq("speaking_style", speakingStyle)
        .maybeSingle();

      const { data: paidRow } = await admin
        .from("user_chunk_access")
        .select("id")
        .eq("user_id", authedUserId)
        .eq("document_id", doc.id)
        .eq("chunk_index", chunk_index)
        .eq("language", lang)
        .eq("asset_type", "audio")
        .eq("voice_name", voiceName)
        .eq("speaking_style", speakingStyle)
        .maybeSingle();

      await admin.rpc("expire_free_credits", { _user_id: authedUserId });
      const { data: profile } = await admin
        .from("profiles")
        .select("credits_balance")
        .eq("user_id", authedUserId)
        .maybeSingle();

      return new Response(
        JSON.stringify({
          success: true,
          check: true,
          cache_exists: !!cachedRow,
          already_paid: !!paidRow,
          credits_balance: profile?.credits_balance ?? 0,
          total_chunks: totalChunks,
          text: displayText,
          chunk_index,
          language: lang,
          provider,
          voice_name: voiceName,
          speaking_style: speakingStyle,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: cached } = await admin
      .from("audio_assets")
      .select("id, storage_path, clean_text_hash")
      .eq("document_id", doc.id)
      .eq("chunk_index", chunk_index)
      .eq("language", lang)
      .eq("voice_provider", provider)
      .eq("voice_name", voiceName)
      .eq("speaking_style", speakingStyle)
      .maybeSingle();

    const { data: userPaid } = await admin
      .from("user_chunk_access")
      .select("id")
      .eq("user_id", authedUserId)
      .eq("document_id", doc.id)
      .eq("chunk_index", chunk_index)
      .eq("language", lang)
      .eq("asset_type", "audio")
      .eq("voice_name", voiceName)
      .eq("speaking_style", speakingStyle)
      .maybeSingle();

    let chargedCredits = 0;

    if (!userPaid) {
      const { data: enforce } = await admin
        .from("profiles")
        .select("is_flagged, cooldown_until, flagged_reason")
        .eq("user_id", authedUserId)
        .maybeSingle();
      if (enforce?.is_flagged) {
        return new Response(JSON.stringify({
          error: enforce.flagged_reason ?? "Your account is under review. Please contact support.",
          code: "USER_FLAGGED",
        }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const cd = enforce?.cooldown_until ? new Date(enforce.cooldown_until) : null;
      if (cd && cd.getTime() > Date.now()) {
        const secs = Math.max(1, Math.ceil((cd.getTime() - Date.now()) / 1000));
        return new Response(JSON.stringify({
          error: `You're temporarily paused. Try again in ${Math.ceil(secs / 60)} min.`,
          code: "COOLDOWN_ACTIVE", retry_after_seconds: secs, cooldown_until: cd.toISOString(),
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(secs) },
        });
      }
      await admin.rpc("expire_free_credits", { _user_id: authedUserId });
      const { data: profile } = await admin
        .from("profiles")
        .select("credits_balance")
        .eq("user_id", authedUserId)
        .maybeSingle();
      const balance = profile?.credits_balance ?? 0;
      if (balance < 1) {
        return new Response(JSON.stringify({ error: "Insufficient credits", credits_balance: balance }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await admin
        .from("profiles")
        .update({ credits_balance: balance - 1 })
        .eq("user_id", authedUserId);
      await admin.from("user_chunk_access").insert({
        user_id: authedUserId,
        document_id: doc.id,
        chunk_index,
        language: lang,
        asset_type: "audio",
        credits_charged: 1,
        voice_name: voiceName,
        speaking_style: speakingStyle,
      });
      await admin.from("user_usage").insert({
        user_id: authedUserId,
        document_id: doc.id,
        action_type: "audio",
        credits_used: 1,
        request_id: `audio-${doc.id}-${lang}-${voiceName}-${speakingStyle}-${chunk_index}-${authedUserId}`,
      });
      chargedCredits = 1;
    }

    let storagePath: string;
    let reused = false;
    // Resolve translated text up-front so we can return it for display in ALL cases
    // (cached audio AND fresh generation). NATIVE_VOICE_LANGS gates the audio voice,
    // but text translation should happen for every non-source language.
    const sourceLang = (doc.language ?? "en").toLowerCase();
    const finalText =
      lang !== sourceLang ? await resolveDisplayText() : chunks[chunk_index];
    // SINGLE SOURCE OF TRUTH: TTS always uses translated text when we have
    // a native Azure voice for the target language. Otherwise we narrate the
    // source text using the language's English fallback voice (text on
    // screen still shows the translation).
    const ttsText =
      lang !== sourceLang && NATIVE_VOICE_LANGS.has(lang)
        ? finalText
        : chunks[chunk_index];
    const expectedHash = await sha256Hex(ttsText);

    // Dirty-detection: cached audio is only reusable when the hash of the
    // text we *would* speak today matches the hash recorded when the audio
    // was generated. Mismatched rows are deleted so the next request (or the
    // seed worker) regenerates from the current cleaned text.
    let cacheUsable = false;
    if (cached) {
      if (cached.clean_text_hash && cached.clean_text_hash === expectedHash) {
        cacheUsable = true;
      } else {
        console.log("[audio] stale cache, deleting", {
          id: cached.id,
          doc: doc.id,
          chunk: chunk_index,
          lang,
          oldHash: cached.clean_text_hash,
          newHash: expectedHash,
        });
        await admin.from("audio_assets").delete().eq("id", cached.id);
      }
    }

    if (cacheUsable) {
      storagePath = cached!.storage_path;
      reused = true;
    } else {
      const apiKey = provider === "azure" ? AZURE_KEY : ELEVEN_KEY;
      if (!apiKey) throw new Error(`${provider} API key not configured`);
      let audio: ArrayBuffer;
      try {
        if (provider === "azure") {
          const result = await ttsAzureWithFallback(ttsText, lang, voiceName, apiKey, mode);
          audio = result.audio;
          if (result.voiceUsed !== voiceName) {
            console.warn(`[audio] voice fallback ${voiceName} -> ${result.voiceUsed} for lang=${lang}`);
            voiceName = result.voiceUsed;
          }
        } else {
          audio = await ttsElevenLabs(ttsText, apiKey);
        }
      } catch (error) {
        const details = error instanceof Error ? error.message : "Audio generation failed";
        const code = typeof (error as { code?: unknown })?.code === "string"
          ? ((error as { code?: string }).code)
          : undefined;
        if (isUnsupportedTranslationError(details)) {
          return new Response(
            JSON.stringify(
              buildTranslationFallbackPayload({
                text: finalText,
                totalChunks,
                chunkIndex: chunk_index,
                language: lang,
                provider,
                voiceName,
                speakingStyle,
                reason: details,
              }),
            ),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        if (code === "VOICE_UNSUPPORTED" || /Voice not available for selected language|Azure 400:/i.test(details)) {
          return new Response(
            JSON.stringify(
              buildAudioUnavailablePayload({
                text: finalText,
                totalChunks,
                chunkIndex: chunk_index,
                language: lang,
                provider,
                voiceName,
                speakingStyle,
                reason: code === "VOICE_UNSUPPORTED"
                  ? details
                  : "Audio service is unavailable for the selected language right now.",
                code: code === "VOICE_UNSUPPORTED" ? code : "AZURE_API_ERROR",
              }),
            ),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        throw error;
      }
      storagePath = `audio/${doc.id}/${lang}/${provider}/${voiceName}/${speakingStyle}/${chunk_index}.mp3`;
      const { error: upErr } = await admin.storage
        .from("assets")
        .upload(storagePath, new Uint8Array(audio), { contentType: "audio/mpeg", upsert: true });
      if (upErr) throw new Error(`Storage upload: ${upErr.message}`);
      await admin.from("audio_assets").insert({
        document_id: doc.id,
        chunk_index,
        language: lang,
        voice_provider: provider,
        voice_name: voiceName,
        speaking_style: speakingStyle,
        storage_path: storagePath,
        char_count: ttsText.length,
        clean_text_hash: expectedHash,
        cleaning_version: (doc as any).cleaning_version ?? 1,
      });
    }

    const { data: signed, error: signErr } = await admin.storage
      .from("assets")
      .createSignedUrl(storagePath, 60 * 60 * 6);
    if (signErr || !signed) throw new Error(`Signed URL: ${signErr?.message}`);

    return new Response(
      JSON.stringify({
        success: true,
        audio_url: signed.signedUrl,
        chunk_index,
        total_chunks: totalChunks,
        text: finalText,
        language: lang,
        provider,
        voice_name: voiceName,
        speaking_style: speakingStyle,
        reused,
        source: reused ? "cached" : "generated",
        cache_state: reused ? "Cached" : (chargedCredits > 0 ? "Generated (1 credit)" : "Generated"),
        credits_charged: chargedCredits,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    const described = await describeError(e);
    const msg = described.message;
    console.error("generate-audio error:", msg);
    if (e?.code === "RATE_LIMITED" || /Azure 429/i.test(msg)) {
      const retryAfter = Number(e?.retryAfter) || 30;
      return new Response(
        JSON.stringify({
          error: "RATE_LIMITED",
          message: "Audio service is busy. Please try again in a moment.",
          retry_after_seconds: retryAfter,
          fallback: true,
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfter) },
        },
      );
    }
    if (described.code === "VOICE_UNSUPPORTED" || /Voice not available for selected language|Azure 400:/i.test(msg)) {
      return new Response(JSON.stringify({ error: msg, fallback: true, code: described.code ?? "AUDIO_UNAVAILABLE" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: msg, fallback: false }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
