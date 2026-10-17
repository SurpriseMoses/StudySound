import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Award, Copy, RefreshCw, Share2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type Summary = {
  enabled: boolean;
  lifetime_successful: number;
  annual_successful: number;
  financials_available: boolean;
  activity: { identifier: string; status: string; attributed_at: string; reason_code: string | null }[];
};

export default function Rewards() {
  const { user } = useAuth();
  const summary = useQuery({
    queryKey: ["referral-summary", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("referral_my_summary");
      if (error) throw error;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Rewards unavailable");
      return data as unknown as Summary;
    },
  });
  const code = useQuery({
    queryKey: ["referral-code", user?.id],
    enabled: !!user && summary.data?.enabled === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("referral_my_code");
      if (error) throw error;
      return data;
    },
  });
  const referralLink = code.data ? `${window.location.origin}/ref/${code.data}` : null;
  const copy = async () => {
    if (!referralLink) return;
    try { await navigator.clipboard.writeText(referralLink); toast.success("Referral link copied"); }
    catch { toast.error("Could not copy the link"); }
  };
  const share = async () => {
    if (!referralLink) return;
    if (!navigator.share) { await copy(); return; }
    try { await navigator.share({ title: "BrainGrasp", text: "Learn together with BrainGrasp", url: referralLink }); }
    catch (error) { if (!(error instanceof Error && error.name === "AbortError")) toast.error("Could not share the link"); }
  };
  return (
    <AppLayout>
      <div className="max-w-4xl space-y-8">
        <header className="space-y-3">
          <p className="text-primary font-semibold flex items-center gap-2"><Award className="h-5 w-5" /> BrainGrasp Rewards</p>
          <h1 className="font-display font-bold text-3xl md:text-4xl">Learn together. Grow together. Earn rewards.</h1>
          <p className="text-muted-foreground max-w-2xl">Invite classmates to BrainGrasp. They save on their first subscription, you earn a referral commission, and your successful referrals can unlock extra study credits.</p>
        </header>
        {summary.isPending ? <p role="status" className="text-muted-foreground">Loading your rewards…</p> : summary.isError ? (
          <div role="alert" className="border-l-4 border-destructive pl-4 space-y-3">
            <p>Your rewards could not be loaded. No balance or reward has been changed.</p>
            <Button variant="outline" onClick={() => summary.refetch()}><RefreshCw /> Try again</Button>
          </div>
        ) : summary.data && (
          <>
            {!summary.data.enabled && <div className="border-l-4 border-primary bg-muted/50 p-4 space-y-1" role="status">
              <p className="font-semibold">Programme not yet active</p>
              <p className="text-sm text-muted-foreground">Invitations, discounts, credit awards and withdrawals will open after payment checks and legal review.</p>
            </div>}
            <section className="border-y py-6 space-y-3">
              <h2 className="font-display text-xl font-semibold">Your invitation</h2>
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 break-all text-sm text-muted-foreground">{referralLink ?? "Your referral link will be available when the programme opens."}</p>
                <Button size="icon" variant="outline" aria-label="Copy referral link" title="Copy referral link" disabled={!referralLink} onClick={copy}><Copy /></Button>
                <Button size="icon" variant="outline" aria-label="Share referral link" title="Share referral link" disabled={!referralLink} onClick={share}><Share2 /></Button>
              </div>
              {code.isError && <p role="alert" className="text-sm text-destructive">Your referral link could not be loaded.</p>}
            </section>
            <dl className="grid grid-cols-2 gap-6">
              <div><dt className="text-sm text-muted-foreground">Lifetime successful referrals</dt><dd className="text-3xl font-display font-semibold mt-1">{summary.data.lifetime_successful}</dd></div>
              <div><dt className="text-sm text-muted-foreground">Successful referrals this year</dt><dd className="text-3xl font-display font-semibold mt-1">{summary.data.annual_successful}</dd></div>
            </dl>
            <section className="space-y-3 border-t pt-6">
              <h2 className="font-display text-xl font-semibold">Milestones & Ambassador</h2>
              <p className="text-sm text-muted-foreground">Every 50 qualifying lifetime referrals: R79 worth of study credits, up to seven standard awards per year. At 300: a permanent Ambassador badge and a separate once-only R149 credit bonus.</p>
              <p className="text-sm">Awards and credit conversion are not active yet.</p>
            </section>
            <section className="border-t pt-6 space-y-2">
              <h2 className="font-display text-xl font-semibold">Commission & withdrawals</h2>
              <p className="text-sm text-muted-foreground">Proposed first-payment commission: R3.95 for Essential or R7.45 for Premium. Minimum withdrawal: R50 of available commission.</p>
              <p className="text-sm">Financial records and withdrawals are not available yet. No payout has been initiated.</p>
            </section>
            <section className="border-t pt-6 space-y-3">
              <h2 className="font-display text-xl font-semibold">Referral activity</h2>
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0" /> Classmates’ private information stays private.</p>
              {summary.data.activity.length === 0 ? <p className="text-sm text-muted-foreground">No referral activity yet.</p> : <ul className="divide-y">
                {summary.data.activity.map((activity) => <li key={activity.identifier} className="py-3 flex flex-wrap justify-between gap-2 text-sm">
                  <span>{activity.identifier}</span><span className="text-muted-foreground">{activity.status.replace(/_/g, " ")}</span>
                </li>)}
              </ul>}
            </section>
          </>
        )}
        <Button asChild variant="link" className="px-0"><Link to="/referral-terms">Read the draft referral terms</Link></Button>
      </div>
    </AppLayout>
  );
}