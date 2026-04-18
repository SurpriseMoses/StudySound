import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { levelProgress, xpThreshold } from "@/lib/progression";

export type XpSource =
  | "section_complete"
  | "lesson_complete"
  | "daily_reward"
  | "quiz_bonus";

export type AwardResult = {
  duplicate: boolean;
  xpAwarded: number;
  creditsAwarded: number;
  totalXp: number;
  level: number;
  fromLevel?: number;
  leveledUp: boolean;
  nextLevelXp: number;
  currentLevelXp: number;
};

export type ProgressionState = {
  xp: number;
  level: number;
  loading: boolean;
  pendingLevelUp: { fromLevel: number; toLevel: number } | null;
  awardXp: (
    source: XpSource,
    opts?: { sourceKey?: string; scorePct?: number; metadata?: Record<string, unknown> },
  ) => Promise<AwardResult | null>;
  flushLevelUp: () => void;
  dismissLevelUp: () => void;
  reload: () => Promise<void>;
};

export function useProgression(): ProgressionState {
  const { user } = useAuth();
  const [xp, setXp] = useState(0);
  const [level, setLevel] = useState(1);
  const [loading, setLoading] = useState(true);
  // Queued level-up celebration (shown when user finishes current activity)
  const queuedLevelUp = useRef<{ fromLevel: number; toLevel: number } | null>(null);
  const [pendingLevelUp, setPendingLevelUp] = useState<{ fromLevel: number; toLevel: number } | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setXp(0);
      setLevel(1);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("xp, level")
      .eq("user_id", user.id)
      .maybeSingle();
    setXp(data?.xp ?? 0);
    setLevel(data?.level ?? 1);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  const awardXp = useCallback<ProgressionState["awardXp"]>(
    async (source, opts = {}) => {
      if (!user) return null;
      try {
        const { data, error } = await supabase.functions.invoke("award-xp", {
          body: {
            source,
            source_key: opts.sourceKey ?? null,
            score_pct: opts.scorePct,
            metadata: opts.metadata ?? null,
          },
        });
        if (error) throw error;
        const res = data as AwardResult;
        if (!res) return null;
        // Optimistically update local state
        setXp(res.totalXp);
        setLevel(res.level);
        if (res.leveledUp && res.fromLevel != null) {
          // Queue — surfaced when caller opts to flush (e.g. after section ends)
          queuedLevelUp.current = { fromLevel: res.fromLevel, toLevel: res.level };
        }
        return res;
      } catch (e) {
        console.error("award-xp failed", e);
        return null;
      }
    },
    [user],
  );

  const flushLevelUp = useCallback(() => {
    if (queuedLevelUp.current) {
      setPendingLevelUp(queuedLevelUp.current);
      queuedLevelUp.current = null;
    }
  }, []);

  const dismissLevelUp = useCallback(() => setPendingLevelUp(null), []);

  return {
    xp,
    level,
    loading,
    pendingLevelUp,
    awardXp,
    flushLevelUp,
    dismissLevelUp,
    reload,
  };
}

export { levelProgress, xpThreshold };
