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
