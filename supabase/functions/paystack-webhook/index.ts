// Paystack webhook — the authoritative source for granting purchased credits
// and keeping subscription plans in sync.
import {
  adminClient,
  corsHeaders,
  grantCreditsForReference,
  json,
  markFailed,
  paystackSecret,
  paystackVerify,
} from "../_shared/paystack.ts";

async function hmacSha512Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function syncSubscriptionEvent(event: string, data: Record<string, any>) {
  const admin = adminClient();
  const customerCode = data?.customer?.customer_code ?? null;
  const subCode = data?.subscription_code ?? null;
  const emailToken = data?.email_token ?? null;

  // Lifecycle events never grant credits or activate a plan. Bind to an already-paid
  // customer; never guess an owner from metadata or the latest unrelated purchase.
  if (!customerCode || !subCode) return;
  const { data: subscription, error } = await admin.from("subscriptions")
    .select("user_id, paystack_subscription_code, current_period_end")
    .eq("paystack_customer_code", customerCode).maybeSingle();
  if (error) throw new Error(error.message);
  if (!subscription) return;
  const userId = subscription.user_id;
  if (event === "subscription.create") {
    if (subscription.paystack_subscription_code && subscription.paystack_subscription_code !== subCode) return;
    const { error: updateError } = await admin.from("subscriptions").update({
      paystack_subscription_code: subCode, paystack_email_token: emailToken,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
    if (updateError) throw new Error(updateError.message);
    return;
  }
  if (subscription.paystack_subscription_code !== subCode) return;

  if (event === "subscription.disable" || event === "subscription.not_renew") {
    await admin
      .from("subscriptions")
      .update({
        status: event === "subscription.disable" ? "cancelled" : "not_renewing",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (event === "subscription.disable" && subscription.current_period_end && Date.parse(subscription.current_period_end) <= Date.now()) {
      await admin.from("profiles").update({ plan: "free" }).eq("user_id", userId);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const secret = paystackSecret();
    if (!secret) return json({ error: "not configured" }, 503);

    const raw = await req.text();
    const signature = req.headers.get("x-paystack-signature") ?? "";
    const expected = await hmacSha512Hex(secret, raw);
    if (signature !== expected) {
      console.warn("paystack-webhook: invalid signature");
      return json({ error: "invalid signature" }, 401);
    }

    const event = JSON.parse(raw);
    const name: string = event?.event ?? "";

    if (name.startsWith("subscription.")) {
      await syncSubscriptionEvent(name, event?.data ?? {});
      return json({ ok: true });
    }

    const reference: string | undefined = event?.data?.reference;
    if (!reference) return json({ ok: true, ignored: true });

    if (name === "charge.success" || name === "invoice.payment_success") {
      // Re-verify with Paystack before crediting.
      const tx = await paystackVerify(reference);
      if (tx?.status === "success") {
        await grantCreditsForReference(reference, tx);
      } else {
        await markFailed(reference, tx);
      }
    } else if (
      name === "charge.failed" ||
      name === "transaction.failed" ||
      name === "invoice.payment_failed"
    ) {
      await markFailed(reference, event?.data ?? null);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("paystack-webhook error", e);
    return json({ error: "handler error" }, 500);
  }
});
