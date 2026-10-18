import { describe, it, expect } from "vitest";
import { cohortScenario, rewardExposure, Scenario } from "../lib/reward-cost-model";
import { extractProviderUsage } from "../../supabase/functions/_shared/ai-cost-usage";
const fixture: Scenario = { subscribers: 50, premiumShare: 0, redeemedShare: 1, newGenerationShare: 1, newCostPerCredit: 1, cachedCostPerCredit: 0, feePercent: 0, feePerPayment: 0, otherVariablePerSubscriber: 0, creditsPerRand: 1, safetyMargin: 0.25 };
describe("Reward audit assumptions (synthetic fixtures, not production evidence)", () => {
  it("preserves Essential R79 and 110 credits for 50 subscribers", () => { const r = cohortScenario(fixture); expect(r.normalRevenue).toBe(3950); expect(r.credits).toBe(5500); expect(r.collectedScenario).toBe(3555); expect(r.commissions).toBe(197.5); });
  it("preserves Premium R149 and 220 credits", () => { const r = cohortScenario({ ...fixture, premiumShare: 1 }); expect(r.credits).toBe(11000); expect(r.collectedScenario).toBe(6705); expect(r.commissions).toBe(372.5); });
  it("models seven R79 awards and the one-time R149 bonus separately", () => { expect(rewardExposure(2, 0.5, 0.25)).toEqual({ standardCredits: 158, ambassadorCredits: 298, annualCredits: 1404, annualCost: 702, annualReserve: 877.5 }); });
  it("does not invent conversion or a contribution margin with missing costs", () => { expect(rewardExposure(null, 1, 0)).toBeNull(); expect(cohortScenario({ ...fixture, feePercent: null }).contribution).toBeNull(); });
  it("caps standard awards at seven for 1,000 referrals to one referrer", () => { const r = cohortScenario({ ...fixture, subscribers: 1000 }); expect(r.standardAwards).toBe(7); expect(r.rewardCredits).toBe(702); });
  it("does not charge cached usage as new generation in the scenario", () => { expect(cohortScenario({ ...fixture, newGenerationShare: 0 }).ai).toBe(0); });
  it("keeps provider units separate from costs", () => { const r = extractProviderUsage({ usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 90, thoughtsTokenCount: 4 } }); expect(r.input_tokens).toBe(30); expect(r.output_tokens).toBe(90); expect(r).not.toHaveProperty("reported_cost"); });
  it("missing usage remains null", () => { expect(extractProviderUsage({}).input_tokens).toBeNull(); });
});