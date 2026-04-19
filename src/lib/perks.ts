// Level-based perks. Surfaced on level-up + in the Profile progression panel.
// Keep purely declarative — actual enforcement lives wherever the perk applies.
import { Languages, Percent, Sparkles, Zap, Crown, Star, Gift, Rocket } from "lucide-react";
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
    level: 2,
    key: "daily_streak_boost",
    title: "Streak booster",
    description: "Daily reward credits scale faster with your streak",
    icon: Sparkles,
  },
  {
    level: 5,
    key: "extra_translation_slot",
    title: "Extra translation language",
    description: "Unlock one additional translation language slot",
    icon: Languages,
  },
  {
    level: 7,
    key: "priority_audio",
    title: "Priority audio generation",
    description: "Your audio jobs jump to the front of the queue",
    icon: Zap,
  },
  {
    level: 10,
    key: "credit_pack_discount",
    title: "10% off credit packs",
    description: "Permanent discount on every credit top-up",
    icon: Percent,
  },
  {
    level: 15,
    key: "bonus_quiz_credit",
    title: "Bonus quiz reward",
    description: "+1 extra credit on every quiz scoring 70% or higher",
    icon: Gift,
  },
  {
    level: 20,
    key: "premium_voices",
    title: "Premium voice library",
    description: "Access expressive narration voices on every lesson",
    icon: Star,
  },
  {
    level: 30,
    key: "unlimited_translations",
    title: "Unlimited translation slots",
    description: "Translate to any supported language without limits",
    icon: Rocket,
  },
  {
    level: 50,
    key: "founder_badge",
    title: "Scholar badge",
    description: "Display a Scholar badge on your profile",
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
