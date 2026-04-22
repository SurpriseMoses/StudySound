// seed-curriculum: admin-only one-shot that downloads CAPS-friendly
// public-domain books from Project Gutenberg, cleans them, and inserts them
// into `documents` with `is_seeded=true`, `seed_audio=true`,
// `seed_audio_status='pending'`. The companion `seed-audio-assets` function
// then generates and caches the narration globally.
//
// Idempotent: dedupes via `content_hash`. Re-running just upgrades existing
// rows (re-cleans, sets seed flags, refreshes raw_text).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { cleanRawText, type DocKind } from "../_shared/clean-text.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type SeedItem = {
  title: string;
  author: string;
  url: string;
  grade_level: string;
  subject_type: "novel" | "history" | "science" | "other";
  kind: DocKind;
};

// 9 public-domain books, all from Project Gutenberg.
const SEED_LIST: SeedItem[] = [
  // ---------- Shakespeare ----------
  { title: "Macbeth", author: "William Shakespeare", grade_level: "Grade 12",
    subject_type: "novel", kind: "play",
    url: "https://www.gutenberg.org/cache/epub/1533/pg1533.txt" },
  { title: "Romeo and Juliet", author: "William Shakespeare", grade_level: "Grade 10",
    subject_type: "novel", kind: "play",
    url: "https://www.gutenberg.org/cache/epub/1513/pg1513.txt" },
  { title: "Othello", author: "William Shakespeare", grade_level: "Grade 12",
    subject_type: "novel", kind: "play",
    url: "https://www.gutenberg.org/cache/epub/1531/pg1531.txt" },

  // ---------- Dickens ----------
  { title: "A Tale of Two Cities", author: "Charles Dickens", grade_level: "Grade 11",
    subject_type: "novel", kind: "novel",
    url: "https://www.gutenberg.org/cache/epub/98/pg98.txt" },
  { title: "Great Expectations", author: "Charles Dickens", grade_level: "Grade 11",
    subject_type: "novel", kind: "novel",
    url: "https://www.gutenberg.org/cache/epub/1400/pg1400.txt" },

  // ---------- Stevenson ----------
  { title: "The Strange Case of Dr Jekyll and Mr Hyde", author: "Robert Louis Stevenson",
    grade_level: "Grade 10", subject_type: "novel", kind: "novel",
    url: "https://www.gutenberg.org/cache/epub/43/pg43.txt" },
  { title: "Treasure Island", author: "Robert Louis Stevenson",
    grade_level: "Grade 9", subject_type: "novel", kind: "novel",
    url: "https://www.gutenberg.org/cache/epub/120/pg120.txt" },

  // ---------- Shelley ----------
  { title: "Frankenstein", author: "Mary Shelley", grade_level: "Grade 12",
    subject_type: "novel", kind: "novel",
    url: "https://www.gutenberg.org/cache/epub/84/pg84.txt" },

  // ---------- Conan Doyle ----------
  { title: "The Adventures of Sherlock Holmes", author: "Arthur Conan Doyle",
    grade_level: "Grade 10", subject_type: "novel", kind: "novel",
    url: "https://www.gutenberg.org/cache/epub/1661/pg1661.txt" },
];

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
    const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY")!;

    // Admin-only. Verify caller is a logged-in admin.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin
      .from("user_roles").select("id")
      .eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Array<{
      title: string; status: string; chars?: number;
      cleaned_chars?: number; error?: string; document_id?: string;
    }> = [];

    for (const item of SEED_LIST) {
      try {
        const resp = await fetch(item.url, {
          headers: { "User-Agent": "StudySoundSeeder/1.0" },
        });
        if (!resp.ok) {
          results.push({ title: item.title, status: "fetch_failed",
            error: `HTTP ${resp.status}` });
          continue;
        }
        const raw = await resp.text();
        const cleaned = cleanRawText(raw, item.kind);
        if (cleaned.charCount < 1000) {
          results.push({ title: item.title, status: "too_short",
            chars: raw.length, cleaned_chars: cleaned.charCount });
          continue;
        }

        const hash = await sha256Hex(cleaned.text);

        // Dedupe by content hash
        const { data: existing } = await admin
          .from("documents")
          .select("id, is_seeded, seed_audio")
          .eq("content_hash", hash)
          .maybeSingle();

        const baseFields = {
          raw_text: raw,
          clean_text: cleaned.text,
          char_count: cleaned.charCount,
          subject_type: item.subject_type,
          language: "en",
          grade_level: item.grade_level,
          is_seeded: true,
          seed_audio: true,
          source_url: item.url,
          title: item.title,
          tags: [{ author: item.author, kind: item.kind }],
        };

        if (existing) {
          await admin.from("documents").update({
            ...baseFields,
            // Don't reset audio progress if it's already further along.
          }).eq("id", existing.id);
          results.push({ title: item.title, status: "updated",
            document_id: existing.id, cleaned_chars: cleaned.charCount });
          continue;
        }

        const { data: inserted, error: insErr } = await admin
          .from("documents")
          .insert({
            ...baseFields,
            content_hash: hash,
            seed_audio_status: "pending",
            seed_audio_progress: -1,
          })
          .select("id")
          .single();
        if (insErr) {
          results.push({ title: item.title, status: "insert_failed",
            error: insErr.message });
          continue;
        }
        results.push({ title: item.title, status: "seeded",
          document_id: inserted.id, cleaned_chars: cleaned.charCount });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ title: item.title, status: "error", error: msg });
      }
    }

    const counts = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    return new Response(JSON.stringify({
      success: true,
      total: SEED_LIST.length,
      counts,
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
