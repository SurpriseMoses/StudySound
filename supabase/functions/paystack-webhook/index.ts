// Paystack webhook — the authoritative source for granting purchased credits
// and keeping subscription plans in sync.
import {
  adminClient,
  corsHeaders,
  ensureRenewalPurchase,
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

  // Find the owning user via metadata, customer code, or the linked transaction.
  let userId: string | null = data?.metadata?.user_id ?? null;
  if (!userId && customerCode) {
    const { data: row } = await admin
      .from("subscriptions")
      .select("user_id")
      .eq("paystack_customer_code", customerCode)
      .maybeSingle();
    userId = row?.user_id ?? null;
  }
  if (!userId && customerCode) {
    const { data: purchase } = await admin
      .from("credit_purchases")
      .select("user_id")
      .eq("kind", "subscription")
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    userId = purchase?.user_id ?? null;
  }
  if (!userId) return;

  if (event === "subscription.create" || event === "subscription.enable") {
    const planId = data?.plan?.name?.toLowerCase().includes("premium")
      ? "premium"
      : "essential";
    await admin.from("subscriptions").upsert(
      {
        user_id: userId,
        plan: planId,
        status: "active",
        paystack_subscription_code: subCode,
        paystack_customer_code: customerCode,
        paystack_email_token: emailToken,
        current_period_end: data?.next_payment_date
          ? new Date(data.next_payment_date).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    await admin.from("profiles").update({ plan: planId }).eq("user_id", userId);
    return;
  }

  if (event === "subscription.disable" || event === "subscription.not_renew") {
    await admin
      .from("subscriptions")
      .update({
        status: event === "subscription.disable" ? "cancelled" : "not_renewing",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (event === "subscription.disable") {
      await admin.from("profiles").update({ plan: "free" }).eq("user_id", userId);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
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
        let result = await grantCreditsForReference(reference, tx);
        if (result.status === "unknown") {
          // Monthly renewal: no purchase row exists yet, create one then credit.
          if (await ensureRenewalPurchase(reference, tx)) {
            result = await grantCreditsForReference(reference, tx);
          }
        }
        console.log("paystack-webhook credited", reference, result.status);
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
