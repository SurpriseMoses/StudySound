import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { xpBoostMultiplier } from "../_shared/perks.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Classic RPG curve: T(n) = 100*(n-1) + 50*(n-1)*(n-2)
// Level 1: 0, Level 2: 100, Level 3: 300, Level 4: 600, Level 5: 1000, Level 6: 1500, Level 7: 2100 ...
function levelForXp(xp: number): number {
  let lvl = 1;
  while (xpThreshold(lvl + 1) <= xp) lvl += 1;
  return lvl;
}
function xpThreshold(level: number): number {
  if (level <= 1) return 0;
  return 100 * (level - 1) + 50 * (level - 1) * (level - 2);
}

type Source = "section_complete" | "lesson_complete" | "daily_reward" | "quiz_bonus";

const XP_BY_SOURCE: Record<Source, number> = {
  section_complete: 10,
  lesson_complete: 30,
  daily_reward: 5,
  quiz_bonus: 0, // XP for quiz comes from per-correct answers handled separately if needed
};

function quizBonusCredits(scorePct: number): number {
  if (scorePct >= 85) return 3;
  if (scorePct >= 70) return 2;
  if (scorePct >= 50) return 1;
  return 0;
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
    const source = String(body?.source ?? "") as Source;
    const sourceKey = body?.source_key ? String(body.source_key) : null;
    const scorePct = typeof body?.score_pct === "number" ? body.score_pct : null;
    const metadata = body?.metadata ?? null;

    if (!(source in XP_BY_SOURCE)) {
      return new Response(JSON.stringify({ error: "Invalid source" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let xpAwarded = XP_BY_SOURCE[source];
    let creditsAwarded = 0;

    if (source === "quiz_bonus") {
      if (scorePct === null || scorePct < 0 || scorePct > 100) {
        return new Response(JSON.stringify({ error: "score_pct required (0-100)" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      creditsAwarded = quizBonusCredits(scorePct);
      // Modest XP for completing a quiz; scales with score
      xpAwarded = scorePct >= 50 ? 15 : 5;
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Idempotency: if source_key supplied and event exists, return current state
    if (sourceKey) {
      const { data: existing } = await admin
        .from("xp_events")
        .select("xp_awarded, credits_awarded")
        .eq("user_id", userId)
        .eq("source", source)
        .eq("source_key", sourceKey)
        .maybeSingle();
      if (existing) {
        const { data: prof } = await admin
          .from("profiles")
          .select("xp, level")
          .eq("user_id", userId)
          .maybeSingle();
        return new Response(
          JSON.stringify({
            duplicate: true,
            xpAwarded: 0,
            creditsAwarded: 0,
            totalXp: prof?.xp ?? 0,
            level: prof?.level ?? 1,
            leveledUp: false,
            nextLevelXp: xpThreshold((prof?.level ?? 1) + 1),
            currentLevelXp: xpThreshold(prof?.level ?? 1),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Expire stale free-tier credits before crediting bonus
    await admin.rpc("expire_free_credits", { _user_id: userId });
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("xp, level, credits_balance")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileErr || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fromLevel = profile.level ?? 1;
    // Apply XP boost perk (level 5 → +10%, level 20 → +20%)
    const boost = xpBoostMultiplier(fromLevel);
    if (boost > 1) {
      xpAwarded = Math.round(xpAwarded * boost);
    }
    const newXp = (profile.xp ?? 0) + xpAwarded;
    const newLevel = levelForXp(newXp);
    const leveledUp = newLevel > fromLevel;

    // Insert event log (unique on user_id+source+source_key when source_key not null)
    const { error: insertErr } = await admin.from("xp_events").insert({
      user_id: userId,
      source,
      source_key: sourceKey,
      xp_awarded: xpAwarded,
      credits_awarded: creditsAwarded,
      metadata,
    });
    if (insertErr) {
      // Race: another concurrent request inserted the same key
      if (sourceKey) {
        return new Response(
          JSON.stringify({
            duplicate: true,
            xpAwarded: 0,
            creditsAwarded: 0,
            totalXp: profile.xp ?? 0,
            level: fromLevel,
            leveledUp: false,
            nextLevelXp: xpThreshold(fromLevel + 1),
            currentLevelXp: xpThreshold(fromLevel),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw insertErr;
    }

    await admin
      .from("profiles")
      .update({
        xp: newXp,
        level: newLevel,
        credits_balance: (profile.credits_balance ?? 0) + creditsAwarded,
      })
      .eq("user_id", userId);

    return new Response(
      JSON.stringify({
        duplicate: false,
        xpAwarded,
        creditsAwarded,
        totalXp: newXp,
        level: newLevel,
        fromLevel,
        leveledUp,
        nextLevelXp: xpThreshold(newLevel + 1),
        currentLevelXp: xpThreshold(newLevel),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("award-xp error", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
