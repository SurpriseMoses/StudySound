import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type RewardTrigger = "listen" | "quiz" | "reading";

export type RewardResult = {
  alreadyClaimed: boolean;
  creditsAwarded: number;
  streak: number;
  trigger: RewardTrigger;
};

type DailyRewardState = {
  open: boolean;
  result: RewardResult | null;
  claim: (trigger: RewardTrigger) => Promise<void>;
  dismiss: () => void;
};

const todayKey = () => `studysound:daily-reward:${new Date().toISOString().slice(0, 10)}`;

let inFlight: Promise<RewardResult | null> | null = null;

export function useDailyReward(): DailyRewardState {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<RewardResult | null>(null);
  const claimedThisSession = useRef(false);

  const claim = useCallback(
    async (trigger: RewardTrigger) => {
      if (!user) return;
      if (claimedThisSession.current) return;

      // Local guard: if already shown today on this device, don't even ping server
      const localKey = `${todayKey()}:${user.id}`;
      if (localStorage.getItem(localKey) === "shown") {
        claimedThisSession.current = true;
        return;
      }

      try {
        if (!inFlight) {
          inFlight = supabase.functions
            .invoke("claim-daily-reward", { body: { trigger } })
            .then(({ data, error }) => {
              if (error) throw error;
              return data as RewardResult;
            })
            .catch((e) => {
              console.error("daily-reward claim failed", e);
              return null;
            })
            .finally(() => {
              setTimeout(() => (inFlight = null), 500);
            });
        }
        const res = await inFlight;
        if (!res) return;

        claimedThisSession.current = true;
        localStorage.setItem(localKey, "shown");

        // Only show celebratory modal for fresh claims
        if (!res.alreadyClaimed) {
          setResult(res);
          setOpen(true);
        }
      } catch (e) {
        console.error("daily-reward error", e);
      }
    },
    [user],
  );

  const dismiss = useCallback(() => setOpen(false), []);

  // Reset session flag when user changes
  useEffect(() => {
    claimedThisSession.current = false;
  }, [user?.id]);

  return { open, result, claim, dismiss };
}
