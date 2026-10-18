import { paymentEnvironment, checkoutCallback } from "../_shared/payment-evidence.ts";
// Starts a Paystack monthly subscription checkout for a BrainGrasp plan.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getPlan } from "../_shared/plans.ts";
import {
  adminClient,
  corsHeaders,
  ensurePlanCode,
  json,
  paystackFetch,
  paystackSecret,
} from "../_shared/paystack.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Invalid token" }, 401);
    const user = userData.user;

    const secret = paystackSecret();
    if (!secret) return json({ error: "Payments are not configured yet" }, 503);

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!user.email) return json({ error: "An account email is required" }, 400);
    const environment = paymentEnvironment(secret);
    const body = await req.json().catch(() => ({}));
    const plan = getPlan(body?.plan_id);
    if (!plan) return json({ error: "Unknown plan" }, 400);

    let callbackUrl: string;
    try { callbackUrl = checkoutCallback(body?.callback_url, req.headers.get("Origin")); }
    catch { return json({ error: "Invalid checkout return address" }, 400); }

    const planCode = await ensurePlanCode(plan);
    const reference = `ss_plan_${plan.id}_${crypto.randomUUID().replace(/-/g, "")}`;

    const admin = adminClient();
    const { error: insertErr } = await admin.from("credit_purchases").insert({
      user_id: user.id,
      pack_id: `plan_${plan.id}`,
      plan_id: plan.id,
      kind: "subscription",
      credits: plan.monthlyCredits,
      bonus_credits: 0,
      amount_zar: plan.amountZar,
      reference,
      status: "pending",
      expected_customer_email: user.email.trim().toLowerCase(),
      payment_environment: environment,
      expected_plan_code: planCode,
    });
    if (insertErr) throw new Error(insertErr.message);

    const { ok, data } = await paystackFetch("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: user.email,
        amount: Math.round(plan.amountZar * 100),
        currency: "ZAR",
        plan: planCode,
        reference,
        callback_url: callbackUrl,
        metadata: {
          user_id: user.id,
          plan_id: plan.id,
          credits: plan.monthlyCredits,
        },
      }),
    });

    if (!ok || !data?.data?.authorization_url) {
      await admin
        .from("credit_purchases")
        .update({ status: "failed", paystack_payload: data ?? null })
        .eq("reference", reference);
      return json(
        { error: data?.message ?? "Could not start checkout. Please try again." },
        502,
      );
    }

    return json({
      authorization_url: data.data.authorization_url,
      reference,
      plan_id: plan.id,
      credits: plan.monthlyCredits,
    });
  } catch (e) {
    console.error("paystack-subscribe error", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
