import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Flame, Sparkles, X, Clock, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "studysound:upgrade-rewards-banner:dismissed";

type ProfileBits = {
  plan: string | null;
  credits_balance: number;
  free_credits_expires_at: string | null;
};

/**
 * Free-tier upsell banner with three urgency tiers based on credit-expiry:
 *  - Calm   (>3 days left): "Unlock daily streak rewards"
 *  - Warn   (1–3 days):     "Your 20 free credits expire in N days"
 *  - Urgent (<24h or expired): destructive copy, no dismiss
 *
 * Calm + Warn dismissable for the session; Urgent always shown.
 */
export default function UpgradeForRewardsBanner() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileBits | null>(null);
  const [dismissed, setDismissed] = useState(() =>
    typeof window !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1",
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("plan, credits_balance, free_credits_expires_at")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setProfile(data as ProfileBits);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!profile) return null;
  const isFree = !profile.plan || profile.plan === "free";
  if (!isFree) return null;

  const expiresAt = profile.free_credits_expires_at ? new Date(profile.free_credits_expires_at) : null;
  const msLeft = expiresAt ? expiresAt.getTime() - Date.now() : null;
  const expired = msLeft !== null && msLeft <= 0;
  const daysLeft = msLeft !== null ? Math.max(0, Math.ceil(msLeft / 86400000)) : null;
  const hoursLeft = msLeft !== null ? Math.max(0, Math.ceil(msLeft / 3600000)) : null;

  const isUrgent = expired || (hoursLeft !== null && hoursLeft <= 24);
  const isWarn = !isUrgent && daysLeft !== null && daysLeft <= 3;

  if (dismissed && !isUrgent) return null;

  // Tier-specific palette via semantic tokens
  const palette = isUrgent
    ? "border-destructive/40 bg-gradient-to-br from-destructive/10 via-destructive/5 to-background"
    : isWarn
      ? "border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-background"
      : "border-primary/30 bg-gradient-to-br from-primary/10 via-accent/5 to-secondary/10";

  const iconWrap = isUrgent
    ? "bg-destructive/15 text-destructive"
    : isWarn
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      : "bg-primary/15 text-primary";

  const Icon = isUrgent ? AlertTriangle : isWarn ? Clock : Flame;

  let title: string;
  let body: React.ReactNode;
  let cta: string;

  if (expired) {
    title = "Your free credits have expired";
    body = (
      <>Upgrade to <span className="font-medium text-foreground">Essential</span> to keep generating audio, quizzes and translations — plus earn daily streak rewards.</>
    );
    cta = "Upgrade now →";
  } else if (isUrgent) {
    title = `Only ${hoursLeft}h left on your free credits`;
    body = (
      <>You have <span className="font-medium text-foreground">{profile.credits_balance} credits</span> left, expiring soon. Upgrade to keep your progress and earn daily rewards.</>
    );
    cta = "Upgrade before it's gone →";
  } else if (isWarn) {
    title = `Your 20 free credits expire in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
    body = (
      <>You have <span className="font-medium text-foreground">{profile.credits_balance} credits</span> left. Essential learners earn 1–5 fresh credits <span className="font-medium text-foreground">every day</span>.</>
    );
    cta = "See Essential plan →";
  } else {
    title = "Unlock daily streak rewards";
    body = (
      <>Essential learners earn <span className="font-medium text-foreground">1–5 credits every day</span> just for showing up — plus bonus credits as they level up. Free plan: a one-time 20 credits that expire after 7 days.</>
    );
    cta = "See Essential plan →";
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`mb-6 relative overflow-hidden rounded-2xl border p-4 md:p-5 ${palette}`}
    >
      {!isUrgent && (
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(DISMISS_KEY, "1");
            setDismissed(true);
          }}
          aria-label="Dismiss"
          className="absolute top-2.5 right-2.5 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <div className={`flex items-start gap-4 ${!isUrgent ? "pr-6" : ""}`}>
        <div className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${iconWrap}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-sm md:text-base flex items-center gap-1.5">
            {title}
            {!isUrgent && !isWarn && <Sparkles className="w-3.5 h-3.5 text-accent" />}
          </p>
          <p className="text-xs md:text-sm text-muted-foreground mt-1 leading-relaxed">{body}</p>
          <Button asChild size="sm" className="mt-3 h-8" variant={isUrgent ? "destructive" : "default"}>
            <Link to="/plans">{cta}</Link>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
