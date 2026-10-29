import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { prelaunchDecision } from "./prelaunch-policy.ts";

// Temporary launch gate. Never wraps provider webhooks or reconciliation.
export async function requirePrelaunchAccess(req: Request): Promise<Response | null> {
  let status: number | null = 403;
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!url || !anon || !service) throw new Error("Access unavailable");
    if (token === service) return null;
    if (!token || token === anon) status = prelaunchDecision("anonymous");
    else {
      const client = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
      const { data: { user }, error } = await client.auth.getUser();
      if (error || !user) status = 401;
      else {
        const { data, error: accessError } = await client.rpc("prelaunch_access_allowed");
        status = prelaunchDecision(accessError ? "error" : data === true ? "admin" : "learner");
      }
    }
  } catch { status = prelaunchDecision("error"); }
  return status === null ? null : new Response(JSON.stringify({
    error: "BrainGrasp is not launched yet. Administrator access only.", code: "PRELAUNCH_ADMIN_ONLY",
  }), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}