import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Coins, TrendingUp, TrendingDown } from "lucide-react";
import { CREDIT_PRICE_ZAR, estimateCostsZar, formatZar } from "@/lib/admin-pricing";

type SeriesRow = { day: string; audio_credits: number; translation_credits: number; visual_credits: number; total: number };
type Metrics = {
  audio_credits: number; translation_credits: number; visual_credits: number;
  audio_generated: number; translation_generated: number; visual_generated: number;
  paying_users: number; total_users: number;
};

export default function AdminEconomy() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [series, setSeries] = useState<SeriesRow[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    Promise.all([
      supabase.functions.invoke("admin-api", { body: { action: "credit_timeseries", days } }),
      supabase.functions.invoke("admin-api", { body: { action: "business_metrics", days } }),
    ]).then(([ts, bm]) => {
      if (cancelled) return;
      if (ts.error || !ts.data?.success) { setErr(ts.error?.message ?? ts.data?.error ?? "Failed to load timeseries"); setLoading(false); return; }
      if (bm.error || !bm.data?.success) { setErr(bm.error?.message ?? bm.data?.error ?? "Failed to load metrics"); setLoading(false); return; }
      setSeries(ts.data.series as SeriesRow[]);
      setMetrics(bm.data.metrics as Metrics);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [days]);

  const derived = useMemo(() => {
    if (!metrics) return null;
    const totalSpent = metrics.audio_credits + metrics.translation_credits + metrics.visual_credits;
    const revenue = totalSpent * CREDIT_PRICE_ZAR;
    const costs = estimateCostsZar({
      audio_generated: metrics.audio_generated,
      translation_generated: metrics.translation_generated,
      visual_generated: metrics.visual_generated,
    });
    return { totalSpent, revenue, costs, profit: revenue - costs.total };
  }, [metrics]);

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading credit economy…</div>;
  if (err) return <p className="text-destructive text-sm">{err}</p>;
  if (!series || !metrics || !derived) return null;

  const maxTotal = Math.max(1, ...series.map((s) => s.total));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-display font-bold">Credit economy</h1>
        <div className="inline-flex rounded-md border bg-card overflow-hidden">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d as 7 | 30 | 90)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              Last {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Credits consumed" value={derived.totalSpent.toLocaleString()} icon={Coins} />
        <Stat label="Estimated revenue" value={formatZar(derived.revenue)} icon={TrendingUp} accent="positive" />
        <Stat label="Estimated API cost" value={formatZar(derived.costs.total)} icon={TrendingDown} accent="negative" />
        <Stat
          label="Net profit"
          value={formatZar(derived.profit)}
          icon={derived.profit >= 0 ? TrendingUp : TrendingDown}
          accent={derived.profit >= 0 ? "positive" : "negative"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feature split (credits consumed)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FeatureRow label="Audio" value={metrics.audio_credits} total={derived.totalSpent} costZar={derived.costs.audio} color="bg-sky-500" />
          <FeatureRow label="Translation" value={metrics.translation_credits} total={derived.totalSpent} costZar={derived.costs.translation} color="bg-violet-500" />
          <FeatureRow label="Visuals" value={metrics.visual_credits} total={derived.totalSpent} costZar={derived.costs.visual} color="bg-amber-500" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Credits spent over time</CardTitle>
        </CardHeader>
        <CardContent>
          {series.every((s) => s.total === 0) ? (
            <p className="text-sm text-muted-foreground">No credit activity yet in this period.</p>
          ) : (
            <div className="flex items-end gap-1 h-44">
              {series.map((s) => (
                <div key={s.day} className="flex-1 flex flex-col items-stretch gap-1" title={`${s.day}: ${s.total} credits`}>
                  <div className="flex-1 flex flex-col-reverse">
                    <div className="bg-sky-500" style={{ height: `${(s.audio_credits / maxTotal) * 100}%` }} />
                    <div className="bg-violet-500" style={{ height: `${(s.translation_credits / maxTotal) * 100}%` }} />
                    <div className="bg-amber-500" style={{ height: `${(s.visual_credits / maxTotal) * 100}%` }} />
                  </div>
                  <span className="text-[9px] text-muted-foreground text-center">{s.day.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-3">
            <Legend color="bg-sky-500" label="Audio" />
            <Legend color="bg-violet-500" label="Translation" />
            <Legend color="bg-amber-500" label="Visuals" />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4 text-xs text-muted-foreground">
          Subscription / top-up split will appear here once payments are wired into <code>credit_transactions</code>.
          The new ledger table is ready — every <strong>admin credit adjustment</strong> already records into it.
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, icon: Icon, accent }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; accent?: "positive" | "negative" }) {
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

function FeatureRow({ label, value, total, costZar, color }: { label: string; value: number; total: number; costZar: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-muted-foreground">
          {value.toLocaleString()} cr · cost ≈ {formatZar(costZar)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`w-3 h-3 rounded-sm ${color}`} /> {label}</span>;
}
