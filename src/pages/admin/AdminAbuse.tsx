import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldAlert, ShieldOff, Clock, RotateCcw, Flag } from "lucide-react";

type Candidate = {
  user_id: string;
  display_name: string | null;
  plan: string;
  is_flagged: boolean;
  cooldown_until: string | null;
  translations_today: number;
  translations_last_minute: number;
  audio_today: number;
  daily_cap: number;
};

export default function AdminAbuse() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.functions.invoke("admin-api", { body: { action: "abuse_candidates" } });
    if (error || !data?.success) {
      setErr(error?.message ?? data?.error ?? "Failed to load");
    } else {
      setRows(data.candidates as Candidate[]);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const callAction = async (action: string, body: Record<string, unknown>, label: string) => {
    setBusy(`${action}:${body.user_id}`);
    const { data, error } = await supabase.functions.invoke("admin-api", { body: { action, ...body } });
    setBusy(null);
    if (error || !data?.success) {
      toast({ title: `${label} failed`, description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    toast({ title: `${label} applied` });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-display font-bold flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-amber-500" /> Abuse monitoring
        </h1>
        <p className="text-xs text-muted-foreground">Auto-detected: high translations/day, &gt;5 sections/min, or already flagged.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : err ? (
        <p className="text-destructive text-sm">{err}</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left p-3">User</th>
                    <th className="text-left p-3">Plan</th>
                    <th className="text-right p-3">Translations today</th>
                    <th className="text-right p-3">Per min</th>
                    <th className="text-right p-3">Audio today</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const overDaily = r.translations_today > r.daily_cap;
                    const nearDaily = !overDaily && r.translations_today > r.daily_cap * 0.8;
                    const overMin = r.translations_last_minute > 5;
                    const inCd = r.cooldown_until && new Date(r.cooldown_until).getTime() > Date.now();
                    return (
                      <tr key={r.user_id} className={`border-t ${r.is_flagged ? "bg-rose-500/5" : overDaily || overMin ? "bg-amber-500/5" : ""}`}>
                        <td className="p-3 font-medium">
                          <div>{r.display_name ?? "—"}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{r.user_id.slice(0, 8)}…</div>
                        </td>
                        <td className="p-3 text-muted-foreground">{r.plan}</td>
                        <td className={`p-3 text-right font-mono ${overDaily ? "text-rose-500 font-bold" : nearDaily ? "text-amber-500" : ""}`}>
                          {r.translations_today} / {r.daily_cap}
                        </td>
                        <td className={`p-3 text-right font-mono ${overMin ? "text-rose-500 font-bold" : ""}`}>{r.translations_last_minute}</td>
                        <td className="p-3 text-right font-mono">{r.audio_today}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {r.is_flagged && <Badge tone="destructive">FLAGGED</Badge>}
                            {inCd && <Badge tone="warning"><Clock className="w-3 h-3 mr-1" />Cooldown</Badge>}
                            {overDaily && <Badge tone="warning">Over daily cap</Badge>}
                            {overMin && <Badge tone="warning">Over per-min</Badge>}
                          </div>
                        </td>
                        <td className="p-3 text-right space-x-1 whitespace-nowrap">
                          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => callAction("apply_cooldown", { user_id: r.user_id, minutes: 60 }, "Cooldown")}>
                            <Clock className="w-3 h-3 mr-1" /> 60m
                          </Button>
                          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => callAction("reset_user_counters", { user_id: r.user_id }, "Counters reset")}>
                            <RotateCcw className="w-3 h-3 mr-1" /> Reset
                          </Button>
                          {r.is_flagged ? (
                            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => callAction("unflag_user", { user_id: r.user_id }, "Unflag")}>
                              <ShieldOff className="w-3 h-3 mr-1" /> Unflag
                            </Button>
                          ) : (
                            <Button size="sm" variant="destructive" disabled={!!busy} onClick={() => {
                              const reason = prompt("Reason for flagging?", "Suspicious bulk activity");
                              if (reason !== null) callAction("flag_user", { user_id: r.user_id, reason }, "Flag");
                            }}>
                              <Flag className="w-3 h-3 mr-1" /> Flag
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No abuse candidates right now. ✨</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-muted/30 border-dashed">
        <CardContent className="p-4 text-xs text-muted-foreground">
          Flagging blocks all new generations (translation + audio). Cooldown blocks new generations until expiry. Both leave existing unlocks playable.
        </CardContent>
      </Card>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "destructive" | "warning" }) {
  const cls = tone === "destructive"
    ? "bg-destructive/15 text-destructive"
    : "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded ${cls}`}>{children}</span>;
}
