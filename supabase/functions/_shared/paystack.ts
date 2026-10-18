// Shared Paystack helpers: verification, plan codes + idempotent credit granting.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { type PlanDef } from "./plans.ts";
import { paymentEnvironment, verifiedPaymentEvidence } from "./payment-evidence.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
export { corsHeaders };

export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function paystackSecret(): string | null {
  return Deno.env.get("PAYSTACK_SECRET_KEY") ?? Deno.env.get("Patsack_Secret_Key") ?? null;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function paystackFetch(path: string, init?: RequestInit) {
  const key = paystackSecret();
  if (!key) throw new Error("PAYSTACK_SECRET_KEY not configured");
  const res = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export async function paystackVerify(reference: string) {
  const { ok, status, data } = await paystackFetch(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  if (!ok || data?.status !== true) throw new Error(`Paystack verification unavailable (${status})`);
  return data?.data ?? null;
}

/** Returns (creating if needed) the Paystack plan code for a subscription plan. */
export async function ensurePlanCode(plan: PlanDef): Promise<string> {
  const admin = adminClient();
  const { data: existing } = await admin
    .from("payment_plan_codes")
    .select("plan_code, amount_zar")
    .eq("plan_id", plan.id)
    .maybeSingle();

  if (existing?.plan_code && existing.amount_zar === plan.amountZar) {
    return existing.plan_code;
  }

  const { ok, data } = await paystackFetch("/plan", {
    method: "POST",
    body: JSON.stringify({
      name: `BrainGrasp ${plan.name}`,
      amount: Math.round(plan.amountZar * 100),
      interval: "monthly",
      currency: "ZAR",
    }),
  });
  const code = data?.data?.plan_code;
  if (!ok || !code) {
    throw new Error(data?.message ?? "Could not create subscription plan on Paystack");
  }

  await admin
    .from("payment_plan_codes")
    .upsert(
      { plan_id: plan.id, plan_code: code, amount_zar: plan.amountZar },
      { onConflict: "plan_id" },
    );

  return code as string;
}

/** Callback and webhook share the same purchase-bound atomic posting operation. */
export async function grantCreditsForReference(reference: string, payload: unknown) {
  const secret = paystackSecret();
  if (!secret) throw new Error("Payments are not configured");
  const evidence = verifiedPaymentEvidence(reference, payload, paymentEnvironment(secret));
  const { data, error } = await adminClient().rpc("payment_post_verified", { _evidence: evidence });
  if (error) throw new Error(error.message);
  if (!data || typeof data.status !== "string") throw new Error("Payment posting outcome unavailable");
  return data as { credited: boolean; credits: number; status: string; balance?: number };
}

export async function markFailed(reference: string, payload: unknown) {
  const admin = adminClient();
  await admin
    .from("credit_purchases")
    .update({ status: "failed", paystack_payload: payload ?? null })
    .eq("reference", reference)
    .eq("credited", false);
}
