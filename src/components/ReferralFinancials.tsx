import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Financials, commissionMoney, parseWithdrawalCents } from "@/lib/referral-financials";

export default function ReferralFinancials({ userId }: { userId: string }) {
  const client = useQueryClient();
  const [amount, setAmount] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const query = useQuery({ queryKey: ["referral-financials", userId], queryFn: async () => {
    const { data, error } = await supabase.rpc("referral_my_financials");
    if (error) throw error;
    return data as unknown as Financials;
  } });
  const cents = parseWithdrawalCents(amount);
  const open = query.data?.withdrawals.some(w => !["paid", "rejected"].includes(w.status));
  const valid = query.data?.withdrawals_enabled && !open && cents !== null && cents >= query.data.minimum_cents && cents <= query.data.available_cents;
  const submit = async () => {
    if (!valid || cents === null || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("referral_request_withdrawal", { _amount_cents: cents, _request_key: requestKey });
      if (error) throw error;
      toast.success("Withdrawal requested. Funds reserved for review; no transfer made.");
      setAmount(""); setRequestKey(crypto.randomUUID());
      await client.invalidateQueries({ queryKey: ["referral-financials", userId] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Withdrawal could not be requested. Retry the same amount."); }
    finally { setSaving(false); }
  };
  return <section className="border-t pt-6 space-y-4">
    <h2 className="font-display text-xl font-semibold flex gap-2 items-center"><Wallet className="h-5 w-5" /> Commission & withdrawals</h2>
    {query.isPending ? <p role="status">Loading commission records…</p> : query.isError ? <div role="alert"><p>Commission records could not be loaded.</p><Button variant="outline" onClick={() => query.refetch()}><RefreshCw />Try again</Button></div> : query.data && <>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-5 text-sm">
        {([["Available", query.data.available_cents], ["Pending", query.data.pending_cents], ["Reserved", query.data.reserved_cents], ["Paid", query.data.paid_cents], ["Reversed", query.data.reversed_cents]] as const).map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-display text-xl font-semibold mt-1">{commissionMoney(value)}</dd></div>)}
      </dl>
      {query.data.recovery_cents > 0 && <p role="status" className="text-destructive text-sm">Reversed earnings require reconciliation: {commissionMoney(query.data.recovery_cents)}. New earnings offset this amount.</p>}
      <p className="text-muted-foreground text-sm">Minimum withdrawal: {commissionMoney(query.data.minimum_cents)}. Commission is separate from study credits.</p>
      {!query.data.withdrawals_enabled ? <p role="status" className="text-sm">Withdrawals are not active. No transfer has been initiated.</p> : <div className="space-y-3 max-w-sm">
        <Label htmlFor="withdrawal-amount">Withdrawal amount (ZAR)</Label><Input id="withdrawal-amount" inputMode="decimal" value={amount} disabled={saving || open} onChange={e => { setAmount(e.target.value); setRequestKey(crypto.randomUUID()); }} />
        {open && <p className="text-sm text-muted-foreground">Your existing request must finish before another can be submitted.</p>}
        <Button onClick={submit} disabled={!valid || saving}><Wallet />{saving ? "Requesting…" : "Request withdrawal"}</Button>
      </div>}
      {query.data.withdrawals.length === 0 ? <p className="text-muted-foreground text-sm">No withdrawal requests yet.</p> : <ul className="divide-y">{query.data.withdrawals.map(w => <li key={w.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{commissionMoney(w.amount_cents)} · {new Date(w.requested_at).toLocaleDateString("en-ZA")}</span><span className="text-muted-foreground">{w.status.replace(/_/g, " ")}</span></li>)}</ul>}
    </>}
  </section>;
}