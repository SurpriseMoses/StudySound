// Shared text cleaner for public-domain seeded books.
//
// Pipeline (Shakespeare-grade for plays, generic for novels):
//   1. Strip Project Gutenberg header/footer + licence/URL noise lines
//   2. For plays: remove front-matter (Dramatis Personae, scene/location lists,
//      table of contents) BEFORE we jump to ACT I
//   3. Start at first ACT I (plays) or CHAPTER 1 (novels)
//   4. Trim at end-of-book markers ("End of Project Gutenberg", FINIS)
//   5. Strip non-speakable artifacts: footnotes, asterisks/daggers, page nums,
//      stray underscores `_word_`, OCR junk
//   6. Normalise stage directions: `[Exit]`, `(Enter Iago)`, `_Exeunt._`, etc.
//      → spoken-friendly form: `Exit.` / `They exit.` / `Enter Iago.`
//   7. Normalise speaker labels:
//        IAGO.  → IAGO:\n
//        IAGO. Tush…  → IAGO:\nTush…
//   8. Merge broken verse lines under a speaker into a single paragraph for
//      audio narration (preserves verse structure for novels via blank lines)
//   9. Pad ACT / SCENE headings with blank lines for clear audio structure
//
// Pure & Deno-safe. Used by `seed-curriculum`, `seed-audio-assets`,
// `seed-queue-manager`. Output is the narration-ready text fed to Azure TTS.

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
  /^\s*CONTENTS?\b/i,
  /^\s*TABLE\s+OF\s+CONTENTS?\b/i,
];

function stripGutenbergBoilerplate(raw: string): string {
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

// Strip non-speakable artifacts: page numbers, footnote markers, stray symbols,
// Gutenberg-style `_italics_` underscores, illustration tags, and dot leaders.
function stripArtifacts(text: string): string {
  return text
    // `_italic phrase_` → `italic phrase`
    .replace(/_([^_\n]{1,200})_/g, "$1")
    // stray standalone underscores left mid-sentence ("the _ woman" → "the woman")
    .replace(/\s_\s/g, " ")
    // [Illustration: ...] / [Illustration] tags from Gutenberg scans
    .replace(/\[\s*Illustration[^\]]*\]/gi, "")
    // dot leaders (TOC artifacts: "Chapter I .........  3")
    .replace(/\.{4,}/g, " ")
    // standalone footnote refs like [1], [12], [*]
    .replace(/\[\s*(?:\d{1,3}|\*|†|‡)\s*\]/g, "")
    // inline footnote symbols
    .replace(/[†‡§¶]/g, "")
    // line-end asterisk runs (footnote separators)
    .replace(/^\s*\*\s*$/gm, "")
    // bare page numbers on their own line
    .replace(/^\s*\d{1,4}\s*$/gm, "")
    // collapse double-spaces left behind
    .replace(/[ \t]{2,}/g, " ");
}

// Strip front-matter sections (Dramatis Personae, scene/location lists, TOC)
// that appear *before* ACT I. We scan from the start of the text up to the
// first ACT marker and excise blocks headed by a known front-matter heading.
function stripPlayFrontMatter(text: string): string {
  const firstAct = text.match(/^\s*ACT\s+(?:I|1|THE\s+FIRST)\b/im);
  const cutoff = firstAct?.index ?? text.length;

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
      if (/^\s*ACT\s+(?:I|1|[IVX]+|\d+|THE\s+\w+)\b/i.test(trimmed)) {
        skipping = false;
        kept.push(line);
      }
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

// --- Stage direction normalisation ----------------------------------------
// Convert bracketed/parenthesised stage directions to spoken-friendly form.
// We standardise to a sentence terminated by a period, on its own line.
function normaliseStageDirection(inner: string): string {
  let t = inner.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
  if (!t) return "";

  // Common shorthand → narration
  // "Exeunt" / "Exuent" (typo) → "They exit"
  if (/^exeunt\b/i.test(t) || /^exuent\b/i.test(t)) {
    const rest = t.replace(/^exe?unt\b/i, "").trim();
    return rest ? `They exit ${rest}.` : "They exit.";
  }
  // "Exit" alone or "Exit Iago"
  if (/^exit\b/i.test(t)) {
    return `${t.charAt(0).toUpperCase() + t.slice(1)}.`;
  }
  // "Enter Iago" / "Enter Iago and Roderigo"
  if (/^enter\b/i.test(t)) {
    return `${t.charAt(0).toUpperCase() + t.slice(1)}.`;
  }
  // "Re-enter…", "Aside", "Within", "Flourish", etc. — keep as terse cue.
  return `${t.charAt(0).toUpperCase() + t.slice(1)}.`;
}

function normaliseStageDirections(text: string): string {
  // [stage direction]  or  (stage direction)  → its own line, narration form.
  // Length-bounded to avoid swallowing long parenthetical asides in prose.
  const rx = /[\[\(]\s*([^\[\]\(\)\n]{2,200})\s*[\]\)]/g;
  return text.replace(rx, (_m, inner) => `\n${normaliseStageDirection(inner)}\n`);
}

// --- Speaker labels & line merging ----------------------------------------
// Detect speaker labels and ensure the format:
//   IAGO:
//   line of dialogue continuing on this line and the next
//   second line of dialogue is merged onto the same paragraph
function normalisePlayDialogue(text: string): string {
  // 1. Speaker on its own line: `IAGO.` or `IAGO` → `IAGO:`
  text = text.replace(
    /^([A-Z][A-Z'\- ]{1,30})\.?\s*$/gm,
    (m, name) => {
      const n = name.trim();
      if (/^(ACT|SCENE|PROLOGUE|EPILOGUE|CHORUS)\b/i.test(n)) return m;
      return `${n}:`;
    },
  );

  // 2. Inline speaker form: `IAGO. Tush, never tell me.` → `IAGO:\nTush…`
  text = text.replace(
    /^([A-Z][A-Z'\- ]{1,30})\.\s+(?=[A-Z“"'\(\[])/gm,
    (_m, name) => `${name.trim()}:\n`,
  );

  // 3. Merge broken verse lines under a speaker into one paragraph.
  //    A "speaker block" runs from `NAME:` until the next blank line, the next
  //    speaker label, an ACT/SCENE heading, or a normalised stage direction.
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  const speakerLine = /^([A-Z][A-Z'\- ]{1,30}):\s*$/;
  const isStructural = (s: string) =>
    /^(ACT|SCENE|PROLOGUE|EPILOGUE|CHORUS)\b/i.test(s.trim()) ||
    speakerLine.test(s) ||
    /^(Exit|Enter|Re-enter|They exit|Exeunt|Aside|Within|Flourish)\b/.test(s.trim());

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(speakerLine);
    if (!m) {
      out.push(line);
      i++;
      continue;
    }
    out.push(line); // the `NAME:` header
    i++;
    const buf: string[] = [];
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === "") {
        i++;
        break;
      }
      if (isStructural(next)) break;
      buf.push(next.trim());
      i++;
    }
    if (buf.length) {
      // Merge verse lines into a single flowing paragraph for narration.
      out.push(buf.join(" ").replace(/\s{2,}/g, " "));
      out.push(""); // blank line after dialogue paragraph
    }
  }
  return out.join("\n");
}

function padStructuralHeadings(text: string): string {
  text = text.replace(
    /^[ \t]*(ACT\s+[IVX\d]+(?:\.[^\n]*)?)[ \t]*$/gim,
    "\n\n$1\n",
  );
  text = text.replace(
    /^[ \t]*(SCENE\s+[IVX\d]+\.?[^\n]*)$/gim,
    "\n$1\n",
  );
  return text.replace(/\n{3,}/g, "\n\n");
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
 * Clean raw public-domain text into narration-ready content.
 *
 * Plays get the full Shakespeare pipeline:
 *   - Strip Gutenberg + Dramatis Personae + scene lists + TOC
 *   - Start at ACT I, end at "End of Project Gutenberg"
 *   - Remove footnotes / page numbers / stray underscores
 *   - Normalise stage directions to spoken form (Exit. / They exit. / Enter X.)
 *   - Normalise speaker labels (IAGO:) on their own line
 *   - Merge broken verse lines into paragraphs for fluid audio
 *   - Pad ACT/SCENE headings for clear audio breaks
 *
 * Novels get a lighter pass (boilerplate strip, start at CHAPTER 1, artifact
 * removal, whitespace normalisation).
 */
export function cleanRawText(raw: string, kind: DocKind): CleanResult {
  let text = raw ?? "";
  text = stripGutenbergBoilerplate(text);
  text = dropNoiseLines(text);

  if (kind === "play") text = stripPlayFrontMatter(text);

  const beforeStart = text.length;
  text = startAtRealContent(text, kind);
  const startedAt: CleanResult["startedAt"] = text.length === beforeStart ? "none" : kind;

  text = trimAtEnd(text);
  text = stripArtifacts(text);

  if (kind === "play") {
    text = collapseUppercaseBlocks(text);
    text = normaliseStageDirections(text);
    text = normalisePlayDialogue(text);
    text = padStructuralHeadings(text);
  }

  text = normaliseWhitespace(text);

  const result: CleanResult = { text, startedAt, charCount: text.length };
  if (kind === "play") {
    const structure = extractPlayStructure(text);
    if (structure.length > 0) result.structure = structure;
  }
  return result;
}
