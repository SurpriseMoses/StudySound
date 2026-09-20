// Shared Paystack helpers: verification, plan codes + idempotent credit granting.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getPlan, type PlanDef } from "./plans.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-paystack-signature",
};

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
  if (!ok) throw new Error(`Paystack verify failed: ${status} ${JSON.stringify(data)}`);
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
      name: `StudySound ${plan.name}`,
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

/**
 * Grants credits for a successful transaction exactly once.
 * For subscription purchases it also activates the plan.
 */
export async function grantCreditsForReference(reference: string, payload: unknown) {
  const admin = adminClient();

  const { data: purchase } = await admin
    .from("credit_purchases")
    .select(
      "id, user_id, credits, bonus_credits, amount_zar, credited, status, pack_id, kind, plan_id",
    )
    .eq("reference", reference)
    .maybeSingle();

  if (!purchase) return { credited: false, credits: 0, status: "unknown" as const };

  const total = purchase.credits + (purchase.bonus_credits ?? 0);

  // Idempotency guard: only the first writer flips credited false -> true.
  const { data: claimed } = await admin
    .from("credit_purchases")
    .update({ status: "success", credited: true, paystack_payload: payload ?? null })
    .eq("id", purchase.id)
    .eq("credited", false)
    .select("id")
    .maybeSingle();

  if (!claimed) {
    return { credited: false, credits: total, status: "already_credited" as const };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("credits_balance")
    .eq("user_id", purchase.user_id)
    .maybeSingle();

  const next = (profile?.credits_balance ?? 0) + total;
  const profileUpdate: Record<string, unknown> = { credits_balance: next };
  if (purchase.kind === "subscription" && purchase.plan_id) {
    profileUpdate.plan = purchase.plan_id;
  }

  await admin.from("profiles").update(profileUpdate).eq("user_id", purchase.user_id);

  if (purchase.kind === "subscription" && purchase.plan_id) {
    await activateSubscription(purchase.user_id, purchase.plan_id, payload);
  }

  await admin.from("credit_transactions").insert({
    user_id: purchase.user_id,
    amount: total,
    source: "purchase",
    feature_type: null,
    request_id: reference,
    metadata: {
      provider: "paystack",
      kind: purchase.kind,
      pack_id: purchase.pack_id,
      plan_id: purchase.plan_id,
      amount_zar: purchase.amount_zar,
      bonus_credits: purchase.bonus_credits,
    },
  }).then(() => {}, () => {});

  return {
    credited: true,
    credits: total,
    balance: next,
    kind: purchase.kind as string,
    plan_id: purchase.plan_id as string | null,
    status: "success" as const,
  };
}

/** Upserts the subscription row for a paid plan, extending the period by a month. */
export async function activateSubscription(
  userId: string,
  planId: string,
  payload: unknown,
) {
  const admin = adminClient();
  const tx = (payload ?? {}) as Record<string, any>;
  const nextPayment = tx?.plan_object?.next_payment_date ?? tx?.next_payment_date ?? null;
  const periodEnd = nextPayment
    ? new Date(nextPayment).toISOString()
    : new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

  await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      plan: planId,
      status: "active",
      paystack_customer_code: tx?.customer?.customer_code ?? null,
      current_period_end: periodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}

/**
 * Recurring renewals arrive with a fresh reference and no purchase row.
 * Creates one from the Paystack transaction so credits are granted monthly.
 */
export async function ensureRenewalPurchase(reference: string, tx: Record<string, any>) {
  const planCode = tx?.plan?.plan_code ?? tx?.plan_object?.plan_code ??
    (typeof tx?.plan === "string" ? tx.plan : null);
  if (!planCode) return false;

  const admin = adminClient();
  const { data: mapping } = await admin
    .from("payment_plan_codes")
    .select("plan_id")
    .eq("plan_code", planCode)
    .maybeSingle();
  const plan = getPlan(mapping?.plan_id);
  if (!plan) return false;

  const email = tx?.customer?.email;
  let userId: string | null = tx?.metadata?.user_id ?? null;
  if (!userId && email) {
    const { data: sub } = await admin
      .from("subscriptions")
      .select("user_id")
      .eq("paystack_customer_code", tx?.customer?.customer_code ?? "")
      .maybeSingle();
    userId = sub?.user_id ?? null;
  }
  if (!userId) return false;

  const { error } = await admin.from("credit_purchases").insert({
    user_id: userId,
    pack_id: `plan_${plan.id}`,
    plan_id: plan.id,
    kind: "subscription",
    credits: plan.monthlyCredits,
    bonus_credits: 0,
    amount_zar: plan.amountZar,
    reference,
    status: "pending",
  });
  return !error;
}

export async function markFailed(reference: string, payload: unknown) {
  const admin = adminClient();
  await admin
    .from("credit_purchases")
    .update({ status: "failed", paystack_payload: payload ?? null })
    .eq("reference", reference)
    .eq("credited", false);
}
