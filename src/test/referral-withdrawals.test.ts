import { describe, expect, it } from "vitest";
import { commissionTotals, validateWithdrawal, withdrawalNextStates } from "../../supabase/functions/_shared/referral-rules";
import { parseWithdrawalCents } from "@/lib/referral-financials";

describe("manual withdrawal safety rules", () => {
  it("accepts exactly R50 and rejects R49.99", () => {
    expect(parseWithdrawalCents("50.00")).toBe(5000);
    expect(() => validateWithdrawal(5000, 5000)).not.toThrow();
    expect(() => validateWithdrawal(5000, 4999)).toThrow();
  });
  it("does not round sub-cent withdrawals", () => expect(parseWithdrawalCents("50.001")).toBeNull());
  it("requires requested then under review before approval", () => {
    expect(withdrawalNextStates("requested")).toEqual(["under_review", "rejected"]);
    expect(withdrawalNextStates("under_review")).toEqual(["approved", "rejected"]);
  });
  it("requires approval before processing and confirmation before paid", () => {
    expect(withdrawalNextStates("approved")).toEqual(["processing", "rejected"]);
    expect(withdrawalNextStates("processing")).toEqual(["paid"]);
  });
  it("never releases potentially transferred processing funds through generic rejection", () => expect(withdrawalNextStates("processing")).not.toContain("rejected"));
  it.each(["paid", "rejected"] as const)("treats %s as terminal", status => expect(withdrawalNextStates(status)).toEqual([]));
  const base = { availableEarnedCents: 10000, pendingCents: 395, reservedCents: 5000, paidCents: 0, reversedCents: 0 };
  it("subtracts reservations from spendable earnings without spending pending money", () => expect(commissionTotals(base)).toMatchObject({ availableCents: 5000, pendingCents: 395 }));
  it("rejection restores available commission by excluding the rejected reservation", () => expect(commissionTotals({ ...base, reservedCents: 0 }).availableCents).toBe(10000));
  it("confirmed paid amounts remain unavailable after the reservation closes", () => expect(commissionTotals({ ...base, reservedCents: 0, paidCents: 5000 }).availableCents).toBe(5000));
  it("reversed paid commissions become recovery liability, not negative spendable funds", () => expect(commissionTotals({ ...base, availableEarnedCents: 0, reservedCents: 0, paidCents: 5000, reversedCents: 10000 })).toMatchObject({ availableCents: 0, recoveryCents: 5000 }));
});