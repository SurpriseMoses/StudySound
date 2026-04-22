// seed-curriculum: one-shot admin function that downloads CAPS-aligned
// public-domain texts (Shakespeare from Project Gutenberg) and CC-BY
// Siyavula textbooks, cleans + hashes them, and inserts into `documents`
// with is_seeded=true so the Library can badge them as "Official curriculum".
//
// Safe to re-run: dedupes via content_hash. Existing rows are skipped.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type SeedItem = {
  title: string;
  url: string;
  grade_level: string;
  subject_type: "novel" | "history" | "science" | "other";
  // For Project Gutenberg .txt files we strip the boilerplate header/footer.
  is_gutenberg?: boolean;
};

// CAPS-aligned setworks (Shakespeare from Project Gutenberg, public domain)
// + Siyavula CC-BY textbook chapter URLs (plain-text versions).
const SEED_LIST: SeedItem[] = [
  // ---------- Shakespeare (FET English HL/FAL setworks) ----------
  // NOTE: Macbeth intentionally excluded — the previously uploaded copy
  // had non-canonical front matter (didn't start at Act I Scene 1).
  // We will re-add it once a clean source text is selected.
  { title: "Hamlet", grade_level: "Grade 12", subject_type: "novel",
    url: "https://www.gutenberg.org/cache/epub/1524/pg1524.txt", is_gutenberg: true },
  { title: "Othello", grade_level: "Grade 12", subject_type: "novel",
    url: "https://www.gutenberg.org/cache/epub/1531/pg1531.txt", is_gutenberg: true },
  { title: "Romeo and Juliet", grade_level: "Grade 10", subject_type: "novel",
    url: "https://www.gutenberg.org/cache/epub/1513/pg1513.txt", is_gutenberg: true },
  { title: "Julius Caesar", grade_level: "Grade 11", subject_type: "novel",
    url: "https://www.gutenberg.org/cache/epub/1522/pg1522.txt", is_gutenberg: true },
  { title: "The Merchant of Venice", grade_level: "Grade 11", subject_type: "novel",
    url: "https://www.gutenberg.org/cache/epub/1515/pg1515.txt", is_gutenberg: true },

  // ---------- Optional public-domain prose often on SA reading lists ----------
  { title: "Heart of Darkness", grade_level: "Grade 12", subject_type: "novel",
    url: "https://www.gutenberg.org/cache/epub/219/pg219.txt", is_gutenberg: true },
  { title: "Pride and Prejudice", grade_level: "Grade 11", subject_type: "novel",
    url: "https://www.gutenberg.org/cache/epub/1342/pg1342.txt", is_gutenberg: true },
];

function stripGutenbergBoilerplate(raw: string): string {
  const startMarker = /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG[^*]*\*\*\*/i;
  const endMarker = /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG[^*]*\*\*\*/i;
  const startMatch = raw.match(startMarker);
  const endMatch = raw.match(endMarker);
  let text = raw;
  if (startMatch) text = text.slice(startMatch.index! + startMatch[0].length);
  if (endMatch) {
    const endIdx = text.match(endMarker)?.index;
    if (endIdx !== undefined) text = text.slice(0, endIdx);
  }
  return text;
}

function cleanText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .toLowerCase();
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY")!;

    // AuthN: only authenticated users can trigger seeding (treat as admin tool).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const results: Array<{ title: string; status: string; chars?: number; error?: string }> = [];

    for (const item of SEED_LIST) {
      try {
        const resp = await fetch(item.url, {
          headers: { "User-Agent": "StudySoundSeeder/1.0" },
        });
        if (!resp.ok) {
          results.push({ title: item.title, status: "fetch_failed", error: `HTTP ${resp.status}` });
          continue;
        }
        let raw = await resp.text();
        if (item.is_gutenberg) raw = stripGutenbergBoilerplate(raw);
        const cleaned = cleanText(raw);
        if (cleaned.length < 1000) {
          results.push({ title: item.title, status: "too_short", chars: cleaned.length });
          continue;
        }
        const hash = await sha256Hex(cleaned);

        // Dedupe
        const { data: existing } = await admin
          .from("documents")
          .select("id, is_seeded")
          .eq("content_hash", hash)
          .maybeSingle();

        if (existing) {
          // Upgrade existing row to seeded if it isn't already
          if (!existing.is_seeded) {
            await admin.from("documents").update({
              is_seeded: true,
              grade_level: item.grade_level,
              source_url: item.url,
              title: item.title,
            }).eq("id", existing.id);
          }
          results.push({ title: item.title, status: "already_exists", chars: cleaned.length });
          continue;
        }

        const { error: insErr } = await admin.from("documents").insert({
          content_hash: hash,
          title: item.title,
          clean_text: cleaned,
          subject_type: item.subject_type,
          language: "en",
          char_count: cleaned.length,
          grade_level: item.grade_level,
          is_seeded: true,
          source_url: item.url,
        });
        if (insErr) {
          results.push({ title: item.title, status: "insert_failed", error: insErr.message });
          continue;
        }
        results.push({ title: item.title, status: "seeded", chars: cleaned.length });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ title: item.title, status: "error", error: msg });
      }
    }

    const seeded = results.filter((r) => r.status === "seeded").length;
    const skipped = results.filter((r) => r.status === "already_exists").length;
    const failed = results.filter((r) => !["seeded", "already_exists"].includes(r.status)).length;

    return new Response(JSON.stringify({
      success: true,
      summary: { total: SEED_LIST.length, seeded, skipped, failed },
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("seed-curriculum error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
