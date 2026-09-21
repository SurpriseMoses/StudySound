// Learner quiz endpoint: assemble a quiz from the published bank, charge the
// existing StudySound credit wallet atomically, record the attempt with locked
// question versions, grade answers and update adaptive performance data.
//
// Actions: availability, start, answer, complete, flag
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { creditCostFor, type QuizSettings } from "../_shared/quiz-bank.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (p: unknown, status = 200) =>
  new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface BankQuestion {
  id: string;
  version: number;
  chunk_index: number | null;
  question: string;
  question_type: string;
  options: string[] | null;
  items: string[] | null;
  correct_order: number[] | null;
  correct_answer: string;
  acceptable_answers: string[] | null;
  explanation: string;
  working: string | null;
  difficulty: string;
  skill: string | null;
  topic: string | null;
}

/** Public shape sent to the learner — never includes the answer. */
function publicQuestion(q: BankQuestion, position: number) {
  return {
    position,
    question_id: q.id,
    question: q.question,
    question_type: q.question_type,
    options: q.options,
    items: q.items,
    difficulty: q.difficulty,
    skill: q.skill,
    topic: q.topic,
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function answerIsCorrect(q: BankQuestion, given: string): boolean {
  const g = (given ?? "").trim();
  if (!g) return false;
  if (q.question_type === "ordering") {
    return g.replace(/\s/g, "") === (q.correct_order ?? []).join(",");
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  if (norm(g) === norm(q.correct_answer)) return true;
  return (q.acceptable_answers ?? []).some((a) => norm(a) === norm(g));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    const { data: settingsRow } = await admin.from("quiz_settings").select("*").eq("id", 1).maybeSingle();
    const settings = settingsRow as unknown as QuizSettings;

    // ------------------------------------------------------- availability
    if (action === "availability") {
      const documentId = body.document_id as string;
      const chunkIndex = body.chunk_index as number | null | undefined;
      let q = admin
        .from("quiz_questions")
        .select("id", { count: "exact", head: true })
        .eq("document_id", documentId)
        .eq("status", "published")
        .eq("language", body.language ?? "en");
      const { count: bookCount } = await q;
      let sectionCount = 0;
      if (typeof chunkIndex === "number") {
        const { count } = await admin
          .from("quiz_questions")
          .select("id", { count: "exact", head: true })
          .eq("document_id", documentId)
          .eq("status", "published")
          .eq("language", body.language ?? "en")
          .eq("chunk_index", chunkIndex);
        sectionCount = count ?? 0;
      }
      const { data: profile } = await admin
        .from("profiles").select("credits_balance").eq("user_id", user.id).maybeSingle();
      return json({
        book_questions: bookCount ?? 0,
        section_questions: sectionCount,
        presets: settings.presets,
        credit_costs: settings.credit_costs,
        balance: (profile as any)?.credits_balance ?? 0,
      });
    }

    // --------------------------------------------------------------- start
    if (action === "start") {
      const documentId = body.document_id as string;
      const scope: "section" | "book" = body.scope === "book" ? "book" : "section";
      const chunkIndex = body.chunk_index as number | null | undefined;
      const language = body.language ?? "en";
      const presetId = body.preset ?? "standard";
      const idempotencyKey = (body.idempotency_key as string | undefined) ?? null;

      const preset = settings.presets.find((p) => p.id === presetId) ?? settings.presets[1] ?? { id: "standard", label: "Standard Quiz", questions: 10 };
      const wanted = preset.questions;

      // Double-tap protection: return the existing attempt instead of charging twice.
      if (idempotencyKey) {
        const { data: prior } = await admin
          .from("quiz_bank_attempts").select("id").eq("user_id", user.id).eq("idempotency_key", idempotencyKey).maybeSingle();
        if (prior) {
          const { data: qs } = await admin
            .from("quiz_bank_attempt_questions").select("position, question_id, question_snapshot")
            .eq("attempt_id", (prior as any).id).order("position");
          return json({
            already: true,
            attempt_id: (prior as any).id,
            questions: (qs ?? []).map((r: any) => publicQuestion(r.question_snapshot as BankQuestion, r.position)),
          });
        }
      }

      // ---- pool selection: respect book / section / difficulty / skill / topic
      let pool = admin
        .from("quiz_questions")
        .select("id, version, chunk_index, question, question_type, options, items, correct_order, correct_answer, acceptable_answers, explanation, working, difficulty, skill, topic")
        .eq("document_id", documentId)
        .eq("status", "published")
        .eq("language", language)
        .limit(600);
      if (scope === "section" && typeof chunkIndex === "number") pool = pool.eq("chunk_index", chunkIndex);
      if (body.difficulty) pool = pool.eq("difficulty", body.difficulty);
      if (body.skill) pool = pool.eq("skill", body.skill);
      if (body.topic) pool = pool.eq("topic", body.topic);

      const { data: poolRows, error: poolErr } = await pool;
      if (poolErr) throw poolErr;
      let candidates = (poolRows ?? []) as unknown as BankQuestion[];

      if (candidates.length === 0) {
        return json({
          error: "no_questions",
          message: "No quiz questions are published for this section yet.",
        }, 200);
      }

      // ---- adaptive weighting: favour weak skills, then least-recently-seen
      const [{ data: perf }, { data: exposure }] = await Promise.all([
        admin.from("quiz_performance").select("skill, attempts, correct").eq("user_id", user.id).eq("document_id", documentId),
        admin.from("quiz_question_exposure").select("question_id, times_seen, last_seen_at").eq("user_id", user.id)
          .in("question_id", candidates.map((c) => c.id)),
      ]);
      const skillRate = new Map<string, number>();
      for (const r of (perf ?? []) as any[]) {
        if (!r.skill || !r.attempts) continue;
        skillRate.set(r.skill, r.correct / r.attempts);
      }
      const seen = new Map<string, { times_seen: number; last_seen_at: string | null }>();
      for (const r of (exposure ?? []) as any[]) seen.set(r.question_id, r);

      const scored = shuffle(candidates).map((q) => {
        const rate = q.skill ? skillRate.get(q.skill) : undefined;
        const weakness = rate === undefined ? 0.35 : 1 - rate; // unknown skills get mild priority
        const ex = seen.get(q.id);
        const freshness = ex ? 1 / (1 + ex.times_seen) : 1;
        return { q, score: weakness * 0.6 + freshness * 0.4 + Math.random() * 0.15 };
      }).sort((a, b) => b.score - a.score);

      // ---- honour the configured difficulty spread where the pool allows
      const chosen: BankQuestion[] = [];
      const mix: Record<string, number> = body.difficulty_mix ?? { easy: 40, medium: 40, hard: 20 };
      const quotas: Record<string, number> = {
        easy: Math.round((mix.easy ?? 0) / 100 * wanted),
        medium: Math.round((mix.medium ?? 0) / 100 * wanted),
        hard: Math.round((mix.hard ?? 0) / 100 * wanted),
      };
      for (const level of ["easy", "medium", "hard"]) {
        for (const s of scored) {
          if (chosen.length >= wanted) break;
          if (quotas[level] <= 0) break;
          if (s.q.difficulty !== level) continue;
          if (chosen.some((c) => c.id === s.q.id)) continue;
          chosen.push(s.q);
          quotas[level]--;
        }
      }
      for (const s of scored) {
        if (chosen.length >= wanted) break;
        if (!chosen.some((c) => c.id === s.q.id)) chosen.push(s.q);
      }

      const finalQuestions = chosen.slice(0, Math.min(wanted, chosen.length));
      const cost = creditCostFor(finalQuestions.length, settings.credit_costs);

      // ---- credits: admins free, everyone else charged from the shared wallet
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
      await admin.rpc("expire_free_credits", { _user_id: user.id });
      const { data: profile } = await admin
        .from("profiles").select("credits_balance").eq("user_id", user.id).maybeSingle();
      const balance = (profile as any)?.credits_balance ?? 0;
      const effectiveCost = isAdmin ? 0 : cost;

      if (!isAdmin && balance < cost) {
        return json({
          error: "insufficient_credits",
          message: "Not enough credits to start this quiz.",
          required: cost,
          balance,
        }, 200);
      }

      // Create the attempt first (unique idempotency key guards double-taps).
      const { data: attempt, error: attErr } = await admin.from("quiz_bank_attempts").insert({
        user_id: user.id,
        document_id: documentId,
        chunk_index: scope === "section" ? (chunkIndex ?? null) : null,
        scope,
        preset: preset.id,
        language,
        total_questions: finalQuestions.length,
        credits_charged: effectiveCost,
        idempotency_key: idempotencyKey,
      }).select().maybeSingle();
      if (attErr) {
        if (/duplicate key|unique/i.test(attErr.message)) {
          return json({ error: "duplicate_start", message: "This quiz was already started." }, 200);
        }
        throw attErr;
      }
      const attemptId = (attempt as any).id as string;

      // Deduct, rolling back the attempt if the deduction fails.
      if (effectiveCost > 0) {
        // Conditional update: only succeeds while the wallet still holds the cost,
        // so two concurrent starts can never overdraw the balance.
        const { data: charged, error: dedErr } = await admin
          .from("profiles")
          .update({ credits_balance: balance - effectiveCost })
          .eq("user_id", user.id)
          .eq("credits_balance", balance)
          .gte("credits_balance", effectiveCost)
          .select("credits_balance");
        if (dedErr || !charged || charged.length === 0) {
          await admin.from("quiz_bank_attempts").delete().eq("id", attemptId);
          if (dedErr) throw dedErr;
          return json({
            error: "insufficient_credits",
            message: "Your credit balance changed — please try again.",
            required: cost,
            balance,
          }, 200);
        }
        await admin.from("credit_transactions").insert({
          user_id: user.id,
          amount: -effectiveCost,
          source: "quiz",
          feature_type: "quiz",
          document_id: documentId,
          request_id: `quiz-attempt-${attemptId}`,
          metadata: { reference_type: "quiz_attempt", reference_id: attemptId, questions: finalQuestions.length, preset: preset.id },
          unlocks: 1,
        });
        await admin.from("user_usage").insert({
          user_id: user.id, document_id: documentId, action_type: "quiz",
          credits_used: effectiveCost, request_id: `quiz-attempt-${attemptId}`,
        });
      }

      // Lock question ids + versions into the attempt.
      const { error: lockErr } = await admin.from("quiz_bank_attempt_questions").insert(
        finalQuestions.map((q, i) => ({
          attempt_id: attemptId,
          question_id: q.id,
          question_version: q.version,
          position: i,
          question_snapshot: q,
        })),
      );
      if (lockErr) {
        // Refund and remove the attempt so the learner is never charged for a broken quiz.
        if (effectiveCost > 0) {
          await admin.from("profiles").update({ credits_balance: balance }).eq("user_id", user.id);
          await admin.from("credit_transactions").insert({
            user_id: user.id,
            amount: effectiveCost,
            source: "quiz_refund",
            feature_type: "quiz",
            document_id: documentId,
            request_id: `quiz-refund-${attemptId}`,
            metadata: { reference_type: "quiz_attempt", reference_id: attemptId, reason: "assembly_failed" },
          });
        }
        await admin.from("quiz_bank_attempts").delete().eq("id", attemptId);
        throw lockErr;
      }

      // Exposure bookkeeping
      for (const q of finalQuestions) {
        const ex = seen.get(q.id);
        await admin.from("quiz_question_exposure").upsert({
          user_id: user.id,
          question_id: q.id,
          times_seen: (ex?.times_seen ?? 0) + 1,
          last_seen_at: new Date().toISOString(),
        }, { onConflict: "user_id,question_id" });
      }
      await admin.rpc("quiz_bump_served", { _ids: finalQuestions.map((q) => q.id) });

      return json({
        attempt_id: attemptId,
        credits_charged: effectiveCost,
        new_balance: balance - effectiveCost,
        preset: preset,
        questions: finalQuestions.map((q, i) => publicQuestion(q, i)),
      });
    }

    // -------------------------------------------------------------- answer
    if (action === "answer") {
      const attemptId = body.attempt_id as string;
      const position = body.position as number;
      const given = String(body.answer ?? "");

      const { data: attempt } = await admin
        .from("quiz_bank_attempts").select("*").eq("id", attemptId).eq("user_id", user.id).maybeSingle();
      if (!attempt) return json({ error: "Attempt not found" }, 404);

      const { data: row } = await admin
        .from("quiz_bank_attempt_questions").select("*").eq("attempt_id", attemptId).eq("position", position).maybeSingle();
      if (!row) return json({ error: "Question not found in attempt" }, 404);
      if ((row as any).answered_at) {
        return json({ already: true, is_correct: (row as any).is_correct });
      }

      const snap = (row as any).question_snapshot as BankQuestion;
      const correct = answerIsCorrect(snap, given);

      await admin.from("quiz_bank_attempt_questions").update({
        given_answer: given, is_correct: correct, answered_at: new Date().toISOString(),
      }).eq("id", (row as any).id);

      // Question-level stats
      const { data: qStats } = await admin
        .from("quiz_questions").select("times_answered, times_correct").eq("id", snap.id).maybeSingle();
      await admin.from("quiz_questions").update({
        times_answered: ((qStats as any)?.times_answered ?? 0) + 1,
        times_correct: ((qStats as any)?.times_correct ?? 0) + (correct ? 1 : 0),
      }).eq("id", snap.id);

      // Adaptive performance buckets
      const { data: perfRow } = await admin
        .from("quiz_performance").select("id, attempts, correct")
        .eq("user_id", user.id).eq("document_id", (attempt as any).document_id)
        .eq("skill", snap.skill ?? "").eq("difficulty", snap.difficulty)
        .eq("question_type", snap.question_type).maybeSingle();
      if (perfRow) {
        await admin.from("quiz_performance").update({
          attempts: (perfRow as any).attempts + 1,
          correct: (perfRow as any).correct + (correct ? 1 : 0),
          last_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", (perfRow as any).id);
      } else {
        await admin.from("quiz_performance").insert({
          user_id: user.id,
          document_id: (attempt as any).document_id,
          chunk_index: snap.chunk_index,
          skill: snap.skill ?? "",
          difficulty: snap.difficulty,
          question_type: snap.question_type,
          attempts: 1,
          correct: correct ? 1 : 0,
          last_attempt_at: new Date().toISOString(),
        });
      }

      const { data: ex } = await admin
        .from("quiz_question_exposure").select("id, times_correct").eq("user_id", user.id).eq("question_id", snap.id).maybeSingle();
      if (ex) {
        await admin.from("quiz_question_exposure")
          .update({ times_correct: (ex as any).times_correct + (correct ? 1 : 0) }).eq("id", (ex as any).id);
      }

      return json({
        is_correct: correct,
        correct_answer: snap.correct_answer,
        correct_order: snap.correct_order,
        explanation: snap.explanation,
        working: snap.working,
      });
    }

    // ------------------------------------------------------------ complete
    if (action === "complete") {
      const attemptId = body.attempt_id as string;
      const { data: attempt } = await admin
        .from("quiz_bank_attempts").select("*").eq("id", attemptId).eq("user_id", user.id).maybeSingle();
      if (!attempt) return json({ error: "Attempt not found" }, 404);

      const { data: rows } = await admin
        .from("quiz_bank_attempt_questions").select("position, is_correct, given_answer, question_snapshot")
        .eq("attempt_id", attemptId).order("position");
      const answered = (rows ?? []) as any[];
      const correctCount = answered.filter((r) => r.is_correct).length;
      const total = (attempt as any).total_questions || answered.length;
      const startedAt = new Date((attempt as any).started_at).getTime();

      await admin.from("quiz_bank_attempts").update({
        completed_at: new Date().toISOString(),
        correct_count: correctCount,
        score: total > 0 ? correctCount / total : 0,
        duration_seconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
      }).eq("id", attemptId);

      return json({
        correct_count: correctCount,
        total_questions: total,
        score: total > 0 ? correctCount / total : 0,
        review: answered.map((r) => ({
          position: r.position,
          question: r.question_snapshot.question,
          question_type: r.question_snapshot.question_type,
          options: r.question_snapshot.options,
          items: r.question_snapshot.items,
          given_answer: r.given_answer,
          is_correct: r.is_correct,
          correct_answer: r.question_snapshot.correct_answer,
          correct_order: r.question_snapshot.correct_order,
          explanation: r.question_snapshot.explanation,
          working: r.question_snapshot.working,
        })),
      });
    }

    // ---------------------------------------------------------------- flag
    if (action === "flag") {
      const { error } = await admin.from("quiz_flags").insert({
        question_id: body.question_id, flagged_by: user.id, source: "learner", reason: body.reason ?? null,
      });
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[quiz-play]", msg);
    return json({ error: msg }, 500);
  }
});
