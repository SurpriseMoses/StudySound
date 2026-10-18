import { describe, expect, it } from "vitest";
import { checkoutCallback, paymentEnvironment, verifiedPaymentEvidence } from "../../supabase/functions/_shared/payment-evidence";
import { getPlan } from "../../supabase/functions/_shared/plans";
import { getPack } from "../../supabase/functions/_shared/credit-packs";

const tx = { id: 123, reference: "sandbox_123", status: "success", domain: "test", amount: 5000, currency: "ZAR",
  customer: { email: "learner@example.test", customer_code: "CUS_example" }, paid_at: "2026-01-01T12:00:00Z", plan: null };
describe("provider payment evidence", () => {
  it("rejects checkout returns outside the requesting app origin", () => {
    expect(() => checkoutCallback("https://other.example/payment/callback", "https://app.example")).toThrow();
    expect(checkoutCallback("https://app.example/payment/callback?kind=plan", "https://app.example")).toBe("https://app.example/payment/callback?kind=plan");
  });
  it("uses provider identity and units, never metadata credit or user claims", () => {
    expect(verifiedPaymentEvidence(tx.reference, { ...tx, metadata: { credits: 999999, user_id: "attacker" } }, "test"))
      .toMatchObject({ payment_id: "123", amount_cents: 5000, customer_email: "learner@example.test", environment: "test" });
  });
  for (const [field, value] of Object.entries({ reference: "different", status: "failed", domain: "live", amount: 50.5, currency: "USD", id: null, customer: {}, paid_at: "invalid" })) {
    it(`rejects invalid provider ${field}`, () => expect(() => verifiedPaymentEvidence(tx.reference, { ...tx, [field]: value }, "test")).toThrow());
  }
  it("does not guess unrecognised credential environments", () => expect(() => paymentEnvironment("unknown")).toThrow());
  it("preserves Essential R79 and 110 monthly credits", () => expect(getPlan("essential")).toMatchObject({ amountZar: 79, monthlyCredits: 110 }));
  it("preserves Premium R149 and 220 monthly credits", () => expect(getPlan("premium")).toMatchObject({ amountZar: 149, monthlyCredits: 220 }));
  for (const [id, amount, credits] of [["starter", 50, 40], ["popular", 100, 110], ["power", 200, 220]] as const) {
    it(`preserves ${id} top-up`, () => { const pack = getPack(id); expect(pack?.amountZar).toBe(amount); expect((pack?.credits ?? 0) + (pack?.bonus ?? 0)).toBe(credits); });
  }
});