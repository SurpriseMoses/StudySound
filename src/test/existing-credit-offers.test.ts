import { describe, expect, it } from "vitest";
import { PLAN_OPTIONS } from "../lib/plans";
import { CREDIT_PACKS as UI_PACKS } from "../lib/credit-packs";
import { PLANS } from "../../supabase/functions/_shared/plans";
import { CREDIT_PACKS as SERVER_PACKS } from "../../supabase/functions/_shared/credit-packs";
import { rewardCreditAmount } from "../../supabase/functions/_shared/referral-rules";

describe("preserve existing offers independently of referral conversion", () => {
  it("preserves Essential R79 and 110 monthly credits", () => {
    expect(PLANS.essential).toMatchObject({ amountZar: 79, monthlyCredits: 110 });
    expect(PLAN_OPTIONS.find((p) => p.id === "essential")).toMatchObject({ amountZar: 79, monthlyCredits: 110 });
  });
  it("preserves Premium R149 and 220 monthly credits", () => {
    expect(PLANS.premium).toMatchObject({ amountZar: 149, monthlyCredits: 220 });
    expect(PLAN_OPTIONS.find((p) => p.id === "premium")).toMatchObject({ amountZar: 149, monthlyCredits: 220 });
  });
  it.each([
    ["starter", 50, 40, 0], ["popular", 100, 100, 10], ["power", 200, 220, 0],
  ] as const)("preserves %s top-up price and credits", (id, amountZar, credits, bonus) => {
    expect(SERVER_PACKS[id]).toMatchObject({ amountZar, credits, bonus });
    const ui = UI_PACKS.find((p) => p.id === id);
    expect(ui).toMatchObject({ amountZar, credits });
    expect(ui?.bonus ?? 0).toBe(bonus);
  });
  it("does not default a missing promotional conversion to the reporting rate", () => {
    expect(() => rewardCreditAmount(7900, null)).toThrow("Administrator-confirmed");
    expect(() => rewardCreditAmount(14900, null)).toThrow("Administrator-confirmed");
  });
  it("supports 79 and 149 credits only when a 1-credit-per-rand rate is explicitly configured", () => {
    expect(rewardCreditAmount(7900, 1)).toBe(79);
    expect(rewardCreditAmount(14900, 1)).toBe(149);
    expect(PLANS.essential.monthlyCredits).toBe(110);
    expect(PLANS.premium.monthlyCredits).toBe(220);
  });
});