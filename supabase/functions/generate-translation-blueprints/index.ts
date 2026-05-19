// generate-translation-blueprints — one-time prep function that produces a
// ~1,500-token "Comprehensive Translation Blueprint" per seeded book.
//
// Blueprint contents:
//   1) 3-paragraph plot & thematic summary
//   2) Comprehensive character glossary (names, roles, relationships, register)
//   3) Victorian / Shakespearean idiom guide → modern descriptive English
//
// Stored in translation_blueprints (one row per document_id). Idempotent —
// skips documents that already have a blueprint unless ?force=true.
//
// POST  /generate-translation-blueprints           → process all seeded docs
// POST  /generate-translation-blueprints?force=true → re-generate even if exists
// POST  /generate-translation-blueprints?document_id=<uuid> → single doc

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BLUEPRINT_MODEL = "gemini-2.5-flash";
const MAX_SOURCE_CHARS = 60_000; // sample size sent to Gemini for analysis

function estimateTokens(text: string): number {
  // Rough 1 token ≈ 4 chars heuristic.
  return Math.ceil(text.length / 4);
}

async function generateBlueprint(title: string, sample: string, apiKey: string): Promise<string> {
  const system =
    `You are a literary analyst preparing a "Translation Blueprint" that will be ` +
    `used to ground machine translation of this book into multiple South African languages ` +
    `(isiZulu, isiXhosa, Sepedi, Setswana, Sesotho, Xitsonga, Tshivenda, siSwati, isiNdebele, Afrikaans). ` +
    `Produce ONE comprehensive blueprint in English (~1,500 tokens, ~6,000 chars). ` +
    `Use these EXACT section headings (Markdown):\n\n` +
    `## 1. Plot & Thematic Summary\n` +
    `Three full paragraphs covering plot arc, setting, period, register, and major themes. ` +
    `Be specific about tone (formal/royal, gothic, Victorian, satirical, etc.).\n\n` +
    `## 2. Character Glossary\n` +
    `Bullet list of every named character (or unnamed but recurring figure). For each: ` +
    `**Name** — role, relationship to other characters, speaking style/register, ` +
    `and any pronunciation/spelling notes a translator must preserve.\n\n` +
    `## 3. Idiom & Archaic Phrase Guide\n` +
    `Bullet list. For each archaic/period idiom or formal expression found in the source, ` +
    `give: **"original phrase"** → plain modern English meaning (one short sentence). ` +
    `Aim for 25-40 entries covering the most common confusing constructions in the book.\n\n` +
    `Rules:\n` +
    `- Output ONLY the blueprint in Markdown. No preamble, no closing remarks.\n` +
    `- Be concrete and specific to THIS book, not generic literary advice.\n` +
    `- Keep the whole document under 7,000 characters.`;

  const user = `BOOK TITLE: ${title}\n\nSOURCE TEXT SAMPLE (truncated):\n\n${sample}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${BLUEPRINT_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = await res.json();
  const out = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
  if (!out.trim()) throw new Error("Empty blueprint response from Gemini");
  return out.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GEMINI_KEY = Deno.env.get("Gemini_Secret_Key");
    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Gemini_Secret_Key not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";
    const singleDocId = url.searchParams.get("document_id");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Pick documents: seeded for translation, or a specific one.
    let docQuery = admin.from("documents").select("id, title, clean_text").not("clean_text", "is", null);
    if (singleDocId) {
      docQuery = docQuery.eq("id", singleDocId);
    } else {
      docQuery = docQuery.eq("seed_translation", true);
    }
    const { data: docs, error: docErr } = await docQuery;
    if (docErr) throw docErr;

    const { data: existingBp } = await admin.from("translation_blueprints").select("document_id");
    const existing = new Set((existingBp ?? []).map((r) => r.document_id));

    const results: Array<{ id: string; title: string; status: string; chars?: number; error?: string }> = [];
    for (const doc of docs ?? []) {
      if (!force && existing.has(doc.id)) {
        results.push({ id: doc.id, title: doc.title, status: "skipped (exists)" });
        continue;
      }
      if (!doc.clean_text || doc.clean_text.length < 1000) {
        results.push({ id: doc.id, title: doc.title, status: "skipped (no/short text)" });
        continue;
      }

      try {
        // Sample: take start, middle, end of the book so the model sees range.
        const text = doc.clean_text as string;
        let sample = text.slice(0, MAX_SOURCE_CHARS);
        if (text.length > MAX_SOURCE_CHARS) {
          const slice = Math.floor(MAX_SOURCE_CHARS / 3);
          const mid = Math.floor(text.length / 2) - Math.floor(slice / 2);
          sample = [
            text.slice(0, slice),
            "\n\n[...middle section...]\n\n",
            text.slice(mid, mid + slice),
            "\n\n[...later section...]\n\n",
            text.slice(text.length - slice),
          ].join("");
        }

        const blueprint = await generateBlueprint(doc.title, sample, GEMINI_KEY);
        const tokens = estimateTokens(blueprint);

        const { error: upErr } = await admin
          .from("translation_blueprints")
          .upsert({
            document_id: doc.id,
            blueprint_text: blueprint,
            token_estimate: tokens,
            model: BLUEPRINT_MODEL,
            updated_at: new Date().toISOString(),
          }, { onConflict: "document_id" });
        if (upErr) throw upErr;

        // Invalidate any existing Gemini caches for this doc — blueprint changed.
        await admin.from("gemini_context_caches").delete().eq("document_id", doc.id);

        results.push({ id: doc.id, title: doc.title, status: "generated", chars: blueprint.length });
        console.log(`[blueprints] ✓ ${doc.title} (${blueprint.length} chars, ~${tokens} tokens)`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ id: doc.id, title: doc.title, status: "error", error: msg });
        console.error(`[blueprints] ✗ ${doc.title}: ${msg}`);
      }
    }

    return new Response(JSON.stringify({ ok: true, count: results.length, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[blueprints] fatal:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
