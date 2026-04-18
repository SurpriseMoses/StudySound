// Shared XP/level math — must mirror supabase/functions/award-xp/index.ts
// Classic RPG curve: T(n) = 100*(n-1) + 50*(n-1)*(n-2)
export function xpThreshold(level: number): number {
  if (level <= 1) return 0;
  return 100 * (level - 1) + 50 * (level - 1) * (level - 2);
}

export function levelForXp(xp: number): number {
  let lvl = 1;
  while (xpThreshold(lvl + 1) <= xp) lvl += 1;
  return lvl;
}

export function levelProgress(xp: number) {
  const level = levelForXp(xp);
  const current = xpThreshold(level);
  const next = xpThreshold(level + 1);
  const into = xp - current;
  const span = next - current;
  return {
    level,
    xp,
    currentLevelXp: current,
    nextLevelXp: next,
    xpIntoLevel: into,
    xpForNext: span,
    pct: span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 0,
  };
}

export function quizBonusCredits(scorePct: number): number {
  if (scorePct >= 85) return 3;
  if (scorePct >= 70) return 2;
  if (scorePct >= 50) return 1;
  return 0;
}

export function quizBonusLabel(scorePct: number): string {
  if (scorePct >= 85) return "Excellent — top reward unlocked";
  if (scorePct >= 70) return "Strong score — nice bonus";
  if (scorePct >= 50) return "Good effort — small bonus earned";
  return "Keep practising — review and try again";
}
