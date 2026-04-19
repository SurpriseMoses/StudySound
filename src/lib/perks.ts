// Level-based perks. Surfaced on level-up + in the Profile progression panel.
// Revenue-safe: no credit-pack discounts, no unlimited feature unlocks.
import { Languages, Sparkles, Zap, Gift, Coins, RotateCcw, Star, Crown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type Perk = {
  level: number;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Stable key for code that needs to gate functionality on a perk. */
  key: string;
};

export const PERKS: Perk[] = [
  {
    level: 3,
    key: "daily_credit_bonus_1",
    title: "Daily credit bonus",
    description: "Earn +1 extra credit on your daily reward",
    icon: Coins,
  },
  {
    level: 5,
    key: "xp_boost_10",
    title: "XP boost",
    description: "Earn 10% bonus XP on every learning action",
    icon: Zap,
  },
  {
    level: 7,
    key: "extra_translation_slot",
    title: "Extra translation language",
    description: "Unlock one additional translation language slot",
    icon: Languages,
  },
  {
    level: 10,
    key: "quiz_retry_bonus",
    title: "Quiz retry bonus",
    description: "Retry a failed quiz once per day for half cost",
    icon: RotateCcw,
  },
  {
    level: 15,
    key: "daily_credit_bonus_2",
    title: "Bigger daily bonus",
    description: "Earn +2 extra credits on your daily reward",
    icon: Gift,
  },
  {
    level: 20,
    key: "xp_boost_20",
    title: "XP boost upgrade",
    description: "Earn 20% bonus XP on every learning action",
    icon: Sparkles,
  },
  {
    level: 30,
    key: "scholar_badge",
    title: "Scholar badge",
    description: "Display a Scholar badge on your profile",
    icon: Star,
  },
  {
    level: 50,
    key: "founder_badge",
    title: "Master Scholar badge",
    description: "Display the prestigious Master Scholar badge",
    icon: Crown,
  },
];

/** Perks unlocked when crossing from `fromLevel` to `toLevel` (exclusive of from, inclusive of to). */
export function perksUnlockedBetween(fromLevel: number, toLevel: number): Perk[] {
  return PERKS.filter((p) => p.level > fromLevel && p.level <= toLevel);
}

/** All perks already unlocked at this level. */
export function unlockedPerks(level: number): Perk[] {
  return PERKS.filter((p) => p.level <= level);
}

/** Next perks the user hasn't unlocked yet. */
export function nextPerks(level: number, count = 3): Perk[] {
  return PERKS.filter((p) => p.level > level).slice(0, count);
}

/** True if the user has unlocked a given perk key. */
export function hasPerk(level: number, key: string): boolean {
  const perk = PERKS.find((p) => p.key === key);
  return !!perk && level >= perk.level;
}
