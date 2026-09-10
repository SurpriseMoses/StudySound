// Shared Paystack helpers: verification + idempotent credit granting.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function paystackVerify(reference: string) {
  const key = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!key) throw new Error("PAYSTACK_SECRET_KEY not configured");
  const res = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Paystack verify failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data?.data ?? null;
}

/**
 * Grants credits for a successful transaction exactly once.
 * Returns { credited, credits, balance, status }.
 */
export async function grantCreditsForReference(reference: string, payload: unknown) {
  const admin = adminClient();

  const { data: purchase } = await admin
    .from("credit_purchases")
    .select("id, user_id, credits, bonus_credits, amount_zar, credited, status, pack_id")
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

  await admin
    .from("profiles")
    .update({ credits_balance: next })
    .eq("user_id", purchase.user_id);

  await admin.from("credit_transactions").insert({
    user_id: purchase.user_id,
    amount: total,
    source: "purchase",
    feature_type: null,
    request_id: reference,
    metadata: {
      provider: "paystack",
      pack_id: purchase.pack_id,
      amount_zar: purchase.amount_zar,
      bonus_credits: purchase.bonus_credits,
    },
  }).then(() => {}, () => {});

  return { credited: true, credits: total, balance: next, status: "success" as const };
}

export async function markFailed(reference: string, payload: unknown) {
  const admin = adminClient();
  await admin
    .from("credit_purchases")
    .update({ status: "failed", paystack_payload: payload ?? null })
    .eq("reference", reference)
    .eq("credited", false);
}
