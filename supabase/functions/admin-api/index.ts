// Admin-only endpoints (single function, action-routed):
// - "analytics": signups, lessons, audio minutes, credits spent over last 30 days
// - "regenerate_document": delete all cached audio_assets rows + storage files for a document
// - "set_role": grant or revoke admin role for a user
// - "adjust_credits": set or delta a user's credit balance
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
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // verify admin
    const { data: roleRow } = await admin
      .from("user_roles").select("id").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    if (action === "analytics") {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [{ count: profileCount }, { data: lessonsRecent }, { data: usage }, { data: docs }] = await Promise.all([
        admin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since),
        admin.from("lessons").select("id, created_at").gte("created_at", since),
        admin.from("user_usage").select("credits_used, action_type, created_at").gte("created_at", since),
        admin.from("audio_assets").select("char_count, duration_seconds, created_at").gte("created_at", since),
      ]);

      const totalCredits = (usage ?? []).reduce((s, r) => s + (r.credits_used ?? 0), 0);
      const audioMinutes = (docs ?? []).reduce((s, r) => s + ((r.duration_seconds ?? 0) / 60), 0);

      // by-day buckets
      const byDay = (rows: { created_at: string }[] | null | undefined) => {
        const map = new Map<string, number>();
        (rows ?? []).forEach((r) => {
          const d = r.created_at.slice(0, 10);
          map.set(d, (map.get(d) ?? 0) + 1);
        });
        return Array.from(map.entries()).sort().map(([date, count]) => ({ date, count }));
      };

      return new Response(JSON.stringify({
        success: true,
        new_signups: profileCount ?? 0,
        new_lessons: (lessonsRecent ?? []).length,
        credits_spent: totalCredits,
        audio_minutes_generated: Math.round(audioMinutes),
        signups_by_day: byDay(null), // signups on profiles needs created_at — using lessons as proxy below
        lessons_by_day: byDay(lessonsRecent),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "regenerate_document") {
      const document_id = body?.document_id as string;
      if (!document_id) throw new Error("document_id required");
      const { data: rows } = await admin
        .from("audio_assets").select("id, storage_path").eq("document_id", document_id);
      let removedFiles = 0;
      if (rows && rows.length > 0) {
        const paths = rows.map((r) => r.storage_path);
        const { error: rmErr } = await admin.storage.from("assets").remove(paths);
        if (!rmErr) removedFiles = paths.length;
        await admin.from("audio_assets").delete().in("id", rows.map((r) => r.id));
      }
      return new Response(JSON.stringify({
        success: true, deleted_rows: rows?.length ?? 0, deleted_files: removedFiles,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "set_role") {
      const target_user_id = body?.user_id as string;
      const grant = !!body?.grant;
      if (!target_user_id) throw new Error("user_id required");
      if (grant) {
        await admin.from("user_roles").insert({ user_id: target_user_id, role: "admin" }).select();
      } else {
        await admin.from("user_roles").delete().eq("user_id", target_user_id).eq("role", "admin");
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "adjust_credits") {
      const target_user_id = body?.user_id as string;
      const delta = Number(body?.delta ?? 0);
      if (!target_user_id || !Number.isFinite(delta)) throw new Error("user_id + numeric delta required");
      const { data: profile } = await admin
        .from("profiles").select("credits_balance").eq("user_id", target_user_id).maybeSingle();
      const current = profile?.credits_balance ?? 0;
      const next = Math.max(0, current + delta);
      await admin.from("profiles").update({ credits_balance: next }).eq("user_id", target_user_id);
      return new Response(JSON.stringify({ success: true, balance: next }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("admin-api error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
