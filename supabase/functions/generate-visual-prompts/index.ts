// generate-visual-prompts — produces a chronological list of 10-12 Leonardo.ai
// image prompts per seeded book, grounded on the existing translation_blueprints.
//
// POST /generate-visual-prompts?document_id=<uuid>           → single doc
// POST /generate-visual-prompts                              → all seeded docs (limit param)
// POST /generate-visual-prompts?force=true                   → regenerate existing
//
// Body (optional JSON): { style?: string }
//   style — designated Leonardo style keywords appended to every prompt.
//           Defaults to a painterly classic-literature illustration style.
//
// Stores results in translation_blueprints.visual_prompts (jsonb) — adds the
// column if missing via a separate migration. If the column does not exist,
// results are still returned in the HTTP response.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "gemini-2.5-pro";

const SYSTEM_PROMPT = `You are an expert AI art director generating descriptive image prompts for Leonardo.ai based on classic literature. 

I will provide you with a book blueprint and a target visual style. 

Your task is to break the book down into 10-12 chronological key narrative milestones. For each milestone, output a structured JSON array containing:

1. "chapter_reference": The chapter number or scene marker.

2. "scene_description": A short summary of what is happening for the admin's context.

3. "leonardo_prompt": A highly descriptive visual prompt written in English. 

Prompt Formatting Rules for Leonardo.ai:

- Start with the subject and core action (e.g., "An old pirate with a scarred face sits at a wooden table...").

- Describe the setting, weather, and background depth.

- Specify the lighting (e.g., "moody candlelit shadows", "vivid dynamic lighting").

- Append the designated style keywords at the very end.

- Crucial: Keep the main characters' physical descriptions completely identical across all scene prompts so the AI maintains character consistency.

- Do NOT use vague buzzwords like "photorealistic" or "ultra-detailed". Use descriptive text instead.

Output ONLY a clean, valid JSON array. No conversational text or markdown blocks.`;

const DEFAULT_STYLE =
  "painterly digital illustration, warm cinematic color palette, soft brushwork, classic storybook composition, period-accurate costuming and architecture";

interface VisualPrompt {
  chapter_reference: string;
  scene_description: string;
  leonardo_prompt: string;
}

async function generatePrompts(
  title: string,
  blueprint: string,
  style: string,
  apiKey: string,
): Promise<VisualPrompt[]> {
  const user = `BOOK TITLE: ${title}

TARGET VISUAL STYLE KEYWORDS (append to every prompt):
${style}

BLUEPRINT:
${blueprint}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  });

  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      const waitMs = Math.min(30_000, 2_000 * Math.pow(2, attempt - 1)) +
        Math.floor(Math.random() * 1500);
      console.log(`[visual-prompts] retry ${attempt} after ${waitMs}ms for "${title}"`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (res.status === 503 || res.status === 429) {
      lastErr = `Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`;
      continue;
    }
    if (!res.ok) {
      throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    const json = await res.json();
    const cand = json?.candidates?.[0];
    const out = cand?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
    if (!out.trim()) {
      throw new Error(
        `Empty response (finishReason=${cand?.finishReason ?? "unknown"})`,
      );
    }
    // Strip possible markdown fences just in case.
    const cleaned = out.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new Error(`Invalid JSON from Gemini: ${(e as Error).message}. Raw: ${cleaned.slice(0, 300)}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected JSON array, got: ${typeof parsed}`);
    }
    const prompts = (parsed as VisualPrompt[]).filter(
      (p) => p && typeof p.leonardo_prompt === "string" && p.leonardo_prompt.trim().length > 0,
    );
    if (prompts.length < 10) {
      throw new Error(`Only ${prompts.length} prompts returned, expected 10-12.`);
    }
    return prompts.slice(0, 12);
  }
  throw new Error(`Gemini unavailable after retries: ${lastErr}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const GEMINI_KEY = Deno.env.get("Gemini_Secret_Key");
    if (!GEMINI_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "Gemini_Secret_Key not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";
    const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit") ?? "2")));
    const singleDocId = url.searchParams.get("document_id");

    let style = DEFAULT_STYLE;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.style && typeof body.style === "string") style = body.style.trim();
      } catch { /* no body, use default */ }
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Pull blueprints, then fetch docs separately (no FK in schema cache).
    let bpQuery = admin
      .from("translation_blueprints")
      .select("document_id, blueprint_text, visual_prompts");
    if (singleDocId) {
      bpQuery = bpQuery.eq("document_id", singleDocId);
    }
    const { data: bps, error: bpErr } = await bpQuery;
    if (bpErr) throw bpErr;

    const docIds = (bps ?? []).map((r: any) => r.document_id);
    let docMap = new Map<string, { id: string; title: string; seed_translation: boolean }>();
    if (docIds.length > 0) {
      const { data: docs, error: docErr } = await admin
        .from("documents")
        .select("id, title, seed_translation")
        .in("id", docIds);
      if (docErr) throw docErr;
      docMap = new Map((docs ?? []).map((d: any) => [d.id, d]));
    }

    const candidates = (bps ?? [])
      .map((row: any) => ({ ...row, documents: docMap.get(row.document_id) }))
      .filter((row: any) => {
        if (!row.documents) return false;
        if (singleDocId) return true;
        return row.documents.seed_translation === true;
      });

    const results: Array<{
      document_id: string;
      title: string;
      status: string;
      count?: number;
      error?: string;
      prompts?: VisualPrompt[];
    }> = [];
    let generated = 0;

    for (const row of candidates as any[]) {
      const doc = row.documents;
      if (generated >= limit) {
        results.push({
          document_id: row.document_id,
          title: doc?.title ?? "(unknown)",
          status: "deferred (limit reached)",
        });
        continue;
      }
      if (!force && Array.isArray(row.visual_prompts) && row.visual_prompts.length > 0) {
        results.push({
          document_id: row.document_id,
          title: doc?.title ?? "(unknown)",
          status: "skipped (exists)",
          count: row.visual_prompts.length,
        });
        continue;
      }
      if (!row.blueprint_text || row.blueprint_text.length < 500) {
        results.push({
          document_id: row.document_id,
          title: doc?.title ?? "(unknown)",
          status: "skipped (no blueprint)",
        });
        continue;
      }

      try {
        const prompts = await generatePrompts(doc.title, row.blueprint_text, style, GEMINI_KEY);

        const { error: upErr } = await admin
          .from("translation_blueprints")
          .update({
            visual_prompts: prompts,
            updated_at: new Date().toISOString(),
          })
          .eq("document_id", row.document_id);
        if (upErr) {
          // Column may not exist yet — return prompts in response anyway.
          console.warn(`[visual-prompts] persist failed: ${upErr.message}`);
        }

        results.push({
          document_id: row.document_id,
          title: doc.title,
          status: "generated",
          count: prompts.length,
          prompts,
        });
        generated++;
        console.log(`[visual-prompts] ✓ ${doc.title} (${prompts.length} prompts)`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({
          document_id: row.document_id,
          title: doc?.title ?? "(unknown)",
          status: "error",
          error: msg,
        });
        console.error(`[visual-prompts] ✗ ${doc?.title}: ${msg}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, count: results.length, style, results }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    const msg = e?.message ?? e?.error_description ?? e?.hint ?? JSON.stringify(e);
    console.error("[visual-prompts] fatal:", msg, e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
