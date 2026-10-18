// Admin-only: create short-lived signed download URLs for existing audio
// assets. Used for duration measurement / cache audits. Never generates
// audio, never charges credits, never exposes URLs to non-admins.
//
// Body: { paths: string[] }  (max 50 per call)
// Returns: { urls: { path, signed_url }[] }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRow } = await admin
      .from("user_roles").select("id")
      .eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const paths: unknown = body?.paths;
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 50) {
      return new Response(JSON.stringify({ error: "paths must be an array of 1-50 storage paths" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Only allow signing existing audio_assets rows — no arbitrary bucket access.
    const { data: assets, error: aErr } = await admin
      .from("audio_assets").select("storage_path").in("storage_path", paths);
    if (aErr) throw aErr;
    const allowed = new Set((assets ?? []).map((a) => a.storage_path));

    const urls: Array<{ path: string; signed_url: string }> = [];
    for (const p of paths) {
      if (typeof p !== "string" || !allowed.has(p)) continue;
      const { data, error } = await admin.storage.from("assets").createSignedUrl(p, 300);
      if (!error && data?.signedUrl) urls.push({ path: p, signed_url: data.signedUrl });
    }
    return new Response(JSON.stringify({ success: true, urls }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("sign-audio-urls error:", e?.message ?? e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
