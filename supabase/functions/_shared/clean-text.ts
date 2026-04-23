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

// Headings/blocks to strip from plays — character lists, scene location lists,
// front-matter sections that should not be narrated as story content.
const PLAY_FRONTMATTER_HEADINGS: RegExp[] = [
  /^\s*DRAMATIS\s+PERSON[AÆ]E?\b/i,
  /^\s*PERSONS?\s+(?:REPRESENTED|OF\s+THE\s+(?:PLAY|DRAMA)|IN\s+THE\s+PLAY)\b/i,
  /^\s*CHARACTERS?\s+(?:OF\s+THE\s+PLAY|IN\s+THE\s+PLAY|REPRESENTED)\b/i,
  /^\s*THE\s+SCENE\b/i,
  /^\s*SCENE[:\.]\s*$/i, // standalone "SCENE." heading for the location list
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

// Strip front-matter sections (Dramatis Personae, scene/location lists, etc.)
// that appear *before* ACT I. We scan from the start of the text up to the
// first ACT marker and excise any block headed by a known front-matter heading.
function stripPlayFrontMatter(text: string): string {
  const firstAct = text.match(/^\s*ACT\s+(?:I|1|THE\s+FIRST)\b/im);
  const cutoff = firstAct?.index ?? text.length;

  // Walk lines in the pre-ACT region. When we hit a front-matter heading,
  // skip until we hit a blank line followed by another structural marker
  // (ACT, SCENE, or another all-caps heading we don't recognise as content).
  const head = text.slice(0, cutoff);
  const tail = text.slice(cutoff);

  const lines = head.split("\n");
  const kept: string[] = [];
  let skipping = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!skipping && PLAY_FRONTMATTER_HEADINGS.some((rx) => rx.test(trimmed))) {
      skipping = true;
      continue;
    }

    if (skipping) {
      // Stop skipping when we reach an ACT marker (shouldn't happen in head,
      // but defensive) or a clearly new top-level heading after a blank line.
      if (/^\s*ACT\s+(?:I|1|[IVX]+|\d+|THE\s+\w+)\b/i.test(trimmed)) {
        skipping = false;
        kept.push(line);
      }
      // Otherwise drop the line.
      continue;
    }

    kept.push(line);
  }

  return kept.join("\n") + tail;
}

// Collapse runs of 3+ consecutive ALL-CAPS lines (publisher blurbs, dedications,
// list-style metadata) that aren't real headings (ACT/SCENE).
function collapseUppercaseBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let run: string[] = [];

  const isHeading = (s: string) =>
    /^\s*(ACT|SCENE|PROLOGUE|EPILOGUE|CHORUS)\b/i.test(s);
  const isAllCaps = (s: string) => {
    const t = s.trim();
    if (t.length < 4) return false;
    if (isHeading(t)) return false;
    // mostly uppercase letters; allow punctuation/digits/spaces
    const letters = t.replace(/[^A-Za-z]/g, "");
    if (letters.length < 4) return false;
    return letters === letters.toUpperCase() && /[A-Z]/.test(letters);
  };

  const flush = () => {
    if (run.length >= 3) {
      // drop the whole run
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const line of lines) {
    if (isAllCaps(line)) {
      run.push(line);
    } else {
      flush();
      out.push(line);
    }
  }
  flush();

  return out.join("\n");
}

// Make plays read better:
//  - Speaker label `IAGO.` or `IAGO` on its own line → `IAGO:`
//  - ACT / SCENE markers preserved on their own lines with blank-line padding
//  - Stage directions `(…)` → `[…]` for clearer audio cues
function normalisePlayFormatting(text: string): string {
  // Speaker label: 1-3 uppercase words (≤30 chars) on its own line, optional trailing period.
  const speakerLine = /^([A-Z][A-Z'\- ]{1,30})\.?\s*$/gm;
  text = text.replace(speakerLine, (_m, name) => {
    const n = name.trim();
    // Don't touch real headings.
    if (/^(ACT|SCENE|PROLOGUE|EPILOGUE|CHORUS)\b/i.test(n)) return _m;
    return `${n}:`;
  });

  // Inline speaker form like `IAGO. Tush, never tell me.` → `IAGO: Tush…`
  text = text.replace(
    /^([A-Z][A-Z'\- ]{1,30})\.\s+(?=[A-Z“"'\(\[])/gm,
    (_m, name) => `${name.trim()}: `,
  );

  // (stage direction) → [stage direction]
  text = text.replace(/\(([^()\n]{2,120})\)/g, (_m, inner) => `[${inner.trim()}]`);

  // Pad ACT and SCENE headings with blank lines for clear structure.
  text = text.replace(
    /^[ \t]*(ACT\s+[IVX\d]+(?:\.[^\n]*)?)[ \t]*$/gim,
    "\n\n$1\n",
  );
  text = text.replace(
    /^[ \t]*(SCENE\s+[IVX\d]+\.?[^\n]*)$/gim,
    "\n$1\n",
  );

  // Tidy excessive blank lines created above.
  text = text.replace(/\n{3,}/g, "\n\n");

  return text;
}

export type DocKind = "play" | "novel";

export interface SceneRef {
  act: string;        // e.g. "ACT I"
  scene: string;      // e.g. "SCENE I"
  location?: string;  // e.g. "Venice. A street."
}

export interface CleanResult {
  text: string;
  startedAt: "play" | "novel" | "none";
  charCount: number;
  /** Optional structural index for plays — not narrated, useful for navigation. */
  structure?: SceneRef[];
}

function extractPlayStructure(text: string): SceneRef[] {
  const structure: SceneRef[] = [];
  let currentAct = "";
  const lineRx = /^[ \t]*(ACT\s+[IVX\d]+|SCENE\s+[IVX\d]+\.?[^\n]*)$/gim;
  let m: RegExpExecArray | null;
  while ((m = lineRx.exec(text)) !== null) {
    const heading = m[1].trim();
    if (/^ACT/i.test(heading)) {
      currentAct = heading.replace(/\s+/g, " ");
    } else {
      const sceneMatch = heading.match(/^(SCENE\s+[IVX\d]+)\.?\s*(.*)$/i);
      if (sceneMatch) {
        structure.push({
          act: currentAct || "ACT I",
          scene: sceneMatch[1].toUpperCase().replace(/\s+/g, " "),
          location: sceneMatch[2]?.trim() || undefined,
        });
      }
    }
  }
  return structure;
}

/**
 * Clean raw public-domain text (e.g. from Project Gutenberg) into
 * narration-ready content.
 *
 *  - Strips Gutenberg header/footer
 *  - Drops licence / URL / boilerplate lines
 *  - Starts at ACT I (plays) or CHAPTER 1 (novels)
 *  - For plays: strips Dramatis Personae & scene/location front-matter,
 *    preserves ACT/SCENE markers, normalises speaker labels (`IAGO:`),
 *    converts stage directions `(…)` → `[…]`, collapses uppercase blocks.
 *  - Cuts trailing "End of Project Gutenberg…" tails
 *  - Normalises whitespace
 *
 * For plays, also returns an optional `structure` array (act/scene/location)
 * which callers may persist separately — it is NOT included in `text` beyond
 * the inline ACT/SCENE headings already needed for narration cues.
 */
export function cleanRawText(raw: string, kind: DocKind): CleanResult {
  let text = raw ?? "";
  text = stripGutenbergBoilerplate(text);
  text = dropNoiseLines(text);

  // For plays, strip Dramatis Personae / location lists BEFORE we jump to ACT I,
  // so any stragglers between front-matter and ACT I are removed too.
  if (kind === "play") text = stripPlayFrontMatter(text);

  const beforeStart = text.length;
  text = startAtRealContent(text, kind);
  const startedAt: CleanResult["startedAt"] = text.length === beforeStart ? "none" : kind;

  text = trimAtEnd(text);

  if (kind === "play") {
    text = collapseUppercaseBlocks(text);
    text = normalisePlayFormatting(text);
  }

  text = normaliseWhitespace(text);

  const result: CleanResult = { text, startedAt, charCount: text.length };
  if (kind === "play") {
    const structure = extractPlayStructure(text);
    if (structure.length > 0) result.structure = structure;
  }
  return result;
}
