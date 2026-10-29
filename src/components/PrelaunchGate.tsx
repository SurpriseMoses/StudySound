import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Loader2, LockKeyhole } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export default function PrelaunchGate({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();
  const [allowedUser, setAllowedUser] = useState<string | null>(null);
  const [checkedUser, setCheckedUser] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!user) { setAllowedUser(null); setCheckedUser(null); return; }
      try {
        const { data, error } = await supabase.rpc("prelaunch_access_allowed");
        if (!cancelled) {
          setAllowedUser(!error && data === true ? user.id : null);
          setCheckedUser(user.id);
        }
      } catch {
        if (!cancelled) { setAllowedUser(null); setCheckedUser(user.id); }
      }
    };
    void check();
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("focus", check); };
  }, [user?.id]);

  // Public samples never grant access to learner data or account creation.
  if (["/", "/preview", "/auth", "/forgot-password", "/reset-password", "/privacy", "/terms", "/referral-terms", "/support"].includes(location.pathname)) return <>{children}</>;
  if (loading || (user && checkedUser !== user.id)) return (
    <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
  );
  if (user && allowedUser === user.id) return <>{children}</>;
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-6 text-center">
      <div className="max-w-sm space-y-6">
        <img src="/icon-192.png" alt="BrainGrasp" className="h-16 w-16 mx-auto rounded-lg" />
        <h1 className="font-display text-3xl font-bold">BrainGrasp</h1>
        <p className="text-muted-foreground">{location.pathname === "/onboarding" ? "No sign-ups are currently accepted. We’re preparing for launch." : "We’re preparing for launch. Registrations and learner access are temporarily closed."}</p>
        <Button variant="outline" asChild><Link to="/preview">Free Preview</Link></Button>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><LockKeyhole className="h-4 w-4" />Administrator access only</div>
        {user ? <Button variant="outline" onClick={() => void signOut()}>Sign out</Button> : <Button variant="outline" asChild><Link to="/auth">Administrator sign in</Link></Button>}
      </div>
    </main>
  );
}