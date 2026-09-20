// Cancels (disables) the signed-in user's Paystack subscription.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  adminClient,
  corsHeaders,
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
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Invalid token" }, 401);
    const userId = userData.user.id;

    if (!paystackSecret()) return json({ error: "Payments are not configured yet" }, 503);

    const admin = adminClient();
    const { data: sub } = await admin
      .from("subscriptions")
      .select("id, paystack_subscription_code, paystack_email_token, status")
      .eq("user_id", userId)
      .maybeSingle();

    if (!sub) return json({ error: "No active plan found" }, 404);

    if (sub.paystack_subscription_code && sub.paystack_email_token) {
      const { ok, data } = await paystackFetch("/subscription/disable", {
        method: "POST",
        body: JSON.stringify({
          code: sub.paystack_subscription_code,
          token: sub.paystack_email_token,
        }),
      });
      if (!ok) console.error("paystack disable failed", data);
    }

    await admin
      .from("subscriptions")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", sub.id);

    return json({ ok: true, status: "cancelled" });
  } catch (e) {
    console.error("paystack-cancel-subscription error", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
