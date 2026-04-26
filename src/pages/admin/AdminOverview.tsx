import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2, TrendingUp, TrendingDown, Users, UserPlus, CreditCard,
  Headphones, Languages, Image as ImageIcon, Database, Zap,
  DollarSign, Percent, BookOpen, Clock, Activity, Target,
} from "lucide-react";
import {
  CREDIT_PRICE_ZAR, COST_PER_CREDIT,
  REAL_COST_PER_1000_CHARS_ZAR, RAW_COST_PER_1000_CHARS_ZAR,
  REAL_COST_PER_CREDIT_ZAR, CHARS_PER_CREDIT,
  costForCharsZar, formatZar, formatPct,
} from "@/lib/admin-pricing";

type BaseMetrics = {
  audio_credits: number; translation_credits: number; visual_credits: number;
  audio_unlocks: number; translation_unlocks: number; visual_unlocks: number;
  audio_generated: number; translation_generated: number; visual_generated: number;
  new_signups: number; active_users_7d: number; paying_users: number; total_users: number;
};
type SeriesRow = { day: string; audio_credits: number; translation_credits: number; visual_credits: number; total: number };
type Investor = {
  days: number;
  metrics: BaseMetrics;
  chars: {
    audio_generated: number; translation_generated: number;
    user_audio_estimated: number; user_translation_estimated: number;
    system_audio_estimated: number; system_translation_estimated: number;
    avg_audio_chunk: number;
  };
  mrr_zar: number;
  plan_counts: Record<string, number>;
  content_assets: {
    documents: number; audio_chunks_lifetime: number;
    audio_hours_lifetime: number; audio_chars_lifetime: number;
    translations_lifetime: number;
  };
  growth: {
    credit_series: SeriesRow[];
    signups_by_day: { day: string; count: number }[];
    active_30d: number; active_7d: number;
  };
};

export default function AdminOverview() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<Investor | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // projection inputs
  const [projUsers, setProjUsers] = useState(1000);
  const [projCredits, setProjCredits] = useState(40);
  const [projCostPerCredit, setProjCostPerCredit] = useState(COST_PER_CREDIT);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null);
    supabase.functions
      .invoke("admin-api", { body: { action: "investor_metrics", days } })
      .then(({ data: d, error }) => {
        if (cancelled) return;
        if (error || !d?.success) setErr(error?.message ?? d?.error ?? "Failed to load metrics");
        else setData(d as Investor);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [days]);

  const derived = useMemo(() => {
    if (!data) return null;
    const m = data.metrics;
    const totalCredits = m.audio_credits + m.translation_credits + m.visual_credits;
    const revenue = totalCredits * CREDIT_PRICE_ZAR;

    // ─── UNIFIED COST MODEL — single source: COST_PER_CREDIT ───────────
    // User-driven COGS = credits consumed by users × cost/credit
    const audioCOGS = m.audio_credits * COST_PER_CREDIT;
    const transCOGS = m.translation_credits * COST_PER_CREDIT;
    const visualsCOGS = m.visual_credits * COST_PER_CREDIT;
    const userCOGS = audioCOGS + transCOGS + visualsCOGS;

    // System (platform investment) costs — seeded content, not user-driven.
    // Estimate equivalent credits from system chars, then apply same R/credit.
    const systemChars =
      data.chars.system_audio_estimated + data.chars.system_translation_estimated;
    const systemCreditsEquiv = systemChars / CHARS_PER_CREDIT;
    const systemCost = systemCreditsEquiv * COST_PER_CREDIT;

    // Profitability — clearly separated
    const grossProfit = revenue - userCOGS;            // unit-level (per usage)
    const netProfit   = revenue - userCOGS - systemCost; // platform-level
    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const netMargin   = revenue > 0 ? (netProfit / revenue) * 100 : 0;

    // Unit economics — per active user (excludes system investment)
    const arpu = data.growth.active_30d > 0 ? revenue / data.growth.active_30d : 0;
    const costPerUser = data.growth.active_30d > 0 ? userCOGS / data.growth.active_30d : 0;
    const profitPerUser = arpu - costPerUser;

    // Break-even: how many users at current ARPU/profit cover system costs?
    const breakEvenUsers =
      profitPerUser > 0 ? Math.ceil(systemCost / profitPerUser) : Infinity;

    // Cache hit rate
    const cachePct = (unlocks: number, gen: number) =>
      unlocks > 0 ? Math.max(0, (unlocks - gen) / unlocks) * 100 : 0;
    const audioHit = cachePct(m.audio_unlocks, m.audio_generated);
    const transHit = cachePct(m.translation_unlocks, m.translation_generated);

    // Raw vs true (informational)
    const totalGenChars = data.chars.audio_generated + data.chars.translation_generated;
    const rawCost  = costForCharsZar(totalGenChars, true);
    const realCost = costForCharsZar(totalGenChars, false);

    const conversion = m.total_users > 0 ? (m.paying_users / m.total_users) * 100 : 0;

    return {
      totalCredits, revenue,
      userCOGS, systemCost, totalCost: userCOGS + systemCost,
      audioCOGS, transCOGS, visualsCOGS,
      grossProfit, netProfit, grossMargin, netMargin,
      arpu, costPerUser, profitPerUser, breakEvenUsers,
      audioHit, transHit,
      rawCost, realCost, conversion,
    };
  }, [data]);

  const projection = useMemo(() => {
    const revenue = projUsers * projCredits * CREDIT_PRICE_ZAR;
    const cost    = projUsers * projCredits * projCostPerCredit;
    const profit  = revenue - cost;
    const profitPerUserProj = projCredits * (CREDIT_PRICE_ZAR - projCostPerCredit);
    const systemCostRef = derived?.systemCost ?? 0;
    const breakEvenUsers =
      profitPerUserProj > 0 && systemCostRef > 0
        ? Math.ceil(systemCostRef / profitPerUserProj)
        : profitPerUserProj > 0 ? 0 : Infinity;
    return { revenue, cost, profit, profitPerUserProj, breakEvenUsers };
  }, [projUsers, projCredits, projCostPerCredit, derived?.systemCost]);

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading investor dashboard…</div>;
  if (err) return <p className="text-destructive text-sm">{err}</p>;
  if (!data || !derived) return null;

  const m = data.metrics;
  const maxSeries = Math.max(1, ...data.growth.credit_series.map((s) => s.total));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold">Business overview</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Investor-grade financial dashboard · last {days} days</p>
        </div>
        <div className="inline-flex rounded-md border bg-card overflow-hidden">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d as 7 | 30 | 90)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              Last {d}d
            </button>
          ))}
        </div>
      </div>

      {/* 1 ─ KPI STRIP */}
      <Section title="Top KPIs">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Kpi label="MRR" value={formatZar(data.mrr_zar)} icon={DollarSign} accent="positive" tip="Sum of all paid plan subscriptions × monthly price" />
          <Kpi label={`Revenue (${days}d)`} value={formatZar(derived.revenue)} icon={TrendingUp} accent="positive" tip="Credits consumed × R1" />
          <Kpi label="COGS (Cost of Goods Sold)" value={formatZar(derived.userCOGS)} icon={TrendingDown} accent="negative" tip={`User-driven generations × R${COST_PER_CREDIT.toFixed(2)}/credit`} />
          <Kpi label="Gross Profit" value={formatZar(derived.grossProfit)} icon={derived.grossProfit >= 0 ? TrendingUp : TrendingDown} accent={derived.grossProfit >= 0 ? "positive" : "negative"} tip="Revenue − COGS (excludes system costs)" />
          <Kpi label="Gross Margin" value={formatPct(derived.grossMargin)} icon={Percent} accent={derived.grossMargin >= 50 ? "positive" : derived.grossMargin >= 0 ? "neutral" : "negative"} />
        </div>
      </Section>

      {/* 2A ─ UNIT ECONOMICS */}
      <Section title="A. Unit economics (per active user, 30d)">
        <p className="text-xs text-muted-foreground mb-3 -mt-2">
          Per-user profitability — excludes platform investment costs.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Active users (30d)" value={data.growth.active_30d.toLocaleString()} icon={Users} />
          <Kpi label="ARPU" value={formatZar(derived.arpu)} icon={DollarSign} accent="positive" tip="Revenue ÷ active users" />
          <Kpi label="Cost per user" value={formatZar(derived.costPerUser)} icon={TrendingDown} accent="negative" tip={`COGS ÷ active users (R${COST_PER_CREDIT.toFixed(2)}/credit)`} />
          <Kpi label="Profit per user" value={formatZar(derived.profitPerUser)} icon={derived.profitPerUser >= 0 ? TrendingUp : TrendingDown} accent={derived.profitPerUser >= 0 ? "positive" : "negative"} />
        </div>
      </Section>

      {/* 2B ─ PLATFORM PROFITABILITY */}
      <Section title="B. Platform profitability (real business view)">
        <p className="text-xs text-muted-foreground mb-3 -mt-2">
          Includes all operational and content investment costs.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Kpi label={`Total Revenue (${days}d)`} value={formatZar(derived.revenue)} icon={TrendingUp} accent="positive" />
          <Kpi label="Total COGS (user)" value={formatZar(derived.userCOGS)} icon={TrendingDown} accent="negative" />
          <Kpi label="System Costs" value={formatZar(derived.systemCost)} icon={Database} accent="negative" tip="Seeding & background jobs — not user-driven" />
          <Kpi label="Net Profit (after system costs)" value={formatZar(derived.netProfit)} icon={derived.netProfit >= 0 ? TrendingUp : TrendingDown} accent={derived.netProfit >= 0 ? "positive" : "negative"} />
          <Kpi label="Net Margin" value={formatPct(derived.netMargin)} icon={Percent} accent={derived.netMargin >= 0 ? "positive" : "negative"} />
        </div>
      </Section>

      {/* 3 ─ CREDIT ECONOMICS */}
      <Section title="Credit economics">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Credits used" value={derived.totalCredits.toLocaleString()} icon={CreditCard} />
          <Kpi label="Revenue per credit" value={formatZar(CREDIT_PRICE_ZAR)} icon={TrendingUp} accent="positive" />
          <Kpi label="True Cost per Credit" value={formatZar(COST_PER_CREDIT)} icon={TrendingDown} accent="negative" tip={`Single source of truth: R${COST_PER_CREDIT.toFixed(2)}/credit at ${CHARS_PER_CREDIT} chars`} />
          <Kpi label="Profit per credit" value={formatZar(CREDIT_PRICE_ZAR - COST_PER_CREDIT)} icon={TrendingUp} accent="positive" />
        </div>
      </Section>

      {/* 4 ─ USER COSTS (COGS) BREAKDOWN */}
      <Section title="User costs (COGS) — user-triggered generations">
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2">Feature</th>
                  <th className="px-4 py-2 text-right">Credits</th>
                  <th className="px-4 py-2 text-right">Revenue</th>
                  <th className="px-4 py-2 text-right">COGS</th>
                  <th className="px-4 py-2 text-right">Profit</th>
                  <th className="px-4 py-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                <UsageRow icon={Headphones} name="Audio (user-triggered)" credits={m.audio_credits} cost={derived.audioCOGS} />
                <UsageRow icon={Languages} name="Translation (user-triggered)" credits={m.translation_credits} cost={derived.transCOGS} />
                <UsageRow icon={ImageIcon} name="Visuals (user-triggered)" credits={m.visual_credits} cost={derived.visualsCOGS} />
              </tbody>
            </table>
          </CardContent>
        </Card>
      </Section>

      {/* 4B ─ SYSTEM COSTS (non-revenue) */}
      <Section title="System costs (platform investment — non-revenue)">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Kpi label="Seeded audio" value={formatZar((data.chars.system_audio_estimated / CHARS_PER_CREDIT) * COST_PER_CREDIT)} icon={Database} accent="negative" tip={`${data.chars.system_audio_estimated.toLocaleString()} chars`} />
          <Kpi label="Seeded translations" value={formatZar((data.chars.system_translation_estimated / CHARS_PER_CREDIT) * COST_PER_CREDIT)} icon={Database} accent="negative" tip={`${data.chars.system_translation_estimated.toLocaleString()} chars`} />
          <Kpi label="Total system cost" value={formatZar(derived.systemCost)} icon={TrendingDown} accent="negative" tip="Background processing — not user-driven" />
        </div>
      </Section>

      {/* 5 ─ CONTENT ASSETS */}
      <Section title="Content asset library (lifetime)">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Books processed" value={data.content_assets.documents.toLocaleString()} icon={BookOpen} />
          <Kpi label="Audio chunks" value={data.content_assets.audio_chunks_lifetime.toLocaleString()} icon={Headphones} />
          <Kpi label="Audio hours" value={data.content_assets.audio_hours_lifetime.toFixed(1)} icon={Clock} />
          <Kpi label="Translations" value={data.content_assets.translations_lifetime.toLocaleString()} icon={Languages} />
        </div>
      </Section>

      {/* 6 ─ EFFICIENCY */}
      <Section title="Performance & efficiency">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Cost / 1k chars (true)" value={formatZar(REAL_COST_PER_1000_CHARS_ZAR)} icon={Activity} tip="Includes SSML, retries, infra overhead" />
          <Kpi label="Cost / 1k chars (raw)" value={formatZar(RAW_COST_PER_1000_CHARS_ZAR)} icon={Activity} tip="Azure TTS list price only" />
          <Kpi label="Avg chunk size" value={`${data.chars.avg_audio_chunk} ch`} icon={Database} />
          <Kpi label="Audio cache hit" value={formatPct(derived.audioHit)} icon={Zap} accent={derived.audioHit >= 50 ? "positive" : "neutral"} />
        </div>
        <Card className="mt-3">
          <CardContent className="p-4 text-xs text-muted-foreground">
            <strong className="text-foreground">Raw infrastructure cost</strong> (Azure only): {formatZar(derived.rawCost)} ·
            <strong className="text-foreground ml-2">True operating cost</strong>: {formatZar(derived.realCost)}
            <span className="ml-2">— overhead = {formatPct(derived.realCost > 0 ? ((derived.realCost - derived.rawCost) / derived.realCost) * 100 : 0)}</span>
          </CardContent>
        </Card>
      </Section>

      {/* 7 ─ GROWTH */}
      <Section title="Growth">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Kpi label="New users (period)" value={m.new_signups.toLocaleString()} icon={UserPlus} accent="positive" />
          <Kpi label="Active 7d" value={data.growth.active_7d.toLocaleString()} icon={Activity} />
          <Kpi label="Active 30d" value={data.growth.active_30d.toLocaleString()} icon={Users} />
          <Kpi label="Paying conversion" value={formatPct(derived.conversion)} icon={Target} accent={derived.conversion >= 5 ? "positive" : "neutral"} tip="Paying ÷ total users" />
        </div>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Credits spent per day</CardTitle></CardHeader>
          <CardContent>
            {data.growth.credit_series.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity in this period.</p>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {data.growth.credit_series.map((s) => (
                  <div key={s.day} className="flex-1 flex flex-col items-stretch gap-1" title={`${s.day}: ${s.total} credits`}>
                    <div className="flex-1 flex flex-col-reverse">
                      <div className="bg-sky-500" style={{ height: `${(s.audio_credits / maxSeries) * 100}%` }} />
                      <div className="bg-violet-500" style={{ height: `${(s.translation_credits / maxSeries) * 100}%` }} />
                      <div className="bg-amber-500" style={{ height: `${(s.visual_credits / maxSeries) * 100}%` }} />
                    </div>
                    <span className="text-[9px] text-muted-foreground text-center">{s.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </Section>

      {/* 8 ─ PROJECTION */}
      <Section title="Profitability projection">
        <Card>
          <CardContent className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Projected active users</Label>
                <Input type="number" min={0} value={projUsers} onChange={(e) => setProjUsers(Number(e.target.value || 0))} />
              </div>
              <div>
                <Label className="text-xs">Avg credits / user / month</Label>
                <Input type="number" min={0} value={projCredits} onChange={(e) => setProjCredits(Number(e.target.value || 0))} />
              </div>
              <div>
                <Label className="text-xs">Optimised cost / credit (ZAR)</Label>
                <Input type="number" step="0.01" min={0} value={projCostPerCredit} onChange={(e) => setProjCostPerCredit(Number(e.target.value || 0))} />
              </div>
            </div>
            <div className="space-y-3">
              <ProjRow label="Projected revenue" value={formatZar(projection.revenue)} positive />
              <ProjRow label="Projected cost" value={formatZar(projection.cost)} negative />
              <ProjRow label="Projected profit" value={formatZar(projection.profit)} positive={projection.profit >= 0} negative={projection.profit < 0} />
              <div className="pt-3 border-t text-sm text-muted-foreground">
                {projection.breakEvenUsers === 0 ? (
                  <>✅ Profitable from user #1 at this cost/credit (R{projCostPerCredit.toFixed(2)} &lt; R{CREDIT_PRICE_ZAR.toFixed(2)} price).</>
                ) : (
                  <>⚠️ Cost/credit ≥ price/credit — model is not profitable per credit.</>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4 text-xs text-muted-foreground">
          Cost model: Azure TTS $16/1M chars × R{17}/USD = R{RAW_COST_PER_1000_CHARS_ZAR.toFixed(2)}/1k chars (raw),
          adjusted to <strong>R{REAL_COST_PER_1000_CHARS_ZAR.toFixed(2)}/1k chars</strong> (true) for SSML & retries.
          1 credit ≈ {CHARS_PER_CREDIT} chars → cost ≈ R{REAL_COST_PER_CREDIT_ZAR.toFixed(2)}/credit.
          Edit in <code>src/lib/admin-pricing.ts</code>.
        </CardContent>
      </Card>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Kpi({ label, value, icon: Icon, accent, tip }: {
  label: string; value: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "positive" | "negative" | "neutral";
  tip?: string;
}) {
  const cls =
    accent === "positive" ? "text-emerald-600 dark:text-emerald-400" :
    accent === "negative" ? "text-rose-600 dark:text-rose-400" :
    "text-foreground";
  return (
    <Card title={tip}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className={`text-2xl font-display font-bold ${cls}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function UsageRow({ icon: Icon, name, credits, cost }: {
  icon: React.ComponentType<{ className?: string }>;
  name: string; credits: number; cost: number;
}) {
  const revenue = credits * CREDIT_PRICE_ZAR;
  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  return (
    <tr className="border-t">
      <td className="px-4 py-3"><span className="inline-flex items-center gap-2 font-medium"><Icon className="w-4 h-4 text-primary" /> {name}</span></td>
      <td className="px-4 py-3 text-right font-mono">{credits.toLocaleString()}</td>
      <td className="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400">{formatZar(revenue)}</td>
      <td className="px-4 py-3 text-right font-mono text-rose-600 dark:text-rose-400">{formatZar(cost)}</td>
      <td className={`px-4 py-3 text-right font-mono font-semibold ${profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{formatZar(profit)}</td>
      <td className={`px-4 py-3 text-right font-mono ${margin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{formatPct(margin)}</td>
    </tr>
  );
}

function ProjRow({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  const cls = positive ? "text-emerald-600 dark:text-emerald-400" : negative ? "text-rose-600 dark:text-rose-400" : "";
  return (
    <div className="flex items-center justify-between p-3 rounded-md border bg-card">
      <span className="text-sm">{label}</span>
      <span className={`text-lg font-display font-bold ${cls}`}>{value}</span>
    </div>
  );
}
