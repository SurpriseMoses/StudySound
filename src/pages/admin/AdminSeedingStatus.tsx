import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type DocRow = {
  id: string;
  title: string;
  seed_audio: boolean;
  seed_translation: boolean;
  seed_audio_status: string;
  translation_status: string;
  audio_pending: number;
  audio_processing: number;
  audio_failed: number;
  trans_pending: number;
  trans_processing: number;
  trans_failed: number;
};

type WorkerState = {
  is_running: boolean;
  current_document_id: string | null;
  current_language: string | null;
  last_heartbeat: string | null;
  total_processed: number;
  last_error: string | null;
};

const STUCK_MS = 5 * 60 * 1000; // 5 min

function workerHealth(w: WorkerState | null) {
  if (!w) return { label: "unknown", stuck: false, ageSec: null as number | null };
  if (!w.is_running) return { label: "idle", stuck: false, ageSec: null };
  const age = w.last_heartbeat ? Date.now() - new Date(w.last_heartbeat).getTime() : Infinity;
  return {
    label: age > STUCK_MS ? "stuck" : "running",
    stuck: age > STUCK_MS,
    ageSec: Number.isFinite(age) ? Math.round(age / 1000) : null,
  };
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    done: "bg-emerald-500/15 text-emerald-700",
    processing: "bg-blue-500/15 text-blue-700",
    pending: "bg-amber-500/15 text-amber-700",
    failed: "bg-red-500/15 text-red-700",
  };
  return (
    <span className={cn("text-[11px] px-1.5 py-0.5 rounded font-medium", map[status] ?? "bg-muted text-muted-foreground")}>
      {status}
    </span>
  );
}

export default function AdminSeedingStatus() {
  const [rows, setRows] = useState<DocRow[]>([]);
  const [audioWorker, setAudioWorker] = useState<WorkerState | null>(null);
  const [transWorker, setTransWorker] = useState<WorkerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "stuck">("all");

  const load = async () => {
    setLoading(true);
    const [docsRes, audioQ, transQ, audioWS, transWS] = await Promise.all([
      supabase
        .from("documents")
        .select("id, title, seed_audio, seed_translation, seed_audio_status, translation_status")
        .or("seed_audio.eq.true,seed_translation.eq.true")
        .order("title"),
      supabase.from("seed_queue").select("document_id, status"),
      supabase.from("translation_seed_queue").select("document_id, status"),
      supabase.from("seed_worker_state").select("*").eq("id", 1).maybeSingle(),
      supabase.from("translation_worker_state").select("*").eq("id", 1).maybeSingle(),
    ]);

    const audioCounts = new Map<string, { pending: number; processing: number; failed: number }>();
    (audioQ.data ?? []).forEach((r: any) => {
      const c = audioCounts.get(r.document_id) ?? { pending: 0, processing: 0, failed: 0 };
      if (r.status === "pending") c.pending++;
      else if (r.status === "processing") c.processing++;
      else if (r.status === "failed") c.failed++;
      audioCounts.set(r.document_id, c);
    });

    const transCounts = new Map<string, { pending: number; processing: number; failed: number }>();
    (transQ.data ?? []).forEach((r: any) => {
      const c = transCounts.get(r.document_id) ?? { pending: 0, processing: 0, failed: 0 };
      if (r.status === "pending") c.pending++;
      else if (r.status === "processing") c.processing++;
      else if (r.status === "failed") c.failed++;
      transCounts.set(r.document_id, c);
    });

    setRows(
      (docsRes.data ?? []).map((d: any) => {
        const a = audioCounts.get(d.id) ?? { pending: 0, processing: 0, failed: 0 };
        const t = transCounts.get(d.id) ?? { pending: 0, processing: 0, failed: 0 };
        return {
          id: d.id,
          title: d.title,
          seed_audio: d.seed_audio,
          seed_translation: d.seed_translation,
          seed_audio_status: d.seed_audio_status,
          translation_status: d.translation_status,
          audio_pending: a.pending,
          audio_processing: a.processing,
          audio_failed: a.failed,
          trans_pending: t.pending,
          trans_processing: t.processing,
          trans_failed: t.failed,
        };
      }),
    );
    setAudioWorker((audioWS.data as any) ?? null);
    setTransWorker((transWS.data as any) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 15_000);
    return () => clearInterval(i);
  }, []);

  const audioH = workerHealth(audioWorker);
  const transH = workerHealth(transWorker);

  const filtered = rows.filter((r) => {
    if (filter === "active") {
      return (
        (r.seed_audio && r.seed_audio_status !== "done") ||
        (r.seed_translation && r.translation_status !== "done")
      );
    }
    if (filter === "stuck") {
      return r.audio_failed > 0 || r.trans_failed > 0;
    }
    return true;
  });

  const totalAudioPending = rows.reduce((s, r) => s + r.audio_pending + r.audio_processing, 0);
  const totalTransPending = rows.reduce((s, r) => s + r.trans_pending + r.trans_processing, 0);
  const totalAudioFailed = rows.reduce((s, r) => s + r.audio_failed, 0);
  const totalTransFailed = rows.reduce((s, r) => s + r.trans_failed, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-display font-bold">Seeding status</h1>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { label: "Audio worker", w: audioWorker, h: audioH, pending: totalAudioPending, failed: totalAudioFailed },
          { label: "Translation worker", w: transWorker, h: transH, pending: totalTransPending, failed: totalTransFailed },
        ].map((x) => (
          <Card key={x.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between">
                {x.label}
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded inline-flex items-center gap-1",
                    x.h.label === "stuck"
                      ? "bg-red-500/15 text-red-700"
                      : x.h.label === "running"
                      ? "bg-emerald-500/15 text-emerald-700"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {x.h.label === "stuck" && <AlertTriangle className="w-3 h-3" />}
                  {x.h.label === "running" && <CheckCircle2 className="w-3 h-3" />}
                  {x.h.label === "idle" && <Clock className="w-3 h-3" />}
                  {x.h.label}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1 text-muted-foreground">
              <div>Pending+processing: <span className="text-foreground font-medium">{x.pending}</span></div>
              <div>Failed: <span className={cn("font-medium", x.failed > 0 ? "text-red-600" : "text-foreground")}>{x.failed}</span></div>
              <div>
                Heartbeat: {x.h.ageSec != null ? `${x.h.ageSec}s ago` : "—"}
                {x.h.stuck && <span className="text-red-600 ml-1">(stuck &gt;5m)</span>}
              </div>
              <div>Total processed: <span className="text-foreground">{x.w?.total_processed ?? 0}</span></div>
              {x.w?.last_error && <div className="text-red-600 truncate" title={x.w.last_error}>Err: {x.w.last_error}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {(["all", "active", "stuck"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "active" ? "Active only" : "With failures"}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground ml-2">{filtered.length} documents</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Title</th>
                  <th className="text-left p-3">Audio status</th>
                  <th className="text-right p-3" title="pending / processing / failed">Audio queue</th>
                  <th className="text-left p-3">Translation status</th>
                  <th className="text-right p-3" title="pending / processing / failed">Trans queue</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 font-medium max-w-[280px] truncate">{r.title}</td>
                    <td className="p-3">
                      {r.seed_audio ? <StatusPill status={r.seed_audio_status} /> : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {r.seed_audio ? (
                        <span>
                          <span className="text-amber-700">{r.audio_pending}</span> /{" "}
                          <span className="text-blue-700">{r.audio_processing}</span> /{" "}
                          <span className={r.audio_failed > 0 ? "text-red-600 font-semibold" : "text-muted-foreground"}>{r.audio_failed}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {r.seed_translation ? <StatusPill status={r.translation_status} /> : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {r.seed_translation ? (
                        <span>
                          <span className="text-amber-700">{r.trans_pending}</span> /{" "}
                          <span className="text-blue-700">{r.trans_processing}</span> /{" "}
                          <span className={r.trans_failed > 0 ? "text-red-600 font-semibold" : "text-muted-foreground"}>{r.trans_failed}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No documents match.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
