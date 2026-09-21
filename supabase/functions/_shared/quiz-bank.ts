// Shared quiz-bank helpers: section selection, hashing, prompt building,
// schema + semantic validation, cost estimation.
// Used by quiz-bank-admin, quiz-seed-submit, quiz-seed-poll, quiz-play.

export type Difficulty = "easy" | "medium" | "hard";
export type QuestionType =
  | "multiple_choice"
  | "true_false"
  | "short_answer"
  | "ordering"
  | "vocabulary"
  | "inference"
  | "analysis";

export interface QuizSettings {
  credit_costs: Record<string, number>;
  presets: { id: string; label: string; questions: number }[];
  model_pricing: {
    model: string;
    input_usd_per_million: number;
    output_usd_per_million: number;
    batch_discount: number;
    usd_to_zar: number;
  };
  min_section_chars: number;
  default_questions_per_section: number;
  require_review_subjects: string[];
  auto_publish_approved: boolean;
  generation_enabled: boolean;
}

export interface SectionRow {
  id: string;
  chunk_index: number;
  text: string;
  content_hash: string;
  char_count: number;
}

// ---------------------------------------------------------------- hashing

export function normalizeQuestionText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\b(the|a|an|of|in|to|is|was|that|which|what|who)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function questionHash(question: string): Promise<string> {
  return await sha256(normalizeQuestionText(question));
}

/** Cheap near-duplicate check: token Jaccard similarity on normalized text. */
export function similarity(a: string, b: string): number {
  const ta = new Set(normalizeQuestionText(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeQuestionText(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export const NEAR_DUPLICATE_THRESHOLD = 0.82;

// ------------------------------------------------- meaningful sections

const NAV_MARKERS = [
  /table of contents/i,
  /^\s*contents\s*$/i,
  /^\s*index\s*$/i,
  /all rights reserved/i,
  /isbn/i,
  /^\s*(page\s*\d+\s*)+$/i,
];

/** Filters out metadata-only, navigational, empty or too-short fragments. */
export function isMeaningfulSection(s: { text: string; char_count: number }, minChars: number): boolean {
  const text = (s.text ?? "").trim();
  if (text.length < minChars) return false;
  // Mostly non-prose (dot leaders, page numbers, tables of contents)
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (letters / text.length < 0.55) return false;
  const head = text.slice(0, 400);
  if (NAV_MARKERS.some((re) => re.test(head)) && text.length < minChars * 3) return false;
  // Needs at least a few sentences of real content
  const sentences = text.split(/[.!?]\s/).filter((x) => x.trim().length > 40);
  return sentences.length >= 3;
}

export function pickMeaningfulSections(rows: SectionRow[], minChars: number): SectionRow[] {
  const seen = new Set<string>();
  const out: SectionRow[] = [];
  for (const r of rows) {
    if (!isMeaningfulSection(r, minChars)) continue;
    if (r.content_hash && seen.has(r.content_hash)) continue; // duplicate content
    if (r.content_hash) seen.add(r.content_hash);
    out.push(r);
  }
  return out;
}

// ------------------------------------------------------- cost estimation

export interface CostEstimate {
  sections: number;
  questions: number;
  input_tokens: number;
  output_tokens: number;
  usd: number;
  zar: number;
  batch: boolean;
  model: string;
}

export function estimateCost(
  sections: SectionRow[],
  questionsPerSection: number,
  pricing: QuizSettings["model_pricing"],
  useBatch: boolean,
): CostEstimate {
  const chars = sections.reduce((s, r) => s + (r.char_count || r.text.length), 0);
  // ~4 chars per token; prompt scaffolding ≈ 700 tokens per section request.
  const inputTokens = Math.round(chars / 4) + sections.length * 700;
  // ~160 tokens per generated question (question, options, explanation, metadata).
  const outputTokens = sections.length * questionsPerSection * 160;
  const discount = useBatch ? (pricing.batch_discount ?? 1) : 1;
  const usd =
    ((inputTokens / 1_000_000) * pricing.input_usd_per_million +
      (outputTokens / 1_000_000) * pricing.output_usd_per_million) *
    discount;
  return {
    sections: sections.length,
    questions: sections.length * questionsPerSection,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    usd,
    zar: usd * (pricing.usd_to_zar ?? 18.5),
    batch: useBatch,
    model: pricing.model,
  };
}

// ---------------------------------------------------------- prompt build

export interface GenContext {
  bookTitle: string;
  subjectKind: "literature" | "curriculum" | "stem";
  subject?: string | null;
  grade?: string | null;
  language: string;
  questionsPerSection: number;
  difficultyMix: Record<string, number>;
  skillMix: Record<string, number>;
  questionTypes: string[];
  examAlignmentLevel: "low" | "medium" | "high";
}

function mixLine(mix: Record<string, number>): string {
  const entries = Object.entries(mix).filter(([, v]) => v > 0);
  if (entries.length === 0) return "balanced";
  return entries.map(([k, v]) => `${v}% ${k.replace(/_/g, " ")}`).join(", ");
}

const COGNITIVE_BY_KIND: Record<GenContext["subjectKind"], string> = {
  literature:
    "comprehension, interpretation, inference, language structures, analysis, evaluation",
  curriculum:
    "recall/knowledge, understanding, application, analysis, evaluation",
  stem:
    "knowledge, routine procedures, complex procedures, application, calculations, interpretation, problem solving, reasoning",
};

export function buildSystemPrompt(ctx: GenContext): string {
  const strictStem = ctx.subjectKind === "stem";
  return [
    `You write assessment questions for South African high-school learners on the StudySound platform.`,
    `Book/material: "${ctx.bookTitle}". Subject: ${ctx.subject ?? "general"}. Grade: ${ctx.grade ?? "unspecified"}. Language: ${ctx.language}.`,
    ``,
    `ABSOLUTE RULES`,
    `- Use ONLY the supplied section text. Never introduce facts, names, dates, figures or events that are not present in it.`,
    `- If the section cannot support the requested number of questions, return fewer. Never pad with invented content.`,
    `- Questions must be original. Never claim or imply a question will appear in a real examination.`,
    `- Every question needs a correct answer and a 1-2 sentence explanation grounded in the section.`,
    `- Quote or reference the part of the section that supports the answer in "source_reference".`,
    ``,
    `TARGET MIX`,
    `- Questions requested per section: ${ctx.questionsPerSection}`,
    `- Difficulty distribution: ${mixLine(ctx.difficultyMix)}`,
    `- Skill distribution: ${mixLine(ctx.skillMix)}`,
    `- Allowed question types: ${ctx.questionTypes.join(", ")}`,
    `- Cognitive demand categories for this subject: ${COGNITIVE_BY_KIND[ctx.subjectKind]}`,
    `- Exam alignment level: ${ctx.examAlignmentLevel.toUpperCase()} (${
      ctx.examAlignmentLevel === "high"
        ? "mirror CAPS command words, cognitive demand and question structures used in official South African assessment material"
        : ctx.examAlignmentLevel === "medium"
          ? "curriculum-aligned and resembling common assessment formats"
          : "learning and comprehension focused"
    })`,
    ``,
    ctx.subjectKind === "literature"
      ? `LITERATURE FOCUS: events, characters, relationships, setting, vocabulary in context, cause and effect, themes, inference, literary devices, plot development.`
      : `CURRICULUM FOCUS: definitions, concepts, processes, cause and effect, application, interpretation, exam-style reasoning. Use CAPS terminology and populate caps_topic, caps_subtopic, cognitive_level and command_word.`,
    strictStem
      ? `MATHEMATICS / PHYSICAL SCIENCES: every calculation question must include full step-by-step working in "working", the exact numeric answer with units in "correct_answer", and must be solvable from the section alone.`
      : ``,
    ``,
    `MULTIPLE CHOICE RULES: exactly 4 options, exactly one correct, no duplicate options, plausible but clearly wrong distractors, never "all of the above" or "none of the above".`,
    `TRUE/FALSE RULES: the statement must be unambiguous; correct_answer must be exactly "True" or "False".`,
    `SHORT ANSWER RULES: give the model answer in correct_answer and reasonable alternatives in acceptable_answers.`,
    `ORDERING RULES: provide items and correct_order (0-based indexes into items).`,
    ``,
    `Return JSON only, matching the provided schema. No prose outside the JSON.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildUserPrompt(section: SectionRow, ctx: GenContext): string {
  return [
    `SECTION ID: ${section.id}`,
    `SECTION NUMBER: ${section.chunk_index}`,
    ``,
    `SECTION TEXT:`,
    `"""`,
    section.text.slice(0, 12000),
    `"""`,
    ``,
    `Write up to ${ctx.questionsPerSection} questions from this section only, following the mix and rules above.`,
  ].join("\n");
}

/** Gemini responseSchema for structured JSON output. */
export const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          question_type: {
            type: "string",
            enum: ["multiple_choice", "true_false", "short_answer", "ordering", "vocabulary", "inference", "analysis"],
          },
          options: { type: "array", items: { type: "string" } },
          correct_answer: { type: "string" },
          acceptable_answers: { type: "array", items: { type: "string" } },
          items: { type: "array", items: { type: "string" } },
          correct_order: { type: "array", items: { type: "integer" } },
          explanation: { type: "string" },
          working: { type: "string" },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          skill: { type: "string" },
          topic: { type: "string" },
          cognitive_level: { type: "string" },
          command_word: { type: "string" },
          caps_topic: { type: "string" },
          caps_subtopic: { type: "string" },
          learning_outcome: { type: "string" },
          assessment_skill: { type: "string" },
          source_section_id: { type: "string" },
          source_reference: { type: "string" },
          language: { type: "string" },
        },
        required: ["question", "question_type", "correct_answer", "explanation", "difficulty", "source_reference"],
      },
    },
  },
  required: ["questions"],
} as const;

// -------------------------------------------------------- validation

export interface RawQuestion {
  question?: unknown;
  question_type?: unknown;
  options?: unknown;
  correct_answer?: unknown;
  acceptable_answers?: unknown;
  items?: unknown;
  correct_order?: unknown;
  explanation?: unknown;
  working?: unknown;
  difficulty?: unknown;
  skill?: unknown;
  topic?: unknown;
  cognitive_level?: unknown;
  command_word?: unknown;
  caps_topic?: unknown;
  caps_subtopic?: unknown;
  learning_outcome?: unknown;
  assessment_skill?: unknown;
  source_section_id?: unknown;
  source_reference?: unknown;
  language?: unknown;
}

export interface ValidatedQuestion {
  question: string;
  question_type: QuestionType;
  options: string[] | null;
  correct_answer: string;
  acceptable_answers: string[] | null;
  items: string[] | null;
  correct_order: number[] | null;
  explanation: string;
  working: string | null;
  difficulty: Difficulty;
  skill: string | null;
  topic: string | null;
  cognitive_level: string | null;
  command_word: string | null;
  caps_topic: string | null;
  caps_subtopic: string | null;
  learning_outcome: string | null;
  assessment_skill: string | null;
  source_reference: string;
}

const BANNED_OPTION_RE = /\b(all|none)\s+of\s+the\s+above\b/i;
const TYPES = new Set([
  "multiple_choice", "true_false", "short_answer", "ordering", "vocabulary", "inference", "analysis",
]);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : [];

/**
 * Full validation pipeline: schema, required fields, answer, options,
 * source grounding, difficulty, type and explanation checks.
 * Returns the normalized question, or the reason it was rejected.
 */
export function validateQuestion(
  raw: RawQuestion,
  opts: { sectionText: string; strictStem: boolean; language: string },
): { ok: true; value: ValidatedQuestion } | { ok: false; reason: string } {
  const question = str(raw.question);
  if (question.length < 12) return { ok: false, reason: "question too short or missing" };
  if (!/[?:.]$/.test(question) && !/^(true or false)/i.test(question)) {
    // tolerate missing punctuation but require sentence-like length
    if (question.split(" ").length < 4) return { ok: false, reason: "question not a sentence" };
  }

  let question_type = str(raw.question_type).toLowerCase() as QuestionType;
  if (!TYPES.has(question_type)) return { ok: false, reason: `unknown question_type "${question_type}"` };
  // Skill-flavoured types still need a concrete answer format; treat them as MCQ-or-short.
  const difficulty = str(raw.difficulty).toLowerCase() as Difficulty;
  if (!["easy", "medium", "hard"].includes(difficulty)) return { ok: false, reason: "invalid difficulty" };

  const explanation = str(raw.explanation);
  if (explanation.length < 15) return { ok: false, reason: "explanation missing or too short" };

  const source_reference = str(raw.source_reference);
  if (source_reference.length < 8) return { ok: false, reason: "missing source_reference" };

  let correct_answer = str(raw.correct_answer);
  let options: string[] | null = null;
  let items: string[] | null = null;
  let correct_order: number[] | null = null;
  let acceptable_answers: string[] | null = null;

  if (question_type === "ordering") {
    items = strArr(raw.items);
    const order = Array.isArray(raw.correct_order)
      ? raw.correct_order.filter((n): n is number => Number.isInteger(n))
      : [];
    if (items.length < 3) return { ok: false, reason: "ordering needs at least 3 items" };
    if (order.length !== items.length) return { ok: false, reason: "correct_order length mismatch" };
    if (new Set(order).size !== order.length) return { ok: false, reason: "correct_order has repeats" };
    if (order.some((n) => n < 0 || n >= items!.length)) return { ok: false, reason: "correct_order out of range" };
    correct_order = order;
    correct_answer = order.join(",");
  } else if (question_type === "true_false") {
    const a = correct_answer.toLowerCase();
    if (a !== "true" && a !== "false") return { ok: false, reason: "true_false answer must be True or False" };
    correct_answer = a === "true" ? "True" : "False";
    options = ["True", "False"];
    if (/\b(sometimes|maybe|usually|might)\b/i.test(question)) {
      return { ok: false, reason: "true_false statement is ambiguous" };
    }
  } else if (question_type === "short_answer") {
    if (correct_answer.length < 1) return { ok: false, reason: "short_answer missing correct_answer" };
    acceptable_answers = strArr(raw.acceptable_answers).filter(
      (a) => a.toLowerCase() !== correct_answer.toLowerCase(),
    );
  } else {
    // multiple_choice and the skill-flavoured types are served as 4-option MCQs
    options = strArr(raw.options);
    if (options.length !== 4) return { ok: false, reason: `multiple choice needs exactly 4 options (got ${options.length})` };
    if (new Set(options.map((o) => o.toLowerCase())).size !== 4) return { ok: false, reason: "duplicate options" };
    if (options.some((o) => BANNED_OPTION_RE.test(o))) return { ok: false, reason: "banned option (all/none of the above)" };
    const match = options.find((o) => o.toLowerCase() === correct_answer.toLowerCase());
    if (!match) return { ok: false, reason: "correct_answer not present in options" };
    correct_answer = match;
    if (options.some((o) => o.length < 1)) return { ok: false, reason: "empty option" };
  }

  const working = str(raw.working) || null;
  if (opts.strictStem) {
    const looksNumeric = /[0-9]/.test(question) || /[0-9]/.test(correct_answer);
    if (looksNumeric && (!working || working.length < 20)) {
      return { ok: false, reason: "calculation question missing working" };
    }
  }

  // Source grounding: the answer/reference must overlap the section text.
  const sectionNorm = normalizeQuestionText(opts.sectionText);
  const refTokens = normalizeQuestionText(source_reference).split(" ").filter((t) => t.length > 3);
  if (refTokens.length > 0) {
    const hits = refTokens.filter((t) => sectionNorm.includes(t)).length;
    if (hits / refTokens.length < 0.5) {
      return { ok: false, reason: "source_reference not grounded in section text" };
    }
  }

  return {
    ok: true,
    value: {
      question,
      question_type,
      options,
      correct_answer,
      acceptable_answers,
      items,
      correct_order,
      explanation,
      working,
      difficulty,
      skill: str(raw.skill) || null,
      topic: str(raw.topic) || null,
      cognitive_level: str(raw.cognitive_level) || null,
      command_word: str(raw.command_word) || null,
      caps_topic: str(raw.caps_topic) || null,
      caps_subtopic: str(raw.caps_subtopic) || null,
      learning_outcome: str(raw.learning_outcome) || null,
      assessment_skill: str(raw.assessment_skill) || null,
      source_reference,
    },
  };
}

// ---------------------------------------------------------------- misc

export function subjectKindFor(
  doc: { subject_type?: string | null; doc_type?: string | null; tags?: unknown },
  subject?: string | null,
): GenContext["subjectKind"] {
  const s = (subject ?? "").toLowerCase();
  if (/mathemat|physical science|physics|chemistry/.test(s)) return "stem";
  if (doc.subject_type === "novel" || doc.doc_type === "novel") return "literature";
  if (!subject && doc.subject_type === "other") return "literature";
  return "curriculum";
}

export function creditCostFor(count: number, costs: Record<string, number>): number {
  const exact = costs[String(count)];
  if (typeof exact === "number") return exact;
  // Fall back to the configured per-question rate of the nearest smaller tier.
  const tiers = Object.keys(costs).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  const base = tiers.filter((t) => t <= count).pop() ?? tiers[0] ?? 5;
  const rate = (costs[String(base)] ?? 1) / base;
  return Math.max(1, Math.ceil(count * rate));
}
