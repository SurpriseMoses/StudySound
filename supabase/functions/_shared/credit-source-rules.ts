// Allocation plans must execute under a wallet row lock in one transaction.
// These pure routines never mutate a wallet or establish financial eligibility.
export type CreditSource = "subscription" | "top_up" | "referral_milestone" | "ambassador_bonus" | "promotional" | "admin" | "legacy_unreconciled";
export type CreditLot = {
  id: string;
  source: CreditSource;
  remainingCredits: number;
  issuedAt: string;
  expiresAt: string | null;
};
export type CreditAllocation = { lotId: string; source: CreditSource; credits: number };

function creditInteger(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid credit amount");
  return value;
}
function time(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid credit timestamp");
  return timestamp;
}

export function oldestEligibleAllocation(lots: readonly CreditLot[], requestedCredits: number, now: string): CreditAllocation[] {
  creditInteger(requestedCredits);
  const at = time(now);
  const ids = new Set<string>();
  const eligible = lots.map((lot) => {
    if (!lot.id || ids.has(lot.id)) throw new Error("Duplicate or missing credit lot");
    ids.add(lot.id);
    creditInteger(lot.remainingCredits);
    return { lot, issued: time(lot.issuedAt), expires: lot.expiresAt === null ? null : time(lot.expiresAt) };
  }).filter(({ lot, issued, expires }) => lot.remainingCredits > 0 && issued <= at && (expires === null || expires > at))
    .sort((a, b) => a.issued - b.issued || a.lot.id.localeCompare(b.lot.id));
  let needed = requestedCredits;
  const allocations: CreditAllocation[] = [];
  for (const { lot } of eligible) {
    if (needed === 0) break;
    const credits = Math.min(needed, lot.remainingCredits);
    allocations.push({ lotId: lot.id, source: lot.source, credits });
    needed -= credits;
  }
  if (needed !== 0) throw new Error("Insufficient eligible credits");
  return allocations;
}

// Split one operation's recorded cost using largest remainders, preserving the
// exact integer minor-unit total. Call once per unique operation/cost record.
export function allocateOperationCost(costMinorUnits: number, allocations: readonly CreditAllocation[], billableCallMade: boolean) {
  creditInteger(costMinorUnits);
  if (!billableCallMade && costMinorUnits !== 0) throw new Error("Cache-only operation cannot have new provider cost");
  const totalCredits = allocations.reduce((sum, allocation) => sum + creditInteger(allocation.credits), 0);
  if (!Number.isSafeInteger(totalCredits)) throw new Error("Allocation exceeds safe range");
  if (totalCredits === 0) {
    if (costMinorUnits !== 0) throw new Error("Cost attribution requires spent credits");
    return [];
  }
  const parts = allocations.map((allocation, index) => {
    const product = costMinorUnits * allocation.credits;
    if (!Number.isSafeInteger(product)) throw new Error("Cost exceeds safe range");
    return { ...allocation, costMinorUnits: Math.floor(product / totalCredits), remainder: product % totalCredits, index };
  });
  let remaining = costMinorUnits - parts.reduce((sum, part) => sum + part.costMinorUnits, 0);
  const order = [...parts].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const part of order) {
    if (remaining === 0) break;
    part.costMinorUnits += 1;
    remaining -= 1;
  }
  return parts.map(({ remainder: _remainder, index: _index, ...part }) => part);
}