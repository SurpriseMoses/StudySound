import { createContext, useContext, ReactNode } from "react";
import { useProgression, ProgressionState } from "@/hooks/use-progression";

const ProgressionCtx = createContext<ProgressionState | null>(null);

export function ProgressionProvider({ children }: { children: ReactNode }) {
  const value = useProgression();
  return <ProgressionCtx.Provider value={value}>{children}</ProgressionCtx.Provider>;
}

export function useProgressionContext(): ProgressionState {
  const ctx = useContext(ProgressionCtx);
  if (!ctx) {
    // Safe no-op fallback for routes outside AppLayout (auth pages)
    return {
      xp: 0,
      level: 1,
      loading: false,
      pendingLevelUp: null,
      awardXp: async () => null,
      flushLevelUp: () => {},
      dismissLevelUp: () => {},
      reload: async () => {},
    };
  }
  return ctx;
}
