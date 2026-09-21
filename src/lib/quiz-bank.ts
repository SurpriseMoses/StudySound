// Client helpers for the Quiz Bank (admin) and learner quiz play endpoints.
import { supabase } from "@/integrations/supabase/client";

export type QuestionStatus =
  | "draft" | "pending_review" | "approved" | "published" | "rejected" | "retired";

export const QUESTION_STATUSES: QuestionStatus[] = [
  "draft", "pending_review", "approved", "published", "rejected", "retired",
];

export const QUESTION_TYPES = [
  "multiple_choice", "true_false", "short_answer", "ordering", "vocabulary", "inference", "analysis",
] as const;

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

export const STATUS_TONE: Record<QuestionStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_review: "bg-accent/15 text-accent",
  approved: "bg-primary/15 text-primary",
  published: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  retired: "bg-muted text-muted-foreground line-through",
};

export function prettify(s?: string | null): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function callFn<T>(fn: string, payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body: payload });
  if (error) {
    // Edge functions return a JSON body with `error` on failure.
    const detail = (data as { error?: string } | null)?.error;
    throw new Error(detail || error.message);
  }
  if (data && typeof data === "object" && "error" in (data as Record<string, unknown>)) {
    const err = (data as { error?: string }).error;
    // Soft errors (no_questions, insufficient_credits) are returned to the caller.
    if (err && !["no_questions", "insufficient_credits", "duplicate_start"].includes(err)) {
      throw new Error(err);
    }
  }
  return data as T;
}

export const quizAdmin = <T = any>(action: string, payload: Record<string, unknown> = {}) =>
  callFn<T>("quiz-bank-admin", { action, ...payload });

export const quizPlay = <T = any>(action: string, payload: Record<string, unknown> = {}) =>
  callFn<T>("quiz-play", { action, ...payload });

export const submitSeedJob = (jobId: string) =>
  callFn<{ ok: boolean; unavailable?: boolean; error?: string; submitted?: number; batch_name?: string }>(
    "quiz-seed-submit", { job_id: jobId },
  );

export const pollSeedJob = (jobId?: string) =>
  callFn<{ ok: boolean; report?: unknown[]; error?: string }>("quiz-seed-poll", jobId ? { job_id: jobId } : {});

export function formatZar(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `R${n.toFixed(2)}`;
}

export function pct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}
