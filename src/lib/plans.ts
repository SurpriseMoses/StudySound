// Subscription plans shown in the UI.
// Mirrors supabase/functions/_shared/plans.ts — keep values identical.
export type PlanId = "essential" | "premium";

export type PlanOption = {
  id: PlanId;
  name: string;
  price: string;
  amountZar: number;
  monthlyCredits: number;
  period: string;
  desc: string;
  features: string[];
  popular?: boolean;
};

export const PLAN_OPTIONS: PlanOption[] = [
  {
    id: "essential",
    name: "Essential",
    price: "R79",
    amountZar: 79,
    monthlyCredits: 110,
    period: "/month",
    desc: "For learners who prefer listening and practising",
    features: [
      "110 credits every month (~2–3 books)",
      "Daily streak rewards (1–5 credits/day)",
      "Bonus credits as you level up",
      "Audio + Quiz + Translation",
      "Multilingual voices",
      "Offline study mode",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    price: "R149",
    amountZar: 149,
    monthlyCredits: 220,
    period: "/month",
    desc: "Full audio-visual learning experience",
    features: [
      "220 credits every month (~5–6 books)",
      "Daily streak rewards + bigger bonus",
      "Audio + Quiz + Visuals",
      "Visual scenes for novels & history",
      "Priority processing",
      "Offline study mode",
      "Custom study packs",
    ],
    popular: true,
  },
];
