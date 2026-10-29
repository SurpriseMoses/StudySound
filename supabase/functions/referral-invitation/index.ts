import { requirePrelaunchAccess } from "../_shared/prelaunch-guard.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

// Intentionally public invitation capture. This endpoint has no wallet,
// payment, qualification or attribution-writing authority. Binding requires
// an authenticated, verified new account through referral_bind_claim.
const bodySchema = z.object({ code: z.string().regex(/^[a-f0-9]{32}$/) }).strict();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const prelaunchDenied = await requirePrelaunchAccess(req);
  if (prelaunchDenied) return prelaunchDenied;
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
  try {
    const text = await req.text();
    if (text.length > 256) return response({ error: "Invalid invitation" }, 400);
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) return response({ status: "invalid" }, 400);
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return response({ error: "Invitations unavailable" }, 503);
    const client = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await client.rpc("referral_create_claim", { _code: parsed.data.code });
    if (error) return response({ error: "Invitations unavailable" }, 503);
    return response(data);
  } catch (error) {
    return response({ error: error instanceof SyntaxError ? "Invalid invitation" : "Invitations unavailable" }, error instanceof SyntaxError ? 400 : 503);
  }
});