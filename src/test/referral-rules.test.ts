import { describe, expect, it } from "vitest";
import {
  REFERRAL_DEFAULTS, businessCalendarYear, milestoneCandidates, qualifiesForCommission,
  reserveForecast, rewardCreditAmount, subscriptionReferralQuote, validateWithdrawal,
} from "../../supabase/functions/_shared/referral-rules";

const candidate = {
  confirmed: true, firstSubscriptionPayment: true, environment: "live" as const,
  selfReferral: false, duplicateIdentity: false, fraud: false, refunded: false,
  chargedBack: false, currency: "ZAR", confirmedAmountCents: 7110, expectedAmountCents: 7110,
};
const milestones = (lifetimeSuccessful: number, standardAwardsThisYear = 0, standardThresholdsAlreadyAwarded: number[] = [], ambassadorAlreadyAwarded = false) =>
  milestoneCandidates({ lifetimeSuccessful, standardAwardsThisYear, standardThresholdsAlreadyAwarded, ambassadorAlreadyAwarded });

describe("server-side referral economics", () => {
  it("quotes Essential at R71.10 with R3.95 commission", () => {
    expect(subscriptionReferralQuote({ normalPriceCents: 7900, firstEligiblePayment: true }))
      .toMatchObject({ discountCents: 790, payableCents: 7110, commissionCents: 395 });
  });
  it("quotes Premium at R134.10 with R7.45 commission", () => {
    expect(subscriptionReferralQuote({ normalPriceCents: 14900, firstEligiblePayment: true }))
      .toMatchObject({ discountCents: 1490, payableCents: 13410, commissionCents: 745 });
  });
  it("does not discount or commission renewals", () => {
    expect(subscriptionReferralQuote({ normalPriceCents: 7900, firstEligiblePayment: false }))
      .toMatchObject({ discountCents: 0, payableCents: 7900, commissionCents: 0 });
    expect(qualifiesForCommission({ ...candidate, firstSubscriptionPayment: false })).toBe(false);
  });
  it("supports an explicitly configured paid-price commission basis", () => {
    expect(subscriptionReferralQuote({ normalPriceCents: 7900, firstEligiblePayment: true, commissionBasis: "paid_price" }).commissionCents).toBe(356);
  });
  it("accepts a confirmed eligible live first payment", () => expect(qualifiesForCommission(candidate)).toBe(true));
  it.each(["selfReferral", "duplicateIdentity", "fraud", "refunded", "chargedBack"] as const)("rejects %s", (rule) => {
    expect(qualifiesForCommission({ ...candidate, [rule]: true })).toBe(false);
  });
  it("excludes test transactions", () => expect(qualifiesForCommission({ ...candidate, environment: "test" })).toBe(false));
  it("excludes unconfirmed payments", () => expect(qualifiesForCommission({ ...candidate, confirmed: false })).toBe(false));
  it("rejects mismatched provider amounts", () => expect(qualifiesForCommission({ ...candidate, confirmedAmountCents: 7100 })).toBe(false));
  it("rejects a non-ZAR transaction", () => expect(qualifiesForCommission({ ...candidate, currency: "USD" })).toBe(false));
  it("requires R50 for withdrawal", () => {
    expect(() => validateWithdrawal(4999, 4999)).toThrow();
    expect(() => validateWithdrawal(5000, 5000)).not.toThrow();
  });
  it("does not permit spending reserved/unavailable funds", () => expect(() => validateWithdrawal(5000, 5001)).toThrow());
  it("requires confirmed reward conversion, not an assumed R1 rate", () => expect(() => rewardCreditAmount(7900, null)).toThrow());
  it("converts the configured R79 reward rate explicitly", () => expect(rewardCreditAmount(7900, 2)).toBe(158));
  it("rejects unsupported fractional wallet credit amounts", () => expect(() => rewardCreditAmount(7900, 1.1)).toThrow());
});

describe("lifetime milestones and South African annual eligibility", () => {
  it.each([50, 100, 150])("qualifies each 50-referral threshold through %i", (count) => {
    expect(milestones(count).standardThresholds).toEqual(Array.from({ length: count / 50 }, (_, i) => (i + 1) * 50));
  });
  it("at 300 qualifies six standard rewards and the separate Ambassador bonus", () => {
    expect(milestones(300)).toMatchObject({ standardThresholds: [50, 100, 150, 200, 250, 300], standardValueCents: 47400, ambassadorEligible: true });
    expect(REFERRAL_DEFAULTS.ambassadorValueCents).toBe(14900);
  });
  it("caps standard awards at seven and R553 even across many thresholds", () => {
    expect(milestones(1000).standardThresholds).toHaveLength(7);
    expect(milestones(1000).standardValueCents).toBe(55300);
    expect(milestones(1000, 7).standardThresholds).toEqual([]);
  });
  it("never includes an already-awarded milestone", () => expect(milestones(150, 2, [50, 100]).standardThresholds).toEqual([150]));
  it("does not qualify Ambassador twice", () => expect(milestones(1000, 7, [], true).ambassadorEligible).toBe(false));
  it("keeps the separate Ambassador bonus eligible at the annual cap", () => expect(milestones(300, 7).ambassadorEligible).toBe(true));
  it("uses midnight Johannesburg rather than midnight UTC for rollover", () => {
    expect(businessCalendarYear("2026-12-31T21:59:59Z")).toBe(2026);
    expect(businessCalendarYear("2026-12-31T22:00:00Z")).toBe(2027);
  });
  it("new-year allowance evaluates retained lifetime milestones without resetting totals or badge", () => {
    const priorAwards = [50, 100, 150, 200, 250, 300, 350];
    expect(milestones(450, 7, priorAwards, true).standardThresholds).toEqual([]);
    expect(milestones(450, 0, priorAwards, true)).toMatchObject({ standardThresholds: [400, 450], nextThreshold: 500, ambassadorEligible: false });
  });
});

describe("AI reserve forecasts distinguish evidence from estimates", () => {
  const input = {
    attributedUsedCostCents: 1000, outstandingCredits: 100, expectedUsageBasisPoints: 5000,
    estimatedCostPerUsedCreditCents: 10, pendingJobCostCents: 500, safetyMarginBasisPoints: 2000,
    fundedReserveCents: 2000, providerReportedExpenditureCents: null, monthlyBudgetCents: 5000,
  };
  it("uses expected redemption and safety margin, not credit face value", () => {
    expect(reserveForecast(input)).toMatchObject({ futureCostCents: 500, estimatedRequiredCents: 2400, availableReserveCents: 1000, shortfallCents: 400 });
  });
  it("does not invent actual provider expenditure or a budget state", () => {
    expect(reserveForecast(input)).toMatchObject({ budgetReached: null, providerUsageReconciled: false });
  });
  it("flags a monthly budget reached from recorded expenditure", () => {
    expect(reserveForecast({ ...input, providerReportedExpenditureCents: 5000 })).toMatchObject({ budgetReached: true, providerUsageReconciled: true });
  });
});