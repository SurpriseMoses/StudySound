// generate-visual-prompts — Gemini Batch API + "Visual Bible" character consistency.
//
// Strategy for character consistency across 10-12 images per book:
//   Step 1: Ask Gemini for a structured JSON object
//           { character_bible: [{ name, physical_description, attire, distinguishing_marks }],
//             scenes:         [{ chapter_reference, scene_description,
//                                 action_text, characters_present: [name, ...] }] }
//   Step 2: Server-side, build each scene's final leonardo_prompt as:
//           "<action_text>. CHARACTERS: <Name1 — full bible desc>; <Name2 — full bible desc>. <STYLE>"
//   → Character descriptions are BYTE-IDENTICAL across scenes ⇒ the downstream
//     image model gets the same reference text every time, locking visual identity.
//
// Endpoints:
//   POST /generate-visual-prompts                          → submit batch for all qualifying docs
//   POST /generate-visual-prompts?document_id=<uuid>       → submit/poll a single doc
//   POST /generate-visual-prompts?poll=true                → only drain in-flight (cron)
//   POST /generate-visual-prompts?force=true               → resubmit even if prompts exist
//   Body (optional JSON): { style?: string }
//
// In-flight batches tracked in visual_prompts_batch_jobs (one row per doc).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import {
  submitBatch,
  pollBatch,
  extractText,
  type BatchRequestItem,
} from "../_shared/gemini-batch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "gemini-2.5-flash";
const MAX_DOCS_PER_BATCH = 10;

const SYSTEM_PROMPT = `You are an expert AI art director generating descriptive image prompts for Leonardo.ai based on classic literature.

I will provide you with a book blueprint and a target visual style.

You must output a single valid JSON object with this EXACT shape, and nothing else:

{
  "character_bible": [
    {
      "name": "string — the name as it should appear in every scene prompt",
      "physical_description": "string — age, build, face, hair, eyes, skin tone, race/ethnicity (concrete, visual, 1-2 sentences)",
      "attire": "string — typical clothing, fabrics, accessories (period-accurate, concrete)",
      "distinguishing_marks": "string — scars, posture, gait, eyepatch, peg leg, etc. (or empty string if none)"
    }
  ],
  "scenes": [
    {
      "chapter_reference": "string — chapter number or scene marker",
      "scene_description": "string — short summary for admin context (one sentence)",
      "action_text": "string — what is happening in this image, INCLUDING setting, weather, time of day, lighting (e.g. 'moody candlelit shadows', 'vivid dynamic morning light'). Refer to characters ONLY by the names listed in character_bible (do NOT redescribe their appearance here).",
      "characters_present": ["string — names that appear in this image, exactly as in character_bible"]
    }
  ]
}

Rules:
- 10 to 12 scenes, chronologically ordered through the book.
- Every name in any scene's characters_present MUST exist in character_bible. Do not invent names.
- Include EVERY major recurring character in character_bible (minimum 4, maximum 12).
- Physical descriptions in character_bible must be concrete and visual — no vague words like "handsome" or "mysterious".
- Do NOT use buzzwords like "photorealistic", "ultra-detailed", "8k", "trending on artstation".
- action_text is the per-scene moment only; do NOT repeat character descriptions there.
- Output ONLY the JSON object, no markdown fences, no commentary.`;

const DEFAULT_STYLE =
  "painterly digital illustration, warm cinematic color palette, soft brushwork, classic storybook composition, period-accurate costuming and architecture";

interface CharacterBibleEntry {
  name: string;
  physical_description: string;
  attire: string;
  distinguishing_marks?: string;
}
interface SceneEntry {
  chapter_reference: string;
  scene_description: string;
  action_text: string;
  characters_present?: string[];
}

interface OutputPrompt {
  chapter_reference: string;
  scene_description: string;
  leonardo_prompt: string;
}

function buildLeonardoPrompt(
  scene: SceneEntry,
  bible: CharacterBibleEntry[],
  style: string,
): string {
  const bibleByName = new Map(bible.map((c) => [c.name.trim().toLowerCase(), c]));
  const names = (scene.characters_present ?? []).filter((n) => typeof n === "string" && n.trim());
  const characterClauses: string[] = [];
  for (const name of names) {
    const entry = bibleByName.get(name.trim().toLowerCase());
    if (!entry) continue;
    const parts = [
      entry.physical_description?.trim(),
      entry.attire?.trim(),
      entry.distinguishing_marks?.trim(),
    ].filter((s): s is string => Boolean(s));
    characterClauses.push(`${entry.name} — ${parts.join("; ")}`);
  }

  const characterBlock = characterClauses.length > 0
    ? ` CHARACTERS IN SCENE: ${characterClauses.join(". ")}.`
    : "";
  return `${scene.action_text.trim()}.${characterBlock} STYLE: ${style}`.replace(/\s+/g, " ").trim();
}

function buildRequest(title: string, blueprint: string, style: string): BatchRequestItem {
  const user = `BOOK TITLE: ${title}\n\nTARGET VISUAL STYLE (use as STYLE keywords):\n${style}\n\nBLUEPRINT:\n${blueprint}`;
  return {
    request: {
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
    },
  };
}

function parseAndBuild(rawText: string, style: string): { prompts: OutputPrompt[]; bible: CharacterBibleEntry[] } {
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  const bible: CharacterBibleEntry[] = Array.isArray(parsed?.character_bible) ? parsed.character_bible : [];
  const scenes: SceneEntry[] = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  if (bible.length === 0) throw new Error("Empty character_bible");
  if (scenes.length < 10) throw new Error(`Only ${scenes.length} scenes (need 10-12)`);
  const prompts = scenes.slice(0, 12).map((scene) => ({
    chapter_reference: String(scene.chapter_reference ?? ""),
    scene_description: String(scene.scene_description ?? ""),
    leonardo_prompt: buildLeonardoPrompt(scene, bible, style),
  }));
  return { prompts, bible };
}

// deno-lint-ignore no-explicit-any
async function pollAllRunning(admin: any, apiKey: string, style: string) {
  const { data: jobs, error } = await admin
    .from("visual_prompts_batch_jobs")
    .select("document_id, batch_job_name")
    .eq("status", "running");
  if (error) throw error;

  // Group jobs by batch_job_name; one batch may cover multiple docs.
  const byJob = new Map<string, string[]>();
  for (const j of jobs ?? []) {
    const arr = byJob.get(j.batch_job_name) ?? [];
    arr.push(j.document_id);
    byJob.set(j.batch_job_name, arr);
  }

  const results: Array<Record<string, unknown>> = [];

  for (const [jobName, docIds] of byJob) {
    try {
      const status = await pollBatch(jobName, apiKey);
      if (status.state === "JOB_STATE_SUCCEEDED" && status.inlinedResponses) {
        // Re-read jobs for this batch in the order they were inserted (id asc)
        // — matches the order requests were appended at submit time.
        const { data: ordered } = await admin
          .from("visual_prompts_batch_jobs")
          .select("document_id")
          .eq("batch_job_name", jobName)
          .order("submitted_at", { ascending: true })
          .order("document_id", { ascending: true });
        const orderedDocs = (ordered ?? []).map((r: any) => r.document_id);
        let ok = 0, fail = 0;
        for (let i = 0; i < orderedDocs.length; i++) {
          const docId = orderedDocs[i];
          const item = status.inlinedResponses[i];
          if (!item || item.error) {
            await admin.from("visual_prompts_batch_jobs").update({
              status: "failed",
              last_error: item?.error?.message ?? "missing response slot",
              updated_at: new Date().toISOString(),
            }).eq("document_id", docId);
            fail++;
            continue;
          }
          try {
            const text = extractText(item.response);
            const { prompts, bible } = parseAndBuild(text, style);
            await admin.from("translation_blueprints").update({
              visual_prompts: prompts,
              updated_at: new Date().toISOString(),
            }).eq("document_id", docId);
            await admin.from("visual_prompts_batch_jobs").update({
              status: "done",
              last_error: null,
              updated_at: new Date().toISOString(),
            }).eq("document_id", docId);
            console.log(`[visual-prompts] ✓ doc=${docId} bible=${bible.length} prompts=${prompts.length}`);
            ok++;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await admin.from("visual_prompts_batch_jobs").update({
              status: "failed",
              last_error: msg,
              updated_at: new Date().toISOString(),
            }).eq("document_id", docId);
            fail++;
          }
        }
        results.push({ job: jobName, state: status.state, ok, fail });
      } else if (status.state === "JOB_STATE_FAILED" || status.state === "JOB_STATE_CANCELLED" || status.state === "JOB_STATE_EXPIRED") {
        await admin.from("visual_prompts_batch_jobs").update({
          status: "failed",
          last_error: status.error?.message ?? status.state,
          updated_at: new Date().toISOString(),
        }).in("document_id", docIds);
        results.push({ job: jobName, state: status.state });
      } else {
        results.push({ job: jobName, state: status.state, docs: docIds.length });
      }
    } catch (e) {
      results.push({ job: jobName, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
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
    const pollOnly = url.searchParams.get("poll") === "true";
    const limit = Math.max(1, Math.min(MAX_DOCS_PER_BATCH, Number(url.searchParams.get("limit") ?? String(MAX_DOCS_PER_BATCH))));
    const singleDocId = url.searchParams.get("document_id");

    let style = DEFAULT_STYLE;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body?.style && typeof body.style === "string") style = body.style.trim();
      } catch { /* no body */ }
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) Drain any in-flight batches first.
    const polled = await pollAllRunning(admin, GEMINI_KEY, style);

    if (pollOnly) {
      return new Response(JSON.stringify({ ok: true, polled }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Gather candidates needing visual prompts.
    let bpQuery = admin
      .from("translation_blueprints")
      .select("document_id, blueprint_text, visual_prompts");
    if (singleDocId) bpQuery = bpQuery.eq("document_id", singleDocId);
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

    // In-flight jobs to avoid double-submit.
    const { data: running } = await admin
      .from("visual_prompts_batch_jobs")
      .select("document_id")
      .eq("status", "running");
    const runningSet = new Set((running ?? []).map((r: any) => r.document_id));

    const toSubmit: Array<{ id: string; title: string; blueprint: string }> = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const row of bps ?? []) {
      if (toSubmit.length >= limit) break;
      const doc = docMap.get(row.document_id);
      if (!doc) continue;
      if (!singleDocId && !doc.seed_translation) continue;
      if (runningSet.has(row.document_id)) { skipped.push({ id: row.document_id, reason: "batch running" }); continue; }
      if (!force && Array.isArray(row.visual_prompts) && row.visual_prompts.length > 0) {
        skipped.push({ id: row.document_id, reason: "prompts exist" });
        continue;
      }
      if (!row.blueprint_text || row.blueprint_text.length < 500) {
        skipped.push({ id: row.document_id, reason: "no blueprint" });
        continue;
      }
      toSubmit.push({ id: row.document_id, title: doc.title, blueprint: row.blueprint_text });
    }

    if (toSubmit.length === 0) {
      return new Response(JSON.stringify({ ok: true, polled, submitted: 0, skipped, style }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pre-insert tracking rows in submit order so polling order matches.
    const submittedAt = new Date().toISOString();
    const placeholders = toSubmit.map((d) => ({
      document_id: d.id,
      batch_job_name: "(pending)",
      submitted_at: submittedAt,
      status: "pending",
      last_error: null as string | null,
      updated_at: submittedAt,
    }));
    const { error: upErr } = await admin
      .from("visual_prompts_batch_jobs")
      .upsert(placeholders, { onConflict: "document_id" });
    if (upErr) throw upErr;

    const requests = toSubmit.map((d) => buildRequest(d.title, d.blueprint, style));
    const { name: jobName } = await submitBatch(MODEL, requests, GEMINI_KEY, `visual-prompts-${Date.now()}`);

    await admin
      .from("visual_prompts_batch_jobs")
      .update({
        batch_job_name: jobName,
        status: "running",
        updated_at: new Date().toISOString(),
      })
      .in("document_id", toSubmit.map((d) => d.id));

    console.log(`[visual-prompts] submitted batch ${jobName} for ${toSubmit.length} docs`);

    return new Response(JSON.stringify({
      ok: true,
      polled,
      submitted: toSubmit.length,
      batch_job_name: jobName,
      style,
      docs: toSubmit.map((d) => ({ id: d.id, title: d.title })),
      skipped,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e?.message ?? e?.error_description ?? e?.hint ?? JSON.stringify(e);
    console.error("[visual-prompts] fatal:", msg, e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
