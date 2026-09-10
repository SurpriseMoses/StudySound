// Verifies a Paystack reference after the user returns from checkout,
// and grants credits once (webhook may have already done it).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  adminClient,
  corsHeaders,
  grantCreditsForReference,
  json,
  markFailed,
  paystackVerify,
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

    const body = await req.json().catch(() => ({}));
    const reference = typeof body?.reference === "string" ? body.reference : "";
    if (!reference) return json({ error: "reference required" }, 400);

    const admin = adminClient();
    const { data: purchase } = await admin
      .from("credit_purchases")
      .select("id, user_id, credits, bonus_credits, status, credited")
      .eq("reference", reference)
      .maybeSingle();

    if (!purchase || purchase.user_id !== userId) {
      return json({ error: "Purchase not found" }, 404);
    }

    const tx = await paystackVerify(reference);
    if (tx?.status !== "success") {
      await markFailed(reference, tx);
      return json({ status: tx?.status ?? "failed", credited: false });
    }

    const result = await grantCreditsForReference(reference, tx);

    const { data: profile } = await admin
      .from("profiles")
      .select("credits_balance")
      .eq("user_id", userId)
      .maybeSingle();

    return json({
      status: "success",
      credited: result.credited,
      credits: purchase.credits + (purchase.bonus_credits ?? 0),
      balance: profile?.credits_balance ?? null,
    });
  } catch (e) {
    console.error("paystack-verify error", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
