// Canonical credit packs — server-side source of truth.
// Prices/credits must match src/lib/credit-packs.ts. Do not change values.
export type CreditPack = {
  id: string;
  credits: number;
  bonus: number;
  amountZar: number;
};

export const CREDIT_PACKS: Record<string, CreditPack> = {
  starter: { id: "starter", credits: 40, bonus: 0, amountZar: 50 },
  popular: { id: "popular", credits: 100, bonus: 10, amountZar: 100 },
  power: { id: "power", credits: 220, bonus: 0, amountZar: 200 },
};

export function getPack(id: unknown): CreditPack | null {
  if (typeof id !== "string") return null;
  return CREDIT_PACKS[id] ?? null;
}
