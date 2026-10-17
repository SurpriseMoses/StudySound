import { describe, expect, it } from "vitest";
import { allocateOperationCost, oldestEligibleAllocation, type CreditLot } from "../../supabase/functions/_shared/credit-source-rules";

const now = "2026-10-17T22:00:00Z";
const lots: CreditLot[] = [
  { id: "reward", source: "referral_milestone", remainingCredits: 10, issuedAt: "2026-10-16T00:00:00Z", expiresAt: null },
  { id: "purchase", source: "top_up", remainingCredits: 4, issuedAt: "2026-10-15T00:00:00Z", expiresAt: null },
];

describe("source-aware credit allocation", () => {
  it("spends oldest eligible credits across sources", () => {
    expect(oldestEligibleAllocation(lots, 6, now)).toEqual([
      { lotId: "purchase", source: "top_up", credits: 4 },
      { lotId: "reward", source: "referral_milestone", credits: 2 },
    ]);
  });
  it("does not erase purchased credits when promotional credits expire", () => {
    const expired: CreditLot = { id: "expired", source: "promotional", remainingCredits: 100, issuedAt: "2026-10-01T00:00:00Z", expiresAt: now };
    expect(oldestEligibleAllocation([expired, ...lots], 4, now)).toEqual([{ lotId: "purchase", source: "top_up", credits: 4 }]);
    expect(lots[1].remainingCredits).toBe(4);
  });
  it("rejects future-issued lots", () => {
    expect(() => oldestEligibleAllocation([{ ...lots[0], issuedAt: "2026-10-18T00:00:00Z" }], 1, now)).toThrow("Insufficient");
  });
  it("fails the entire allocation when funds are insufficient", () => expect(() => oldestEligibleAllocation(lots, 15, now)).toThrow("Insufficient"));
  it("rejects duplicate lots rather than double-counting their balance", () => expect(() => oldestEligibleAllocation([lots[0], lots[0]], 11, now)).toThrow("Duplicate"));
  it("preserves legacy funds without inventing their original source", () => {
    expect(oldestEligibleAllocation([{ ...lots[1], source: "legacy_unreconciled" }], 1, now)[0].source).toBe("legacy_unreconciled");
  });
  it("attributes a single new-generation cost exactly once across funding sources", () => {
    const result = allocateOperationCost(101, oldestEligibleAllocation(lots, 6, now), true);
    expect(result.map((part) => part.costMinorUnits)).toEqual([67, 34]);
    expect(result.reduce((sum, part) => sum + part.costMinorUnits, 0)).toBe(101);
  });
  it("does not invent generation cost for cached replay", () => {
    expect(allocateOperationCost(0, oldestEligibleAllocation(lots, 6, now), false).every((part) => part.costMinorUnits === 0)).toBe(true);
    expect(() => allocateOperationCost(100, oldestEligibleAllocation(lots, 6, now), false)).toThrow("Cache-only");
  });
  it("retains actual failed-call costs when a billable call occurred", () => {
    expect(allocateOperationCost(25, [{ lotId: "reward", source: "ambassador_bonus", credits: 1 }], true)[0].costMinorUnits).toBe(25);
  });
  it("does not attribute unlinked provider costs to referral credits", () => expect(() => allocateOperationCost(25, [], true)).toThrow("requires spent"));
});