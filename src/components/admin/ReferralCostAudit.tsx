import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cohortScenario, rewardExposure } from "@/lib/reward-cost-model";
import ReferralReserveFunding from "@/components/admin/ReferralReserveFunding";

type Evidence = {
  retrieved_at: string; window_start: string; paid_subscription_records: number; credit_ledger_records: number;
  funded_reserve_zar: number | null; funding_records: number; reward_credits_issued: number | null;
  settings: { credits_per_rand: number | null; cost_model_approved: boolean; safety_margin_basis_points: number } | null;
  events: Array<{ feature: string; provider: string; model: string; billing_mode: string; events: number; cache_events: number; reported_cost_events: number; linked_events: number; failed_events: number; reported_cost: number | null; estimated_cost: number | null; currency: string | null }>;
};
const money = (n: number | null) => n === null ? "Unknown" : `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const numberOrNull = (s: string) => s.trim() === "" || !Number.isFinite(Number(s)) || Number(s) < 0 ? null : Number(s);

const providerRows = [
  ["Audio", "Google · gemini-2.5-flash-preview-tts", "Online generateContent; 1,800-character target"],
  ["Audio", "Azure Speech neural voices / ElevenLabs eleven_multilingual_v2", "SSML characters / account-specific character credits"],
  ["Translation", "Google gemini-2.5-flash → Lovable google/gemini-3-flash-preview → Azure Translator", "Online; context cache where caller supplies blueprint; line-by-line retries"],
  ["Quiz", "Lovable google/gemini-3-flash-preview; bank model from job/settings", "6 questions from ≤8,000 characters; bank uses Google Batch"],
  ["Images", "Lovable google/gemini-3.1-flash-image-preview", "10–12 scenes per document; planning uses google/gemini-3-flash-preview"],
  ["Document processing", "Local PDF parser, Firecrawl, Gemini OCR/classification", "Page slicing; exact OCR models and routes documented in audit report"],
  ["Embeddings", "Lovable openai/text-embedding-3-small", "1,200-character chunks, 150 overlap, batches of 32"],
  ["Background seeding", "Google gemini-2.5-flash Batch; Azure/Gemini TTS", "Batch results must be reconciled separately; not per-learner generation"],
];

export default function ReferralCostAudit() {
  const evidence = useQuery({ queryKey: ["referral-cost-evidence"], queryFn: async () => {
    const { data, error } = await supabase.rpc("referral_admin_cost_evidence"); if (error) throw error;
    return data as unknown as Evidence;
  } });
  const [inputs, setInputs] = useState({ newCost: "", cachedCost: "", fees: "", flatFee: "", variable: "", rate: "", expected: "25", safety: "25" });
  const [review, setReview] = useState("");
  const [checks, setChecks] = useState({ source_expiry_verified: false, representative_cohorts_verified: false, fees_and_variable_costs_verified: false, reserve_coverage_verified: false });
  const [saving, setSaving] = useState(false);
  const e = evidence.data;
  const confirmedRate = e?.settings?.credits_per_rand ?? null;
  const proposedRate = numberOrNull(inputs.rate);
  const rate = confirmedRate ?? (proposedRate !== null && proposedRate > 0 && Number.isInteger(79 * proposedRate) && Number.isInteger(149 * proposedRate) ? proposedRate : null);
  const cost = numberOrNull(inputs.newCost);
  const safety = (numberOrNull(inputs.safety) ?? 25) / 100;
  const annual = rewardExposure(rate, cost, safety);
  const expectedShare = Math.min(100, numberOrNull(inputs.expected) ?? 25) / 100;
  const reported = e?.events.reduce((n, r) => n + r.reported_cost_events, 0) ?? 0;
  const linked = e?.events.reduce((n, r) => n + r.linked_events, 0) ?? 0;
  const eligible = !!e && confirmedRate !== null && reported > 0 && linked > 0 && e.paid_subscription_records > 0 && Object.values(checks).every(Boolean) && review.trim().length >= 10;
  const approve = async () => {
    if (!eligible) return; setSaving(true);
    const { error } = await supabase.rpc("referral_admin_approve_cost_model", { _evidence: { ...checks, review_reference: review.trim(), scenario_assumptions: inputs, observation_at: e?.retrieved_at } });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Cost review approved. Reward issuance and payouts remain disabled."); await evidence.refetch();
  };
  return <section className="border-t pt-6 space-y-6 min-w-0">
    <header className="space-y-2"><h2 className="font-display text-lg font-semibold">AI cost audit & reward safety gate</h2>
      <p role="status" className="text-destructive font-medium">{e?.settings?.cost_model_approved ? "Administrator review recorded — activation is separate" : "Model not validated · Reward issuance disabled"}</p>
      <p className="text-sm text-muted-foreground">No measured cost per credit or subscriber profitability is established yet. Prices, allowances and balances are unchanged.</p></header>
    {evidence.isPending ? <p>Loading cost evidence…</p> : evidence.isError ? <p role="alert">Authorised cost evidence unavailable. Approval remains blocked.</p> : e && <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div><p className="text-muted-foreground">Paid subscription records</p><strong>{e.paid_subscription_records}</strong></div>
        <div><p className="text-muted-foreground">Reconciled provider cost records / linked events</p><strong>{reported} / {linked}</strong></div>
        <div><p className="text-muted-foreground">Confirmed reserve funding</p><strong>{money(e.funded_reserve_zar)}</strong><p>{e.funding_records} confirmation records; no provider balance inferred.</p></div>
        <div><p className="text-muted-foreground">Reward credits issued in the existing ledger</p><strong>{e.reward_credits_issued ?? "No issuance records"}</strong><p>Outstanding liability and redemption allocation: not yet reconciled.</p></div>
      </div>
      <p className="text-xs text-muted-foreground">Rolling 30-day cost observation: {new Date(e.window_start).toLocaleDateString("en-ZA")} – {new Date(e.retrieved_at).toLocaleDateString("en-ZA")}. Historical usage cannot establish cache status or actual provider costs.</p>
      {e.events.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Feature / provider</th><th className="p-2">Events / cached</th><th className="p-2">Reported cost</th><th className="p-2">Estimated cost</th><th className="p-2">Failed attempts</th></tr></thead><tbody>{e.events.map((r, i) => <tr key={i} className="border-b"><td className="p-2">{r.feature} · {r.provider}<br /><span className="text-muted-foreground">{r.model}</span></td><td className="p-2">{r.events} / {r.cache_events}</td><td className="p-2">{r.reported_cost === null ? "Unavailable" : `${r.currency} ${r.reported_cost}`}</td><td className="p-2">{r.estimated_cost === null ? "Unavailable" : `${r.currency} ${r.estimated_cost}`}</td><td className="p-2">{r.failed_events}</td></tr>)}</tbody></table></div>}
    </>}
    <div className="space-y-3"><h3 className="font-display font-semibold">Provider inventory</h3><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Feature</th><th className="p-2">Provider / model</th><th className="p-2">Generation pattern</th></tr></thead><tbody>{providerRows.map(([f,p,d]) => <tr key={f+p} className="border-b align-top"><td className="p-2">{f}</td><td className="p-2">{p}</td><td className="p-2">{d}</td></tr>)}</tbody></table></div>
      <p className="text-sm">Official Google pricing checked 18 October 2026: 2.5 Flash TTS online $0.50 text input / $10 audio output per million tokens; eligible Batch $0.25 / $5. Direct 2.5 Flash text online $0.30 / $2.50; Batch $0.15 / $1.25. Thinking, context-cache storage and other modalities need separate accounting.</p>
      <p className="text-sm text-muted-foreground">Google prices are not Lovable Gateway charges, Azure or ElevenLabs prices. Current TTS calls are online, not Batch. No model or billing route was changed.</p>
      <a className="text-primary underline text-sm" href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">Official Google pricing</a>
    </div>
    <div className="space-y-4"><h3 className="font-display font-semibold">Hypothetical cohort & reserve scenarios — not measured profit</h3>
      <p className="text-sm text-muted-foreground">Blank costs remain unknown. Enter reviewed ZAR assumptions; these calculations do not save settings or approve conversion.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{([
        ["newCost", "New-generation cost per credit (ZAR)"], ["cachedCost", "Cached delivery cost per credit (ZAR)"], ["fees", "Payment fee (%)"], ["flatFee", "Payment fee per transaction (ZAR)"], ["variable", "Other variable costs per subscriber (ZAR)"], ["rate", "Proposed promotional credits per rand"], ["expected", "Expected new-generation share (%)"], ["safety", "Scenario safety margin (%)"],
      ] as const).map(([key,label]) => <div key={key} className="space-y-2"><Label htmlFor={`audit-${key}`}>{label}</Label><Input id={`audit-${key}`} type="number" min="0" step="any" max={key === "expected" ? 100 : undefined} value={key === "rate" && confirmedRate !== null ? confirmedRate : inputs[key]} disabled={key === "rate" && confirmedRate !== null} onChange={ev => setInputs(v => ({ ...v, [key]: ev.target.value }))} /></div>)}</div>
      <p className="text-xs text-muted-foreground">Conversion basis: {confirmedRate === null ? "Unconfirmed proposal only" : `${confirmedRate} credits per rand, administrator-confirmed`}. Expected scenario uses all monthly credits with the entered new-generation mix. Stress scenario uses 100% new generation. One referrer receives the cohort's successes within one calendar year; rewards spread across referrers can have different liabilities.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap"><thead><tr className="border-b text-left">{["Cohort / plan", "Discounted collection scenario", "Commission", "Expected contribution", "100% new contribution", "Stress reward reserve"].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{[50,100,1000].flatMap(n => ([["Essential",0],["Premium",1],["50/50 mixed",0.5]] as const).map(([name,share]) => {
        const base = { subscribers:n, premiumShare:share, redeemedShare:1, newGenerationShare:expectedShare, newCostPerCredit:cost, cachedCostPerCredit:numberOrNull(inputs.cachedCost), feePercent:numberOrNull(inputs.fees), feePerPayment:numberOrNull(inputs.flatFee), otherVariablePerSubscriber:numberOrNull(inputs.variable), creditsPerRand:rate, safetyMargin:safety };
        const expected = cohortScenario(base); const worst = cohortScenario({ ...base, newGenerationShare:1 });
        return <tr key={`${n}-${name}`} className="border-b"><td className="p-2">{n} · {name}</td><td className="p-2">{money(expected.collectedScenario)}</td><td className="p-2">{money(expected.commissions)}</td><td className="p-2">{money(expected.contribution)}</td><td className="p-2">{money(worst.contribution)}</td><td className="p-2">{money(worst.rewardReserve)}</td></tr>;
      }))}</tbody></table></div>
      <p className="text-xs text-muted-foreground">Collection is hypothetical first-payment revenue after 10% discount, not actual cash received. One-time 5% commission is on normal price. Contribution includes entered variable costs and reward reserve, excludes unmeasured taxes and fixed costs; it is not net profit. Renewal discounts/commissions are not modelled.</p>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm"><div><dt>Maximum annual credits: 7 × R79 + one-time R149</dt><dd>{annual?.annualCredits ?? "Requires a conversion and cost assumption"}</dd></div><div><dt>Stress marginal generation cost</dt><dd>{money(annual?.annualCost ?? null)}</dd></div><div><dt>Required stress reserve with safety margin</dt><dd>{money(annual?.annualReserve ?? null)}</dd></div><div><dt>Shortfall against confirmed funding</dt><dd>{money(annual && e?.funded_reserve_zar !== null && e?.funded_reserve_zar !== undefined ? Math.max(0, annual.annualReserve - e.funded_reserve_zar) : null)}</dd></div></dl>
    </div>
    <div className="space-y-3"><h3 className="font-display font-semibold">Unresolved approval risks</h3><ul className="list-disc pl-5 text-sm space-y-2">
      <li>No representative paid Essential/Premium cohorts or invoice-reconciled provider costs. Average cost per credit, upload, feature and size distribution remain unknown.</li>
      <li>Historical 602 usage rows / 173 credits lack reliable feature and cache attribution; translations are logged as audio. Do not use them as an audio cost average.</li>
      <li>Weekly free-credit refill now preserves the non-free portion of the wallet. Legacy source attribution and atomic source-aware debits still require verification.</li>
      <li>Audio can deduct before generation; fallback, failed requests and concurrent cache misses can add exposure. Audit preserves this behaviour and does not claim refunds occurred.</li>
      <li>Background batch-result usage, source allocation, processing outcomes, storage/delivery attribution, merchant fees, FX, taxes and fixed costs still require reconciliation.</li>
    </ul></div>
    <ReferralReserveFunding />
    <div className="space-y-3"><h3 className="font-display font-semibold">Authorised cost-model review</h3><Label htmlFor="cost-review-reference">Reconciled review reference</Label><Input id="cost-review-reference" value={review} onChange={ev => setReview(ev.target.value)} placeholder="Evidence report or invoice reconciliation reference" />
      {Object.entries(checks).map(([key,value]) => <label key={key} className="flex gap-3 items-start text-sm"><Checkbox checked={value} onCheckedChange={v => setChecks(c => ({ ...c, [key]: v === true }))} /><span>{({source_expiry_verified:"Source-aware wallet and expiry protection reviewed",representative_cohorts_verified:"Representative paid cohorts and costs reconciled",fees_and_variable_costs_verified:"Fees and material variable costs verified",reserve_coverage_verified:"Reward reserve coverage evidenced"} as Record<string,string>)[key]}</span></label>)}
      <Button onClick={approve} disabled={!eligible || saving}><ShieldCheck />{saving ? "Recording review…" : "Approve cost model only"}</Button><p className="text-xs text-muted-foreground">The server rejects approval without confirmed conversion, linked provider costs and collected subscription records. Approval never issues credits, activates referrals or transfers funds.</p>
    </div>
  </section>;
}