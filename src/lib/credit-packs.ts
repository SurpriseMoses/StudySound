// Credit packs shown in the top-up UI.
// Mirrors supabase/functions/_shared/credit-packs.ts — keep values identical.
export type CreditPack = {
  id: "starter" | "popular" | "power";
  credits: number;
  bonus?: number;
  amountZar: number;
  price: string;
  tagline: string;
  popular?: boolean;
};

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "starter",
    credits: 40,
    amountZar: 50,
    price: "R50",
    tagline: "1–2 study sessions, great for quick revision",
  },
  {
    id: "popular",
    credits: 100,
    bonus: 10,
    amountZar: 100,
    price: "R100",
    tagline: "2–3 lessons or books, most popular choice",
    popular: true,
  },
  {
    id: "power",
    credits: 220,
    amountZar: 200,
    price: "R200",
    tagline: "5–6 lessons or full study coverage",
  },
];
