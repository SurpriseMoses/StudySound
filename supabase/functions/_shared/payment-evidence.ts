// Only evidence returned by Paystack's authenticated verification endpoint is accepted.
export type PaymentEvidence = {
  reference: string; payment_id: string; status: "success";
  amount_cents: number; currency: "ZAR"; environment: "test" | "live";
  customer_email: string; customer_code: string; plan_code: string | null;
  paid_at: string;
};

export function paymentEnvironment(secret: string): "test" | "live" {
  if (secret.startsWith("sk_test_")) return "test";
  if (secret.startsWith("sk_live_")) return "live";
  throw new Error("Unrecognised payment credential environment");
}

export function verifiedPaymentEvidence(reference: string, tx: any, environment: "test" | "live"): PaymentEvidence {
  if (!/^[a-zA-Z0-9_.-]{1,200}$/.test(reference) || tx?.reference !== reference) throw new Error("Payment reference mismatch");
  if (tx?.status !== "success") throw new Error("Payment is not successful");
  if (tx?.domain !== environment) throw new Error("Payment environment mismatch");
  if (!Number.isSafeInteger(tx?.amount) || tx.amount <= 0 || tx.currency !== "ZAR") throw new Error("Invalid payment amount or currency");
  const id = tx?.id;
  if (!(typeof id === "number" && Number.isSafeInteger(id) && id > 0) && !(typeof id === "string" && /^[1-9][0-9]{0,30}$/.test(id))) throw new Error("Missing provider payment identity");
  const email = tx?.customer?.email;
  const customer = tx?.customer?.customer_code;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof customer !== "string" || !/^CUS_[a-zA-Z0-9]+$/.test(customer)) throw new Error("Missing verified customer identity");
  const paidAt = tx?.paid_at ?? tx?.paidAt;
  if (typeof paidAt !== "string" || !Number.isFinite(Date.parse(paidAt)) || Date.parse(paidAt) > Date.now() + 300000) throw new Error("Invalid payment date");
  const planCode = typeof tx?.plan === "string" ? tx.plan : tx?.plan?.plan_code ?? tx?.plan_object?.plan_code ?? null;
  if (planCode !== null && (typeof planCode !== "string" || !/^PLN_[a-zA-Z0-9]+$/.test(planCode))) throw new Error("Invalid payment plan");
  return { reference, payment_id: String(id), status: "success", amount_cents: tx.amount, currency: "ZAR", environment,
    customer_email: email.trim().toLowerCase(), customer_code: customer, plan_code: planCode, paid_at: new Date(paidAt).toISOString() };
}