// Polls a submitted Gemini batch for a quiz seed job, validates and
// deduplicates the returned questions, and stores survivors as drafts
// for the admin review queue. Safe to call repeatedly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { pollBatch, extractText } from "../_shared/gemini-batch.ts";
import {
  NEAR_DUPLICATE_THRESHOLD, questionHash, questionOriginFor, similarity, subjectKindFor,
  validateQuestion, type QuizSettings,
} from "../_shared/quiz-bank.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (p: unknown, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const GEMINI_KEY = (Deno.env.get("Gemini_Secret_Key") ?? Deno.env.get("GEMINI_API_KEY"));
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const cronSecret = req.headers.get("x-cron-secret");
    const isCron = !!cronSecret && cronSecret === Deno.env.get("CRON_SECRET");

    if (!isCron) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: userData } = await userClient.auth.getUser();
      if (!userData?.user) return json({ error: "Unauthorized" }, 401);
      const { data: roleRow } = await admin
        .from("user_roles").select("id").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
      if (!roleRow) return json({ error: "Forbidden: admin only" }, 403);
    }

    if (!GEMINI_KEY) {
      return json({
        ok: false, unavailable: true,
        error: "Quiz generation is currently unavailable because the AI generation service is not configured.",
      });
    }

    const { data: settingsRow } = await admin.from("quiz_settings").select("*").eq("id", 1).maybeSingle();
    const settings = settingsRow as unknown as QuizSettings;

    // Which jobs to poll
    let jobsQuery = admin.from("quiz_seed_jobs").select("*").eq("status", "processing").not("batch_name", "is", null);
    if (body.job_id) jobsQuery = admin.from("quiz_seed_jobs").select("*").eq("id", body.job_id);
    const { data: jobs } = await jobsQuery.limit(5);

    const report: unknown[] = [];

    for (const job of (jobs ?? []) as any[]) {
      if (!job.batch_name) continue;
      if (job.cancel_requested || job.paused) {
        report.push({ job_id: job.id, skipped: job.cancel_requested ? "cancelled" : "paused" });
        continue;
      }

      let status;
      try {
        status = await pollBatch(job.batch_name, GEMINI_KEY);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await admin.from("quiz_seed_jobs").update({ error_message: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", job.id);
        report.push({ job_id: job.id, error: msg });
        continue;
      }

      await admin.from("quiz_seed_jobs").update({ batch_state: status.state, updated_at: new Date().toISOString() }).eq("id", job.id);

      if (["JOB_STATE_QUEUED", "JOB_STATE_PENDING", "JOB_STATE_RUNNING", "JOB_STATE_UNSPECIFIED"].includes(status.state)) {
        report.push({ job_id: job.id, state: status.state });
        continue;
      }

      if (status.state !== "JOB_STATE_SUCCEEDED") {
        await admin.from("quiz_seed_jobs").update({
          status: (job.generated_questions ?? 0) > 0 ? "partially_completed" : "failed",
          error_message: status.error?.message ?? `Batch ended as ${status.state}`,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        report.push({ job_id: job.id, state: status.state, failed: true });
        continue;
      }

      const responses = status.inlinedResponses ?? [];
      const { data: items } = await admin
        .from("quiz_seed_job_items").select("*").eq("job_id", job.id).eq("status", "submitted")
        .order("batch_position", { ascending: true });

      const docIds = [...new Set((items ?? []).map((i: any) => i.document_id))];
      const { data: docs } = await admin
        .from("documents").select("id, title, subject_type, doc_type, grade_level, tags, content_hash").in("id", docIds);
      const docMap = new Map((docs ?? []).map((d: any) => [d.id, d]));

      let generated = 0, duplicates = 0, invalid = 0, failedItems = 0;

      for (const item of (items ?? []) as any[]) {
        const entry = responses[item.batch_position];
        if (!entry) {
          await admin.from("quiz_seed_job_items").update({ status: "failed", error: "no batch response" }).eq("id", item.id);
          failedItems++;
          continue;
        }
        if ((entry as any).error) {
          await admin.from("quiz_seed_job_items")
            .update({ status: "failed", error: String((entry as any).error?.message ?? "batch item error").slice(0, 400) })
            .eq("id", item.id);
          failedItems++;
          continue;
        }

        const doc = docMap.get(item.document_id) as any;
        const subject = doc?.tags?.subject ?? null;
        const kind = subjectKindFor(doc ?? {}, subject);

        const { data: chunk } = await admin
          .from("document_chunks").select("id, text, content_hash")
          .eq("document_id", item.document_id).eq("chunk_index", item.chunk_index).maybeSingle();
        const sectionText = (chunk as any)?.text ?? "";

        // Existing questions for this section (dedupe scope).
        const { data: existing } = await admin
          .from("quiz_questions").select("question, question_hash")
          .eq("document_id", item.document_id).eq("chunk_index", item.chunk_index).eq("language", job.language);
        const existingHashes = new Set((existing ?? []).map((r: any) => r.question_hash));
        const existingTexts = (existing ?? []).map((r: any) => r.question as string);

        let parsed: any = null;
        try {
          parsed = JSON.parse(extractText((entry as any).response));
        } catch {
          await admin.from("quiz_seed_job_items").update({ status: "failed", error: "response was not valid JSON" }).eq("id", item.id);
          failedItems++;
          continue;
        }

        const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
        let itemGenerated = 0, itemDupes = 0, itemInvalid = 0;

        for (const raw of rawQuestions) {
          const result = validateQuestion(raw, {
            sectionText,
            strictStem: kind === "stem",
            language: job.language,
          });
          if (!result.ok) { itemInvalid++; continue; }
          const v = result.value;

          const hash = await questionHash(v.question);
          if (existingHashes.has(hash)) { itemDupes++; continue; }
          if (existingTexts.some((t) => similarity(t, v.question) >= NEAR_DUPLICATE_THRESHOLD)) { itemDupes++; continue; }

          const { error: insErr } = await admin.from("quiz_questions").insert({
            document_id: item.document_id,
            chunk_index: item.chunk_index,
            chunk_id: (chunk as any)?.id ?? item.chunk_id,
            language: job.language,
            question_hash: hash,
            source_content_hash: (chunk as any)?.content_hash ?? item.source_content_hash,
            quiz_bank_version: 1,
            question: v.question,
            question_type: v.question_type,
            options: v.options,
            correct_answer: v.correct_answer,
            acceptable_answers: v.acceptable_answers,
            items: v.items,
            correct_order: v.correct_order,
            explanation: v.explanation,
            working: v.working,
            difficulty: v.difficulty,
            skill: v.skill,
            topic: v.topic,
            source_reference: v.source_reference,
            grade: doc?.grade_level ?? null,
            subject,
            phase: doc?.grade_level && Number(doc.grade_level) >= 10 ? "FET" : doc?.grade_level ? "Senior" : null,
            curriculum_system: doc?.tags?.curriculum ?? "CAPS",
            caps_topic: v.caps_topic,
            caps_subtopic: v.caps_subtopic,
            learning_outcome: v.learning_outcome,
            assessment_skill: v.assessment_skill,
            cognitive_level: v.cognitive_level,
            command_word: v.command_word,
            mark_allocation: v.mark_allocation,
            marking_guidance: v.marking_guidance,
            expected_answer_points: v.expected_answer_points,
            exam_alignment_level: job.exam_alignment_level ?? "low",
            question_origin: questionOriginFor(job.exam_alignment_level ?? "low"),
            assessment_reference_type: job.exam_alignment_level === "high" ? "official assessment patterns" : null,
            source_material_type: kind === "literature" ? "textbook section" : "CAPS + textbook section",
            validation: v.validation,
            validation_status: v.validation_status,
            answer_verified: v.answer_verified,
            status: "draft",
            ai_validated: v.validation_status === "passed",
            generation_job_id: job.id,
            created_by: job.created_by,
          });
          if (insErr) {
            // Unique index hit = duplicate that slipped through a race.
            if (/duplicate key|unique/i.test(insErr.message)) { itemDupes++; continue; }
            itemInvalid++;
            continue;
          }
          existingHashes.add(hash);
          existingTexts.push(v.question);
          itemGenerated++;
        }

        generated += itemGenerated;
        duplicates += itemDupes;
        invalid += itemInvalid;

        await admin.from("quiz_seed_job_items").update({
          status: itemGenerated > 0 ? "completed" : "empty",
          generated_questions: itemGenerated,
          duplicate_questions: itemDupes,
          invalid_questions: itemInvalid,
          error: itemGenerated === 0 ? "no valid questions survived validation" : null,
          updated_at: new Date().toISOString(),
        }).eq("id", item.id);
      }

      // Are there still unsent sections (batch size cap)?
      const { count: stillPending } = await admin
        .from("quiz_seed_job_items").select("id", { count: "exact", head: true })
        .eq("job_id", job.id).eq("status", "pending");

      const nextStatus = (stillPending ?? 0) > 0
        ? "queued"
        : failedItems > 0 ? "partially_completed" : "completed";

      await admin.from("quiz_seed_jobs").update({
        status: nextStatus,
        batch_name: (stillPending ?? 0) > 0 ? null : job.batch_name,
        generated_questions: (job.generated_questions ?? 0) + generated,
        duplicate_questions: (job.duplicate_questions ?? 0) + duplicates,
        invalid_questions: (job.invalid_questions ?? 0) + invalid,
        failed_questions: (job.failed_questions ?? 0) + failedItems,
        completed_at: (stillPending ?? 0) > 0 ? null : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      report.push({ job_id: job.id, generated, duplicates, invalid, failed_items: failedItems, status: nextStatus, pending_sections: stillPending ?? 0 });
    }

    return json({ ok: true, polled: (jobs ?? []).length, report });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[quiz-seed-poll]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
