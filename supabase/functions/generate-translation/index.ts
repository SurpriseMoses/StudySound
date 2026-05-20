// Generate a translation for a single chunk of a document.
// Anti-abuse layer:
// - Tier-based daily caps (free: 20, paid: 100 sections/day) — based on translation_rate_log
// - Soft per-minute throttle (>5 in 60s → 429 with retry-after, no charge)
// - Hashed watermark stored in translation_watermarks for traceability
// - Charge ONLY after successful generation/cache hit + access row insert
// - Rate log written ONLY on accepted requests (not on throttled/failed)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  CURRENT_TRANSLATION_VERSION,
  preprocessForTranslation,
  sha256Hex as pipelineSha256Hex,
  detectEnglishLeak,
} from "../_shared/translation-pipeline.ts";

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
  nso: "Sepedi (Northern Sotho)", tn: "Setswana", ts: "Xitsonga", ve: "Tshivenda", fr: "French",
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

// Generic English-residue detector: catches untranslated proper nouns, ALL-CAPS
// headings, and high-frequency English function words bleeding through into ANY
// non-English target. Designed for African-language targets where Azure
// frequently preserves title-cased / capitalized fragments verbatim.
function hasEnglishResidue(sourceText: string, translatedText: string, targetLang: string): boolean {
  if (targetLang === "en") return false;

  // ALL-CAPS headings preserved verbatim (e.g., "STORY OF THE DOOR")
  if (/\b[A-Z]{2,}(?:\s+[A-Z]{2,}){2,}\b/.test(translatedText)) return true;
  if (/\b(?:STORY|SEARCH|CONTENTS|CHAPTER|BOOK|PART|CASE|INCIDENT|LETTER|WINDOW|MURDER|NIGHT|SECTION|UNIT|LESSON)\b/.test(translatedText)) return true;

  // High-frequency English words that should rarely survive a real translation.
  const englishStopwords =
    translatedText.match(/\b(?:the|and|of|for|with|that|this|from|have|been|were|will|would|could|should|about|which|their|there|where|when|what|which|while|because|story|search|contents|chapter|section|case|incident|window|night|letter)\b/gi) ?? [];

  // Count source-side English words for ratio.
  const sourceEnglish = sourceText.match(/\b[A-Za-z]+\b/g)?.length ?? 0;
  const translatedWords = translatedText.match(/\b[A-Za-zÀ-ÿ]+\b/g)?.length ?? 1;

  // Absolute threshold (small chunks) OR a high ratio of English residue.
  if (englishStopwords.length >= 6) return true;
  if (englishStopwords.length >= 3 && englishStopwords.length / translatedWords > 0.08) return true;

  return false;
}

function shouldRefreshCachedTranslation(sourceText: string, translatedText: string, targetLang: string): boolean {
  if (targetLang === "en") return false;
  return hasEnglishResidue(sourceText, translatedText, targetLang);
}

// Lowercase a "title-like" short sentence so Azure doesn't treat it as a proper-noun
// block that should be preserved verbatim. We only do this for short fragments
// (<= 12 words) where the majority of words start with a capital letter — typical
// of headings, table-of-contents entries, and chapter titles.
function deTitleCaseShortFragment(fragment: string): string {
  const words = fragment.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 12) return fragment;

  const titleCaseWords = words.filter((w) => /^[A-Z][a-z'’\-]*\.?$/.test(w));
  const titleRatio = titleCaseWords.length / words.length;
  if (titleRatio < 0.55) return fragment;

  // Convert to sentence case: first word capitalized, rest lowercased,
  // but preserve common honorifics + standalone "I".
  return words
    .map((w, idx) => {
      if (/^(Mr|Mrs|Ms|Dr|St)\.?$/i.test(w)) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      }
      if (w === "I" || w === "I'm" || w === "I'll" || w === "I've" || w === "I'd") return w;
      const lower = w.toLowerCase();
      if (idx === 0) return lower.charAt(0).toUpperCase() + lower.slice(1);
      return lower;
    })
    .join(" ");
}

// Split text into sentence-sized fragments so Azure translates each one in isolation.
// This is critical for languages like Setswana where Azure tends to skip
// title-cased prefixes inside long mixed paragraphs.
function splitIntoFragments(text: string): string[] {
  // First split on newlines to preserve paragraph structure as boundary markers.
  const fragments: string[] = [];
  const lines = text.split(/(\r?\n+)/);

  for (const line of lines) {
    if (!line) continue;
    if (/^\r?\n+$/.test(line)) {
      fragments.push(line);
      continue;
    }

    // Split on sentence boundaries: . ! ? followed by whitespace + capital/quote.
    // Keep the punctuation attached to the preceding sentence.
    const parts = line.split(/(?<=[.!?])\s+(?=[A-Z“"‘'])/);
    for (const part of parts) {
      if (part.trim()) fragments.push(part);
      else fragments.push(part);
    }
  }

  return fragments;
}

async function translateLineByLineWithAzure(text: string, sourceLang: string, targetLang: string): Promise<string> {
  const fragments = splitIntoFragments(text);
  const translated: string[] = [];

  for (const fragment of fragments) {
    if (!fragment || /^\r?\n+$/.test(fragment)) {
      translated.push(fragment);
      continue;
    }

    const trimmed = fragment.trim();
    if (!trimmed) {
      translated.push(fragment);
      continue;
    }

    // Aggressively de-title-case short title-like fragments (table of contents, headings).
    const prepared = deTitleCaseShortFragment(trimmed);

    try {
      const out = await translateWithAzure(prepared, sourceLang, targetLang);
      const leading = fragment.match(/^\s*/)?.[0] ?? "";
      const trailing = fragment.match(/\s*$/)?.[0] ?? "";
      // Re-attach a trailing space if the original fragment was followed by another sentence
      // on the same line (split removed the separator).
      const needsTrailingSpace = trailing.length === 0 && fragments.indexOf(fragment) < fragments.length - 1;
      translated.push(`${leading}${out}${trailing}${needsTrailingSpace ? " " : ""}`);
    } catch (err) {
      console.warn(`[translate] fragment failed, keeping original: ${(err as Error).message}`);
      translated.push(fragment);
    }
  }

  return translated.join("").replace(/ +\n/g, "\n").replace(/  +/g, " ");
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

// Translate via Lovable AI Gateway (Gemini). Replaces Azure Translator.
// Kept the same name/signature so call sites don't change.
async function translateWithAzure(text: string, sourceLang: string, targetLang: string): Promise<string> {
  const { geminiTranslate } = await import("../_shared/translation-pipeline.ts");
  return await geminiTranslate(text, sourceLang, targetLang);
}

async function translateWithAI(text: string, sourceLang: string, targetLang: string): Promise<{ text: string; leaked: boolean }> {
  const normalized = preprocessForTranslation(text);
  const azureOutput = await translateWithAzure(normalized, sourceLang, targetLang);

  let finalOutput = azureOutput;
  if (targetLang !== "en" && detectEnglishLeak(azureOutput, targetLang).leaked) {
    console.warn(`[translate] azure ${targetLang} output had english leak; retrying line-by-line (${text.length} chars)`);
    const lineByLineOutput = await translateLineByLineWithAzure(normalized, sourceLang, targetLang);
    finalOutput = lineByLineOutput;
  }

  const leak = detectEnglishLeak(finalOutput, targetLang);
  console.log(`[translate] ${sourceLang}->${targetLang} (${text.length} chars) leaked=${leak.leaked} ratio=${leak.englishRatio.toFixed(3)}`);
  return { text: finalOutput, leaked: leak.leaked };
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

    // Admin bypass — admins use features for free (no charges, no caps)
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userId, _role: "admin",
    });

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
    if (!alreadyPaid && !isAdmin) {
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

    // Compute deterministic source hash on the preprocessed text (= what Azure will see)
    const preparedSource = preprocessForTranslation(chunks[idx] ?? "");
    const currentHash = await pipelineSha256Hex(preparedSource);

    // 1) Cache hit? Validate by version + hash + leak flag.
    const { data: cached } = await admin
      .from("translation_assets")
      .select("translated_text, source_text_hash, translation_version, english_leak_detected")
      .eq("document_id", documentId)
      .eq("chunk_index", idx)
      .eq("target_language", target_language)
      .maybeSingle();

    let translatedText = cached?.translated_text ?? null;

    const cacheStale = !!cached && !isAdmin && (
      cached.english_leak_detected === true ||
      (cached.translation_version ?? 1) < CURRENT_TRANSLATION_VERSION ||
      (cached.source_text_hash && cached.source_text_hash !== currentHash) ||
      (translatedText && detectEnglishLeak(translatedText, target_language).leaked)
    );

    if (cacheStale) {
      console.log(`[translate] cache invalid for ${target_language} doc=${documentId} chunk=${idx} — regenerating`);
      translatedText = null;
      await admin.from("translation_assets")
        .delete()
        .eq("document_id", documentId)
        .eq("chunk_index", idx)
        .eq("target_language", target_language);
    }

    // Admin test mode: never call upstream AI on cache miss.
    if (isAdmin && !translatedText) {
      return new Response(JSON.stringify({
        success: false,
        error: "No cached translation for this chunk. Admin test mode does not call upstream APIs.",
        code: "NO_CACHE",
        chunk_index: idx,
        target_language,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) Generate if missing
    let leakDetected = false;
    if (!translatedText) {
      const result = await translateWithAI(preparedSource, sourceLang, target_language);
      translatedText = result.text;
      leakDetected = result.leaked;

      // Per spec: NEVER save partial / leaked translations silently — still
      // persist but flag so a future request / admin sweep can regenerate.
      const { error: insErr } = await admin.from("translation_assets").insert({
        document_id: documentId, chunk_index: idx, source_language: sourceLang,
        target_language, translated_text: translatedText, char_count: translatedText.length,
        source_text_hash: currentHash,
        translation_version: CURRENT_TRANSLATION_VERSION,
        english_leak_detected: leakDetected,
      });
      if (insErr && !insErr.message.includes("duplicate")) {
        console.error("translation_assets insert failed:", insErr);
      }
    }

    // 3) Charge credits if user hasn't unlocked this chunk yet.
    // Per-feature cost is charged on EVERY unlock (cache hit or fresh generation).
    // Admins are exempt.
    let creditsCharged = 0;
    if (!alreadyPaid) {
      const requireCredits = !isAdmin;
      if (requireCredits && balance < CREDITS_PER_CHUNK) {
        return new Response(JSON.stringify({
          error: "Insufficient credits", credits_balance: balance, credits_required: CREDITS_PER_CHUNK,
        }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const chargeAmount = requireCredits ? CREDITS_PER_CHUNK : 0;
      const { error: accessErr } = await admin.from("user_translation_access").insert({
        user_id: userId, document_id: documentId, chunk_index: idx,
        target_language, credits_charged: chargeAmount,
      });

      if (!accessErr) {
        creditsCharged = chargeAmount;
        if (chargeAmount > 0) {
          await admin.from("profiles")
            .update({ credits_balance: balance - chargeAmount })
            .eq("user_id", userId);
        }

        // Log usage ledger
        await admin.from("user_usage").insert({
          user_id: userId, action_type: "audio", document_id: documentId,
          credits_used: chargeAmount,
          request_id: `translate:${documentId}:${idx}:${target_language}`,
        }).then(() => {}, () => {});

        // Rate-limit log (only on accepted requests)
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
