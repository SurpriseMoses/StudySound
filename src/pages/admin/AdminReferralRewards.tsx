import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Settings = { credits_per_rand: number | null; enabled: boolean; legal_review_confirmed: boolean; payment_flow_verified: boolean };

export default function AdminReferralRewards() {
  const [rate, setRate] = useState("");
  const [saving, setSaving] = useState(false);
  const settings = useQuery({
    queryKey: ["referral-admin-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("referral_admin_settings");
      if (error) throw error;
      return data as unknown as Settings;
    },
  });
  const numericRate = Number(rate);
  const validRate = rate.trim() !== "" && Number.isFinite(numericRate) && numericRate > 0 && numericRate <= 1000
    && Number.isInteger(79 * numericRate) && Number.isInteger(149 * numericRate);
  const save = async () => {
    if (!validRate) return;
    setSaving(true);
    const { error } = await supabase.rpc("referral_admin_set_conversion", { _credits_per_rand: numericRate });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Conversion confirmed. No credits issued and programme remains disabled.");
    setRate("");
    await settings.refetch();
  };
  return (
    <div className="space-y-8 min-w-0">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-bold">Referral Rewards & AI Reserve</h1>
        <p className="text-muted-foreground text-sm">Programme setup · Not active</p>
      </header>
      {settings.isPending ? <p role="status">Loading settings…</p> : settings.isError ? <p role="alert" className="text-destructive">Could not load authorised programme settings.</p> : settings.data && <>
        <section className="border-y py-6 space-y-4">
          <h2 className="font-display font-semibold text-lg">Reward credit conversion</h2>
          <p className="text-sm text-muted-foreground">Subscription and top-up offers have different rates. Confirm a separate reward conversion before any R79 milestone or R149 Ambassador credit award is issued.</p>
          <p className="text-sm">Confirmed rate: <strong>{settings.data.credits_per_rand === null ? "Not configured" : `${settings.data.credits_per_rand} credits per rand`}</strong></p>
          <div className="space-y-2 max-w-sm">
            <Label htmlFor="reward-conversion">Study credits per rand of reward value</Label>
            <Input id="reward-conversion" type="number" min="0" max="1000" step="any" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} />
          </div>
          {validRate && <p className="text-sm">R79 milestone → {79 * numericRate} credits · R149 Ambassador → {149 * numericRate} credits</p>}
          <Button onClick={save} disabled={!validRate || saving || settings.data.enabled}><Save /> {saving ? "Saving…" : "Confirm conversion"}</Button>
          <p className="text-xs text-muted-foreground">Confirmation is audited. It does not issue credits or activate the programme.</p>
        </section>
        <section className="space-y-3">
          <h2 className="font-display font-semibold text-lg">Activation checks</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2"><ShieldCheck className="h-4 w-4 text-primary shrink-0" /> Private attribution records and owner-only summaries are installed.</li>
            <li>Legal review: {settings.data.legal_review_confirmed ? "Recorded" : "Required"}</li>
            <li>Discounted first payment and regular-price renewal verification: {settings.data.payment_flow_verified ? "Recorded" : "Required"}</li>
            <li>Commission, milestone issuance and withdrawal operations: not connected yet.</li>
            <li>Payout identity requirements, processing times and fees: not configured.</li>
          </ul>
          <Button asChild variant="link" className="px-0"><Link to="/referral-terms">Review draft referral terms</Link></Button>
        </section>
        <section className="border-t pt-6 space-y-2">
          <h2 className="font-display font-semibold text-lg">AI reserve reconciliation</h2>
          <p className="text-sm text-muted-foreground">Provider usage records, reward-funded generation tracking and confirmed reserve funding are not connected yet. No expenditure, reserve balance or funded transfer is reported here.</p>
          <p className="text-sm">Calculation and source-allocation rules are tested; forecasts are not operational spending controls.</p>
        </section>
      </>}
    </div>
  );
}