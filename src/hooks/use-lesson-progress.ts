import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type LessonProgressUpdate = {
  audio_progress_pct?: number;
  audio_listened_seconds?: number;
  last_position_seconds?: number;
  sections_completed?: number;
  sections_total?: number;
  reward_eligible?: boolean;
};

/**
 * Persists per-lesson playback progress into the `lesson_progress` table.
 * - One row per (user_id, lesson_id) — enforced by DB unique constraint.
 * - Writes are throttled (default 5s) to avoid hammering during `timeupdate`.
 * - A final `flush()` is called on unmount so we never lose the last position.
 */
export function useLessonProgress(lessonId: string | null, throttleMs = 5000) {
  const { user } = useAuth();
  const pending = useRef<LessonProgressUpdate>({});
  const lastFlush = useRef<number>(0);
  const timer = useRef<number | null>(null);

  const flush = useCallback(async () => {
    if (!user || !lessonId) return;
    const payload = pending.current;
    if (!payload || Object.keys(payload).length === 0) return;
    pending.current = {};
    lastFlush.current = Date.now();
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    // Clamp pct just in case (CHECK constraint enforces 0-100).
    const clamped: LessonProgressUpdate = { ...payload };
    if (typeof clamped.audio_progress_pct === "number") {
      clamped.audio_progress_pct = Math.max(0, Math.min(100, clamped.audio_progress_pct));
    }
    await supabase.from("lesson_progress").upsert(
      {
        user_id: user.id,
        lesson_id: lessonId,
        ...clamped,
      },
      { onConflict: "user_id,lesson_id" },
    );
  }, [user, lessonId]);

  const update = useCallback(
    (partial: LessonProgressUpdate) => {
      pending.current = { ...pending.current, ...partial };
      const now = Date.now();
      const since = now - lastFlush.current;
      if (since >= throttleMs) {
        flush();
      } else if (!timer.current) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          flush();
        }, throttleMs - since);
      }
    },
    [flush, throttleMs],
  );

  useEffect(() => {
    return () => {
      // Best-effort final write on unmount / lesson switch.
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  return { update, flush };
}
