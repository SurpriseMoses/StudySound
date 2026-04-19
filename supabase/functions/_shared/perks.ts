// Server-side perk helpers. Mirror src/lib/perks.ts but kept minimal —
// only perks that affect rewards/XP server-side live here.

export type Plan = "free" | "essential" | "premium" | null | undefined;

export function isPaidPlan(plan: Plan): boolean {
  return plan === "essential" || plan === "premium";
}

/** XP multiplier from level-based XP boost perks. */
export function xpBoostMultiplier(level: number): number {
  if (level >= 20) return 1.2; // xp_boost_20
  if (level >= 5) return 1.1;  // xp_boost_10
  return 1.0;
}

/**
 * Extra daily-reward credits granted by the daily-credit-bonus perks.
 * Paid plans only — keeps the perk as a clear upgrade-value moment.
 */
export function dailyCreditBonus(level: number, plan: Plan): number {
  if (!isPaidPlan(plan)) return 0;
  if (level >= 15) return 2; // daily_credit_bonus_2
  if (level >= 3) return 1;  // daily_credit_bonus_1
  return 0;
}
