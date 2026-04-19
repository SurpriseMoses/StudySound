import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type ProfileBits = {
  plan: string | null;
  credits_balance: number;
  free_credits_expires_at: string | null;
};

/**
 * Compact pill shown in headers for free-tier users only.
 * Displays remaining credits + days until expiry, with color tier:
 *  - >3 days: muted
 *  - 1–3 days: amber (warning)
 *  - <24h:    destructive (urgent)
 *  - expired: outlined "expired" state linking to /plans
 */
export default function FreeCreditsExpiryBadge({ className }: { className?: string }) {
  const { user } = useAuth();
  const [p, setP] = useState<ProfileBits | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("plan, credits_balance, free_credits_expires_at")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setP(data as ProfileBits);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!p) return null;
  const isFree = !p.plan || p.plan === "free";
  if (!isFree) return null;

  const expiresAt = p.free_credits_expires_at ? new Date(p.free_credits_expires_at) : null;
  const now = Date.now();
  const msLeft = expiresAt ? expiresAt.getTime() - now : null;
  const expired = msLeft !== null && msLeft <= 0;
  const daysLeft = msLeft !== null ? Math.max(0, Math.ceil(msLeft / 86400000)) : null;
  const hoursLeft = msLeft !== null ? Math.max(0, Math.ceil(msLeft / 3600000)) : null;

  // Tier
  let tone = "bg-muted text-muted-foreground border-border";
  if (!expired && daysLeft !== null) {
    if (daysLeft <= 1) tone = "bg-destructive/10 text-destructive border-destructive/30";
    else if (daysLeft <= 3) tone = "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30";
  }
  if (expired) tone = "bg-destructive/10 text-destructive border-destructive/40";

  let label: string;
  if (expired) {
    label = "Refilling soon…";
  } else if (hoursLeft !== null && hoursLeft <= 24) {
    label = `${p.credits_balance} credits • expire in ${hoursLeft}h`;
  } else {
    label = `${p.credits_balance} credits • expire in ${daysLeft}d`;
  }

  return (
    <Link
      to="/plans"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-90",
        tone,
        className,
      )}
      title={expired ? "Your free credits will refill on next action" : "Free credits expire after 7 days, then refill monthly — upgrade for daily rewards"}
    >
      {expired ? <Sparkles className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
      <span>{label}</span>
    </Link>
  );
}
