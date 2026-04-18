import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_TRIGGERS = new Set(["listen", "quiz", "reading"]);

function creditsForStreak(streak: number): number {
  if (streak <= 1) return 1;
  if (streak <= 3) return 2;
  if (streak <= 5) return 3;
  if (streak === 6) return 4;
  return 5; // 7+
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / 86400000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Validate user via anon client + JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const trigger = String(body?.trigger ?? "");
    if (!ALLOWED_TRIGGERS.has(trigger)) {
      return new Response(JSON.stringify({ error: "Invalid trigger" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const today = todayUTC();

    // Already claimed today?
    const { data: existing } = await admin
      .from("daily_rewards")
      .select("streak_count, credits_awarded, trigger_action")
      .eq("user_id", userId)
      .eq("reward_date", today)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({
          alreadyClaimed: true,
          creditsAwarded: existing.credits_awarded,
          streak: existing.streak_count,
          trigger: existing.trigger_action,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load profile to compute next streak
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("credits_balance, current_streak, last_reward_date, streak_grace_used")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileErr || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let newStreak = 1;
    let graceUsed = profile.streak_grace_used ?? false;

    if (profile.last_reward_date) {
      const gap = daysBetween(profile.last_reward_date, today);
      if (gap === 1) {
        newStreak = (profile.current_streak ?? 0) + 1;
      } else if (gap === 2 && !graceUsed) {
        // 1-day grace period: skip one day, keep streak, mark grace used
        newStreak = (profile.current_streak ?? 0) + 1;
        graceUsed = true;
      } else if (gap === 0) {
        // shouldn't happen due to existing check, but safe
        newStreak = profile.current_streak ?? 1;
      } else {
        newStreak = 1;
        graceUsed = false; // reset grace on streak break
      }
    }

    const credits = creditsForStreak(newStreak);

    // Insert reward (UNIQUE constraint protects against double-claims)
    const { error: insertErr } = await admin.from("daily_rewards").insert({
      user_id: userId,
      reward_date: today,
      streak_count: newStreak,
      credits_awarded: credits,
      trigger_action: trigger,
    });

    if (insertErr) {
      // Race condition — someone just claimed it
      const { data: raceRow } = await admin
        .from("daily_rewards")
        .select("streak_count, credits_awarded, trigger_action")
        .eq("user_id", userId)
        .eq("reward_date", today)
        .maybeSingle();
      if (raceRow) {
        return new Response(
          JSON.stringify({
            alreadyClaimed: true,
            creditsAwarded: raceRow.credits_awarded,
            streak: raceRow.streak_count,
            trigger: raceRow.trigger_action,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw insertErr;
    }

    // Award XP for the daily reward (idempotent via source_key = today)
    const DAILY_XP = 5;
    const { data: xpProfile } = await admin
      .from("profiles")
      .select("xp, level")
      .eq("user_id", userId)
      .maybeSingle();

    const fromLevel = xpProfile?.level ?? 1;
    const newXp = (xpProfile?.xp ?? 0) + DAILY_XP;
    // Mirror level math from award-xp: T(n) = 100*(n-1) + 50*(n-1)*(n-2)
    const xpThreshold = (lvl: number) =>
      lvl <= 1 ? 0 : 100 * (lvl - 1) + 50 * (lvl - 1) * (lvl - 2);
    let newLevel = fromLevel;
    while (xpThreshold(newLevel + 1) <= newXp) newLevel += 1;

    // Best-effort log (unique constraint protects against double-award)
    await admin.from("xp_events").insert({
      user_id: userId,
      source: "daily_reward",
      source_key: today,
      xp_awarded: DAILY_XP,
      credits_awarded: credits,
      metadata: { trigger },
    });

    // Update profile balance + streak + xp + level state
    await admin
      .from("profiles")
      .update({
        credits_balance: (profile.credits_balance ?? 0) + credits,
        current_streak: newStreak,
        last_reward_date: today,
        streak_grace_used: graceUsed,
        xp: newXp,
        level: newLevel,
      })
      .eq("user_id", userId);

    return new Response(
      JSON.stringify({
        alreadyClaimed: false,
        creditsAwarded: credits,
        streak: newStreak,
        trigger,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("claim-daily-reward error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
