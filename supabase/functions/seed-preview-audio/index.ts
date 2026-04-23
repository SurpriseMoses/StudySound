// Admin-only: pre-generate the first N chunks of a document so /preview can play them
// without ever calling Azure at request-time and without charging credits.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE = 1800;
const AZURE_LANGS = new Set(["zu", "af", "xh", "en", "fr", "ts", "nso"]);
const AZURE_VOICES: Record<string, string> = {
  zu: "zu-ZA-ThandoNeural",
  af: "af-ZA-AdriNeural",
  xh: "en-GB-LibbyNeural",
  ts: "en-GB-LibbyNeural",
  nso: "en-GB-LibbyNeural",
  en: "en-GB-LibbyNeural",
  fr: "fr-FR-DeniseNeural",
};
const AZURE_STORY_VOICES: Record<string, string> = {
  en: "en-GB-RyanNeural",
  xh: "en-GB-RyanNeural",
  ts: "en-GB-RyanNeural",
  nso: "en-GB-RyanNeural",
};
function pickVoice(lang: string, mode: "story" | "study"): string {
  if (mode === "story" && AZURE_STORY_VOICES[lang]) return AZURE_STORY_VOICES[lang];
  return AZURE_VOICES[lang] ?? AZURE_VOICES.en;
}
const AZURE_LANG_LOCALE: Record<string, string> = {
  zu: "zu-ZA", af: "af-ZA", xh: "en-GB", ts: "en-GB", nso: "en-GB", en: "en-GB", fr: "fr-FR",
};
const AZURE_REGION = "southafricanorth";

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function addNaturalPauses(text: string) {
  return text.replace(/\.(?!\s)/g, ". ").replace(/,(?!\s)/g, ", ").replace(/\?(?!\s)/g, "? ").replace(/!(?!\s)/g, "! ").replace(/\s+/g, " ").trim();
}
function chunkText(text: string, size = CHUNK_SIZE): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]+|\S+$/g) ?? [clean];
  const out: string[] = []; let buf = "";
  for (const s of sentences) {
    if ((buf + " " + s).length > size && buf.length > 0) { out.push(buf.trim()); buf = s; }
    else { buf = buf ? buf + " " + s : s; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
function buildSSML(text: string, voice: string, locale: string, mode: "story" | "study") {
  const processed = escapeXml(addNaturalPauses(text));
  if (mode === "story") {
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}"><voice name="${voice}"><mstts:express-as style="narration-professional" styledegree="2.0"><prosody rate="0.82" pitch="-2%" contour="(0%,+0%) (50%,+8%) (100%,-4%)">${processed}</prosody></mstts:express-as></voice></speak>`;
  }
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}"><voice name="${voice}"><mstts:express-as style="general" styledegree="1.0"><prosody rate="0.90">${processed}</prosody></mstts:express-as></voice></speak>`;
}
async function ttsAzure(text: string, lang: string, apiKey: string, mode: "story" | "study") {
  const voice = pickVoice(lang, mode);
  const locale = AZURE_LANG_LOCALE[lang] ?? "en-GB";
  const ssml = buildSSML(text, voice, locale, mode);
  const res = await fetch(`https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "studysound-seed",
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
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const AZURE_KEY = Deno.env.get("Azure_Secret_Key_SpeechServices");
    if (!AZURE_KEY) throw new Error("Azure key not configured");

    // Admin-only
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const { document_id, language = "en", chunks: chunkCount = 2 } = body ?? {};
    if (!document_id) {
      return new Response(JSON.stringify({ error: "document_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: doc } = await admin
      .from("documents")
      .select("id, clean_text, language, subject_type")
      .eq("id", document_id)
      .maybeSingle();
    if (!doc) throw new Error("Document not found");

    const lang = (language ?? doc.language ?? "en").toLowerCase();
    if (!AZURE_LANGS.has(lang)) throw new Error(`Language ${lang} not supported by Azure`);
    const provider = "azure" as const;
    const mode: "story" | "study" = doc.subject_type === "novel" ? "story" : "study";
    const voiceName = AZURE_VOICES[lang] ?? AZURE_VOICES.en;
    const speakingStyle = mode === "story" ? "narration-relaxed" : "general";

    const chunks = chunkText(doc.clean_text);
    const limit = Math.min(chunkCount, chunks.length);
    const results: Array<{ chunk_index: number; status: string }> = [];

    for (let i = 0; i < limit; i++) {
      const { data: existing } = await admin
        .from("audio_assets")
        .select("id")
        .eq("document_id", doc.id).eq("chunk_index", i).eq("language", lang)
        .eq("voice_provider", provider).eq("voice_name", voiceName).eq("speaking_style", speakingStyle)
        .maybeSingle();
      if (existing) { results.push({ chunk_index: i, status: "already_cached" }); continue; }

      const audio = await ttsAzure(chunks[i], lang, AZURE_KEY, mode);
      const storagePath = `audio/${doc.id}/${lang}/${provider}/${voiceName}/${speakingStyle}/${i}.mp3`;
      const { error: upErr } = await admin.storage.from("assets")
        .upload(storagePath, new Uint8Array(audio), { contentType: "audio/mpeg", upsert: true });
      if (upErr) throw new Error(`Storage upload: ${upErr.message}`);
      await admin.from("audio_assets").insert({
        document_id: doc.id, chunk_index: i, language: lang,
        voice_provider: provider, voice_name: voiceName, speaking_style: speakingStyle,
        storage_path: storagePath, char_count: chunks[i].length,
      });
      results.push({ chunk_index: i, status: "generated" });
    }

    return new Response(JSON.stringify({ success: true, document_id: doc.id, language: lang, voice_name: voiceName, speaking_style: speakingStyle, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("seed-preview-audio error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
