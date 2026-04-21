// Admin-only endpoints (single function, action-routed).
// Actions:
//   analytics            – legacy 30d cards (kept for back-compat with old Overview)
//   business_metrics     – aggregated revenue/cost/usage metrics
//   credit_timeseries    – daily credit-spend split by feature
//   top_documents        – revenue leaderboard
//   abuse_candidates     – users near or over abuse thresholds
//   regenerate_document  – wipe cached audio for a document
//   set_role             – grant/revoke admin
//   adjust_credits       – +/- credits on a profile (logs credit_transactions)
//   flag_user            – set is_flagged + reason
//   unflag_user          – clear flag + cooldown
//   apply_cooldown       – set cooldown_until = now() + N minutes
//   reset_user_counters  – delete today's translation_rate_log rows for a user
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

    const { data: roleRow } = await admin
      .from("user_roles").select("id").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;
    const adminId = user.id;

    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // -------------------- READ ACTIONS --------------------

    if (action === "analytics") {
      // Legacy 30d cards used by current Overview page (kept for back-compat).
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [{ count: profileCount }, { data: lessonsRecent }, { data: usage }, { data: docs }] = await Promise.all([
        admin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since),
        admin.from("lessons").select("id, created_at").gte("created_at", since),
        admin.from("user_usage").select("credits_used, action_type, created_at").gte("created_at", since),
        admin.from("audio_assets").select("char_count, duration_seconds, created_at").gte("created_at", since),
      ]);

      const totalCredits = (usage ?? []).reduce((s, r) => s + (r.credits_used ?? 0), 0);
      const audioMinutes = (docs ?? []).reduce((s, r) => s + ((r.duration_seconds ?? 0) / 60), 0);

      const byDay = (rows: { created_at: string }[] | null | undefined) => {
        const map = new Map<string, number>();
        (rows ?? []).forEach((r) => {
          const d = r.created_at.slice(0, 10);
          map.set(d, (map.get(d) ?? 0) + 1);
        });
        return Array.from(map.entries()).sort().map(([date, count]) => ({ date, count }));
      };

      return json({
        success: true,
        new_signups: profileCount ?? 0,
        new_lessons: (lessonsRecent ?? []).length,
        credits_spent: totalCredits,
        audio_minutes_generated: Math.round(audioMinutes),
        signups_by_day: byDay(null),
        lessons_by_day: byDay(lessonsRecent),
      });
    }

    if (action === "business_metrics") {
      const days = Math.max(1, Math.min(365, Number(body?.days ?? 30)));
      const { data, error } = await admin.rpc("admin_business_metrics", { _days: days });
      if (error) throw error;
      return json({ success: true, metrics: data });
    }

    if (action === "credit_timeseries") {
      const days = Math.max(1, Math.min(90, Number(body?.days ?? 30)));
      const { data, error } = await admin.rpc("admin_credit_timeseries", { _days: days });
      if (error) throw error;
      return json({ success: true, series: data ?? [] });
    }

    if (action === "top_documents") {
      const limit = Math.max(1, Math.min(100, Number(body?.limit ?? 20)));
      const { data, error } = await admin.rpc("admin_top_documents", { _limit: limit });
      if (error) throw error;
      return json({ success: true, documents: data ?? [] });
    }

    if (action === "top_documents_v2") {
      const limit = Math.max(1, Math.min(200, Number(body?.limit ?? 100)));
      const { data, error } = await admin.rpc("admin_top_documents_v2", { _limit: limit });
      if (error) throw error;
      return json({ success: true, documents: data ?? [] });
    }

    if (action === "abuse_candidates") {
      const { data, error } = await admin.rpc("admin_abuse_candidates");
      if (error) throw error;
      return json({ success: true, candidates: data ?? [] });
    }

    // -------------------- WRITE ACTIONS --------------------

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
      return json({ success: true, deleted_rows: rows?.length ?? 0, deleted_files: removedFiles });
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
      return json({ success: true });
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
      // Ledger
      await admin.from("credit_transactions").insert({
        user_id: target_user_id,
        amount: delta,
        source: "admin_adjust",
        feature_type: null,
        metadata: { admin_id: adminId, prev: current, next },
      }).then(() => {}, () => {});
      return json({ success: true, balance: next });
    }

    if (action === "flag_user") {
      const target_user_id = body?.user_id as string;
      const reason = (body?.reason as string | undefined) ?? "Flagged by admin";
      if (!target_user_id) throw new Error("user_id required");
      await admin.from("profiles")
        .update({ is_flagged: true, flagged_reason: reason })
        .eq("user_id", target_user_id);
      return json({ success: true });
    }

    if (action === "unflag_user") {
      const target_user_id = body?.user_id as string;
      if (!target_user_id) throw new Error("user_id required");
      await admin.from("profiles")
        .update({ is_flagged: false, flagged_reason: null, cooldown_until: null })
        .eq("user_id", target_user_id);
      return json({ success: true });
    }

    if (action === "apply_cooldown") {
      const target_user_id = body?.user_id as string;
      const minutes = Math.max(1, Math.min(60 * 24 * 7, Number(body?.minutes ?? 60)));
      if (!target_user_id) throw new Error("user_id required");
      const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
      await admin.from("profiles")
        .update({ cooldown_until: until })
        .eq("user_id", target_user_id);
      return json({ success: true, cooldown_until: until });
    }

    if (action === "reset_user_counters") {
      const target_user_id = body?.user_id as string;
      if (!target_user_id) throw new Error("user_id required");
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      await admin.from("translation_rate_log")
        .delete()
        .eq("user_id", target_user_id)
        .gte("created_at", today.toISOString());
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("admin-api error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
