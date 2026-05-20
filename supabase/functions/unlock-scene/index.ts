// Unlock a single visual scene (2 credits) or the full-story bundle (15 credits).
// Idempotent: if already unlocked, returns success without charging.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SCENE_COST = 2;
const BUNDLE_COST = 15;
const BUNDLE_INDEX = -1;
const TOTAL_SCENES = 12;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const document_id: string | undefined = body.document_id;
    const mode: "scene" | "bundle" = body.mode === "bundle" ? "bundle" : "scene";
    const scene_index: number | undefined = body.scene_index;

    if (!document_id) throw new Error("document_id required");
    if (mode === "scene" && (typeof scene_index !== "number" || scene_index < 1 || scene_index >= TOTAL_SCENES)) {
      throw new Error("Invalid scene_index (scene 0 is free; payable scenes are 1..11)");
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Existing unlocks
    const { data: existing } = await admin
      .from("scene_unlocks")
      .select("scene_index")
      .eq("user_id", user.id)
      .eq("document_id", document_id);

    const unlockedSet = new Set<number>((existing ?? []).map((r: any) => r.scene_index));
    const hasBundle = unlockedSet.has(BUNDLE_INDEX);

    if (mode === "scene") {
      if (hasBundle || unlockedSet.has(scene_index!)) {
        return new Response(JSON.stringify({ success: true, already: true, charged: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      if (hasBundle) {
        return new Response(JSON.stringify({ success: true, already: true, charged: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const cost = mode === "scene" ? SCENE_COST : BUNDLE_COST;

    // Admin bypass — admins use features for free (no balance check, no deduction)
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });

    // Fetch profile, refill expired free credits if applicable
    await admin.rpc("expire_free_credits", { _user_id: user.id });
    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("credits_balance")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profErr || !profile) throw new Error("Profile not found");

    const effectiveCost = isAdmin ? 0 : cost;

    if (!isAdmin && (profile.credits_balance ?? 0) < cost) {
      return new Response(JSON.stringify({
        error: "Insufficient credits",
        required: cost,
        balance: profile.credits_balance ?? 0,
      }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Deduct (skipped for admin)
    if (effectiveCost > 0) {
      const { error: deductErr } = await admin
        .from("profiles")
        .update({ credits_balance: (profile.credits_balance ?? 0) - effectiveCost })
        .eq("user_id", user.id);
      if (deductErr) throw deductErr;
    }

    // Insert unlock row
    const insertRow = {
      user_id: user.id,
      document_id,
      scene_index: mode === "bundle" ? BUNDLE_INDEX : scene_index!,
      credits_charged: effectiveCost,
    };
    const { error: insErr } = await admin.from("scene_unlocks").insert(insertRow);
    if (insErr) {
      // Rollback credits if insert failed
      if (effectiveCost > 0) {
        await admin.from("profiles")
          .update({ credits_balance: profile.credits_balance })
          .eq("user_id", user.id);
      }
      throw insErr;
    }

    // Ledger
    await admin.from("user_usage").insert({
      user_id: user.id,
      action_type: "image",
      credits_used: effectiveCost,
      document_id,
      request_id: `unlock-${mode}-${Date.now()}`,
    });

    return new Response(JSON.stringify({
      success: true,
      mode,
      charged: cost,
      new_balance: (profile.credits_balance ?? 0) - cost,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("unlock-scene error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
