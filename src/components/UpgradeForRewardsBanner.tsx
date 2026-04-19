import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Flame, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "studysound:upgrade-rewards-banner:dismissed";

/**
 * Static "worm to catch fish" banner — shown only to free-plan users on the
 * Dashboard, teasing the daily streak rewards locked behind Essential.
 * Dismissable per session (sessionStorage) so it doesn't nag mid-session,
 * but reappears on the next visit so the upgrade hook stays present.
 */
export default function UpgradeForRewardsBanner() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() =>
    typeof window !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1",
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("plan")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPlan(data?.plan ?? "free");
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (dismissed || !plan || plan === "essential" || plan === "premium") return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-accent/5 to-secondary/10 p-4 md:p-5"
    >
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

      <div className="flex items-start gap-4 pr-6">
        <div className="shrink-0 w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center text-primary">
          <Flame className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-sm md:text-base flex items-center gap-1.5">
            Unlock daily streak rewards
            <Sparkles className="w-3.5 h-3.5 text-accent" />
          </p>
          <p className="text-xs md:text-sm text-muted-foreground mt-1 leading-relaxed">
            Essential learners earn <span className="font-medium text-foreground">1–5 credits every day</span> just for showing up — plus bonus credits as they level up. Free plan: one-time 20 credits.
          </p>
          <Button asChild size="sm" className="mt-3 h-8">
            <Link to="/plans">See Essential plan →</Link>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
