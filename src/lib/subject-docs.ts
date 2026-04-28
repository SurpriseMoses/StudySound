// Maps our UI subject ids (english, history, life-sciences, ...) to the
// document.subject_type enum (novel/history/science/other) and a tag "kind".
// Returns true if a document belongs under the given subject id.

export type DocLite = {
  id: string;
  title: string;
  subject_type: string;
  tags: any;
  doc_type?: string | null;
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

// Subject id → predicate
export function docMatchesSubject(doc: DocLite, subjectId: string): boolean {
  const st = (doc.subject_type || "").toLowerCase();
  const kinds = tagKinds(doc.tags);
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
      return kinds.includes("accounting") || kinds.includes("business");
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
  if (kinds.includes("novel") || (doc.subject_type || "").toLowerCase() === "novel") return "Novels";
  return "Other";
}

export const CATEGORY_ORDER: Category[] = ["Novels", "Drama", "Poetry", "Short Stories", "Textbooks", "Other"];
