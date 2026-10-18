import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type FundingRecord = { id: string; reference: string; amount_zar: number; evidence_reference: string; confirmed_at: string; reversed_at: string | null; reversal_reason: string | null };
type FundingSummary = { net_funded_zar: number; records: FundingRecord[] };
const money = (amount: number) => `R${Number(amount).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ReferralReserveFunding() {
  const client = useQueryClient();
  const summary = useQuery({ queryKey: ["referral-reserve-funding"], queryFn: async () => {
    const { data, error } = await supabase.rpc("referral_admin_funding_summary");
    if (error) throw error;
    return data as unknown as FundingSummary;
  } });
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [correction, setCorrection] = useState<FundingRecord | null>(null);
  const [reason, setReason] = useState("");
  const valid = confirmed && reference.trim().length >= 3 && evidence.trim().length >= 10 && /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0 && Number(amount) <= 999999999.99;
  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["referral-reserve-funding"] }), client.invalidateQueries({ queryKey: ["referral-cost-evidence"] }), client.invalidateQueries({ queryKey: ["referral-admin-settings"] })]);
  };
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("referral_admin_record_funding", { _reference: reference.trim(), _amount_zar: Number(amount), _evidence_reference: evidence.trim(), _transfer_confirmed: confirmed });
      if (error) throw error;
      toast.success("Funding confirmation recorded. No money transferred.");
      setReference(""); setAmount(""); setEvidence(""); setConfirmed(false);
      await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Funding confirmation could not be saved."); }
    finally { setSaving(false); }
  };
  const reverse = async () => {
    if (!correction || reason.trim().length < 10 || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("referral_admin_reverse_funding", { _funding_id: correction.id, _reason: reason.trim() });
      if (error) throw error;
      toast.success("Confirmation reversed. Original record retained; cost approval cleared.");
      setCorrection(null); setReason(""); await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Correction could not be saved."); }
    finally { setSaving(false); }
  };
  return <section className="border-t pt-6 space-y-5 min-w-0">
    <header className="space-y-2">
      <h2 className="font-display text-lg font-semibold">Reserve funding confirmations</h2>
      <p className="text-sm text-muted-foreground">Record completed transfers or provider-confirmed top-ups only. This log does not transfer money, establish a provider balance or activate rewards.</p>
    </header>
    {summary.isPending ? <p role="status">Loading confirmations…</p> : summary.isError ? <div role="alert" className="space-y-2"><p>Funding confirmations could not be loaded.</p><Button variant="outline" onClick={() => summary.refetch()}><RefreshCw />Try again</Button></div> : summary.data && <>
      <p className="text-sm">Net confirmed funding: <strong>{money(summary.data.net_funded_zar)}</strong></p>
      {summary.data.records.length === 0 ? <p className="text-sm text-muted-foreground">No confirmed funding recorded.</p> : <ul className="divide-y">
        {summary.data.records.map(record => <li key={record.id} className="py-3 flex flex-wrap items-start justify-between gap-3 text-sm">
          <div className="min-w-0 space-y-1"><p className="font-medium break-all">{record.reference} · {money(record.amount_zar)}</p><p className="text-muted-foreground break-all">{record.evidence_reference}</p><p className="text-muted-foreground">{new Date(record.confirmed_at).toLocaleString("en-ZA")}</p>{record.reversed_at && <p className="text-destructive break-words">Reversed · {record.reversal_reason}</p>}</div>
          {!record.reversed_at && <Button variant="outline" size="icon" aria-label={`Reverse confirmation ${record.reference}`} title="Reverse confirmation" onClick={() => { setCorrection(record); setReason(""); }}><Undo2 /></Button>}
        </li>)}
      </ul>}
      {summary.data.records.length === 100 && <p className="text-xs text-muted-foreground">Showing the latest 100 confirmations. Net funding includes all unreversed records.</p>}
    </>}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="space-y-2"><Label htmlFor="funding-reference">Unique transfer reference</Label><Input id="funding-reference" maxLength={120} value={reference} onChange={e => setReference(e.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="funding-amount">Confirmed amount (ZAR)</Label><Input id="funding-amount" type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></div>
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="funding-evidence">Receipt or reconciliation reference</Label><Input id="funding-evidence" maxLength={500} value={evidence} onChange={e => setEvidence(e.target.value)} /><p className="text-xs text-muted-foreground">Do not enter bank details, credentials or private account information.</p></div>
    </div>
    <label className="flex items-start gap-3 text-sm"><Checkbox checked={confirmed} onCheckedChange={v => setConfirmed(v === true)} /><span>I confirm this transfer or provider top-up has already completed and the evidence supports this amount.</span></label>
    <Button onClick={save} disabled={!valid || saving || !summary.data}><CheckCircle2 />{saving ? "Recording…" : "Record confirmed funding"}</Button>
    <Dialog open={!!correction} onOpenChange={open => { if (!open && !saving) setCorrection(null); }}>
      <DialogContent><DialogHeader><DialogTitle>Reverse funding confirmation</DialogTitle><DialogDescription>The original record stays in the audit log. This removes its amount from confirmed funding and clears cost-model approval; no provider refund is made.</DialogDescription></DialogHeader>
        <p className="text-sm break-all">{correction?.reference} · {correction && money(correction.amount_zar)}</p>
        <Label htmlFor="funding-correction">Correction reason</Label><Input id="funding-correction" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
        <Button variant="destructive" disabled={reason.trim().length < 10 || saving} onClick={reverse}><Undo2 />{saving ? "Recording…" : "Confirm reversal"}</Button>
      </DialogContent>
    </Dialog>
  </section>;
}