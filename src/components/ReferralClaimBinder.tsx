import { useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { clearInvitation, readInvitation, shouldRetryBinding } from "@/lib/referral-invitation";

export default function ReferralClaimBinder() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const bind = async () => {
      const invitation = readInvitation();
      if (!invitation || cancelled) return;
      try {
        const { data, error } = await supabase.rpc("referral_bind_claim", { _token: invitation.token });
        if (cancelled) return;
        attempts++;
        if (error) { if (attempts < 3) timer = setTimeout(bind, 2000); return; }
        const status = data && typeof data === "object" && !Array.isArray(data) ? String(data.status) : "";
        if (!status) return;
        if (shouldRetryBinding(status)) { if (attempts < 3) timer = setTimeout(bind, 2000); return; }
        clearInvitation(invitation.token);
        if (status === "attributed") toast.success("Invitation linked. Rewards still require an eligible first payment.");
        else if (status === "disabled") toast.info("The referral programme is not active. No reward has been applied.");
        else toast.info("This invitation could not be linked to your account. No reward has been applied.");
      } catch { if (!cancelled && ++attempts < 3) timer = setTimeout(bind, 2000); }
    };
    void bind();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [user?.id, user?.email_confirmed_at]);
  return null;
}