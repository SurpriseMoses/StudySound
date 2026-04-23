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
// All languages route to Azure. Languages without a native voice fall back to English voice.
const AZURE_LANGS = new Set(["zu", "af", "xh", "en", "fr", "ts", "nso"]);

const ELEVEN_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
const ELEVEN_MODEL = "eleven_multilingual_v2";

// Languages with native Azure voices. Others (xh, ts, nso) fall back to the English
// voice AND read the original English text (no translation lookup), so pronunciation stays correct.
const NATIVE_VOICE_LANGS = new Set(["zu", "af", "en", "fr"]);
const AZURE_VOICES: Record<string, string> = {
  zu: "zu-ZA-ThandoNeural",
  af: "af-ZA-AdriNeural",
  xh: "en-GB-LibbyNeural",
  ts: "en-GB-LibbyNeural",
  nso: "en-GB-LibbyNeural",
  en: "en-GB-LibbyNeural",
  fr: "fr-FR-DeniseNeural",
};
// For "story" mode (novels/plays) use a more theatrical narrator where supported.
// Other languages keep their default voice (no expressive variant available).
const AZURE_STORY_VOICES: Record<string, string> = {
  en: "en-GB-RyanNeural",
  xh: "en-GB-RyanNeural",
  ts: "en-GB-RyanNeural",
  nso: "en-GB-RyanNeural",
};
const AZURE_LANG_LOCALE: Record<string, string> = {
  zu: "zu-ZA",
  af: "af-ZA",
  xh: "en-GB",
  ts: "en-GB",
  nso: "en-GB",
  en: "en-GB",
  fr: "fr-FR",
};
const AZURE_REGION = "southafricanorth";

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

function pickVoice(lang: string, mode: "story" | "study"): string {
  if (mode === "story" && AZURE_STORY_VOICES[lang]) return AZURE_STORY_VOICES[lang];
  return AZURE_VOICES[lang] ?? AZURE_VOICES.en;
}

function buildSSML(text: string, voice: string, locale: string, mode: "story" | "study"): string {
  const processed = escapeXml(addNaturalPauses(text));
  if (mode === "story") {
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

async function ttsAzure(text: string, lang: string, apiKey: string, mode: "story" | "study"): Promise<ArrayBuffer> {
  const voice = pickVoice(lang, mode);
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
    throw new Error(`Azure ${res.status}: ${body}`);
  }
  return res.arrayBuffer();
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
      .select("id, clean_text, language, subject_type")
      .eq("id", docId)
      .maybeSingle();
    if (!doc) throw new Error("Document not found");
    const mode: "story" | "study" = doc.subject_type === "novel" ? "story" : "study";

    const lang = (language ?? lessonLanguage ?? doc.language ?? "en").toLowerCase();
    const provider: "azure" | "elevenlabs" = AZURE_LANGS.has(lang) ? "azure" : "elevenlabs";
    const voiceName = pickVoice(lang, mode);
    const speakingStyle = mode === "story" ? "narration-professional" : "general";

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
      const { data: cachedRow } = await admin
        .from("audio_assets")
        .select("storage_path")
        .eq("document_id", doc.id)
        .eq("chunk_index", chunk_index)
        .eq("language", lang)
        .eq("voice_provider", provider)
        .eq("voice_name", voiceName)
        .eq("speaking_style", speakingStyle)
        .maybeSingle();

      if (cachedRow) {
        console.log("Preview audio: cache hit", { doc: doc.id, chunk: chunk_index, lang });
        pStoragePath = cachedRow.storage_path;
      } else {
        console.log("Preview audio: generating via Azure", { doc: doc.id, chunk: chunk_index, lang, voice: voiceName });
        const text = chunks[chunk_index];
        const apiKey = provider === "azure" ? AZURE_KEY : ELEVEN_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ success: false, preview: true, error: `${provider} API key not configured`, code: "TTS_NOT_CONFIGURED" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const audio =
          provider === "azure"
            ? await ttsAzure(text, lang, apiKey, mode)
            : await ttsElevenLabs(text, apiKey);
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
      const sourceLang = (doc.language ?? "en").toLowerCase();
      if (lang === sourceLang) return chunks[chunk_index];
      // Try cached translation first.
      const { data: tr } = await admin
        .from("translation_assets")
        .select("translated_text")
        .eq("document_id", doc.id)
        .eq("chunk_index", chunk_index)
        .eq("target_language", lang)
        .maybeSingle();
      if (tr?.translated_text) return tr.translated_text;
      // Otherwise generate (also caches it for the audio step below).
      try {
        const { data: trData, error: trErr } = await admin.functions.invoke("generate-translation", {
          body: { lesson_id, chunk_index, target_language: lang },
          headers: { Authorization: authHeader },
        });
        if (trErr || !trData?.translated_text) {
          console.warn(`[audio] translation fallback to source for ${lang} chunk ${chunk_index}: ${trErr?.message ?? "no text"}`);
          return chunks[chunk_index];
        }
        return trData.translated_text;
      } catch (e) {
        console.warn(`[audio] translation error, falling back to source: ${(e as Error).message}`);
        return chunks[chunk_index];
      }
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
      .select("storage_path")
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
    if (cached) {
      storagePath = cached.storage_path;
      reused = true;
    } else {
      // Use translated text for TTS only when we have a native voice for that lang;
      // otherwise narrate the source text with the fallback voice.
      const ttsText =
        lang !== sourceLang && NATIVE_VOICE_LANGS.has(lang)
          ? finalText
          : chunks[chunk_index];
      const apiKey = provider === "azure" ? AZURE_KEY : ELEVEN_KEY;
      if (!apiKey) throw new Error(`${provider} API key not configured`);
      const audio =
        provider === "azure"
          ? await ttsAzure(ttsText, lang, apiKey, mode)
          : await ttsElevenLabs(ttsText, apiKey);
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
        text: chunks[chunk_index],
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
    const msg = e instanceof Error ? e.message : "Unknown error";
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
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
