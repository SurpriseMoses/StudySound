import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Approx credit cost per section by feature
const COST_PER_SECTION = { audio: 1, quiz: 1, visuals: 2 };

// Roughly 1 audio "section" ≈ ~2000 chars of clean text
const CHARS_PER_SECTION = 2000;

export type CreditEstimate = {
  totalSections: number;
  unlockedSections: number;
  remainingSections: number;
  creditsNeeded: number;          // remaining audio credits only (most common case)
  creditsNeededFull: number;      // audio + quiz + visuals
  balance: number;
  status: "enough" | "close" | "short";
  message: string;
  shortage: number;               // credits missing to finish
  recommendedPack: "starter" | "popular" | "power" | null;
  loading: boolean;
};

const PACK_THRESHOLDS = [
  { id: "starter" as const, credits: 40 },
  { id: "popular" as const, credits: 110 },   // 100 + 10 bonus
  { id: "power" as const, credits: 220 },
];

function recommendPack(shortage: number): CreditEstimate["recommendedPack"] {
  if (shortage <= 0) return null;
  for (const p of PACK_THRESHOLDS) if (p.credits >= shortage) return p.id;
  return "power";
}

function buildMessage(remaining: number, balance: number, audioCost: number) {
  if (remaining === 0) return "You're all caught up on this book";
  if (balance >= audioCost) return "You're good to continue";
  if (balance >= Math.ceil(audioCost / 2)) return "You can finish most of this book";
  return "You need more credits to finish this book";
}

function statusFor(balance: number, audioCost: number): CreditEstimate["status"] {
  if (balance >= audioCost) return "enough";
  if (balance >= Math.ceil(audioCost / 2)) return "close";
  return "short";
}

export function useCreditEstimate(documentId: string | null | undefined): CreditEstimate {
  const { user } = useAuth();
  const [state, setState] = useState<CreditEstimate>({
    totalSections: 0,
    unlockedSections: 0,
    remainingSections: 0,
    creditsNeeded: 0,
    creditsNeededFull: 0,
    balance: 0,
    status: "enough",
    message: "",
    shortage: 0,
    recommendedPack: null,
    loading: true,
  });

  useEffect(() => {
    if (!documentId || !user) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    let cancelled = false;
    (async () => {
      const [{ data: doc }, { data: profile }, { data: unlocked }] = await Promise.all([
        supabase.from("documents").select("char_count").eq("id", documentId).maybeSingle(),
        supabase.from("profiles").select("credits_balance").eq("user_id", user.id).maybeSingle(),
        supabase
          .from("user_chunk_access")
          .select("chunk_index", { count: "exact", head: false })
          .eq("user_id", user.id)
          .eq("document_id", documentId)
          .eq("asset_type", "audio"),
      ]);
      if (cancelled) return;

      const totalSections = Math.max(1, Math.ceil((doc?.char_count ?? 0) / CHARS_PER_SECTION));
      const unlockedSections = Math.min(totalSections, unlocked?.length ?? 0);
      const remainingSections = Math.max(0, totalSections - unlockedSections);
      const balance = profile?.credits_balance ?? 0;

      const creditsNeeded = remainingSections * COST_PER_SECTION.audio;
      const creditsNeededFull =
        remainingSections * (COST_PER_SECTION.audio + COST_PER_SECTION.quiz + COST_PER_SECTION.visuals);

      const shortage = Math.max(0, creditsNeeded - balance);

      setState({
        totalSections,
        unlockedSections,
        remainingSections,
        creditsNeeded,
        creditsNeededFull,
        balance,
        status: statusFor(balance, creditsNeeded),
        message: buildMessage(remainingSections, balance, creditsNeeded),
        shortage,
        recommendedPack: recommendPack(shortage),
        loading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, user]);

  return state;
}

export const PACK_LABELS: Record<NonNullable<CreditEstimate["recommendedPack"]>, string> = {
  starter: "40 credits — R50",
  popular: "100 + 10 bonus — R100",
  power: "220 credits — R200",
};
