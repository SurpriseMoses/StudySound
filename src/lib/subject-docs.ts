// Maps our UI subject ids (english, history, life-sciences, ...) to the
// document.subject_type enum (novel/history/science/other) and a tag "kind".
// Returns true if a document belongs under the given subject id.

export type DocLite = {
  id: string;
  title: string;
  subject_type: string;
  tags: any;
  doc_type?: string | null;
  source_url?: string | null;
};


const tagKinds = (tags: any): string[] => {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t === "string") out.push(t.toLowerCase());
    else if (t && typeof t === "object" && typeof t.kind === "string") out.push(t.kind.toLowerCase());
  }
  return out;
};

// Free-text signals we can match a curriculum subject name against:
// doc_type ("Life Sciences"), tags.subject, and the title ("Mathematics Grade 10").
const subjectText = (doc: DocLite): string => {
  const parts: string[] = [doc.doc_type ?? "", doc.title ?? ""];
  const t = doc.tags;
  if (t && typeof t === "object" && !Array.isArray(t)) {
    for (const k of ["subject", "doc_type", "kind"]) {
      const v = (t as any)[k];
      if (typeof v === "string") parts.push(v);
    }
  }
  return parts.join(" | ").toLowerCase();
};

// Subject id → regexes that identify the curriculum subject in free text.
// Order matters where names overlap (Mathematical Literacy vs Mathematics).
const SUBJECT_PATTERNS: Record<string, RegExp[]> = {
  "english": [/\benglish\b/, /\bhome language\b/, /first additional language/],
  "history": [/\bhistory\b/],
  "geography": [/\bgeography\b/],
  "life-sciences": [/life sciences?/, /\bbiology\b/],
  "natural-sciences": [/natural sciences?/],
  "physical-sciences": [/physical sciences?/, /\bphysics\b/, /\bchemistry\b/],
  "mathematical-literacy": [/mathematical literacy/, /maths? literacy/],
  "mathematics": [/\bmathematics\b/, /\bmaths?\b/],
  "technology": [/\btechnology\b/],
  "accounting": [/\baccounting\b/],
  "business-studies": [/business studies/, /\bbusiness\b/],
  "economics": [/\beconomics\b/, /economic and management sciences/],
  "computer-science": [/computer science/, /information technology/, /\bcat\b/, /programming/],
  "afrikaans": [/\bafrikaans\b/],
  "isizulu": [/isizulu/, /\bzulu\b/],
  "french": [/\bfrench\b/],
  "art": [/visual arts?/, /\bart\b/],
  "music": [/\bmusic\b/],
};

function textSubjectId(doc: DocLite): string | null {
  const text = subjectText(doc);
  // Most specific first so "Mathematical Literacy" never lands on Mathematics.
  const order = [
    "mathematical-literacy", "life-sciences", "natural-sciences", "physical-sciences",
    "business-studies", "computer-science", "economics", "accounting", "technology",
    "geography", "history", "mathematics", "afrikaans", "isizulu", "french",
    "english", "art", "music",
  ];
  for (const id of order) {
    if ((SUBJECT_PATTERNS[id] ?? []).some(re => re.test(text))) return id;
  }
  return null;
}

// Subject id → predicate
export function docMatchesSubject(doc: DocLite, subjectId: string): boolean {
  const st = (doc.subject_type || "").toLowerCase();
  const kinds = tagKinds(doc.tags);

  // Curriculum textbooks & study guides: match on their subject name.
  const byText = textSubjectId(doc);
  if (byText) return byText === subjectId;

  switch (subjectId) {
    case "english":
      return st === "novel" || kinds.some(k => ["novel", "play", "drama", "poetry", "short-story", "shortstory"].includes(k));
    case "history":
      return st === "history" || kinds.includes("history");
    case "life-sciences":
      return st === "science" || kinds.includes("biology") || kinds.includes("life-sciences");
    case "physical-sciences":
      return kinds.includes("physics") || kinds.includes("chemistry") || kinds.includes("physical-sciences");
    case "geography":
      return kinds.includes("geography");
    case "mathematics":
      return kinds.includes("math") || kinds.includes("mathematics");
    case "accounting":
      return kinds.includes("accounting");
    case "business-studies":
      return kinds.includes("business") || kinds.includes("business-studies");
    case "economics":
      return kinds.includes("economics") || kinds.includes("ems");
    case "natural-sciences":
      return kinds.includes("natural-sciences");
    case "technology":
      return kinds.includes("technology");
    case "computer-science":
      return kinds.includes("computer-science") || kinds.includes("cs") || kinds.includes("programming");
    case "afrikaans":
      return kinds.includes("afrikaans");
    case "isizulu":
      return kinds.includes("isizulu") || kinds.includes("zulu");
    case "french":
      return kinds.includes("french");
    case "art":
      return kinds.includes("art");
    case "music":
      return kinds.includes("music");
    default:
      return st === "other";
  }
}


export type Category = "Novels" | "Drama" | "Poetry" | "Textbooks" | "Short Stories" | "Other";

export function categorizeDoc(doc: DocLite): Category {
  const kinds = tagKinds(doc.tags);
  if (kinds.includes("play") || kinds.includes("drama")) return "Drama";
  if (kinds.includes("poetry") || kinds.includes("poem")) return "Poetry";
  if (kinds.includes("short-story") || kinds.includes("shortstory")) return "Short Stories";
  if (kinds.includes("textbook") || kinds.includes("workbook")) return "Textbooks";
  // Curriculum books carry a grade + subject (e.g. "Mathematics Grade 10").
  const t = doc.tags;
  const hasGrade = !!(t && typeof t === "object" && !Array.isArray(t) && (t as any).grade);
  if (hasGrade || /\bgrade\s*\d{1,2}\b/i.test(doc.title || "") || doc.doc_type) return "Textbooks";
  if (kinds.includes("novel") || (doc.subject_type || "").toLowerCase() === "novel") return "Novels";
  return "Other";

}

export const CATEGORY_ORDER: Category[] = ["Novels", "Drama", "Poetry", "Short Stories", "Textbooks", "Other"];

// Study guides (DBE Mind the Gap / Self-Study / Revision Booklets) are the only downloadable docs.
const GUIDE_RE = /study[ _-]?guide|revision[ _-]?booklet|mind[ _-]?the[ _-]?gap|self[ _-]?study/i;

export function isStudyGuide(doc: DocLite): boolean {
  const kinds = tagKinds(doc.tags);
  if (kinds.some(k => GUIDE_RE.test(k))) return true;
  const t = doc.tags;
  if (t && typeof t === "object" && !Array.isArray(t)) {
    const flat = Object.values(t).filter(v => typeof v === "string").join(" ");
    if (GUIDE_RE.test(flat)) return true;
  }
  if (doc.source_url && GUIDE_RE.test(doc.source_url)) return true;
  if (doc.doc_type && GUIDE_RE.test(doc.doc_type)) return true;
  return GUIDE_RE.test(doc.title || "");
}

/** Direct PDF/download link for a study guide, when the source is a real file. */
export function studyGuideDownloadUrl(doc: DocLite): string | null {
  const url = doc.source_url;
  if (!url) return null;
  const bare = url.split("#")[0];
  if (/\.pdf($|\?)/i.test(bare) || /forcedownload=true/i.test(bare) || /LinkClick\.aspx/i.test(bare)) return bare;
  return null;
}

