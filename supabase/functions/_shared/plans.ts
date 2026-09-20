// Canonical subscription plans — server-side source of truth.
// Prices match the Plans page / landing pricing. Monthly credit allowances mirror
// the equivalent credit packs (R100 pack = 110 credits, R200 pack = 220 credits).
export type PlanDef = {
  id: "essential" | "premium";
  name: string;
  amountZar: number;
  monthlyCredits: number;
};

export const PLANS: Record<string, PlanDef> = {
  essential: { id: "essential", name: "Essential", amountZar: 79, monthlyCredits: 110 },
  premium: { id: "premium", name: "Premium", amountZar: 149, monthlyCredits: 220 },
};

export function getPlan(id: unknown): PlanDef | null {
  if (typeof id !== "string") return null;
  return PLANS[id] ?? null;
}
