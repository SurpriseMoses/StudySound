import { paymentEnvironment, checkoutCallback } from "../_shared/payment-evidence.ts";
// Starts a Paystack checkout for a credit pack and records a pending purchase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getPack } from "../_shared/credit-packs.ts";
import { adminClient, corsHeaders, json, paystackSecret } from "../_shared/paystack.ts";

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
    const pack = getPack(body?.pack_id);
    if (!pack) return json({ error: "Unknown credit pack" }, 400);

    let callbackUrl: string;
    try { callbackUrl = checkoutCallback(body?.callback_url, req.headers.get("Origin")); }
    catch { return json({ error: "Invalid checkout return address" }, 400); }

    const reference = `ss_${pack.id}_${crypto.randomUUID().replace(/-/g, "")}`;

    const admin = adminClient();
    const { error: insertErr } = await admin.from("credit_purchases").insert({
      user_id: user.id,
      pack_id: pack.id,
      credits: pack.credits,
      bonus_credits: pack.bonus,
      amount_zar: pack.amountZar,
      reference,
      status: "pending",
      expected_customer_email: user.email.trim().toLowerCase(),
      payment_environment: environment,
    });
    if (insertErr) throw new Error(insertErr.message);

    const res = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        amount: Math.round(pack.amountZar * 100), // kobo/cents
        currency: "ZAR",
        reference,
        callback_url: callbackUrl,
        metadata: {
          user_id: user.id,
          pack_id: pack.id,
          credits: pack.credits + pack.bonus,
        },
      }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.status || !data?.data?.authorization_url) {
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
      credits: pack.credits + pack.bonus,
    });
  } catch (e) {
    console.error("paystack-initialize error", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
