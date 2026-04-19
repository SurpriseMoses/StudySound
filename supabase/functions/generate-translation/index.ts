// Generate a translation for a single chunk of a document.
// Mirrors the audio caching architecture:
// - Deterministic server-side chunking (~1800 chars, sentence boundaries) — must match generate-audio
// - Shared cache in translation_assets keyed by (document_id, chunk_index, target_language)
// - Per-user paid access in user_translation_access — 1 credit charged ONCE per (user, document, chunk, language)
// - Replays / other users hitting the same cache row are FREE for the cache, but each NEW user still pays once
// - Supports preview_only=true to fetch cost summary without charging or generating
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE = 1800;
const CREDITS_PER_CHUNK = 1;

const LANG_NAMES: Record<string, string> = {
  en: "English",
  af: "Afrikaans",
  zu: "isiZulu",
  xh: "isiXhosa",
  ts: "Xitsonga (Tsonga)",
  nso: "Sepedi (Northern Sotho)",
  fr: "French",
};

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

async function translateWithAI(text: string, sourceLang: string, targetLang: string): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const sourceName = LANG_NAMES[sourceLang] ?? sourceLang;
  const targetName = LANG_NAMES[targetLang] ?? targetLang;

  const systemPrompt =
    `You are a precise translator for South African high-school study material. ` +
    `Translate the user's text from ${sourceName} into ${targetName}. ` +
    `Preserve meaning, tone, names, numbers, and paragraph breaks. ` +
    `Do NOT add commentary, notes, or quotation marks around the output. ` +
    `Return ONLY the translated text.`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    }),
  });

  if (resp.status === 429) throw new Error("Rate limit exceeded. Please try again shortly.");
  if (resp.status === 402) throw new Error("AI credits exhausted. Please top up your workspace.");
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI gateway error ${resp.status}: ${t.slice(0, 200)}`);
  }

  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") throw new Error("Empty translation response");
  return content.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { lesson_id, chunk_index, target_language, preview_only } = body ?? {};

    if (!lesson_id || typeof lesson_id !== "string") {
      return new Response(JSON.stringify({ error: "lesson_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!target_language || typeof target_language !== "string") {
      return new Response(JSON.stringify({ error: "target_language required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load lesson + document
    const { data: lesson, error: lessonErr } = await admin
      .from("lessons")
      .select("id, user_id, document_id, content_text")
      .eq("id", lesson_id)
      .maybeSingle();
    if (lessonErr || !lesson) {
      return new Response(JSON.stringify({ error: "Lesson not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (lesson.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sourceText = lesson.content_text ?? "";
    let documentId = lesson.document_id;
    let sourceLang = "en";

    if (documentId) {
      const { data: doc } = await admin
        .from("documents")
        .select("id, clean_text, language")
        .eq("id", documentId)
        .maybeSingle();
      if (doc) {
        sourceText = doc.clean_text ?? sourceText;
        sourceLang = doc.language ?? "en";
      }
    }

    const chunks = chunkText(sourceText);
    const totalChunks = chunks.length;

    // Same-language no-op
    if (target_language === sourceLang) {
      return new Response(JSON.stringify({
        success: true,
        cached: true,
        same_language: true,
        translated_text: chunks[chunk_index ?? 0] ?? "",
        chunk_index: chunk_index ?? 0,
        total_chunks: totalChunks,
        credits_charged: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Expire stale free-tier credits before reading balance
    await admin.rpc("expire_free_credits", { _user_id: userId });
    // Profile + balance
    const { data: profile } = await admin
      .from("profiles")
      .select("credits_balance")
      .eq("user_id", userId)
      .maybeSingle();
    const balance = profile?.credits_balance ?? 0;

    // Count existing user-paid chunks for this (doc, lang)
    const { data: paidRows } = await admin
      .from("user_translation_access")
      .select("chunk_index")
      .eq("user_id", userId)
      .eq("document_id", documentId)
      .eq("target_language", target_language);
    const paidChunkCount = paidRows?.length ?? 0;

    if (preview_only) {
      const remainingChunks = Math.max(0, totalChunks - paidChunkCount);
      return new Response(JSON.stringify({
        success: true,
        total_chunks: totalChunks,
        paid_chunks: paidChunkCount,
        remaining_credits_for_full_book: remainingChunks * CREDITS_PER_CHUNK,
        credits_balance: balance,
        source_language: sourceLang,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const idx = typeof chunk_index === "number" ? chunk_index : 0;
    if (idx < 0 || idx >= totalChunks) {
      return new Response(JSON.stringify({ error: "chunk_index out of range" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Cache hit?
    const { data: cached } = await admin
      .from("translation_assets")
      .select("translated_text")
      .eq("document_id", documentId)
      .eq("chunk_index", idx)
      .eq("target_language", target_language)
      .maybeSingle();

    // 2) Has user already paid for THIS chunk?
    const alreadyPaid = (paidRows ?? []).some((r) => r.chunk_index === idx);

    let translatedText = cached?.translated_text ?? null;

    // 3) Generate if missing
    if (!translatedText) {
      const sourceChunk = chunks[idx];
      translatedText = await translateWithAI(sourceChunk, sourceLang, target_language);

      // Persist to shared cache (ignore conflict — another concurrent request may have inserted)
      const { error: insErr } = await admin
        .from("translation_assets")
        .insert({
          document_id: documentId,
          chunk_index: idx,
          source_language: sourceLang,
          target_language,
          translated_text: translatedText,
          char_count: translatedText.length,
        });
      if (insErr && !insErr.message.includes("duplicate")) {
        console.error("translation_assets insert failed:", insErr);
      }
    }

    // 4) Charge credits if user hasn't unlocked this chunk yet
    let creditsCharged = 0;
    if (!alreadyPaid) {
      if (balance < CREDITS_PER_CHUNK) {
        return new Response(JSON.stringify({
          error: "Insufficient credits",
          credits_balance: balance,
          credits_required: CREDITS_PER_CHUNK,
        }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { error: accessErr } = await admin
        .from("user_translation_access")
        .insert({
          user_id: userId,
          document_id: documentId,
          chunk_index: idx,
          target_language,
          credits_charged: CREDITS_PER_CHUNK,
        });

      if (!accessErr) {
        creditsCharged = CREDITS_PER_CHUNK;
        await admin
          .from("profiles")
          .update({ credits_balance: balance - CREDITS_PER_CHUNK })
          .eq("user_id", userId);
      }
      // If duplicate (race), treat as already paid — no charge
    }

    return new Response(JSON.stringify({
      success: true,
      cached: !!cached,
      translated_text: translatedText,
      chunk_index: idx,
      total_chunks: totalChunks,
      credits_charged: creditsCharged,
      source_language: sourceLang,
      target_language,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-translation error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
