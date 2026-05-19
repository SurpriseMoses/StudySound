// Shared translation-pipeline helpers used by:
//   - generate-translation (on-demand)
//   - seed-translation-worker (background seeding)
//
// Goals (per "translation_pipeline_fix" spec):
//   1. Single source of truth = documents.clean_text → chunk → preprocess.
//   2. Deterministic preprocessing (ALL-CAPS, title-case headings, noise).
//   3. Hash-based cache validation (source_text_hash).
//   4. Pipeline version (CURRENT_TRANSLATION_VERSION) — bump to invalidate.
//   5. English-leak detection — refuse to save dirty translations.

export const CURRENT_TRANSLATION_VERSION = 2;

// ---------------- Translation providers (Gemini first, resilient fallbacks) ----------------

export const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  af: "Afrikaans",
  zu: "isiZulu",
  xh: "isiXhosa",
  nso: "Sepedi (Northern Sotho)",
  tn: "Setswana",
  st: "Sesotho",
  ts: "Xitsonga",
  ve: "Tshivenda",
  ss: "siSwati",
  nr: "isiNdebele",
  fr: "French",
};

export class TranslationRateLimitError extends Error {
  retryAfterMs?: number;
  constructor(msg: string, retryAfterMs?: number) {
    super(msg);
    this.name = "TranslationRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class TranslationCreditsExhaustedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TranslationCreditsExhaustedError";
  }
}

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_AI_MODEL = "google/gemini-3-flash-preview";
// gemini-2.5-flash supports Context Caching (min 1024 tokens) — required for
// per-book blueprint caching that delivers ~90% cost reduction on chunk calls.
const GOOGLE_GEMINI_MODEL = "gemini-2.5-flash";
const GOOGLE_GEMINI_URL = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
const GOOGLE_CACHED_CONTENTS_URL = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${key}`;
const AZURE_TRANSLATOR_ENDPOINT = "https://api.cognitive.microsofttranslator.com/translate";
const AZURE_TRANSLATOR_REGION = Deno.env.get("AZURE_TRANSLATOR_REGION") ?? "southafricanorth";
const AZURE_TRANSLATOR_LANG: Record<string, string> = {
  en: "en", af: "af", zu: "zu", xh: "xh", nso: "nso", tn: "tn", fr: "fr",
};
const GEMINI_LANGUAGE_DELAY_MS = 250;
const CACHE_TTL_SECONDS = 3600;            // 1 hour
const CACHE_REFRESH_BUFFER_MS = 5 * 60_000; // refresh if <5min left

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface TranslateContext {
  /** Optional Supabase admin client (any client w/ access to gemini_context_caches + translation_blueprints). */
  admin?: any;
  /** Document being translated — needed to fetch/persist a context cache. */
  documentId?: string;
  /** Pre-fetched blueprint text (avoids per-chunk DB hit when caller already has it). */
  blueprintText?: string;
}

function buildBaseSystemPrompt(sourceLabel: string, targetLabel: string): string {
  return (
    `You are a professional translator for South African high-school study material. ` +
    `Translate the user's text from ${sourceLabel} to ${targetLabel}. ` +
    `Rules:\n` +
    `1. Output ONLY the translated text. No preface, no quotes, no notes, no source.\n` +
    `2. Preserve line breaks and paragraph structure exactly.\n` +
    `3. Translate ALL words — do NOT leave English words, headings, or ALL-CAPS phrases untranslated, unless they are proper names (e.g. people, places).\n` +
    `4. Keep numbers, dates, and proper nouns as-is.\n` +
    `5. Use natural, clear ${targetLabel} suitable for a teenage learner.`
  );
}

// Translate a single text into ONE target language using Gemini.
// Prefers direct Google Gemini API (Gemini_Secret_Key) when available,
// otherwise falls back to Lovable AI gateway (LOVABLE_API_KEY).
export async function geminiTranslate(
  text: string,
  sourceLang: string,
  targetLang: string,
  ctx?: TranslateContext,
): Promise<string> {
  if (!text.trim()) return text;
  if (sourceLang === targetLang) return text;

  const sourceLabel = LANGUAGE_LABELS[sourceLang] ?? sourceLang;
  const targetLabel = LANGUAGE_LABELS[targetLang] ?? targetLang;

  const system = buildBaseSystemPrompt(sourceLabel, targetLabel);

  const out = await callBestAvailableTranslator(system, text, sourceLang, targetLang, ctx);

  // Strip accidental wrapping quotes/code fences the model sometimes adds.
  return out
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/```$/i, "")
    .trim();
}

async function callBestAvailableTranslator(
  system: string,
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string> {
  const errors: string[] = [];
  const googleKey = Deno.env.get("Gemini_Secret_Key");
  if (googleKey) {
    try {
      return await callGoogleGemini(system, text, googleKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      console.warn(`[translate] Google Gemini failed; trying fallback: ${msg}`);
    }
  }

  if (Deno.env.get("LOVABLE_API_KEY")) {
    try {
      return await callLovableGateway(system, text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      console.warn(`[translate] Lovable Gemini gateway failed; trying fallback: ${msg}`);
    }
  }

  if (Deno.env.get("Azure_Secret_Key_Translator")) {
    try {
      return await callAzureTranslator(text, sourceLang, targetLang);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
    }
  }

  if (errors.some((msg) => /rate.?limit|429/i.test(msg))) {
    throw new TranslationRateLimitError(`All translation providers are rate-limited: ${errors.join(" | ")}`, 60_000);
  }
  if (errors.some((msg) => /credits exhausted|\b402\b/i.test(msg))) {
    throw new TranslationCreditsExhaustedError(`Translation credits exhausted: ${errors.join(" | ")}`);
  }
  throw new Error(errors.length ? `No translation provider succeeded: ${errors.join(" | ")}` : "No translation API key configured");
}

async function callGoogleGemini(system: string, text: string, apiKey: string): Promise<string> {
  const res = await fetch(GOOGLE_GEMINI_URL(GOOGLE_GEMINI_MODEL, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });

  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after"));
    throw new TranslationRateLimitError(
      "Google Gemini rate limit (429)",
      Number.isFinite(ra) && ra > 0 ? ra * 1000 : 30_000,
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Gemini ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const out = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
  if (typeof out !== "string" || !out.trim()) {
    throw new Error("Empty Google Gemini translation response");
  }
  return out;
}

async function callLovableGateway(system: string, text: string): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("No translation API key configured (Gemini_Secret_Key or LOVABLE_API_KEY)");

  const res = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: {
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "edge-fetch",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LOVABLE_AI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
      temperature: 0.2,
    }),
  });

  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after"));
    throw new TranslationRateLimitError(
      "Lovable AI rate limit (429)",
      Number.isFinite(ra) && ra > 0 ? ra * 1000 : 30_000,
    );
  }
  if (res.status === 402) {
    throw new TranslationCreditsExhaustedError("Lovable AI credits exhausted (402)");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Lovable AI ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const out = json?.choices?.[0]?.message?.content;
  if (typeof out !== "string" || !out.trim()) {
    throw new Error("Empty Gemini translation response");
  }
  return out;
}

async function callAzureTranslator(text: string, sourceLang: string, targetLang: string): Promise<string> {
  const apiKey = Deno.env.get("Azure_Secret_Key_Translator");
  if (!apiKey) throw new Error("Azure_Secret_Key_Translator is not configured");

  const from = AZURE_TRANSLATOR_LANG[sourceLang] ?? sourceLang;
  const to = AZURE_TRANSLATOR_LANG[targetLang] ?? targetLang;
  const params = new URLSearchParams({ "api-version": "3.0", from, to });
  const headers: Record<string, string> = {
    "Ocp-Apim-Subscription-Key": apiKey,
    "Content-Type": "application/json",
  };
  if (AZURE_TRANSLATOR_REGION) headers["Ocp-Apim-Subscription-Region"] = AZURE_TRANSLATOR_REGION;

  const res = await fetch(`${AZURE_TRANSLATOR_ENDPOINT}?${params.toString()}`, {
    method: "POST",
    headers,
    body: JSON.stringify([{ text }]),
  });
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after"));
    throw new TranslationRateLimitError(
      "Azure Translator rate limit (429)",
      Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000,
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Azure Translator ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const out = json?.[0]?.translations?.[0]?.text;
  if (typeof out !== "string" || !out.trim()) {
    throw new Error("Empty Azure translation response");
  }
  return out;
}


// Translate the same source text into multiple target languages in parallel.
export async function geminiTranslateMulti(
  text: string,
  sourceLang: string,
  targetLangs: string[],
): Promise<Record<string, string>> {
  const results: Array<readonly [string, string]> = [];
  for (let i = 0; i < targetLangs.length; i++) {
    const lang = targetLangs[i];
    if (i > 0) await sleep(GEMINI_LANGUAGE_DELAY_MS);
    results.push([lang, await geminiTranslate(text, sourceLang, lang)] as const);
  }
  return Object.fromEntries(results);
}

// ---------------- Preprocessing ----------------

function toSentenceCaseHeading(line: string): string {
  let out = line.toLowerCase();
  out = out.replace(/\b(mr|mrs|ms|dr|prof|st)\./g, (a) => a.charAt(0).toUpperCase() + a.slice(1));
  out = out.replace(/(^|[\s“"'‘’(\[])([a-z])/g, (_, p: string, c: string) => `${p}${c.toUpperCase()}`);
  out = out.replace(/([.!?:;]\s+)([a-z])/g, (_, p: string, c: string) => `${p}${c.toUpperCase()}`);
  out = out.replace(/\b([ivxlcdm]+)\b/gi, (r) => r.toUpperCase());
  return out;
}

// Removes structural / OCR noise that often survives cleaning and confuses translation.
function stripStructureNoise(text: string): string {
  return text
    // Bracketed stage directions / TOC artifacts
    .replace(/\[\s*(?:Exit|Exeunt|Enter|Scene\s+[IVX0-9]+)[^\]]*\]/gi, " ")
    // Long runs of underscores / dots / dashes used as separators or TOC leaders
    .replace(/[_]{3,}/g, " ")
    .replace(/\.{4,}/g, " ")
    .replace(/-{4,}/g, " ")
    // Pure page-number lines like " 12 " or "Page 12"
    .replace(/^\s*(?:page\s+)?\d{1,4}\s*$/gim, "")
    // Collapse multiple spaces but keep newlines
    .replace(/[ \t]{2,}/g, " ");
}

// Public: deterministic preprocessing applied right before translation AND
// before hashing — so the cache key is computed on the EXACT text Azure sees.
export function preprocessForTranslation(text: string): string {
  if (!text) return "";
  const noiseStripped = stripStructureNoise(text);
  const lines = noiseStripped.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    const letters = trimmed.match(/[A-Za-z]/g) ?? [];
    const upper = trimmed.match(/[A-Z]/g) ?? [];
    const ratio = letters.length > 0 ? upper.length / letters.length : 0;
    // >70% uppercase OR very-short ALL-CAPS heading → sentence-case
    if (letters.length >= 3 && ratio >= 0.7) {
      const lead = line.match(/^\s*/)?.[0] ?? "";
      const trail = line.match(/\s*$/)?.[0] ?? "";
      return `${lead}${toSentenceCaseHeading(trimmed)}${trail}`;
    }
    return line;
  });

  // De-shout standalone ALL-CAPS tokens (proper nouns left intact).
  const out = lines.join("\n").replace(/\b[A-Z][A-Z'’\-]*[A-Z]\b/g, (w) =>
    w.charAt(0) + w.slice(1).toLowerCase());

  // Collapse duplicate consecutive heading lines (e.g. SCENE I ... SCENE I)
  const dedupLines: string[] = [];
  for (const line of out.split(/\r?\n/)) {
    const last = dedupLines[dedupLines.length - 1];
    if (last && last.trim() && last.trim() === line.trim()) continue;
    dedupLines.push(line);
  }
  return dedupLines.join("\n").trim();
}

// ---------------- Hashing ----------------

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------- English-leak detection ----------------

// High-frequency English function/content words that should rarely survive a
// real translation into a Bantu/African language. Kept short on purpose; the
// ratio check below is what catches systemic leakage.
const ENGLISH_STOPWORDS_RE =
  /\b(?:the|and|of|for|with|that|this|from|have|been|were|will|would|could|should|about|which|their|there|where|when|what|while|because|story|search|contents|chapter|section|case|incident|window|night|letter|book|part|unit|lesson|murder)\b/gi;

const ALLCAPS_RUN_RE = /\b[A-Z]{2,}(?:\s+[A-Z]{2,}){1,}\b/;
const ALLCAPS_HEADING_WORDS_RE =
  /\b(?:STORY|SEARCH|CONTENTS|CHAPTER|BOOK|PART|CASE|INCIDENT|LETTER|WINDOW|MURDER|NIGHT|SECTION|UNIT|LESSON|SCENE|ACT)\b/;

export interface LeakResult {
  leaked: boolean;
  englishRatio: number;
  reason?: string;
}

// Languages we treat as "Latin-script Western" — for these, English stopwords
// overlap heavily with the target so leak detection is unreliable. We still
// catch ALL-CAPS heading leakage but skip the ratio check.
const LATIN_WESTERN = new Set(["af", "fr", "en"]);

export function detectEnglishLeak(translatedText: string, targetLang: string): LeakResult {
  if (!translatedText || targetLang === "en") {
    return { leaked: false, englishRatio: 0 };
  }

  // ALL-CAPS heading runs → almost always untranslated source.
  if (ALLCAPS_RUN_RE.test(translatedText)) {
    return { leaked: true, englishRatio: 1, reason: "all_caps_run" };
  }
  if (ALLCAPS_HEADING_WORDS_RE.test(translatedText)) {
    return { leaked: true, englishRatio: 1, reason: "all_caps_heading_word" };
  }

  // Skip ratio check for Latin-Western languages (too many shared tokens).
  if (LATIN_WESTERN.has(targetLang)) {
    return { leaked: false, englishRatio: 0 };
  }

  const stopMatches = translatedText.match(ENGLISH_STOPWORDS_RE) ?? [];
  const totalWords = (translatedText.match(/\b[A-Za-zÀ-ÿ]+\b/g) ?? []).length || 1;
  const ratio = stopMatches.length / totalWords;

  // Per spec: english_ratio > 0.15 → leak. Also absolute floor for short text.
  if (ratio > 0.15) return { leaked: true, englishRatio: ratio, reason: "ratio_exceeded" };
  if (stopMatches.length >= 6) return { leaked: true, englishRatio: ratio, reason: "absolute_stopwords" };
  if (stopMatches.length >= 3 && ratio > 0.08) {
    return { leaked: true, englishRatio: ratio, reason: "compound" };
  }

  return { leaked: false, englishRatio: ratio };
}

// Convenience boolean for callers that don't need the ratio.
export function hasEnglishLeak(translatedText: string, targetLang: string): boolean {
  return detectEnglishLeak(translatedText, targetLang).leaked;
}
