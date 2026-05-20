import { useEffect, useRef, useState } from "react";
import { Loader2, BookOpenCheck, Sparkles, RefreshCw, Play, Pause, ListPlus, AlertCircle, Trash2, FileText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type SeedDoc = {
  id: string;
  title: string;
  char_count: number;
  seed_audio_status: "pending" | "cleaning" | "processing" | "done" | "failed";
  seed_audio_progress: number;
  seed_audio_error: string | null;
  current_chunk_index: number | null;
  last_error: string | null;
  cached_chunks: number;
  queue_pending: number;
  queue_processing: number;
  queue_done: number;
  queue_failed: number;
  queue_total: number;
};

type SeedLog = {
  id: number;
  document_id: string;
  chunk_index: number;
  status: "started" | "success" | "failed" | "rate_limited";
  error_message: string | null;
  retry_count: number;
  created_at: string;
};

type QueueStatus = {
  counts: { pending: number; processing: number; done: number; failed: number };
  worker: {
    is_running: boolean;
    last_heartbeat: string | null;
    current_document_id: string | null;
    total_processed: number;
    last_error: string | null;
  } | null;
};

const statusColors: Record<SeedDoc["seed_audio_status"], string> = {
  pending: "bg-muted text-muted-foreground",
  cleaning: "bg-secondary text-secondary-foreground",
  processing: "bg-primary/10 text-primary",
  done: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
};

export default function AdminSeedAudio() {
  const [docs, setDocs] = useState<SeedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [seedingTexts, setSeedingTexts] = useState(false);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [enqueuingDoc, setEnqueuingDoc] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [logsDoc, setLogsDoc] = useState<SeedDoc | null>(null);
  const [logs, setLogs] = useState<SeedLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const tickRef = useRef<number | null>(null);

  async function loadDocs() {
    const { data: docRows, error } = await supabase
      .from("documents")
      .select("id, title, char_count, seed_audio_status, seed_audio_progress, seed_audio_error, current_chunk_index, last_error")
      .eq("seed_audio", true)
      .order("title", { ascending: true });
    if (error) { toast.error(error.message); return; }
    const ids = (docRows ?? []).map((d) => d.id);
    const cachedCounts = new Map<string, number>();
    const queueCounts = new Map<string, { pending: number; processing: number; done: number; failed: number }>();
    if (ids.length > 0) {
      // Count any cached audio (Gemini or Azure) per doc.
      const { data: assets } = await supabase
        .from("audio_assets")
        .select("document_id")
        .in("document_id", ids)
        .eq("language", "en");
      (assets ?? []).forEach((a) => {
        cachedCounts.set(a.document_id, (cachedCounts.get(a.document_id) ?? 0) + 1);
      });
      // True queue totals per doc — the source of truth for "how many chunks".
      const { data: qrows } = await supabase
        .from("seed_queue")
        .select("document_id, status")
        .in("document_id", ids);
      (qrows ?? []).forEach((r) => {
        const cur = queueCounts.get(r.document_id) ?? { pending: 0, processing: 0, done: 0, failed: 0 };
        if (r.status === "pending") cur.pending++;
        else if (r.status === "processing") cur.processing++;
        else if (r.status === "done") cur.done++;
        else if (r.status === "failed") cur.failed++;
        queueCounts.set(r.document_id, cur);
      });
    }
    setDocs(
      (docRows ?? []).map((d) => {
        const q = queueCounts.get(d.id) ?? { pending: 0, processing: 0, done: 0, failed: 0 };
        return {
          ...d,
          seed_audio_status: d.seed_audio_status as SeedDoc["seed_audio_status"],
          cached_chunks: cachedCounts.get(d.id) ?? 0,
          queue_pending: q.pending,
          queue_processing: q.processing,
          queue_done: q.done,
          queue_failed: q.failed,
          queue_total: q.pending + q.processing + q.done + q.failed,
        };
      }),
    );
  }

  async function openLogs(doc: SeedDoc) {
    setLogsDoc(doc);
    setLogsLoading(true);
    setLogs([]);
    const { data, error } = await supabase
      .from("seed_logs")
      .select("id, document_id, chunk_index, status, error_message, retry_count, created_at")
      .eq("document_id", doc.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) toast.error(error.message);
    else setLogs((data ?? []) as SeedLog[]);
    setLogsLoading(false);
  }

  async function loadQueueStatus() {
    const { data, error } = await supabase.functions.invoke("seed-queue-manager", {
      body: { action: "status" },
    });
    if (error) { console.error(error); return; }
    setQueueStatus({ counts: data.counts, worker: data.worker });
  }

  async function refreshAll() {
    setLoading(true);
    await Promise.all([loadDocs(), loadQueueStatus()]);
    setLoading(false);
  }

  useEffect(() => { refreshAll(); }, []);

  // Auto-tick: while worker is running, ping it every 8s and refresh status.
  useEffect(() => {
    if (!queueStatus?.worker?.is_running) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    if (tickRef.current) return;
    tickRef.current = window.setInterval(async () => {
      // Fire-and-forget worker ping; ignore errors (another invocation may already be running)
      supabase.functions.invoke("seed-queue-worker", { body: {} }).catch(() => {});
      await Promise.all([loadDocs(), loadQueueStatus()]);
    }, 8000);
    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, [queueStatus?.worker?.is_running]);

  async function seedTexts() {
    setSeedingTexts(true);
    try {
      const { data, error } = await supabase.functions.invoke("seed-curriculum", { body: {} });
      if (error) throw error;
      toast.success(`Seeded ${data?.total ?? 0} books.`);
      await refreshAll();
    } catch (e) {
      toast.error(`Seeding failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSeedingTexts(false);
    }
  }

  async function callManager(action: string, body: Record<string, unknown> = {}, label?: string) {
    setBusyAction(label ?? action);
    try {
      const { data, error } = await supabase.functions.invoke("seed-queue-manager", {
        body: { action, ...body },
      });
      if (error) throw error;
      return data;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusyAction(null);
    }
  }

  async function enqueueDoc(docId: string) {
    setEnqueuingDoc(docId);
    try {
      const data = await callManager("enqueue", { document_id: docId }, `enqueue:${docId}`);
      toast.success(`Queued ${data.added} new chunks (${data.skipped} already cached/queued).`);
      await refreshAll();
    } catch { /* toast already shown */ }
    finally { setEnqueuingDoc(null); }
  }

  async function enqueueAll() {
    try {
      const data = await callManager("enqueue_all", {}, "enqueue_all");
      toast.success(`Queued ${data.total_added} chunks across ${data.documents.length} books.`);
      await refreshAll();
    } catch { /* */ }
  }

  async function startWorker() {
    try {
      await callManager("start", {}, "start");
      toast.success("Worker started — processing one chunk at a time.");
      // Kick it immediately
      supabase.functions.invoke("seed-queue-worker", { body: {} }).catch(() => {});
      await loadQueueStatus();
    } catch { /* */ }
  }

  async function pauseWorker() {
    try {
      await callManager("pause", {}, "pause");
      toast.success("Worker paused. Current chunk will finish, then it stops.");
      await loadQueueStatus();
    } catch { /* */ }
  }

  async function resetStuck() {
    try {
      const data = await callManager("reset_stuck", {}, "reset_stuck");
      toast.success(`Reset ${data.reset} stuck chunks back to pending.`);
      await refreshAll();
    } catch { /* */ }
  }

  async function clearFailed() {
    try {
      const data = await callManager("clear_failed", {}, "clear_failed");
      toast.success(`Removed ${data.deleted} failed chunks.`);
      await refreshAll();
    } catch { /* */ }
  }

  const totalCached = docs.reduce((s, d) => s + d.cached_chunks, 0);
  const totalDone = docs.filter((d) => d.seed_audio_status === "done").length;
  const isRunning = queueStatus?.worker?.is_running ?? false;
  const counts = queueStatus?.counts ?? { pending: 0, processing: 0, done: 0, failed: 0 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Seed audio</h1>
        <p className="text-muted-foreground text-sm">
          Single global queue worker. One chunk at a time, 5s between requests, 30s pause every 10 chunks.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpenCheck className="w-5 h-5" /> Step 1 — Seed book texts
          </CardTitle>
          <CardDescription>
            Downloads cleaned text from Project Gutenberg into the documents table. Idempotent.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3 flex-wrap">
          <Button onClick={seedTexts} disabled={seedingTexts}>
            {seedingTexts ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Seed / refresh book texts
          </Button>
          <span className="text-sm text-muted-foreground">
            {docs.length} books · {totalDone} fully narrated · {totalCached} chunks cached
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" /> Step 2 — Global queue worker
          </CardTitle>
          <CardDescription>
            Processes the global queue one chunk at a time. Safe, slow, and rate-limit friendly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile label="Pending" value={counts.pending} tone="default" />
            <StatTile label="Processing" value={counts.processing} tone="primary" />
            <StatTile label="Done" value={counts.done} tone="success" />
            <StatTile label="Failed" value={counts.failed} tone="destructive" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={enqueueAll} variant="outline" disabled={busyAction === "enqueue_all"}>
              {busyAction === "enqueue_all"
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <ListPlus className="w-4 h-4 mr-2" />}
              Add all books to queue
            </Button>
            {isRunning ? (
              <Button onClick={pauseWorker} variant="secondary" disabled={busyAction === "pause"}>
                {busyAction === "pause"
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <Pause className="w-4 h-4 mr-2" />}
                Pause worker
              </Button>
            ) : (
              <Button onClick={startWorker} disabled={busyAction === "start"}>
                {busyAction === "start"
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <Play className="w-4 h-4 mr-2" />}
                Start worker
              </Button>
            )}
            <Button onClick={resetStuck} variant="ghost" size="sm" disabled={busyAction === "reset_stuck"}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Reset stuck
            </Button>
            <Button onClick={clearFailed} variant="ghost" size="sm" disabled={busyAction === "clear_failed"}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Clear failed
            </Button>
            <Button onClick={refreshAll} variant="ghost" size="sm">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
          </div>

          <div className="text-xs text-muted-foreground">
            {isRunning
              ? <>Worker is <span className="text-primary font-medium">running</span>. Keep this tab open — it pings the worker every 8s.</>
              : <>Worker is <span className="font-medium">paused</span>.</>}
            {queueStatus?.worker?.last_error && (
              <span className="ml-2 text-destructive">· Last: {queueStatus.worker.last_error}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Books</CardTitle>
          <CardDescription>Add a single book to the queue, or watch progress as the worker runs.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No seeded books yet. Run Step 1 first.</p>
          ) : (
            <div className="space-y-3">
              {docs.map((d) => {
                // Prefer the real queue total (matches worker's 1800-char chunking).
                // Fall back to char_count/1800 if the doc was never enqueued.
                const totalEst = d.queue_total > 0
                  ? d.queue_total
                  : Math.max(1, Math.ceil((d.char_count || 0) / 1800));
                const completed = d.queue_done > 0 ? d.queue_done : d.cached_chunks;
                const pct = Math.min(100, Math.round((completed / totalEst) * 100));
                const isCurrent = queueStatus?.worker?.current_document_id === d.id;
                return (
                  <div key={d.id} className={`border rounded-lg p-4 space-y-2 ${isCurrent ? "border-primary/50 bg-primary/5" : ""}`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="font-medium truncate flex items-center gap-2">
                          {d.title}
                          {isCurrent && <Badge variant="secondary" className="bg-primary/10 text-primary">processing now</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {d.char_count.toLocaleString()} chars · {totalEst} chunks · {d.cached_chunks} cached
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={statusColors[d.seed_audio_status]} variant="secondary">
                          {d.seed_audio_status}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => enqueueDoc(d.id)}
                          disabled={enqueuingDoc === d.id || d.seed_audio_status === "done"}
                        >
                          {enqueuingDoc === d.id
                            ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            : <ListPlus className="w-3.5 h-3.5 mr-1.5" />}
                          Add to queue
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openLogs(d)}>
                          <FileText className="w-3.5 h-3.5 mr-1.5" />
                          View logs
                        </Button>
                      </div>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                      <span>Done: <span className="font-mono text-foreground">{completed}/{totalEst}</span></span>
                      <span>Pending: <span className="font-mono text-foreground">{d.queue_pending}</span></span>
                      {d.queue_processing > 0 && <span>Processing: <span className="font-mono text-primary">{d.queue_processing}</span></span>}
                      {d.queue_failed > 0 && <span>Failed: <span className="font-mono text-destructive">{d.queue_failed}</span></span>}
                      <span>Current: <span className="font-mono text-foreground">{d.current_chunk_index ?? "—"}</span></span>
                      {isCurrent && <span className="text-primary">● live</span>}
                    </div>
                    {d.last_error && (
                      <div className="text-xs text-destructive flex items-start gap-1.5 mt-1">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span className="break-all">{d.last_error}</span>
                      </div>
                    )}
                    {d.seed_audio_error && d.seed_audio_error !== d.last_error && (
                      <div className="text-xs text-destructive flex items-start gap-1.5 mt-1">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        <span className="break-all">{d.seed_audio_error}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!logsDoc} onOpenChange={(o) => !o && setLogsDoc(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Logs — {logsDoc?.title}</DialogTitle>
            <DialogDescription>Last 20 chunk events for this book.</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto -mx-6 px-6">
            {logsLoading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
              </div>
            ) : logs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No logs yet.</p>
            ) : (
              <div className="space-y-1.5">
                {logs.map((l) => (
                  <div key={l.id} className="text-xs border rounded-md p-2 flex items-start gap-3">
                    <Badge variant="secondary" className={logStatusColors[l.status]}>
                      {l.status}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono">chunk #{l.chunk_index}</span>
                        <span className="text-muted-foreground">retry: {l.retry_count}</span>
                        <span className="text-muted-foreground">{new Date(l.created_at).toLocaleTimeString()}</span>
                      </div>
                      {l.error_message && (
                        <div className="text-destructive break-all mt-0.5">{l.error_message}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const logStatusColors: Record<SeedLog["status"], string> = {
  started: "bg-muted text-muted-foreground",
  success: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  rate_limited: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
};

function StatTile({ label, value, tone }: { label: string; value: number; tone: "default" | "primary" | "success" | "destructive" }) {
  const toneCls = {
    default: "bg-muted text-foreground",
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    destructive: "bg-destructive/15 text-destructive",
  }[tone];
  return (
    <div className={`rounded-lg p-3 ${toneCls}`}>
      <div className="text-xs uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
    </div>
  );
}
