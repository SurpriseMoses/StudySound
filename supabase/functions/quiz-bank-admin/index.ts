// Admin-only Quiz Bank API (action-routed). Admin auth via user_roles.
// Actions: overview, library, sections_preview, estimate, create_job, list_jobs,
// job_detail, job_control, list_questions, review, update_question,
// question_versions, metrics, flags, resolve_flag, settings_get, settings_update,
// templates, upsert_template, generation_status
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  estimateCost,
  pickMeaningfulSections,
  questionHash,
  subjectKindFor,
  type QuizSettings,
  type SectionRow,
} from "../_shared/quiz-bank.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function loadSections(
  admin: ReturnType<typeof createClient>,
  documentId: string,
  chunkIndexes: number[] | null,
): Promise<SectionRow[]> {
  const rows: SectionRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = admin
      .from("document_chunks")
      .select("id, chunk_index, text, content_hash, char_count")
      .eq("document_id", documentId)
      .order("chunk_index", { ascending: true })
      .range(from, from + page - 1);
    if (chunkIndexes && chunkIndexes.length > 0) q = q.in("chunk_index", chunkIndexes);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as SectionRow[]));
    if (!data || data.length < page) break;
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRow } = await admin
      .from("user_roles").select("id").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden: admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    const { data: settingsRow } = await admin.from("quiz_settings").select("*").eq("id", 1).maybeSingle();
    const settings = settingsRow as unknown as QuizSettings;

    const geminiConfigured = !!(Deno.env.get("Gemini_Secret_Key") ?? Deno.env.get("GEMINI_API_KEY"));

    // ------------------------------------------------------- read actions

    if (action === "generation_status") {
      return json({
        gemini_configured: geminiConfigured,
        generation_enabled: settings?.generation_enabled ?? false,
        available: geminiConfigured && (settings?.generation_enabled ?? false),
        message: !geminiConfigured
          ? "Generation unavailable — configure Gemini billing/API access to begin seeding."
          : !settings?.generation_enabled
            ? "Generation is switched off in Quiz Settings."
            : null,
      });
    }

    if (action === "overview") {
      const { data, error } = await userClient.rpc("quiz_bank_overview");
      if (error) throw error;
      return json({ overview: data, settings, gemini_configured: geminiConfigured });
    }

    if (action === "library") {
      const { data: docs, error } = await admin
        .from("documents")
        .select("id, title, subject_type, doc_type, grade_level, tags, char_count, language, published_at")
        .order("title", { ascending: true })
        .limit(500);
      if (error) throw error;
      const { data: counts } = await admin.from("quiz_questions").select("document_id, status");
      const byDoc = new Map<string, { total: number; published: number; pending: number }>();
      for (const r of (counts ?? []) as { document_id: string; status: string }[]) {
        const e = byDoc.get(r.document_id) ?? { total: 0, published: 0, pending: 0 };
        e.total++;
        if (r.status === "published") e.published++;
        if (r.status === "draft" || r.status === "pending_review") e.pending++;
        byDoc.set(r.document_id, e);
      }
      return json({
        books: (docs ?? []).map((d: any) => ({
          ...d,
          subject: (d.tags as any)?.subject ?? null,
          bank: byDoc.get(d.id) ?? { total: 0, published: 0, pending: 0 },
        })),
      });
    }

    if (action === "sections_preview") {
      const documentId = body.document_id as string;
      const rows = await loadSections(admin, documentId, null);
      const meaningful = pickMeaningfulSections(rows, settings.min_section_chars);
      return json({
        total_sections: rows.length,
        meaningful_sections: meaningful.length,
        sections: meaningful.slice(0, 200).map((s) => ({
          chunk_index: s.chunk_index,
          char_count: s.char_count,
          preview: s.text.slice(0, 160),
        })),
      });
    }

    if (action === "estimate") {
      const documentIds: string[] = body.document_ids ?? [];
      const perSection: number = body.questions_per_section ?? settings.default_questions_per_section;
      const chunkIndexes: number[] | null = body.chunk_indexes ?? null;
      let sections: SectionRow[] = [];
      const perBook: { document_id: string; title: string; meaningful: number; total: number }[] = [];
      for (const id of documentIds) {
        const rows = await loadSections(admin, id, chunkIndexes);
        const meaningful = pickMeaningfulSections(rows, settings.min_section_chars);
        sections = sections.concat(meaningful);
        const { data: doc } = await admin.from("documents").select("title").eq("id", id).maybeSingle();
        perBook.push({ document_id: id, title: (doc as any)?.title ?? id, meaningful: meaningful.length, total: rows.length });
      }
      const est = estimateCost(sections, perSection, settings.model_pricing, true);
      return json({ estimate: est, per_book: perBook, pricing: settings.model_pricing });
    }

    if (action === "list_questions") {
      const {
        document_id, status, difficulty, skill, question_type, language, search,
        subject, grade, limit = 50, offset = 0,
      } = body;
      let q = admin
        .from("quiz_questions")
        .select("*, documents!inner(title, grade_level, subject_type)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (document_id) q = q.eq("document_id", document_id);
      if (status) q = q.eq("status", status);
      if (difficulty) q = q.eq("difficulty", difficulty);
      if (skill) q = q.eq("skill", skill);
      if (question_type) q = q.eq("question_type", question_type);
      if (language) q = q.eq("language", language);
      if (subject) q = q.eq("subject", subject);
      if (grade) q = q.eq("grade", grade);
      if (search) q = q.ilike("question", `%${search}%`);
      const { data, error, count } = await q;
      if (error) throw error;
      return json({ questions: data ?? [], count: count ?? 0 });
    }

    if (action === "question_versions") {
      const { data, error } = await admin
        .from("quiz_question_versions")
        .select("*")
        .eq("question_id", body.question_id)
        .order("version", { ascending: false });
      if (error) throw error;
      return json({ versions: data ?? [] });
    }

    if (action === "list_jobs") {
      const { data, error } = await admin
        .from("quiz_seed_jobs")
        .select("*, documents(title)")
        .order("created_at", { ascending: false })
        .limit(body.limit ?? 100);
      if (error) throw error;
      return json({ jobs: data ?? [] });
    }

    if (action === "job_detail") {
      const [{ data: job }, { data: items }] = await Promise.all([
        admin.from("quiz_seed_jobs").select("*, documents(title)").eq("id", body.job_id).maybeSingle(),
        admin.from("quiz_seed_job_items").select("*").eq("job_id", body.job_id).order("batch_position", { ascending: true }).limit(2000),
      ]);
      return json({ job, items: items ?? [] });
    }

    if (action === "metrics") {
      const { data: qs, error } = await admin
        .from("quiz_questions")
        .select("id, question, document_id, difficulty, skill, question_type, status, times_served, times_answered, times_correct, documents(title)")
        .gt("times_answered", 0)
        .order("times_answered", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = (qs ?? []).map((q: any) => ({
        ...q,
        success_rate: q.times_answered > 0 ? q.times_correct / q.times_answered : null,
      }));
      const answered = rows.filter((r) => r.times_answered >= 5);
      return json({
        most_answered: rows.slice(0, 25),
        hardest: [...answered].sort((a, b) => (a.success_rate ?? 1) - (b.success_rate ?? 1)).slice(0, 25),
        easiest: [...answered].sort((a, b) => (b.success_rate ?? 0) - (a.success_rate ?? 0)).slice(0, 25),
        average_score: answered.length
          ? answered.reduce((s, r) => s + (r.success_rate ?? 0), 0) / answered.length
          : null,
      });
    }

    if (action === "flags") {
      const { data, error } = await admin
        .from("quiz_flags")
        .select("*, quiz_questions(question, status, document_id, difficulty, skill)")
        .eq("status", body.status ?? "open")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return json({ flags: data ?? [] });
    }

    if (action === "settings_get") return json({ settings });

    if (action === "templates") {
      const { data, error } = await admin.from("quiz_templates").select("*").order("created_at");
      if (error) throw error;
      return json({ templates: data ?? [] });
    }

    // ------------------------------------------------------ write actions

    if (action === "settings_update") {
      const patch = body.patch ?? {};
      const allowed = [
        "credit_costs", "presets", "model_pricing", "min_section_chars",
        "default_questions_per_section", "require_review_subjects",
        "auto_publish_approved", "generation_enabled",
      ];
      const update: Record<string, unknown> = { updated_by: user.id, updated_at: new Date().toISOString() };
      for (const k of allowed) if (k in patch) update[k] = patch[k];
      const { data, error } = await admin.from("quiz_settings").update(update).eq("id", 1).select().maybeSingle();
      if (error) throw error;
      return json({ settings: data });
    }

    if (action === "upsert_template") {
      const t = body.template ?? {};
      const row = {
        ...(t.id ? { id: t.id } : {}),
        name: t.name, description: t.description ?? null,
        applies_to: t.applies_to ?? "literature",
        subject: t.subject ?? null, grade: t.grade ?? null,
        questions_per_section: t.questions_per_section ?? 5,
        difficulty_mix: t.difficulty_mix ?? { easy: 40, medium: 40, hard: 20 },
        skill_mix: t.skill_mix ?? {},
        question_types: t.question_types ?? ["multiple_choice"],
        cognitive_mix: t.cognitive_mix ?? {},
        exam_alignment_level: t.exam_alignment_level ?? "low",
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await admin.from("quiz_templates").upsert(row).select().maybeSingle();
      if (error) throw error;
      return json({ template: data });
    }

    if (action === "create_job") {
      const documentIds: string[] = body.document_ids ?? [];
      if (documentIds.length === 0) return json({ error: "Select at least one book" }, 400);
      const perSection: number = body.questions_per_section ?? settings.default_questions_per_section;
      const chunkIndexes: number[] | null = body.chunk_indexes ?? null;
      const scope: string = body.scope ?? "full_book";
      const mode: string = body.generation_mode ?? "generate_new";
      const language: string = body.language ?? "en";

      let allSections: { document_id: string; section: SectionRow }[] = [];
      for (const id of documentIds) {
        const rows = await loadSections(admin, id, chunkIndexes);
        const meaningful = pickMeaningfulSections(rows, settings.min_section_chars);
        for (const s of meaningful) allSections.push({ document_id: id, section: s });
      }

      if (mode === "regenerate_missing") {
        // Keep only sections that currently have no published/approved question.
        const { data: existing } = await admin
          .from("quiz_questions")
          .select("document_id, chunk_index")
          .in("document_id", documentIds)
          .eq("language", language)
          .in("status", ["draft", "pending_review", "approved", "published"]);
        const have = new Set((existing ?? []).map((r: any) => `${r.document_id}:${r.chunk_index}`));
        allSections = allSections.filter((s) => !have.has(`${s.document_id}:${s.section.chunk_index}`));
      } else if (mode === "regenerate_rejected") {
        const { data: rejected } = await admin
          .from("quiz_questions")
          .select("document_id, chunk_index")
          .in("document_id", documentIds)
          .eq("language", language)
          .eq("status", "rejected");
        const want = new Set((rejected ?? []).map((r: any) => `${r.document_id}:${r.chunk_index}`));
        allSections = allSections.filter((s) => want.has(`${s.document_id}:${s.section.chunk_index}`));
      }

      if (allSections.length === 0) return json({ error: "No meaningful sections match this configuration" }, 400);

      const est = estimateCost(allSections.map((s) => s.section), perSection, settings.model_pricing, true);

      const { data: job, error: jobErr } = await admin
        .from("quiz_seed_jobs")
        .insert({
          document_id: documentIds.length === 1 ? documentIds[0] : null,
          document_ids: documentIds,
          scope,
          chunk_indexes: chunkIndexes,
          language,
          generation_mode: mode,
          questions_per_section: perSection,
          difficulty_mix: body.difficulty_mix ?? { easy: 40, medium: 40, hard: 20 },
          skill_mix: body.skill_mix ?? {},
          question_types: body.question_types ?? ["multiple_choice", "true_false", "short_answer"],
          exam_alignment_level: body.exam_alignment_level ?? "low",
          model: settings.model_pricing.model,
          pricing_snapshot: settings.model_pricing,
          estimated_questions: est.questions,
          estimated_cost_zar: est.zar,
          total_sections: allSections.length,
          target_questions: est.questions,
          status: "queued",
          created_by: user.id,
        })
        .select()
        .maybeSingle();
      if (jobErr) throw jobErr;

      const items = allSections.map((s, i) => ({
        job_id: (job as any).id,
        document_id: s.document_id,
        chunk_index: s.section.chunk_index,
        chunk_id: s.section.id,
        batch_position: i,
        source_content_hash: s.section.content_hash,
        requested_questions: perSection,
        status: "pending",
      }));
      for (let i = 0; i < items.length; i += 500) {
        const { error } = await admin.from("quiz_seed_job_items").insert(items.slice(i, i + 500));
        if (error) throw error;
      }

      return json({ job, sections: allSections.length, estimate: est });
    }

    if (action === "job_control") {
      const control = body.control as string;
      const jobId = body.job_id as string;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (control === "pause") patch.paused = true;
      else if (control === "resume") { patch.paused = false; patch.cancel_requested = false; }
      else if (control === "cancel") { patch.cancel_requested = true; patch.status = "cancelled"; patch.completed_at = new Date().toISOString(); }
      else if (control === "retry_failed") {
        await admin.from("quiz_seed_job_items").update({ status: "pending", error: null }).eq("job_id", jobId).eq("status", "failed");
        patch.status = "queued";
        patch.paused = false;
        patch.cancel_requested = false;
        patch.error_message = null;
      } else return json({ error: "Unknown control" }, 400);
      const { data, error } = await admin.from("quiz_seed_jobs").update(patch).eq("id", jobId).select().maybeSingle();
      if (error) throw error;
      return json({ job: data });
    }

    if (action === "review") {
      const ids: string[] = body.question_ids ?? (body.question_id ? [body.question_id] : []);
      const decision = body.decision as "approve" | "reject" | "publish" | "retire" | "pending_review";
      if (ids.length === 0) return json({ error: "No questions selected" }, 400);

      const statusMap: Record<string, string> = {
        approve: "approved", reject: "rejected", publish: "published",
        retire: "retired", pending_review: "pending_review",
      };
      const next = statusMap[decision];
      if (!next) return json({ error: "Unknown decision" }, 400);

      // Stricter gate: STEM questions cannot be published straight from draft.
      if (decision === "publish") {
        const { data: rows } = await admin
          .from("quiz_questions").select("id, subject, status").in("id", ids);
        const strictSubjects = (settings.require_review_subjects ?? []).map((s) => s.toLowerCase());
        const blocked = (rows ?? []).filter((r: any) =>
          strictSubjects.includes((r.subject ?? "").toLowerCase()) && r.status !== "approved",
        );
        if (blocked.length > 0) {
          return json({
            error: `${blocked.length} question(s) in a strict-review subject must be approved before publishing.`,
          }, 400);
        }
      }

      const patch: Record<string, unknown> = {
        status: next,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_note: body.note ?? null,
        updated_at: new Date().toISOString(),
      };
      if (next === "retired") patch.retired_at = new Date().toISOString();

      const { data, error } = await admin.from("quiz_questions").update(patch).in("id", ids).select("id, status");
      if (error) throw error;

      if (settings.auto_publish_approved && next === "approved") {
        await admin.from("quiz_questions").update({ status: "published" }).in("id", ids);
      }
      return json({ updated: data?.length ?? 0 });
    }

    if (action === "update_question") {
      const id = body.question_id as string;
      const patch = body.patch ?? {};
      const { data: current, error: curErr } = await admin
        .from("quiz_questions").select("*").eq("id", id).maybeSingle();
      if (curErr || !current) return json({ error: "Question not found" }, 404);

      // Preserve the previous version before overwriting.
      await admin.from("quiz_question_versions").insert({
        question_id: id,
        version: (current as any).version,
        snapshot: current,
        status: (current as any).status,
        source_content_hash: (current as any).source_content_hash,
        generation_job_id: (current as any).generation_job_id,
        change_reason: body.reason ?? "admin edit",
        created_by: user.id,
      });

      const editable = [
        "question", "question_type", "options", "correct_answer", "acceptable_answers",
        "items", "correct_order", "explanation", "working", "difficulty", "skill", "topic",
        "chunk_index", "cognitive_level", "command_word", "caps_topic", "caps_subtopic",
        "learning_outcome", "assessment_skill", "exam_alignment_level", "grade", "subject", "status",
      ];
      const update: Record<string, unknown> = {
        manually_edited: true,
        version: (current as any).version + 1,
        updated_at: new Date().toISOString(),
        reviewed_by: user.id,
      };
      for (const k of editable) if (k in patch) update[k] = patch[k];
      if (typeof update.question === "string") {
        update.question_hash = await questionHash(update.question as string);
      }

      const { data, error } = await admin.from("quiz_questions").update(update).eq("id", id).select().maybeSingle();
      if (error) throw error;
      return json({ question: data });
    }

    if (action === "resolve_flag") {
      const { error } = await admin
        .from("quiz_flags")
        .update({
          status: body.status === "dismissed" ? "dismissed" : "resolved",
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", body.flag_id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "flag_question") {
      const { error } = await admin.from("quiz_flags").insert({
        question_id: body.question_id, flagged_by: user.id, source: "admin", reason: body.reason ?? null,
      });
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[quiz-bank-admin]", msg);
    return json({ error: msg }, 500);
  }
});
