// Poll all outstanding Gemini Batch jobs for ingestion. On success, write
// clean_text + tag hints back to each ingestion_job and advance state to
// 'chunking' so the standard ingestion-worker can finish embed→publish.
//
// Cron: pg_cron pings this every minute. Also callable manually.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { pollBatch, extractText } from "../_shared/gemini-batch.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const GEMINI_KEY = Deno.env.get("Gemini_Secret_Key")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // No auth required — same pattern as other cron workers (verify_jwt=false by default).
    const { data: batches } = await admin.from("ingestion_batch_jobs")
      .select("*").in("state", ["submitted", "polling"]).limit(10);

    const results: any[] = [];
    for (const b of batches ?? []) {
      try {
        const status = await pollBatch(b.gemini_batch_name, GEMINI_KEY);
        if (status.state === "JOB_STATE_SUCCEEDED") {
          if (b.stage === "reclean") {
            await handleRecleanSuccess(b, status.inlinedResponses ?? []);
          } else {
            await handleSuccess(b, status.inlinedResponses ?? []);
          }
          results.push({ id: b.id, state: "succeeded", stage: b.stage, items: status.inlinedResponses?.length ?? 0 });
        } else if (status.state === "JOB_STATE_FAILED" || status.state === "JOB_STATE_CANCELLED" || status.state === "JOB_STATE_EXPIRED") {
          await admin.from("ingestion_batch_jobs").update({
            state: "failed", finished_at: new Date().toISOString(),
            last_error: status.error?.message ?? status.state,
          }).eq("id", b.id);
          // Send all items to review
          await admin.from("ingestion_batch_items").update({ status: "review_required", error: status.error?.message ?? status.state })
            .eq("batch_job_id", b.id);
          results.push({ id: b.id, state: "failed" });
        } else {
          if (b.state !== "polling") {
            await admin.from("ingestion_batch_jobs").update({ state: "polling" }).eq("id", b.id);
          }
          results.push({ id: b.id, state: status.state });
        }
      } catch (e: any) {
        results.push({ id: b.id, error: String(e?.message ?? e) });
      }
    }
    return j({ polled: results.length, results });
  } catch (e: any) {
    return j({ error: String(e?.message ?? e) }, 500);
  }
});

async function handleSuccess(batch: any, inlined: any[]) {
  const { data: items } = await admin.from("ingestion_batch_items")
    .select("*").eq("batch_job_id", batch.id).order("position");

  let ok = 0, failed = 0, review = 0, totalChars = 0;

  for (const item of items ?? []) {
    const res = inlined[item.position];
    if (!res) {
      await markItem(item.id, item.ingestion_job_id, "failed", "no result at position");
      failed++; continue;
    }
    if (res.error) {
      await markItem(item.id, item.ingestion_job_id, "failed", res.error.message ?? "unknown");
      failed++; continue;
    }
    try {
      const raw = extractText(res.response);
      const parsed = extractJson(raw);
      if (!parsed || !parsed.clean_text || String(parsed.clean_text).length < 300) {
        await markItem(item.id, item.ingestion_job_id, "review_required", "empty or too-short clean_text");
        review++; continue;
      }
      const cleanText = String(parsed.clean_text);
      totalChars += cleanText.length;

      const updates: Record<string, unknown> = {
        input_raw_text: cleanText.slice(0, 4_000_000),
        state: "chunking",
        batch_stage: null,
      };
      if (parsed.grade) updates.grade = String(parsed.grade);
      if (parsed.subject) updates.subject = String(parsed.subject);
      await admin.from("ingestion_jobs").update(updates).eq("id", item.ingestion_job_id);
      await admin.from("ingestion_stage_logs").insert({
        job_id: item.ingestion_job_id, stage: "cleaning", status: "ok",
        message: `batch cleaned to ${cleanText.length} chars`,
      });
      await markItem(item.id, item.ingestion_job_id, "ok", null);
      ok++;

      // Kick worker to run chunking→embed→publish
      fetch(`${SUPABASE_URL}/functions/v1/ingestion-worker`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: ANON },
        body: JSON.stringify({ job_id: item.ingestion_job_id }),
      }).catch(() => {});
    } catch (e: any) {
      await markItem(item.id, item.ingestion_job_id, "failed", String(e?.message ?? e));
      failed++;
    }
  }

  await admin.from("ingestion_batch_jobs").update({
    state: "succeeded",
    finished_at: new Date().toISOString(),
    report: { ok, failed, review_required: review, total_chars: totalChars, items_processed: (items ?? []).length },
  }).eq("id", batch.id);
}

// Re-clean flow: batch was submitted from batch-reclean-submit. Each item
// maps to a shadow ingestion_job whose document_id points at an EXISTING
// published document. On success we overwrite that document's clean_text,
// bump cleaning_version (triggers cleanup elsewhere), purge stale chunks
// and cached assets, then kick backfill-pipeline to re-chunk + re-embed.
async function handleRecleanSuccess(batch: any, inlined: any[]) {
  const { data: items } = await admin.from("ingestion_batch_items")
    .select("*").eq("batch_job_id", batch.id).order("position");

  let ok = 0, failed = 0, review = 0, totalChars = 0;

  for (const item of items ?? []) {
    const { data: shadow } = await admin.from("ingestion_jobs")
      .select("id,document_id").eq("id", item.ingestion_job_id).maybeSingle();
    const docId = shadow?.document_id;
    const res = inlined[item.position];
    if (!res || res.error || !docId) {
      await markItem(item.id, item.ingestion_job_id, "failed", res?.error?.message ?? "no result / no document");
      failed++; continue;
    }
    try {
      const raw = extractText(res.response);
      const parsed = extractJson(raw);
      const cleanText = parsed?.clean_text ? String(parsed.clean_text) : "";
      if (cleanText.length < 500) {
        await markItem(item.id, item.ingestion_job_id, "review_required", "empty or too-short clean_text");
        review++; continue;
      }

      // Load current doc to bump cleaning_version + refresh char_count.
      const { data: doc } = await admin.from("documents")
        .select("cleaning_version").eq("id", docId).maybeSingle();

      await admin.from("documents").update({
        clean_text: cleanText,
        char_count: cleanText.length,
        cleaning_version: (doc?.cleaning_version ?? 1) + 1,
        embeddings_status: "pending",
        updated_at: new Date().toISOString(),
      }).eq("id", docId);

      // Purge stale caches so users don't see mixed old/new content.
      await admin.from("document_chunks").delete().eq("document_id", docId);
      await admin.from("audio_assets").delete().eq("document_id", docId);
      await admin.from("translation_assets").delete().eq("document_id", docId);

      totalChars += cleanText.length;

      await admin.from("ingestion_jobs").update({
        state: "completed",
        batch_stage: null,
        finished_at: new Date().toISOString(),
      }).eq("id", item.ingestion_job_id);

      await admin.from("ingestion_stage_logs").insert({
        job_id: item.ingestion_job_id, stage: "cleaning", status: "ok",
        message: `reclean -> ${cleanText.length} chars, chunks/audio/translations purged`,
      });

      await admin.from("ingestion_batch_items").update({ status: "ok", error: null }).eq("id", item.id);

      // Kick backfill to re-chunk + re-embed. Skip PDF path — we have text.
      fetch(`${SUPABASE_URL}/functions/v1/backfill-pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: ANON },
        body: JSON.stringify({ document_id: docId, reclean: false, skip_pdf: true, max_embed_batches: 6 }),
      }).catch(() => {});
      ok++;
    } catch (e: any) {
      await markItem(item.id, item.ingestion_job_id, "failed", String(e?.message ?? e));
      failed++;
    }
  }

  await admin.from("ingestion_batch_jobs").update({
    state: "succeeded",
    finished_at: new Date().toISOString(),
    report: { ok, failed, review_required: review, total_chars: totalChars, items_processed: (items ?? []).length, stage: "reclean" },
  }).eq("id", batch.id);
}

async function markItem(itemId: string, jobId: string, status: string, error: string | null) {
  await admin.from("ingestion_batch_items").update({ status, error }).eq("id", itemId);
  if (status !== "ok") {
    await admin.from("ingestion_jobs").update({ state: "failed", last_error: `batch:${status}: ${error ?? ""}` }).eq("id", jobId);
    await admin.from("ingestion_stage_logs").insert({
      job_id: jobId, stage: "cleaning", status: "failed", message: `batch item ${status}: ${error ?? ""}`,
    });
  }
}

function extractJson(text: string): any {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
