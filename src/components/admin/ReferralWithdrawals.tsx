import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Withdrawal, commissionMoney, parseWithdrawalCents } from "@/lib/referral-financials";
import { withdrawalNextStates, WithdrawalStatus } from "../../../supabase/functions/_shared/referral-rules";

type Record = Withdrawal & { user_id: string; events: { id: string; next_status: string; reason: string; created_at: string }[]; payout: { reference: string; evidence_reference: string } | null };
export default function ReferralWithdrawals() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["referral-admin-withdrawals"], queryFn: async () => {
    const { data, error } = await supabase.rpc("referral_admin_withdrawals");
    if (error) throw error;
    return data as unknown as { records: Record[]; withdrawals_enabled: boolean };
  } });
  const [selected, setSelected] = useState<Record | null>(null);
  const [next, setNext] = useState<WithdrawalStatus>("under_review");
  const [reason, setReason] = useState("");
  const [identity, setIdentity] = useState(false);
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [evidence, setEvidence] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [actionKey, setActionKey] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const requiresIdentity = ["approved", "processing", "paid"].includes(next);
  const date = new Date(paidAt);
  const valid = selected && reason.trim().length >= 10 && (!requiresIdentity || identity) && (next === "rejected" || query.data?.withdrawals_enabled) && (next !== "paid" || (confirmed && reference.trim().length >= 3 && evidence.trim().length >= 10 && parseWithdrawalCents(amount) === selected.amount_cents && Number.isFinite(date.getTime()) && date.getTime() <= Date.now()));
  const review = async () => {
    if (!selected || !valid || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("referral_admin_review_withdrawal", { _withdrawal_id: selected.id, _next_status: next, _action_key: actionKey, _reason: reason.trim(), _identity_verified: identity, ...(next === "paid" ? { _payout_reference: reference.trim(), _paid_amount_cents: parseWithdrawalCents(amount) ?? 0, _paid_at: date.toISOString(), _evidence_reference: evidence.trim(), _transfer_confirmed: confirmed } : {}) });
      if (error) throw error;
      toast.success(next === "rejected" ? "Request rejected. Unreversed commission released." : next === "paid" ? "Completed payout recorded. No money transferred by BrainGrasp." : "Review recorded. No money transferred.");
      setSelected(null);
      await Promise.all([client.invalidateQueries({ queryKey: ["referral-admin-withdrawals"] }), client.invalidateQueries({ queryKey: ["referral-financials"] })]);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Review could not be saved."); }
    finally { setSaving(false); }
  };
  const open = (record: Record) => {
    const first = withdrawalNextStates(record.status)[0];
    if (!first) return;
    setSelected(record); setNext(first); setReason(""); setIdentity(false); setReference(""); setAmount(""); setPaidAt(""); setEvidence(""); setConfirmed(false); setActionKey(crypto.randomUUID());
  };
  return <section className="border-t pt-6 space-y-4 min-w-0">
    <h2 className="font-display text-lg font-semibold">Withdrawal review</h2>
    <p className="text-sm text-muted-foreground">Manual review only. Payout identity and destination must be verified securely outside this log. Do not enter bank details.</p>
    {query.isPending ? <p role="status">Loading withdrawal requests…</p> : query.isError ? <div role="alert"><p>Withdrawal requests could not be loaded.</p><Button variant="outline" onClick={() => query.refetch()}><RefreshCw />Try again</Button></div> : query.data && <>
      <p className="text-sm">Withdrawals: <strong>{query.data.withdrawals_enabled ? "Open for review" : "Not active"}</strong></p>
      {query.data.records.length === 0 ? <p className="text-muted-foreground text-sm">No withdrawal requests recorded.</p> : <ul className="divide-y">{query.data.records.map(w => <li key={w.id} className="py-4 space-y-2 text-sm">
        <div className="flex flex-wrap justify-between gap-3"><div className="min-w-0 space-y-1"><p className="font-medium">{commissionMoney(w.amount_cents)} · {w.status.replace(/_/g, " ")}</p><p className="text-muted-foreground break-all">Account: {w.user_id}</p><p className="text-muted-foreground">{new Date(w.requested_at).toLocaleString("en-ZA")}</p></div>{withdrawalNextStates(w.status).length > 0 && <Button variant="outline" onClick={() => open(w)}><ClipboardCheck />Review</Button>}</div>
        {w.events.map(e => <p key={e.id} className="text-muted-foreground break-words">{e.next_status.replace(/_/g, " ")} · {e.reason}</p>)}
        {w.payout && <p className="break-all">Payout reference: {w.payout.reference} · {w.payout.evidence_reference}</p>}
      </li>)}</ul>}
      {query.data.records.length === 100 && <p className="text-xs text-muted-foreground">Showing the latest 100 requests.</p>}
    </>}
    <Dialog open={!!selected} onOpenChange={v => { if (!v && !saving) setSelected(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Review withdrawal</DialogTitle><DialogDescription>No automatic bank transfer is performed. Processing transfers cannot be rejected until their outcome is reconciled.</DialogDescription></DialogHeader>
      <p>{selected && commissionMoney(selected.amount_cents)} · {selected?.status.replace(/_/g, " ")}</p>
      <Label htmlFor="withdrawal-status">Next status</Label><Select value={next} disabled={saving} onValueChange={v => { setNext(v as WithdrawalStatus); setActionKey(crypto.randomUUID()); }}><SelectTrigger id="withdrawal-status"><SelectValue /></SelectTrigger><SelectContent>{selected && withdrawalNextStates(selected.status).map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select>
      <Label htmlFor="withdrawal-reason">Review reason</Label><Input id="withdrawal-reason" maxLength={500} disabled={saving} value={reason} onChange={e => { setReason(e.target.value); setActionKey(crypto.randomUUID()); }} />
      {requiresIdentity && <label className="flex gap-3 text-sm"><Checkbox disabled={saving} checked={identity} onCheckedChange={v => { setIdentity(v === true); setActionKey(crypto.randomUUID()); }} /><span>I have securely verified payout identity and destination.</span></label>}
      {next === "paid" && <div className="space-y-3">
        <Label htmlFor="payout-reference">Unique completed transfer reference</Label><Input id="payout-reference" maxLength={120} disabled={saving} value={reference} onChange={e => { setReference(e.target.value); setActionKey(crypto.randomUUID()); }} />
        <Label htmlFor="payout-amount">Confirmed transfer amount (ZAR)</Label><Input id="payout-amount" inputMode="decimal" disabled={saving} value={amount} onChange={e => { setAmount(e.target.value); setActionKey(crypto.randomUUID()); }} />
        <Label htmlFor="payout-date">Transfer date and time</Label><Input id="payout-date" type="datetime-local" disabled={saving} value={paidAt} onChange={e => { setPaidAt(e.target.value); setActionKey(crypto.randomUUID()); }} />
        <Label htmlFor="payout-evidence">Receipt or reconciliation reference</Label><Input id="payout-evidence" maxLength={500} disabled={saving} value={evidence} onChange={e => { setEvidence(e.target.value); setActionKey(crypto.randomUUID()); }} />
        <label className="flex gap-3 text-sm"><Checkbox disabled={saving} checked={confirmed} onCheckedChange={v => { setConfirmed(v === true); setActionKey(crypto.randomUUID()); }} /><span>I confirm the matching transfer has already completed.</span></label>
      </div>}
      <Button disabled={!valid || saving} variant={next === "rejected" ? "destructive" : "default"} onClick={review}><ClipboardCheck />{saving ? "Recording…" : "Record review"}</Button>
    </DialogContent></Dialog>
  </section>;
}