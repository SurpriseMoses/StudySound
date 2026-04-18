import { createContext, useContext, ReactNode } from "react";
import { useDailyReward, RewardTrigger, RewardResult } from "@/hooks/use-daily-reward";

type Ctx = {
  open: boolean;
  result: RewardResult | null;
  claim: (trigger: RewardTrigger) => Promise<void>;
  dismiss: () => void;
};

const DailyRewardCtx = createContext<Ctx | null>(null);

export function DailyRewardProvider({ children }: { children: ReactNode }) {
  const value = useDailyReward();
  return <DailyRewardCtx.Provider value={value}>{children}</DailyRewardCtx.Provider>;
}

export function useDailyRewardContext(): Ctx {
  const ctx = useContext(DailyRewardCtx);
  if (!ctx) {
    // Safe no-op outside layout (e.g. auth pages)
    return {
      open: false,
      result: null,
      claim: async () => {},
      dismiss: () => {},
    };
  }
  return ctx;
}
