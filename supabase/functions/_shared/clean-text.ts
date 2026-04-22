// Shared text cleaner for public-domain seeded books.
// Strips Project Gutenberg boilerplate, drops licence/URL lines, and starts the
// usable text at the first real story marker (ACT I for plays, CHAPTER 1 for
// novels). Output is the narration-ready text we feed to Azure TTS.
//
// IMPORTANT: this runs both inside `seed-curriculum` (during initial seeding)
// and `seed-audio-assets` (lazy re-clean if `clean_text` is null). Keep it
// pure and Deno-safe — no network, no Supabase imports.

const DROP_LINE_PATTERNS: RegExp[] = [
  /project gutenberg/i,
  /https?:\/\//i,
  /www\./i,
  /\*{3,}/,
  /\bisbn\b/i,
  /\blicen[sc]e\b/i,
  /\bebook\b/i,
  /\bproduced by\b/i,
  /\bupdated:/i,
  /\brelease date\b/i,
  /\btranscriber's note\b/i,
  /\bmost recently updated\b/i,
];

// Markers we use to find where the *actual* book begins, in priority order.
const PLAY_START_PATTERNS: RegExp[] = [
  /^\s*ACT\s+I\b(?!\w)/m,
  /^\s*ACT\s+1\b(?!\w)/m,
  /^\s*ACT\s+THE\s+FIRST\b/im,
  /^\s*PROLOGUE\b/m,
];
const NOVEL_START_PATTERNS: RegExp[] = [
  /^\s*CHAPTER\s+(?:I|1)\b(?!\w)/m,
  /^\s*Chapter\s+(?:I|1)\b(?!\w)/m,
  /^\s*BOOK\s+(?:THE\s+)?FIRST\b/im,
  /^\s*PART\s+(?:I|1|ONE)\b/im,
  /^\s*LETTER\s+(?:I|1)\b/m, // Frankenstein opens with letters
];

// Markers that signal the end of the book proper.
const END_PATTERNS: RegExp[] = [
  /^\s*\*{3,}\s*END OF (?:THE|THIS) PROJECT GUTENBERG/im,
  /^\s*END OF (?:THE|THIS) PROJECT GUTENBERG/im,
  /^\s*FINIS\b/im,
];

function stripGutenbergBoilerplate(raw: string): string {
  // Cut everything before "*** START OF ..." and after "*** END OF ..." if present.
  const startMarker = /\*{3,}\s*START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*{3,}/i;
  const endMarker = /\*{3,}\s*END OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*{3,}/i;
  let text = raw;
  const startMatch = text.match(startMarker);
  if (startMatch && startMatch.index !== undefined) {
    text = text.slice(startMatch.index + startMatch[0].length);
  }
  const endMatch = text.match(endMarker);
  if (endMatch && endMatch.index !== undefined) {
    text = text.slice(0, endMatch.index);
  }
  return text;
}

function dropNoiseLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true; // keep blank lines (paragraph breaks)
      return !DROP_LINE_PATTERNS.some((rx) => rx.test(trimmed));
    })
    .join("\n");
}

function findFirstIndex(text: string, patterns: RegExp[]): number {
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m && m.index !== undefined) return m.index;
  }
  return -1;
}

function startAtRealContent(text: string, kind: "play" | "novel"): string {
  const primary = kind === "play" ? PLAY_START_PATTERNS : NOVEL_START_PATTERNS;
  const fallback = kind === "play" ? NOVEL_START_PATTERNS : PLAY_START_PATTERNS;
  let idx = findFirstIndex(text, primary);
  if (idx < 0) idx = findFirstIndex(text, fallback);
  if (idx > 0) text = text.slice(idx);
  return text;
}

function trimAtEnd(text: string): string {
  for (const rx of END_PATTERNS) {
    const m = text.match(rx);
    if (m && m.index !== undefined) {
      return text.slice(0, m.index);
    }
  }
  return text;
}

function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Make plays read better: speaker lines like `MACBETH` followed by dialogue
// → `MACBETH:` so the narrator inflects the change of voice. Stage directions
// in (parentheses) are converted to [brackets] for clearer audio cues.
function normalisePlayFormatting(text: string): string {
  // Speaker label followed by newline + dialogue
  // Match an UPPERCASE name (1-3 words, ≤30 chars) on its own line
  const speakerLine = /^([A-Z][A-Z'\- ]{1,30})\.?$/gm;
  text = text.replace(speakerLine, (_m, name) => `${name.trim()}:`);

  // (stage direction) → [stage direction] when it's clearly italic-style
  text = text.replace(/\(([^()\n]{2,80})\)/g, (_m, inner) => `[${inner.trim()}]`);

  return text;
}

export type DocKind = "play" | "novel";

export interface CleanResult {
  text: string;
  startedAt: "play" | "novel" | "none";
  charCount: number;
}

/**
 * Clean raw public-domain text (e.g. from Project Gutenberg) into
 * narration-ready content.
 *
 *  - Strips Gutenberg header/footer
 *  - Drops licence / URL / boilerplate lines
 *  - Starts at ACT I (plays) or CHAPTER 1 (novels)
 *  - Cuts trailing "End of Project Gutenberg…" tails
 *  - Normalises whitespace; for plays, normalises speaker labels & stage directions
 *
 * This does NOT lowercase the text — Azure TTS handles casing via SSML
 * prosody, and we want speaker names like `MACBETH:` preserved.
 */
export function cleanRawText(raw: string, kind: DocKind): CleanResult {
  let text = raw ?? "";
  text = stripGutenbergBoilerplate(text);
  text = dropNoiseLines(text);

  const beforeStart = text.length;
  text = startAtRealContent(text, kind);
  const startedAt: CleanResult["startedAt"] = text.length === beforeStart ? "none" : kind;

  text = trimAtEnd(text);
  text = normaliseWhitespace(text);

  if (kind === "play") text = normalisePlayFormatting(text);

  return { text, startedAt, charCount: text.length };
}
