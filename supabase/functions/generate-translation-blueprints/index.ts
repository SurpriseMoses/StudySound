// generate-translation-blueprints — Gemini Batch API mode.
//
// Endpoints:
//   POST /generate-translation-blueprints                 → submit a new batch for seeded docs
//                                                           (skips docs that already have blueprints unless ?force=true)
//   POST /generate-translation-blueprints?document_id=…   → submit/poll a single document
//   POST /generate-translation-blueprints?poll=true       → only drain already-submitted batches (used by cron)
//   POST /generate-translation-blueprints?force=true      → regenerate even if blueprint exists
//
// State machine (translation_blueprints columns):
//   batch_status = NULL            → never batched (legacy or fresh row)
//   batch_status = 'running'       → batch_job_name set, awaiting Google
//   batch_status = 'done'          → blueprint_text populated
//   batch_status = 'failed'        → last error in last_error column? we re-use updated_at + log only
//
// Each row in this table is one document. Submit groups N documents into one
// batch. Polling matches inlinedResponses[i] against the order we stored.

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

const BLUEPRINT_MODEL = "gemini-2.5-flash";
const MAX_SOURCE_CHARS = 60_000;
const MAX_DOCS_PER_BATCH = 10;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const SYSTEM_PROMPT =
  `You are a literary analyst preparing a "Translation Blueprint" used to ground machine ` +
  `translation of this book into multiple South African languages. Produce ONE comprehensive ` +
  `blueprint in English. The output MUST be between 5,000 and 7,000 characters (no shorter). ` +
  `Use these EXACT section headings (Markdown):\n\n` +
  `## 1. Plot & Thematic Summary\n` +
  `Three full paragraphs (each ~150 words) covering plot arc, setting, period, register, and major themes.\n\n` +
  `## 2. Character Glossary\n` +
  `Bullet list of every named or recurring character. For each: ` +
  `**Name** — role, relationship to other characters, speaking style/register, ` +
  `and pronunciation/spelling notes. Include at least 12 entries (or all named characters if fewer).\n\n` +
  `## 3. Idiom & Archaic Phrase Guide\n` +
  `Bullet list of 25-40 entries. For each archaic/period idiom or formal expression: ` +
  `**"original phrase"** → plain modern English meaning (one short sentence).\n\n` +
  `Rules:\n` +
  `- Output ONLY the blueprint in Markdown. No preamble, no closing remarks.\n` +
  `- Be concrete and specific to THIS book.\n` +
  `- Treat the source text as literary scholarship; cover violence, romance, and adult themes neutrally.`;

function sampleSource(text: string): string {
  if (text.length <= MAX_SOURCE_CHARS) return text;
  const slice = Math.floor(MAX_SOURCE_CHARS / 3);
  const mid = Math.floor(text.length / 2) - Math.floor(slice / 2);
  return [
    text.slice(0, slice),
    "\n\n[...middle section...]\n\n",
    text.slice(mid, mid + slice),
    "\n\n[...later section...]\n\n",
    text.slice(text.length - slice),
  ].join("");
}

function buildRequest(title: string, sample: string): BatchRequestItem {
  return {
    request: {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: "user",
        parts: [{ text: `BOOK TITLE: ${title}\n\nSOURCE TEXT SAMPLE (truncated):\n\n${sample}` }],
      }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    },
  };
}

// deno-lint-ignore no-explicit-any
async function pollAllRunning(admin: any, apiKey: string) {
  const { data: rows, error } = await admin
    .from("translation_blueprints")
    .select("document_id, batch_job_name")
    .eq("batch_status", "running");
  if (error) throw error;

  // Group rows by batch_job_name
  const byJob = new Map<string, string[]>();
  for (const r of rows ?? []) {
    if (!r.batch_job_name) continue;
    const arr = byJob.get(r.batch_job_name) ?? [];
    arr.push(r.document_id);
    byJob.set(r.batch_job_name, arr);
  }

  const results: Array<Record<string, unknown>> = [];

  for (const [jobName, docIds] of byJob) {
    try {
      const status = await pollBatch(jobName, apiKey);
      if (status.state === "JOB_STATE_SUCCEEDED" && status.inlinedResponses) {
        // We submitted in deterministic doc-id order; persist the same order
        // when we created the batch. To recover order safely, re-read rows
        // sorted by their batch_submitted_at + document_id and then by id of
        // the rows in this job.
        const { data: ordered } = await admin
          .from("translation_blueprints")
          .select("document_id, id")
          .eq("batch_job_name", jobName)
          .order("id", { ascending: true });
        const orderedDocs = (ordered ?? []).map((r: any) => r.document_id);
        let successCount = 0;
        let failCount = 0;
        for (let i = 0; i < orderedDocs.length; i++) {
          const docId = orderedDocs[i];
          const item = status.inlinedResponses[i];
          if (!item || item.error) {
            await admin.from("translation_blueprints").update({
              batch_status: "failed",
              updated_at: new Date().toISOString(),
            }).eq("document_id", docId).eq("batch_job_name", jobName);
            failCount++;
            continue;
          }
          const text = extractText(item.response);
          if (!text || text.length < 2500) {
            await admin.from("translation_blueprints").update({
              batch_status: "failed",
              updated_at: new Date().toISOString(),
            }).eq("document_id", docId).eq("batch_job_name", jobName);
            failCount++;
            continue;
          }
          await admin.from("translation_blueprints").update({
            blueprint_text: text,
            token_estimate: estimateTokens(text),
            model: BLUEPRINT_MODEL,
            batch_status: "done",
            updated_at: new Date().toISOString(),
          }).eq("document_id", docId).eq("batch_job_name", jobName);
          // Blueprint changed → drop any cached Gemini context for this doc.
          await admin.from("gemini_context_caches").delete().eq("document_id", docId);
          successCount++;
        }
        results.push({ job: jobName, state: status.state, success: successCount, failed: failCount });
      } else if (status.state === "JOB_STATE_FAILED" || status.state === "JOB_STATE_CANCELLED" || status.state === "JOB_STATE_EXPIRED") {
        await admin.from("translation_blueprints").update({
          batch_status: "failed",
          updated_at: new Date().toISOString(),
        }).in("document_id", docIds).eq("batch_job_name", jobName);
        results.push({ job: jobName, state: status.state, error: status.error?.message ?? null });
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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) Always poll any in-flight batches first.
    const polled = await pollAllRunning(admin, GEMINI_KEY);

    if (pollOnly) {
      return new Response(JSON.stringify({ ok: true, polled }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Submit a fresh batch for docs that need blueprints.
    let docQuery = admin.from("documents").select("id, title, clean_text").not("clean_text", "is", null);
    if (singleDocId) {
      docQuery = docQuery.eq("id", singleDocId);
    } else {
      docQuery = docQuery.eq("seed_translation", true);
    }
    const { data: docs, error: docErr } = await docQuery;
    if (docErr) throw docErr;

    const { data: existingBp } = await admin
      .from("translation_blueprints")
      .select("document_id, blueprint_text, batch_status");
    const existingByDoc = new Map<string, { hasText: boolean; running: boolean }>();
    for (const r of existingBp ?? []) {
      existingByDoc.set(r.document_id, {
        hasText: Boolean(r.blueprint_text && r.blueprint_text.length > 0),
        running: r.batch_status === "running",
      });
    }

    const toSubmit: Array<{ id: string; title: string; sample: string }> = [];
    const skipped: Array<{ id: string; title: string; reason: string }> = [];
    for (const doc of docs ?? []) {
      if (toSubmit.length >= limit) break;
      const state = existingByDoc.get(doc.id);
      if (state?.running) { skipped.push({ id: doc.id, title: doc.title, reason: "batch running" }); continue; }
      if (!force && state?.hasText) { skipped.push({ id: doc.id, title: doc.title, reason: "blueprint exists" }); continue; }
      if (!doc.clean_text || doc.clean_text.length < 1000) {
        skipped.push({ id: doc.id, title: doc.title, reason: "no/short text" });
        continue;
      }
      toSubmit.push({ id: doc.id, title: doc.title, sample: sampleSource(doc.clean_text as string) });
    }

    if (toSubmit.length === 0) {
      return new Response(JSON.stringify({ ok: true, polled, submitted: 0, skipped }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pre-insert blueprint rows so the polling order is deterministic by id.
    const nowIso = new Date().toISOString();
    const placeholderRows = toSubmit.map((d) => ({
      document_id: d.id,
      blueprint_text: "(pending batch)",
      token_estimate: 0,
      model: BLUEPRINT_MODEL,
      batch_status: "pending",
      batch_submitted_at: nowIso,
      updated_at: nowIso,
    }));
    const { error: upsertErr } = await admin
      .from("translation_blueprints")
      .upsert(placeholderRows, { onConflict: "document_id" });
    if (upsertErr) throw upsertErr;

    const requests = toSubmit.map((d) => buildRequest(d.title, d.sample));
    const { name: jobName } = await submitBatch(BLUEPRINT_MODEL, requests, GEMINI_KEY, `blueprints-${Date.now()}`);

    await admin
      .from("translation_blueprints")
      .update({
        batch_job_name: jobName,
        batch_status: "running",
        batch_submitted_at: new Date().toISOString(),
      })
      .in("document_id", toSubmit.map((d) => d.id));

    console.log(`[blueprints] submitted batch ${jobName} for ${toSubmit.length} docs`);

    return new Response(JSON.stringify({
      ok: true,
      polled,
      submitted: toSubmit.length,
      batch_job_name: jobName,
      docs: toSubmit.map((d) => ({ id: d.id, title: d.title })),
      skipped,
    }, null, 2), {
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
