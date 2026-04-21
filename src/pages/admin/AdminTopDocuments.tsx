import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Trophy, TrendingUp, TrendingDown, DollarSign, Percent, FileText } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";

type Row = {
  document_id: string;
  title: string;
  doc_type: string | null;
  tags: string[] | null;
  users: number;
  unlocks: number;
  generations: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number; // 0..1
  cache_hit: number; // 0..1
  last_activity: string | null;
};

type SortKey = "profit" | "revenue" | "users" | "cache_hit";

const fmtR = (n: number) => `R${(n ?? 0).toFixed(2)}`;
const fmtPct = (n: number) => `${Math.round((n ?? 0) * 100)}%`;

function marginClass(margin: number, revenue: number) {
  if (revenue <= 0) return "bg-muted/30";
  if (margin > 0.6) return "bg-emerald-500/5 hover:bg-emerald-500/10";
  if (margin >= 0.3) return "bg-amber-500/5 hover:bg-amber-500/10";
  return "bg-rose-500/5 hover:bg-rose-500/10";
}

function marginBadge(margin: number, revenue: number) {
  if (revenue <= 0) return <Badge variant="secondary">No revenue</Badge>;
  if (margin > 0.6) return <Badge className="bg-emerald-600 hover:bg-emerald-600">{fmtPct(margin)}</Badge>;
  if (margin >= 0.3) return <Badge className="bg-amber-500 hover:bg-amber-500">{fmtPct(margin)}</Badge>;
  return <Badge className="bg-rose-600 hover:bg-rose-600">{fmtPct(margin)}</Badge>;
}

export default function AdminTopDocuments() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState<string>("all");
  const [docType, setDocType] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("profit");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.functions.invoke("admin-api", {
        body: { action: "top_documents_v2", limit: 100 },
      });
      const docs = (data?.documents ?? []) as Row[];
      setRows(
        docs.map((r) => ({
          ...r,
          revenue: Number(r.revenue ?? 0),
          cost: Number(r.cost ?? 0),
          profit: Number(r.profit ?? 0),
          margin: Number(r.margin ?? 0),
          cache_hit: Number(r.cache_hit ?? 0),
        })),
      );
      setLoading(false);
    })();
  }, []);

  const docTypes = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.doc_type && s.add(r.doc_type));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let out = rows.slice();
    if (subject !== "all") out = out.filter((r) => r.doc_type === subject);
    if (docType !== "all") out = out.filter((r) => r.doc_type === docType);
    out.sort((a, b) => {
      switch (sortBy) {
        case "revenue": return b.revenue - a.revenue;
        case "users": return b.users - a.users;
        case "cache_hit": return b.cache_hit - a.cache_hit;
        default: return b.profit - a.profit;
      }
    });
    return out;
  }, [rows, subject, docType, sortBy]);

  const totals = useMemo(() => {
    const revenue = filtered.reduce((s, r) => s + r.revenue, 0);
    const cost = filtered.reduce((s, r) => s + r.cost, 0);
    const profit = revenue - cost;
    const margin = revenue > 0 ? profit / revenue : 0;
    return { count: filtered.length, revenue, cost, profit, margin };
  }, [filtered]);

  const insights = useMemo(() => {
    const out: string[] = [];
    const sortedByRev = [...filtered].sort((a, b) => b.revenue - a.revenue);
    const top3 = sortedByRev.slice(0, 3).reduce((s, r) => s + r.revenue, 0);
    if (totals.revenue > 0 && sortedByRev.length >= 3) {
      out.push(`Top 3 documents generate ${Math.round((top3 / totals.revenue) * 100)}% of revenue`);
    }
    const lowCache = filtered.filter((r) => r.unlocks >= 5 && r.cache_hit < 0.4);
    if (lowCache.length > 0) {
      out.push(`${lowCache.length} document${lowCache.length > 1 ? "s" : ""} have low cache efficiency (<40%) — pre-generation recommended`);
    }
    const lossy = filtered.filter((r) => r.revenue > 0 && r.margin < 0.3);
    if (lossy.length > 0) {
      out.push(`${lossy.length} document${lossy.length > 1 ? "s are" : " is"} unprofitable (margin <30%)`);
    }
    return out;
  }, [filtered, totals]);

  const chartData = useMemo(
    () => filtered.slice(0, 10).map((r) => ({
      name: r.title.length > 18 ? r.title.slice(0, 18) + "…" : r.title,
      profit: Number(r.profit.toFixed(2)),
    })),
    [filtered],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Trophy className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-display font-bold">Top Documents</h1>
      </div>
      <p className="text-sm text-muted-foreground -mt-4">
        Decision dashboard: which documents make money, which lose money, and where to invest.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* SECTION 1 — Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryCard icon={FileText} label="Documents" value={String(totals.count)} />
            <SummaryCard icon={DollarSign} label="Revenue" value={fmtR(totals.revenue)} />
            <SummaryCard icon={TrendingDown} label="Cost" value={fmtR(totals.cost)} tone="muted" />
            <SummaryCard
              icon={TrendingUp}
              label="Net profit"
              value={fmtR(totals.profit)}
              tone={totals.profit >= 0 ? "good" : "bad"}
            />
            <SummaryCard
              icon={Percent}
              label="Margin"
              value={fmtPct(totals.margin)}
              tone={totals.margin >= 0.6 ? "good" : totals.margin >= 0.3 ? "warn" : "bad"}
            />
          </div>

          {/* Insights */}
          {insights.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Insights</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {insights.map((i, idx) => (
                  <div key={idx} className="flex gap-2"><span className="text-primary">•</span>{i}</div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {docTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="profit">Sort: Profit</SelectItem>
                <SelectItem value="revenue">Sort: Revenue</SelectItem>
                <SelectItem value="users">Sort: Users</SelectItem>
                <SelectItem value="cache_hit">Sort: Cache efficiency</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* SECTION 4 — Profit chart */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Profit by document (top 10)</CardTitle>
              </CardHeader>
              <CardContent className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R${v}`} />
                    <RTooltip formatter={(v: number) => fmtR(v)} />
                    <Bar dataKey="profit" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* SECTION 2 — Leaderboard */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left p-3">#</th>
                      <th className="text-left p-3">Document</th>
                      <th className="text-left p-3">Type</th>
                      <th className="text-right p-3">Users</th>
                      <th className="text-right p-3">Revenue</th>
                      <th className="text-right p-3">Cost</th>
                      <th className="text-right p-3">Profit</th>
                      <th className="text-right p-3">Margin</th>
                      <th className="text-right p-3">Cache hit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => (
                      <tr key={r.document_id} className={cn("border-t transition-colors", marginClass(r.margin, r.revenue))}>
                        <td className="p-3 text-muted-foreground">{i + 1}</td>
                        <td className="p-3 font-medium max-w-[280px] truncate">{r.title}</td>
                        <td className="p-3 text-muted-foreground text-xs uppercase">{r.doc_type ?? "—"}</td>
                        <td className="p-3 text-right">{r.users}</td>
                        <td className="p-3 text-right">{fmtR(r.revenue)}</td>
                        <td className="p-3 text-right text-muted-foreground">{fmtR(r.cost)}</td>
                        <td className={cn("p-3 text-right font-semibold", r.profit < 0 && "text-rose-600")}>
                          {fmtR(r.profit)}
                        </td>
                        <td className="p-3 text-right">{marginBadge(r.margin, r.revenue)}</td>
                        <td className="p-3 text-right">{r.unlocks > 0 ? fmtPct(r.cache_hit) : "—"}</td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No documents match the filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad" | "muted";
}) {
  const toneCls = {
    default: "text-foreground",
    good: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-rose-600",
    muted: "text-muted-foreground",
  }[tone];
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          <Icon className="w-3.5 h-3.5" /> {label}
        </div>
        <div className={cn("mt-1 text-2xl font-bold font-display", toneCls)}>{value}</div>
      </CardContent>
    </Card>
  );
}
