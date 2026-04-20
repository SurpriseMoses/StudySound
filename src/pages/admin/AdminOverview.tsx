import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, TrendingDown, Users, UserPlus, CreditCard, Headphones, Languages, Image as ImageIcon, Database, Zap } from "lucide-react";
import { CREDIT_PRICE_ZAR, estimateCostsZar, formatZar } from "@/lib/admin-pricing";

type Metrics = {
  days: number;
  audio_credits: number;
  translation_credits: number;
  visual_credits: number;
  audio_unlocks: number;
  translation_unlocks: number;
  visual_unlocks: number;
  audio_generated: number;
  translation_generated: number;
  visual_generated: number;
  new_signups: number;
  active_users_7d: number;
  paying_users: number;
  total_users: number;
};

export default function AdminOverview() {
  const [days, setDays] = useState<7 | 30>(30);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    supabase.functions
      .invoke("admin-api", { body: { action: "business_metrics", days } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.success) {
          setErr(error?.message ?? data?.error ?? "Failed to load metrics");
        } else {
          setMetrics(data.metrics as Metrics);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [days]);

  const derived = useMemo(() => {
    if (!metrics) return null;
    const totalCredits = metrics.audio_credits + metrics.translation_credits + metrics.visual_credits;
    const revenue = totalCredits * CREDIT_PRICE_ZAR;
    const costs = estimateCostsZar({
      audio_generated: metrics.audio_generated,
      translation_generated: metrics.translation_generated,
      visual_generated: metrics.visual_generated,
    });
    const netProfit = revenue - costs.total;

    // Cache hit % = (unlocks - generated) / unlocks  (re-uses of cached chunks)
    const hitPct = (unlocks: number, generated: number) => {
      if (unlocks <= 0) return 0;
      const hits = Math.max(0, unlocks - generated);
      return (hits / unlocks) * 100;
    };
    return {
      totalCredits,
      revenue,
      costs,
      netProfit,
      audioHit: hitPct(metrics.audio_unlocks, metrics.audio_generated),
      transHit: hitPct(metrics.translation_unlocks, metrics.translation_generated),
    };
  }, [metrics]);

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading business metrics…</div>;
  }
  if (err) return <p className="text-destructive text-sm">{err}</p>;
  if (!metrics || !derived) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-display font-bold">Business overview</h1>
        <div className="inline-flex rounded-md border bg-card overflow-hidden">
          {[7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d as 7 | 30)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              Last {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Revenue & Cost */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Revenue & cost</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Credits spent" value={derived.totalCredits.toLocaleString()} icon={CreditCard} />
          <KpiCard label="Estimated revenue" value={formatZar(derived.revenue)} icon={TrendingUp} accent="positive" />
          <KpiCard label="Estimated cost" value={formatZar(derived.costs.total)} icon={TrendingDown} accent="negative" />
          <KpiCard
            label="Net profit"
            value={formatZar(derived.netProfit)}
            icon={derived.netProfit >= 0 ? TrendingUp : TrendingDown}
            accent={derived.netProfit >= 0 ? "positive" : "negative"}
          />
        </div>
      </section>

      {/* Usage breakdown */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Usage breakdown</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <UsageBreakdown
            label="Audio"
            credits={metrics.audio_credits}
            unlocks={metrics.audio_unlocks}
            generated={metrics.audio_generated}
            costZar={derived.costs.audio}
            icon={Headphones}
          />
          <UsageBreakdown
            label="Translation"
            credits={metrics.translation_credits}
            unlocks={metrics.translation_unlocks}
            generated={metrics.translation_generated}
            costZar={derived.costs.translation}
            icon={Languages}
          />
          <UsageBreakdown
            label="Visuals"
            credits={metrics.visual_credits}
            unlocks={metrics.visual_unlocks}
            generated={metrics.visual_generated}
            costZar={derived.costs.visual}
            icon={ImageIcon}
          />
        </div>
      </section>

      {/* Efficiency */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Cache efficiency</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <CacheCard label="Audio cache hit rate" pct={derived.audioHit} icon={Database} />
          <CacheCard label="Translation cache hit rate" pct={derived.transHit} icon={Database} />
        </div>
      </section>

      {/* Growth */}
      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Growth</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label={`New signups (${days}d)`} value={metrics.new_signups.toString()} icon={UserPlus} />
          <KpiCard label="Active users (7d)" value={metrics.active_users_7d.toString()} icon={Zap} />
          <KpiCard label="Paying users" value={metrics.paying_users.toString()} icon={Users} accent="positive" />
          <KpiCard label="Total users" value={metrics.total_users.toString()} icon={Users} />
        </div>
      </section>

      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4 text-xs text-muted-foreground">
          Costs are estimates based on per-unit API pricing in <code>src/lib/admin-pricing.ts</code>. Edit that file to change R/credit, FX rate, or per-chunk costs.
          Cache hit % = (unlocks − new generations) / unlocks across all users in the period.
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, accent }: {
  label: string; value: string; icon: React.ComponentType<{ className?: string }>;
  accent?: "positive" | "negative";
}) {
  const accentClass =
    accent === "positive" ? "text-emerald-600 dark:text-emerald-400" :
    accent === "negative" ? "text-rose-600 dark:text-rose-400" :
    "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className={`text-2xl font-display font-bold ${accentClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function UsageBreakdown({ label, credits, unlocks, generated, costZar, icon: Icon }: {
  label: string; credits: number; unlocks: number; generated: number; costZar: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" /> {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        <Row label="Credits spent" value={credits.toLocaleString()} />
        <Row label="Unlocks" value={unlocks.toLocaleString()} />
        <Row label="New generations" value={generated.toLocaleString()} />
        <Row label="Est. cost" value={formatZar(costZar)} muted />
      </CardContent>
    </Card>
  );
}

function CacheCard({ label, pct, icon: Icon }: { label: string; pct: number; icon: React.ComponentType<{ className?: string }> }) {
  const pctText = `${pct.toFixed(1)}%`;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">{label}</span>
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="text-2xl font-display font-bold mb-2">{pctText}</div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
