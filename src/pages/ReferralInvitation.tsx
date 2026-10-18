import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { readInvitation, referralCodeSchema, saveInvitation } from "@/lib/referral-invitation";

type State = "loading" | "valid" | "disabled" | "invalid" | "error" | "existing";
export default function ReferralInvitation() {
  const { code } = useParams();
  const { user, loading } = useAuth();
  const [state, setState] = useState<State>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    async function capture() {
      if (!referralCodeSchema.safeParse(code).success) { setState("invalid"); return; }
      if (user) { setState("existing"); return; }
      const stored = readInvitation();
      // First valid invitation is retained. Reloads do not extend its window.
      if (stored) { setState("valid"); return; }
      setState("loading");
      try {
        const { data, error } = await supabase.functions.invoke("referral-invitation", { body: { code } });
        if (cancelled) return;
        if (error) { setState("error"); return; }
        if (data?.status === "valid") setState(saveInvitation({ code, token: data.token, expires_at: data.expires_at }) ? "valid" : "error");
        else setState(data?.status === "disabled" ? "disabled" : "invalid");
      } catch { if (!cancelled) setState("error"); }
    }
    void capture();
    return () => { cancelled = true; };
  }, [code, user, loading, attempt]);
  const descriptions: Record<State, string> = {
    loading: "Checking your invitation…",
    valid: "Your invitation is saved. Create and verify a new account to link it. Rewards depend on the programme terms and an eligible first subscription payment.",
    disabled: "The referral programme is not yet active. No invitation, discount or reward has been applied.",
    invalid: "This invitation is invalid or no longer available. No discount or reward has been applied.",
    error: "Your invitation could not be saved. No discount or reward has been applied.",
    existing: "Invitations are for new accounts. Your existing account and balance have not changed.",
  };
  return <main className="min-h-screen bg-background flex items-center justify-center p-6">
    <div className="max-w-lg w-full space-y-6">
      <Link to="/" className="inline-flex items-center gap-3 font-display text-2xl font-bold"><img src="/icon-192.png" alt="" className="h-10 w-10 rounded-lg" />BrainGrasp</Link>
      <h1 className="font-display text-3xl font-bold">Your BrainGrasp invitation</h1>
      <p role={state === "error" ? "alert" : "status"} className="text-muted-foreground">{descriptions[state]}</p>
      <div className="flex flex-wrap gap-3">
        {state === "error" && <Button variant="outline" onClick={() => setAttempt(value => value + 1)}><RefreshCw />Try again</Button>}
        {state !== "loading" && <Button asChild><Link to={user ? "/rewards" : state === "valid" ? "/auth?mode=signup" : "/auth"}>{user ? "View your rewards" : state === "valid" ? "Create account" : "Continue to BrainGrasp"}</Link></Button>}
        <Button asChild variant="link"><Link to="/referral-terms">Draft referral terms</Link></Button>
      </div>
    </div>
  </main>;
}