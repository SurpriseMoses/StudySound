// Generate audio for a single chunk of a document.
// Strategy: On-demand chunking. Client requests (lesson_id, chunk_index).
// We chunk the document deterministically server-side (~1800 chars at sentence boundaries),
// route to Azure (zu/af/xh) or ElevenLabs (others), cache globally in audio_assets,
// and charge 1 credit ONCE per user per document (first chunk ever requested).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE = 1800;
// Route everything through Azure for now (ElevenLabs free tier blocked).
const AZURE_LANGS = new Set(["zu", "af", "xh", "en", "fr"]);

// Default voices
const ELEVEN_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // Sarah
const ELEVEN_MODEL = "eleven_multilingual_v2";

const AZURE_VOICES: Record<string, string> = {
  zu: "zu-ZA-ThandoNeural",
  af: "af-ZA-AdriNeural",
  xh: "en-GB-LibbyNeural",
  en: "en-GB-LibbyNeural",
  fr: "fr-FR-DeniseNeural",
};
const AZURE_LANG_LOCALE: Record<string, string> = {
  zu: "zu-ZA",
  af: "af-ZA",
  xh: "en-GB",
  en: "en-GB",
  fr: "fr-FR",
};
const AZURE_REGION = "southafricanorth";

// Add natural pauses by ensuring whitespace after punctuation
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

function buildSSML(text: string, voice: string, locale: string, mode: "story" | "study"): string {
  const processed = escapeXml(addNaturalPauses(text));
  const rate = mode === "story" ? "0.85" : "0.90";
  const style = mode === "story" ? "narration-relaxed" : "general";
  const styleDegree = mode === "story" ? "1.5" : "1.0";
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">
  <voice name="${voice}">
    <mstts:express-as style="${style}" styledegree="${styleDegree}">
      <prosody rate="${rate}">${processed}</prosody>
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
  const voice = AZURE_VOICES[lang] ?? AZURE_VOICES.en;
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
  if (!res.ok) throw new Error(`Azure ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ELEVEN_KEY = Deno.env.get("ElevenLabs_Secret_Key_TTS");
    const AZURE_KEY = Deno.env.get("Azure_Secret_Key_SpeechServices");

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { lesson_id, chunk_index = 0, language, preview_only = false } = body ?? {};
    if (!lesson_id) {
      return new Response(JSON.stringify({ error: "lesson_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1. Load lesson + document
    const { data: lesson, error: lessonErr } = await admin
      .from("lessons")
      .select("id, user_id, document_id, content_text, language")
      .eq("id", lesson_id)
      .maybeSingle();
    if (lessonErr || !lesson) throw new Error("Lesson not found");
    if (lesson.user_id !== user.id) throw new Error("Forbidden");
    if (!lesson.document_id) throw new Error("Lesson has no linked document");

    const { data: doc } = await admin
      .from("documents")
      .select("id, clean_text, language, subject_type")
      .eq("id", lesson.document_id)
      .maybeSingle();
    if (!doc) throw new Error("Document not found");
    const mode: "story" | "study" = doc.subject_type === "novel" ? "story" : "study";

    const lang = (language ?? lesson.language ?? doc.language ?? "en").toLowerCase();
    const provider: "azure" | "elevenlabs" = AZURE_LANGS.has(lang) ? "azure" : "elevenlabs";

    // 2. Determine chunks
    const chunks = chunkText(doc.clean_text);
    const totalChunks = chunks.length;

    // PREVIEW MODE: report cost without generating/charging
    if (preview_only) {
      const { data: paidChunks } = await admin
        .from("user_chunk_access")
        .select("chunk_index")
        .eq("user_id", user.id)
        .eq("document_id", doc.id)
        .eq("language", lang)
        .eq("asset_type", "audio");
      const paidSet = new Set((paidChunks ?? []).map((r) => r.chunk_index));
      const remainingChunks = Array.from({ length: totalChunks }, (_, i) => i).filter((i) => !paidSet.has(i));
      const { data: profile } = await admin
        .from("profiles")
        .select("credits_balance")
        .eq("user_id", user.id)
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

    // 3. Check global audio cache
    const { data: cached } = await admin
      .from("audio_assets")
      .select("storage_path")
      .eq("document_id", doc.id)
      .eq("chunk_index", chunk_index)
      .eq("language", lang)
      .eq("voice_provider", provider)
      .maybeSingle();

    // 4. Check if THIS USER has already paid for THIS chunk
    const { data: userPaid } = await admin
      .from("user_chunk_access")
      .select("id")
      .eq("user_id", user.id)
      .eq("document_id", doc.id)
      .eq("chunk_index", chunk_index)
      .eq("language", lang)
      .eq("asset_type", "audio")
      .maybeSingle();

    let chargedCredits = 0;

    // 5. Charge 1 credit if user hasn't paid for this chunk yet
    if (!userPaid) {
      const { data: profile } = await admin
        .from("profiles")
        .select("credits_balance")
        .eq("user_id", user.id)
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
        .eq("user_id", user.id);
      await admin.from("user_chunk_access").insert({
        user_id: user.id,
        document_id: doc.id,
        chunk_index,
        language: lang,
        asset_type: "audio",
        credits_charged: 1,
      });
      await admin.from("user_usage").insert({
        user_id: user.id,
        document_id: doc.id,
        action_type: "audio",
        credits_used: 1,
        request_id: `audio-${doc.id}-${lang}-${chunk_index}-${user.id}`,
      });
      chargedCredits = 1;
    }

    // 6. Generate audio if not cached globally
    let storagePath: string;
    let reused = false;
    if (cached) {
      storagePath = cached.storage_path;
      reused = true;
    } else {
      const text = chunks[chunk_index];
      const apiKey = provider === "azure" ? AZURE_KEY : ELEVEN_KEY;
      if (!apiKey) throw new Error(`${provider} API key not configured`);
      const audio =
        provider === "azure"
          ? await ttsAzure(text, lang, apiKey, mode)
          : await ttsElevenLabs(text, apiKey);
      storagePath = `audio/${doc.id}/${lang}/${provider}/${chunk_index}.mp3`;
      const { error: upErr } = await admin.storage
        .from("assets")
        .upload(storagePath, new Uint8Array(audio), { contentType: "audio/mpeg", upsert: true });
      if (upErr) throw new Error(`Storage upload: ${upErr.message}`);
      await admin.from("audio_assets").insert({
        document_id: doc.id,
        chunk_index,
        language: lang,
        voice_provider: provider,
        storage_path: storagePath,
        char_count: text.length,
      });
    }

    // 7. Signed URL
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
        reused,
        credits_charged: chargedCredits,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("generate-audio error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
