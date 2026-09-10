// Paystack webhook — the authoritative source for granting purchased credits.
import {
  corsHeaders,
  grantCreditsForReference,
  json,
  markFailed,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!secret) return json({ error: "not configured" }, 503);

    const raw = await req.text();
    const signature = req.headers.get("x-paystack-signature") ?? "";
    const expected = await hmacSha512Hex(secret, raw);
    if (signature !== expected) {
      console.warn("paystack-webhook: invalid signature");
      return json({ error: "invalid signature" }, 401);
    }

    const event = JSON.parse(raw);
    const reference: string | undefined = event?.data?.reference;
    if (!reference) return json({ ok: true, ignored: true });

    if (event?.event === "charge.success") {
      // Re-verify with Paystack before crediting.
      const tx = await paystackVerify(reference);
      if (tx?.status === "success") {
        const result = await grantCreditsForReference(reference, tx);
        console.log("paystack-webhook credited", reference, result.status);
      } else {
        await markFailed(reference, tx);
      }
    } else if (
      event?.event === "charge.failed" ||
      event?.event === "transaction.failed"
    ) {
      await markFailed(reference, event?.data ?? null);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("paystack-webhook error", e);
    return json({ error: "handler error" }, 500);
  }
});
