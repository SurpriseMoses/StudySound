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
// NOTE: For plays we don't use these as the *only* signal — Gutenberg editions
// often list "ACT I SCENE I. An open Place." inside a scene-list TOC at the top
// of the file. The first ACT I match would land us inside that TOC. Instead we
// run findPlayBodyStart() which requires ACT I + SCENE I + a speaker label
// nearby to confirm we're in the actual play.
const PLAY_START_PATTERNS: RegExp[] = [
  /\bACT\s+I\b(?!\w)/g,
  /\bACT\s+1\b(?!\w)/g,
  /\bACT\s+THE\s+FIRST\b/gi,
  /\bPROLOGUE\b/g,
];
// All case-insensitive — Gutenberg editions vary ("CHAPTER I", "Chapter 1",
// "Letter 1"). Without the `i` flag, "Letter 1" in Frankenstein never matches
// and we leave the CONTENTS block at the top of the file.
const NOVEL_START_PATTERNS: RegExp[] = [
  /^\s*CHAPTER\s+(?:I|1)\b(?!\w)/im,
  /^\s*Chapter\s+(?:I|1)\b(?!\w)/im,
  /^\s*BOOK\s+(?:THE\s+)?FIRST\b/im,
  /^\s*PART\s+(?:I|1|ONE)\b/im,
  /^\s*LETTER\s+(?:I|1)\b/im, // Frankenstein opens with letters
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
    // Reset stateful (g-flag) regexes so repeated calls are safe.
    if ("lastIndex" in rx) rx.lastIndex = 0;
    const m = text.match(rx);
    if (m && m.index !== undefined) return m.index;
  }
  return -1;
}

// For plays: the first occurrence of "ACT I" is almost always inside the
// scene-list TOC at the top of Gutenberg editions (e.g. Macbeth lists every
// scene as "ACT I Scene I. An open Place. Scene II. ..."). The *real* play
// body always has, soon after ACT I:
//   - a SCENE I marker (could be "SCENE I." or "SCENE I:"),
//   - immediately followed by stage business + a speaker label like
//     "FIRST WITCH:" / "DUNCAN:" / "MACBETH:".
// We scan all ACT I matches and pick the first one whose ~2KB window after it
// contains both SCENE I and an ALL-CAPS speaker label followed by ":".
function findPlayBodyStart(text: string): number {
  // Speaker labels in plays end with `:` OR `.` (Gutenberg uses `.`), e.g.
  // "MACBETH:" or "FIRST WITCH." Require a newline after to avoid matching
  // sentence-ending words mid-paragraph.
  const speakerRx = /\b[A-Z][A-Z' \-]{1,30}[:.]\s*\n/;
  const sceneOneRx = /\bSCENE\s+(?:I|1)\b/;
  // Lines that prove we're in a TOC (multiple ACTs listed back-to-back).
  const laterActRx = /\bACT\s+(?:II|III|IV|V|2|3|4|5)\b/;
  for (const rx of PLAY_START_PATTERNS) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const start = m.index;
      // Look only a short distance ahead for SCENE I — in real play body it's
      // adjacent. In a TOC, SCENE I sits next to other ACT headings.
      const near = text.slice(start, start + 600);
      const sceneMatch = near.match(sceneOneRx);
      if (!sceneMatch) continue;
      // If a later ACT (II/III/IV/V) appears between this ACT I and SCENE I,
      // we're inside a scene-list TOC — skip to the next ACT I match.
      const between = near.slice(0, sceneMatch.index);
      if (laterActRx.test(between)) continue;
      // Speaker label must appear within ~1500 chars after the ACT I match —
      // proves real dialogue follows, not a personae list.
      const window = text.slice(start, start + 1500);
      if (!speakerRx.test(window)) continue;
      return start;
    }
  }
  return -1;
}

// Novels: like plays, the first "CHAPTER 1" / "LETTER 1" match is often
// inside a CONTENTS block ("Letter 1\nLetter 2\n...Chapter 24\n\nLetter 1\n…").
// The real body has prose (sentences with punctuation) shortly after it; the
// TOC entry is followed only by more short label lines. Pick the first match
// whose ~1500-char window ahead contains real prose AND not a stack of more
// chapter/letter labels.
function findNovelBodyStart(text: string): number {
  const labelStackRx = /(?:^|\n)\s*(?:CHAPTER|Chapter|LETTER|Letter)\s+(?:[IVXLC]+|\d+)\b[^\n]{0,40}\n\s*(?:CHAPTER|Chapter|LETTER|Letter)\s+(?:[IVXLC]+|\d+)\b/;
  const proseRx = /[a-z][a-z,\s'"–—-]{60,}[.!?]/;
  // Collect all valid candidates from every pattern, then pick the EARLIEST.
  // Otherwise CHAPTER 1 (later in the file) would win over LETTER 1 just
  // because the CHAPTER pattern is checked first in the array.
  let best = -1;
  for (const rx of NOVEL_START_PATTERNS) {
    const flags = rx.flags.includes("g") ? rx.flags : rx.flags + "g";
    const gx = new RegExp(rx.source, flags);
    let m: RegExpExecArray | null;
    while ((m = gx.exec(text)) !== null) {
      const start = m.index;
      const window = text.slice(start, start + 1500);
      if (labelStackRx.test(text.slice(start, start + 400))) continue;
      if (!proseRx.test(window)) continue;
      if (best < 0 || start < best) best = start;
      break; // earliest match for this pattern; move to next pattern
    }
  }
  return best;
}

function startAtRealContent(text: string, kind: "play" | "novel"): string {
  if (kind === "play") {
    const playIdx = findPlayBodyStart(text);
    if (playIdx > 0) return text.slice(playIdx);
    const novelIdx = findNovelBodyStart(text);
    if (novelIdx > 0) return text.slice(novelIdx);
    const anyAct = findFirstIndex(text, PLAY_START_PATTERNS);
    if (anyAct > 0) return text.slice(anyAct);
    return text;
  }
  const idx = findNovelBodyStart(text);
  if (idx > 0) return text.slice(idx);
  // findNovelBodyStart returns -1 either because (a) no marker found, or
  // (b) prose already exists above the first marker — in case (b) we leave
  // the text as-is. Only fall back to a naive search when there is no prose
  // at all in the head (i.e. the doc really is all front-matter at the top).
  const proseRx = /[a-z][a-z, ]{40,}[.!?]/;
  if (proseRx.test(text.slice(0, 4000))) return text;
  let fallback = findFirstIndex(text, NOVEL_START_PATTERNS);
  if (fallback < 0) fallback = findFirstIndex(text, PLAY_START_PATTERNS);
  if (fallback > 0) text = text.slice(fallback);
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
    // `_italic phrase_` → `italic phrase` (multi-pass to handle nested/adjacent)
    .replace(/_([^_\n]{1,200})_/g, "$1")
    .replace(/_([^_\n]{1,200})_/g, "$1")
    // any remaining stray underscores anywhere
    .replace(/_+/g, " ")
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
    // lines that are just dashes / hyphens / em-dashes (separators)
    .replace(/^\s*[-–—_*]{2,}\s*$/gm, "")
    // stray leading/trailing hyphens on otherwise-text lines
    .replace(/^\s*[-–—]\s+/gm, "")
    .replace(/\s+[-–—]\s*$/gm, "")
    // "word- word" hyphen-space artifacts from OCR'd line breaks
    .replace(/(\w)-\s+(\w)/g, "$1$2")
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
// Stage directions are NOT narrated — they break immersion and are not part of
// the spoken text. We drop bracketed/parenthesised cues entirely, plus their
// bare-line equivalents ("Exit.", "Exeunt.", "Enter Iago.", "Re-enter Cassio.",
// "Aside.", "Within.", "Flourish.", "Alarum within.", "Thunder.", etc.).
const STAGE_CUE_LEAD = /^(?:exit|exeunt|exuent|enter|re-?enter|aside|within|flourish|alarum|thunder|lightning|trumpets?|sennet|drum|fanfare|hautboys|cornets|march|sound|noise|knocking|knock|music|song|dance|dies|falls|stabs|kisses|exit\.|exeunt\.)\b/i;

function isStageCueLine(s: string): boolean {
  const t = s.trim().replace(/\.$/, "");
  if (!t) return false;
  if (t.length > 120) return false; // long sentences are dialogue, not cues
  return STAGE_CUE_LEAD.test(t);
}

function normaliseStageDirections(text: string): string {
  // 1. Drop bracketed / parenthesised cues entirely:
  //    [Exit.]  (Enter Iago)  [Aside]  → ""
  // Length-bounded so we don't eat long parenthetical asides in prose.
  text = text.replace(/[\[\(]\s*[^\[\]\(\)\n]{2,200}\s*[\]\)]/g, "");

  // 2. Drop bare stage-cue lines that survived without brackets.
  text = text.split("\n").filter((line) => !isStageCueLine(line)).join("\n");

  return text;
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

// --- TOC / duplicate-structure removal -----------------------------------
//
// Detect a Table-of-Contents block: a window with many Chapter/Scene/Act
// labels and few sentence terminators, located in the first ~15% of the doc.
// We strip such a block by finding its first label and the last label in the
// run, then deleting that whole span.
function stripTableOfContents(text: string): string {
  if (text.length < 1500) return text;
  const head = text.slice(0, Math.floor(text.length * 0.20));
  // Include LETTER (Frankenstein opens with letters) and case variants.
  const labelRx = /\b(?:CHAPTER|Chapter|SCENE|Scene|ACT|Act|LETTER|Letter|BOOK|Book|PART|Part)\s+(?:[IVXLC]+|\d+|[A-Z][a-z]+)\b/g;
  const matches = [...head.matchAll(labelRx)];
  if (matches.length < 5) return text;

  // Find the longest *contiguous run* of labels — i.e. consecutive matches
  // whose gaps contain only short whitespace/punctuation. A real TOC has
  // labels stacked tightly; a real heading inside prose has hundreds of chars
  // of prose between it and the next label. Without this, we'd cut from the
  // first TOC entry all the way to the real Chapter 1 heading and delete it.
  let bestStart = -1, bestEnd = -1, bestCount = 0;
  let runStart = matches[0].index ?? 0;
  let runEnd = runStart + matches[0][0].length;
  let runCount = 1;
  for (let i = 1; i < matches.length; i++) {
    const m = matches[i];
    const idx = m.index ?? 0;
    const gap = head.slice(runEnd, idx);
    // Gap must be short (≤80 chars), contain no sentence terminator, AND not
    // contain a section break (2+ consecutive newlines = blank line).
    // The blank-line rule prevents merging the TOC with a real "Letter 1"
    // heading that appears further down after a section break.
    const isTocGap = gap.length <= 80
      && !/[.!?]\s/.test(gap)
      && !/\n[ \t\r]*\n[ \t\r]*\n/.test(gap);
    if (isTocGap) {
      runEnd = idx + m[0].length;
      runCount++;
    } else {
      if (runCount > bestCount) { bestStart = runStart; bestEnd = runEnd; bestCount = runCount; }
      runStart = idx;
      runEnd = idx + m[0].length;
      runCount = 1;
    }
  }
  if (runCount > bestCount) { bestStart = runStart; bestEnd = runEnd; bestCount = runCount; }
  if (bestCount < 5) return text;

  const span = head.slice(bestStart, bestEnd);
  const punct = (span.match(/[.,;:!?]/g) ?? []).length;
  const wordCount = (span.match(/\S+/g) ?? []).length;
  const punctRatio = wordCount > 0 ? punct / wordCount : 0;

  if (punctRatio < 0.15) {
    return text.slice(0, bestStart) + text.slice(bestEnd);
  }
  return text;
}

// Skip the heading + short metadata lines (addressee, dateline) at the very
// start of a novel so narration begins at the first real prose paragraph.
//   "Letter 1\n_To Mrs. Saville, England._\nSt. Petersburg, Dec. 11th, 17—.\nYou will rejoice…"
//        → "You will rejoice…"
// Strategy: drop a leading heading line (CHAPTER N / LETTER N), then drop only
// lines that *positively* look like an addressee, dateline, italic stage label
// or place line. Any other non-blank line is treated as the start of prose.
function skipNovelHeading(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length && /^\s*_?(?:CHAPTER|Chapter|LETTER|Letter|BOOK|PART)\s+(?:[IVXLC]+|\d+|ONE|FIRST)\b/i.test(lines[i])) {
    i++;
  }
  let safety = 6;
  while (i < lines.length && safety-- > 0) {
    const raw = lines[i];
    const t = raw.trim().replace(/^_+|_+$/g, "");
    if (t === "") { i++; continue; }
    const isAddressee = /^to\s+(mr|mrs|miss|sir|madam|lord|lady|the|[A-Z])/i.test(t);
    const isDate = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}/i.test(t)
      || /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t)
      || /\b1[7-9][\d—\-–]{1,3}\b/.test(t);
    // Italic-only label still wrapped in underscores (e.g. _Scene: Verona._)
    const isItalicLabel = /^_[^_]{1,80}_$/.test(raw.trim());
    if (isAddressee || isDate || isItalicLabel) { i++; continue; }
    break;
  }
  return lines.slice(i).join("\n");
}

// --- Chunk validation ----------------------------------------------------
//
// A chunk is "invalid" if it's too short to narrate or has no sentence-like
// punctuation. Used by audio + translation workers to skip junk fragments
// (TOC remnants, page-number stragglers, etc.).
const MIN_VALID_CHUNK_CHARS = 200;
export function isInvalidChunk(text: string): boolean {
  const trimmed = (text ?? "").trim();
  if (trimmed.length < MIN_VALID_CHUNK_CHARS) return true;
  if (!/[.!?]/.test(trimmed)) return true;
  // Mostly-uppercase fragments (orphaned headings/lists) aren't narrative.
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length > 0) {
    const upper = (trimmed.match(/[A-Z]/g) ?? []).length;
    if (upper / letters.length > 0.6) return true;
  }
  return false;
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
 * removal, whitespace normalisation) plus TOC removal.
 */
export function cleanRawText(raw: string, kind: DocKind): CleanResult {
  let text = raw ?? "";
  text = stripGutenbergBoilerplate(text);
  text = dropNoiseLines(text);

  if (kind === "play") text = stripPlayFrontMatter(text);

  // Drop TOCs *before* hunting for the start marker — Gutenberg often has both
  // a TOC and a Chapter 1 heading; the TOC's "CHAPTER I" line would otherwise
  // become our content start and pull all the list noise into chunk 0.
  text = stripTableOfContents(text);

  const beforeStart = text.length;
  text = startAtRealContent(text, kind);
  const startedAt: CleanResult["startedAt"] = text.length === beforeStart ? "none" : kind;

  // Run TOC strip again on the trimmed body in case the doc has a secondary
  // chapter list right after the start marker (common in older editions).
  text = stripTableOfContents(text);

  // For novels, skip the heading + addressee/date metadata so narration starts
  // at real prose ("You will rejoice…"), not "Letter 1 To Mrs. Saville…".
  // Run for any novel (even when startedAt === "none", e.g. when the TOC strip
  // already exposed the metadata at the top).
  if (kind === "novel") {
    text = skipNovelHeading(text);
  }

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

