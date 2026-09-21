// Submits a quiz seed job to the Gemini Batch API (admin only).
// Collects pending job items, builds one structured-JSON request per section,
// submits as a single batch and records the batch name on the job.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { submitBatch, type BatchRequestItem } from "../_shared/gemini-batch.ts";
import {
  buildSystemPrompt, buildUserPrompt, GEMINI_RESPONSE_SCHEMA, subjectKindFor,
  type GenContext, type QuizSettings, type SectionRow,
} from "../_shared/quiz-bank.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (p: unknown, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_ITEMS_PER_BATCH = 400;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const GEMINI_KEY = (Deno.env.get("Gemini_Secret_Key") ?? Deno.env.get("GEMINI_API_KEY"));

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRow } = await admin
      .from("user_roles").select("id").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden: admin only" }, 403);

    const { data: settingsRow } = await admin.from("quiz_settings").select("*").eq("id", 1).maybeSingle();
    const settings = settingsRow as unknown as QuizSettings;

    if (!GEMINI_KEY) {
      return json({
        ok: false,
        unavailable: true,
        error: "Quiz generation is currently unavailable because the AI generation service is not configured.",
      }, 200);
    }
    if (!settings?.generation_enabled) {
      return json({ ok: false, unavailable: true, error: "Quiz generation is switched off in Quiz Settings." }, 200);
    }

    const body = await req.json().catch(() => ({}));
    const jobId = body.job_id as string;
    if (!jobId) return json({ error: "job_id required" }, 400);

    const { data: job } = await admin.from("quiz_seed_jobs").select("*").eq("id", jobId).maybeSingle();
    if (!job) return json({ error: "Job not found" }, 404);
    if ((job as any).cancel_requested) return json({ ok: false, error: "Job was cancelled" }, 400);
    if ((job as any).paused) return json({ ok: false, error: "Job is paused" }, 400);
    if ((job as any).batch_name && ["queued", "processing"].includes((job as any).status)) {
      return json({ ok: true, already_submitted: true, batch_name: (job as any).batch_name });
    }

    const { data: items } = await admin
      .from("quiz_seed_job_items")
      .select("*")
      .eq("job_id", jobId)
      .eq("status", "pending")
      .order("batch_position", { ascending: true })
      .limit(MAX_ITEMS_PER_BATCH);

    const pending = (items ?? []) as any[];
    if (pending.length === 0) {
      await admin.from("quiz_seed_jobs").update({
        status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", jobId);
      return json({ ok: true, submitted: 0, message: "No pending sections left" });
    }

    // Load section text + document metadata for each pending item.
    const docIds = [...new Set(pending.map((i) => i.document_id))];
    const { data: docs } = await admin
      .from("documents").select("id, title, subject_type, doc_type, grade_level, tags").in("id", docIds);
    const docMap = new Map((docs ?? []).map((d: any) => [d.id, d]));

    const requests: BatchRequestItem[] = [];
    const submittedItems: { id: string; position: number }[] = [];

    for (const item of pending) {
      const { data: chunk } = await admin
        .from("document_chunks")
        .select("id, chunk_index, text, content_hash, char_count")
        .eq("document_id", item.document_id)
        .eq("chunk_index", item.chunk_index)
        .maybeSingle();
      if (!chunk) {
        await admin.from("quiz_seed_job_items").update({ status: "failed", error: "section not found" }).eq("id", item.id);
        continue;
      }
      const doc = docMap.get(item.document_id) as any;
      const subject = doc?.tags?.subject ?? null;
      const ctx: GenContext = {
        bookTitle: doc?.title ?? "Untitled",
        subjectKind: subjectKindFor(doc ?? {}, subject),
        subject,
        grade: doc?.grade_level ?? null,
        language: (job as any).language,
        questionsPerSection: item.requested_questions,
        difficultyMix: (job as any).difficulty_mix ?? {},
        skillMix: (job as any).skill_mix ?? {},
        questionTypes: (job as any).question_types ?? ["multiple_choice"],
        examAlignmentLevel: (job as any).exam_alignment_level ?? "low",
      };

      requests.push({
        request: {
          systemInstruction: { parts: [{ text: buildSystemPrompt(ctx) }] },
          contents: [{ role: "user", parts: [{ text: buildUserPrompt(chunk as unknown as SectionRow, ctx) }] }],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: "application/json",
            responseSchema: GEMINI_RESPONSE_SCHEMA,
          },
        },
      });
      submittedItems.push({ id: item.id, position: requests.length - 1 });
    }

    if (requests.length === 0) return json({ ok: false, error: "No usable sections in this job" }, 400);

    const model = (job as any).model ?? settings.model_pricing.model ?? "gemini-2.5-flash";

    let batchName: string;
    try {
      const res = await submitBatch(model, requests, GEMINI_KEY, `quizbank-${jobId.slice(0, 8)}-${Date.now()}`);
      batchName = res.name;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const quota = /429|RESOURCE_EXHAUSTED|prepayment credits are depleted|quota/i.test(msg);
      await admin.from("quiz_seed_jobs").update({
        status: quota ? "queued" : "failed",
        error_message: msg.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
      return json({
        ok: false,
        unavailable: quota,
        error: quota
          ? "Quiz generation is currently unavailable because the AI generation service has no available credit. Top up Gemini billing and submit again."
          : msg,
      }, 200);
    }

    // Record batch positions so results can be mapped back.
    for (const s of submittedItems) {
      await admin.from("quiz_seed_job_items")
        .update({ status: "submitted", batch_position: s.position, updated_at: new Date().toISOString() })
        .eq("id", s.id);
    }

    await admin.from("quiz_seed_jobs").update({
      status: "processing",
      batch_name: batchName,
      batch_submitted_at: new Date().toISOString(),
      batch_state: "JOB_STATE_QUEUED",
      started_at: (job as any).started_at ?? new Date().toISOString(),
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    return json({ ok: true, submitted: requests.length, batch_name: batchName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[quiz-seed-submit]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
