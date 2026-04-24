// Generate a translation for a single chunk of a document.
// Anti-abuse layer:
// - Tier-based daily caps (free: 20, paid: 100 sections/day) — based on translation_rate_log
// - Soft per-minute throttle (>5 in 60s → 429 with retry-after, no charge)
// - Hashed watermark stored in translation_watermarks for traceability
// - Charge ONLY after successful generation/cache hit + access row insert
// - Rate log written ONLY on accepted requests (not on throttled/failed)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE = 1800;
const CREDITS_PER_CHUNK = 2;
const DAILY_CAP_FREE = 20;
const DAILY_CAP_PAID = 100;
const PER_MINUTE_SOFT_LIMIT = 5;

const LANG_NAMES: Record<string, string> = {
  en: "English", af: "Afrikaans", zu: "isiZulu", xh: "isiXhosa",
  nso: "Sepedi (Northern Sotho)", tn: "Setswana", ve: "Tshivenda", fr: "French",
};

function chunkText(text: string, size = CHUNK_SIZE): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]+|\S+$/g) ?? [clean];
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + " " + s).length > size && buf.length > 0) {
      chunks.push(buf.trim()); buf = s;
    } else {
      buf = buf ? buf + " " + s : s;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Encode the first 16 hex chars (64 bits) of the hash into zero-width chars.
// ZWSP = 0, ZWNJ = 1. Interleaved into the visible text by the caller.
function zeroWidthFromHash(hashHex: string, bits = 64): string {
  const slice = hashHex.slice(0, bits / 4);
  let bin = "";
  for (const ch of slice) bin += parseInt(ch, 16).toString(2).padStart(4, "0");
  return bin.split("").map((b) => (b === "0" ? "\u200B" : "\u200C")).join("");
}

// Insert a watermark string after the first sentence (less likely to be trimmed).
function injectWatermark(text: string, mark: string): string {
  const m = text.match(/^(.+?[.!?]\s+)/);
  if (m) return text.slice(0, m[0].length) + mark + text.slice(m[0].length);
  return text + mark;
}

// Map our internal language codes to Azure Translator codes.
// Azure Translator supports: af, zu, xh, nso, tn (Setswana), fr.
// NOT supported by Azure Translator: ts (Xitsonga), ve (Tshivenda).
// (Azure returns error 400036 "target language is not valid" for ve.)
const AZURE_TRANSLATOR_LANG: Record<string, string> = {
  en: "en", af: "af", zu: "zu", xh: "xh",
  nso: "nso", tn: "tn", fr: "fr",
};

function toSentenceCaseHeading(line: string): string {
  let out = line.toLowerCase();
  out = out.replace(/\b(mr|mrs|ms|dr|prof|st)\./g, (abbr) => abbr.charAt(0).toUpperCase() + abbr.slice(1));
  out = out.replace(/(^|[\s“"'‘’(\[])([a-z])/g, (_, prefix: string, chr: string) => `${prefix}${chr.toUpperCase()}`);
  out = out.replace(/([.!?:;]\s+)([a-z])/g, (_, prefix: string, chr: string) => `${prefix}${chr.toUpperCase()}`);
  out = out.replace(/\b([ivxlcdm]+)\b/gi, (roman) => roman.toUpperCase());
  return out;
}

// Normalize ALL-CAPS headings and tokens before translation so Azure doesn't preserve
// English chapter titles / character names verbatim for languages like Setswana.
function normalizeAllCapsForTranslation(text: string): string {
  const normalizedLines = text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      const letters = trimmed.match(/[A-Za-z]/g) ?? [];
      const uppercase = trimmed.match(/[A-Z]/g) ?? [];
      const uppercaseRatio = letters.length > 0 ? uppercase.length / letters.length : 0;

      if (letters.length >= 4 && uppercaseRatio >= 0.8) {
        const leading = line.match(/^\s*/)?.[0] ?? "";
        const trailing = line.match(/\s*$/)?.[0] ?? "";
        return `${leading}${toSentenceCaseHeading(trimmed)}${trailing}`;
      }

      return line;
    })
    .join("\n");

  return normalizedLines.replace(/\b[A-Z][A-Z'’\-]*[A-Z]\b/g, (word) => {
    return word.charAt(0) + word.slice(1).toLowerCase();
  });
}

const SUSPICIOUS_TSWANA_PHRASES = [
  "the strange case",
  "contents",
  "story of the door",
  "search for mr",
  "was quite at ease",
  "the carew murder case",
  "incident of the letter",
  "incident at the window",
  "the last night",
  "full statement of the case",
];

function hasSuspiciousSetswanaEnglish(sourceText: string, translatedText: string): boolean {
  const source = sourceText.toLowerCase();
  const translated = translatedText.toLowerCase();

  const matchedPhrases = SUSPICIOUS_TSWANA_PHRASES.filter((phrase) =>
    source.includes(phrase) && translated.includes(phrase),
  );

  if (matchedPhrases.length >= 2) return true;

  const englishCarryOvers = translated.match(/\b(?:the|and|of|for|with|story|search|contents|case|incident|window|night)\b/gi) ?? [];
  return englishCarryOvers.length >= 8;
}

function shouldRefreshCachedTranslation(sourceText: string, translatedText: string, targetLang: string): boolean {
  if (targetLang !== "tn") return false;

  return [
    /\b(?:STORY|SEARCH|CONTENTS|CHAPTER|BOOK|PART|CASE|INCIDENT|LETTER|WINDOW|MURDER|NIGHT)\b/,
    /\b(?:MR|MRS|MS|DR)\.\s+[A-Z]{2,}\b/,
    /\b[A-Z]{2,}(?:\s+[A-Z]{2,}){2,}\b/,
  ].some((pattern) => pattern.test(translatedText)) || hasSuspiciousSetswanaEnglish(sourceText, translatedText);
}

async function translateWithLovableAI(text: string, sourceLang: string, targetLang: string): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const targetLanguageName = LANG_NAMES[targetLang] ?? targetLang;
  const sourceLanguageName = LANG_NAMES[sourceLang] ?? sourceLang;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `You are an expert literary translator. Translate the passage from ${sourceLanguageName} into ${targetLanguageName}. Translate headings and words that appear in ALL CAPS naturally instead of preserving them in English. Keep names of people and places recognizable. Preserve paragraph breaks. Return only the translated text.`,
        },
        {
          role: "user",
          content: text,
        },
      ],
    }),
  });

  if (!resp.ok) {
    throw new Error(`AI gateway error ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Empty AI translation response");
  }

  return content.trim();
}
// Region of the Azure resource. South Africa North resources usually require the
// region header, while global resources reject it. Try both paths safely.
const AZURE_TRANSLATOR_REGION = Deno.env.get("AZURE_TRANSLATOR_REGION") ?? "southafricanorth";

function isUnsupportedAzureLanguageError(message: string): boolean {
  return /AZURE_LANG_UNSUPPORTED|target language is not valid|400036/i.test(message);
}

function buildUnsupportedLanguageMessage(targetLang: string): string {
  const languageLabel = LANG_NAMES[targetLang] ?? targetLang.toUpperCase();
  return `Azure translation is not available for ${languageLabel} right now.`;
}

function buildUnsupportedLanguagePayload(targetLanguage: string) {
  return {
    success: false,
    fallback: true,
    error: buildUnsupportedLanguageMessage(targetLanguage),
    code: "TRANSLATION_UNSUPPORTED",
    target_language: targetLanguage,
  };
}

function jsonResponse(payload: Record<string, unknown>, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

async function translateWithAzure(text: string, sourceLang: string, targetLang: string): Promise<string> {
  const key = Deno.env.get("Azure_Secret_Key_Translator");
  if (!key) throw new Error("AZURE_TRANSLATOR_NOT_CONFIGURED");

  const from = AZURE_TRANSLATOR_LANG[sourceLang];
  const to = AZURE_TRANSLATOR_LANG[targetLang];
  if (!from || !to) throw new Error(`AZURE_LANG_UNSUPPORTED:${sourceLang}->${targetLang}`);

  const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=${from}&to=${to}&textType=plain`;
  const regionCandidates = Array.from(new Set([
    AZURE_TRANSLATOR_REGION,
    "southafricanorth",
    "global",
  ].filter(Boolean)));

  let lastError = "Azure Translator request failed";
  for (const region of regionCandidates) {
    const headers: Record<string, string> = {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/json",
    };

    if (region && region !== "global") {
      headers["Ocp-Apim-Subscription-Region"] = region;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify([{ Text: text }]),
    });

    if (res.ok) {
      const json = await res.json();
      const out = json?.[0]?.translations?.[0]?.text;
      if (!out || typeof out !== "string") throw new Error("Empty Azure translation response");
      console.log(`[translate] azure auth ok via ${region === "global" ? "global" : region}`);
      return out.trim();
    }

    const body = await res.text();
    lastError = `Azure Translator ${res.status}: ${body.slice(0, 200)}`;

    if (res.status !== 401 && res.status !== 403) {
      throw new Error(lastError);
    }

    console.warn(`[translate] azure auth failed via ${region === "global" ? "global" : region}: ${lastError}`);
  }

  throw new Error(lastError);
}

// Azure-only translation. No AI gateway fallback — surface real errors to the client.
async function translateWithAI(text: string, sourceLang: string, targetLang: string): Promise<string> {
  const normalized = normalizeAllCapsForTranslation(text);
  const azureOutput = await translateWithAzure(normalized, sourceLang, targetLang);

  if (targetLang === "tn" && hasSuspiciousSetswanaEnglish(normalized, azureOutput)) {
    console.warn(`[translate] azure tn output looked partially untranslated; retrying with Lovable AI (${text.length} chars)`);
    try {
      const aiOutput = await translateWithLovableAI(normalized, sourceLang, targetLang);
      console.log(`[translate] ai fallback ok ${sourceLang}->${targetLang} (${text.length} chars)`);
      return aiOutput;
    } catch (fallbackError) {
      console.error("[translate] tn ai fallback failed:", fallbackError);
    }
  }

  console.log(`[translate] azure ok ${sourceLang}->${targetLang} (${text.length} chars)`);
  return azureOutput;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let requestBody: Record<string, unknown> | null = null;

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
    requestBody = body ?? null;
    const { lesson_id, chunk_index, target_language, preview_only, check_only } = body ?? {};

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

    if (!AZURE_TRANSLATOR_LANG[target_language]) {
      return jsonResponse(buildUnsupportedLanguagePayload(target_language));
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
        success: true, cached: true, same_language: true,
        translated_text: chunks[chunk_index ?? 0] ?? "",
        chunk_index: chunk_index ?? 0, total_chunks: totalChunks, credits_charged: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Expire stale free credits before reading balance
    await admin.rpc("expire_free_credits", { _user_id: userId });

    const { data: profile } = await admin
      .from("profiles")
      .select("credits_balance, plan, display_name")
      .eq("user_id", userId)
      .maybeSingle();
    const balance = profile?.credits_balance ?? 0;
    const plan = profile?.plan ?? "free";
    const dailyCap = plan === "free" ? DAILY_CAP_FREE : DAILY_CAP_PAID;

    // Admin enforcement: flagged users / active cooldown blocked from generation
    // (cache replays via already_paid still work — see below)
    const { data: enforce } = await admin
      .from("profiles")
      .select("is_flagged, cooldown_until, flagged_reason")
      .eq("user_id", userId)
      .maybeSingle();
    const isFlagged = !!enforce?.is_flagged;
    const cooldownUntil = enforce?.cooldown_until ? new Date(enforce.cooldown_until) : null;
    const inCooldown = cooldownUntil ? cooldownUntil.getTime() > Date.now() : false;

    // Existing user-paid chunks for this (doc, lang) — needed for preview & alreadyPaid check
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
        success: true, total_chunks: totalChunks, paid_chunks: paidChunkCount,
        remaining_credits_for_full_book: remainingChunks * CREDITS_PER_CHUNK,
        credits_balance: balance, source_language: sourceLang, daily_cap: dailyCap,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const idx = typeof chunk_index === "number" ? chunk_index : 0;

    // ---- CHECK ONLY: cache existence + per-user paid state, no charge, no generation ----
    if (check_only) {
      const { data: cachedRow } = await admin
        .from("translation_assets")
        .select("id")
        .eq("document_id", documentId)
        .eq("chunk_index", idx)
        .eq("target_language", target_language)
        .maybeSingle();
      const alreadyPaidCheck = (paidRows ?? []).some((r) => r.chunk_index === idx);
      return new Response(JSON.stringify({
        success: true,
        check_only: true,
        cache_exists: !!cachedRow,
        already_paid: alreadyPaidCheck,
        credits_required: CREDITS_PER_CHUNK,
        credits_balance: balance,
        total_chunks: totalChunks,
        source_language: sourceLang,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (idx < 0 || idx >= totalChunks) {
      return new Response(JSON.stringify({ error: "chunk_index out of range" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const alreadyPaid = (paidRows ?? []).some((r) => r.chunk_index === idx);

    // ---- ANTI-ABUSE: rate limiting (only for NEW chunks; replays are free & uncounted) ----
    if (!alreadyPaid) {
      if (isFlagged) {
        return new Response(JSON.stringify({
          error: enforce?.flagged_reason ?? "Your account is under review. Please contact support.",
          code: "USER_FLAGGED",
        }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (inCooldown) {
        const secs = Math.max(1, Math.ceil((cooldownUntil!.getTime() - Date.now()) / 1000));
        return new Response(JSON.stringify({
          error: `You're temporarily paused. Try again in ${Math.ceil(secs / 60)} min.`,
          code: "COOLDOWN_ACTIVE", retry_after_seconds: secs, cooldown_until: cooldownUntil!.toISOString(),
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(secs) },
        });
      }
      const { data: dailyCount } = await admin.rpc("count_translations_today", { _user_id: userId });
      if ((dailyCount ?? 0) >= dailyCap) {
        return new Response(JSON.stringify({
          error: `Daily translation limit reached (${dailyCap}/day on ${plan} plan). Resets at midnight UTC.`,
          code: "DAILY_CAP_REACHED", daily_cap: dailyCap, used_today: dailyCount,
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: minuteCount } = await admin.rpc("count_translations_last_minute", { _user_id: userId });
      if ((minuteCount ?? 0) >= PER_MINUTE_SOFT_LIMIT) {
        return new Response(JSON.stringify({
          error: "You're translating very quickly. Please slow down for a moment.",
          code: "RATE_THROTTLED", retry_after_seconds: 10,
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "10" },
        });
      }
    }

    // 1) Cache hit?
    const { data: cached } = await admin
      .from("translation_assets")
      .select("translated_text")
      .eq("document_id", documentId)
      .eq("chunk_index", idx)
      .eq("target_language", target_language)
      .maybeSingle();

    let translatedText = cached?.translated_text ?? null;

    if (translatedText && shouldRefreshCachedTranslation(translatedText, target_language)) {
      console.log(`[translate] refreshing stale cache for ${target_language} doc=${documentId} chunk=${idx}`);
      translatedText = null;
      const { error: deleteErr } = await admin
        .from("translation_assets")
        .delete()
        .eq("document_id", documentId)
        .eq("chunk_index", idx)
        .eq("target_language", target_language);

      if (deleteErr) {
        console.error("translation_assets stale cache delete failed:", deleteErr);
      }
    }

    // 2) Generate if missing
    if (!translatedText) {
      const sourceChunk = chunks[idx];
      translatedText = await translateWithAI(sourceChunk, sourceLang, target_language);

      const { error: insErr } = await admin.from("translation_assets").insert({
        document_id: documentId, chunk_index: idx, source_language: sourceLang,
        target_language, translated_text: translatedText, char_count: translatedText.length,
      });
      if (insErr && !insErr.message.includes("duplicate")) {
        console.error("translation_assets insert failed:", insErr);
      }
    }

    // 3) Charge credits if user hasn't unlocked this chunk yet
    let creditsCharged = 0;
    if (!alreadyPaid) {
      if (balance < CREDITS_PER_CHUNK) {
        return new Response(JSON.stringify({
          error: "Insufficient credits", credits_balance: balance, credits_required: CREDITS_PER_CHUNK,
        }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { error: accessErr } = await admin.from("user_translation_access").insert({
        user_id: userId, document_id: documentId, chunk_index: idx,
        target_language, credits_charged: CREDITS_PER_CHUNK,
      });

      if (!accessErr) {
        creditsCharged = CREDITS_PER_CHUNK;
        await admin.from("profiles")
          .update({ credits_balance: balance - CREDITS_PER_CHUNK })
          .eq("user_id", userId);

        // Log usage ledger
        await admin.from("user_usage").insert({
          user_id: userId, action_type: "audio", document_id: documentId,
          credits_used: CREDITS_PER_CHUNK,
          request_id: `translate:${documentId}:${idx}:${target_language}`,
        }).then(() => {}, () => {});

        // Rate-limit log (only on accepted, charged requests)
        await admin.from("translation_rate_log").insert({
          user_id: userId, document_id: documentId,
          chunk_index: idx, target_language,
        }).then(() => {}, () => {});
      }
      // duplicate (race) → treat as already paid
    }

    // 4) Watermark — generate if missing, embed in returned text
    const secret = serviceKey.slice(0, 16); // stable per-project secret
    const wmInput = `${userId}|${documentId}|${idx}|${target_language}|${secret}`;
    const wmHash = await sha256Hex(wmInput);

    // Persist watermark mapping (one per user/doc/chunk/lang) — ignore duplicate
    await admin.from("translation_watermarks").insert({
      user_id: userId, document_id: documentId, chunk_index: idx,
      target_language, watermark_hash: wmHash,
    }).then(() => {}, () => {});

    const zeroWidthMark = zeroWidthFromHash(wmHash);
    const watermarkedText = injectWatermark(translatedText, zeroWidthMark);

    return new Response(JSON.stringify({
      success: true, cached: !!cached, translated_text: watermarkedText,
      chunk_index: idx, total_chunks: totalChunks, credits_charged: creditsCharged,
      source_language: sourceLang, target_language,
      watermark_hash: wmHash.slice(0, 12), // short prefix for support lookups
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-translation error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (isUnsupportedAzureLanguageError(msg)) {
      const targetLanguage = typeof requestBody?.target_language === "string" ? requestBody.target_language : "";
      return jsonResponse(buildUnsupportedLanguagePayload(targetLanguage));
    }
    if (/Azure Translator 5\d\d:|AZURE_TRANSLATOR_NOT_CONFIGURED/i.test(msg)) {
      return jsonResponse(
        {
          success: false,
          fallback: true,
          error: "SERVICE_UNAVAILABLE",
          message: "Translation service is temporarily unavailable.",
          code: "SERVICE_UNAVAILABLE",
        },
        200,
      );
    }
    return jsonResponse({ error: msg, fallback: false }, 500);
  }
});
