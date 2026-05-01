import { useEffect, useRef, useState } from "react";
import { Loader2, Languages, Sparkles, RefreshCw, Play, Pause, ListPlus, AlertCircle, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TARGET_LANGS = ["zu", "xh", "tn", "nso"] as const;
const LANG_LABEL: Record<string, string> = {
  zu: "Zulu", xh: "Xhosa", tn: "Setswana", nso: "Sepedi",
};

type SeedDoc = {
  id: string;
  title: string;
  char_count: number;
  seed_translation: boolean;
  translation_status: "pending" | "processing" | "done" | "failed";
  cached_per_lang: Record<string, number>;
  total_chunks_est: number;
};

type QueueStatus = {
  counts: { pending: number; processing: number; done: number; failed: number };
  worker: {
    is_running: boolean;
    last_heartbeat: string | null;
    current_document_id: string | null;
    current_language: string | null;
    total_processed: number;
    last_error: string | null;
  } | null;
};

const statusColors: Record<SeedDoc["translation_status"], string> = {
  pending: "bg-muted text-muted-foreground",
  processing: "bg-primary/10 text-primary",
  done: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
};

export default function AdminSeedTranslations() {
  const [docs, setDocs] = useState<SeedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [enqueuingDoc, setEnqueuingDoc] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [togglingDoc, setTogglingDoc] = useState<string | null>(null);
  const tickRef = useRef<number | null>(null);

  async function loadDocs() {
    const { data: docRows, error } = await supabase
      .from("documents")
      .select("id, title, char_count, seed_translation, translation_status, seed_audio")
      .or("seed_audio.eq.true,seed_translation.eq.true")
      .order("title", { ascending: true });
    if (error) { toast.error(error.message); return; }
    const ids = (docRows ?? []).map((d) => d.id);
    const cachedByDocLang = new Map<string, Record<string, number>>();
    if (ids.length > 0) {
      const { data: assets } = await supabase
        .from("translation_assets")
        .select("document_id, target_language")
        .in("document_id", ids)
        .in("target_language", TARGET_LANGS as unknown as string[]);
      (assets ?? []).forEach((a) => {
        const m = cachedByDocLang.get(a.document_id) ?? {};
        m[a.target_language] = (m[a.target_language] ?? 0) + 1;
        cachedByDocLang.set(a.document_id, m);
      });
    }
    setDocs(
      (docRows ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        char_count: d.char_count,
        seed_translation: !!d.seed_translation,
        translation_status: (d.translation_status ?? "pending") as SeedDoc["translation_status"],
        cached_per_lang: cachedByDocLang.get(d.id) ?? {},
        total_chunks_est: Math.max(1, Math.ceil((d.char_count || 0) / 700)),
      })),
    );
  }

  async function loadQueueStatus() {
    const { data, error } = await supabase.functions.invoke("seed-translation-manager", {
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
      supabase.functions.invoke("seed-translation-worker", { body: {} }).catch(() => {});
      await Promise.all([loadDocs(), loadQueueStatus()]);
    }, 8000);
    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, [queueStatus?.worker?.is_running]);

  async function callManager(action: string, body: Record<string, unknown> = {}, label?: string) {
    setBusyAction(label ?? action);
    try {
      const { data, error } = await supabase.functions.invoke("seed-translation-manager", {
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

  async function toggleSeed(doc: SeedDoc, value: boolean) {
    setTogglingDoc(doc.id);
    // Optimistic update so the switch flips immediately.
    setDocs((prev) => prev.map((x) => x.id === doc.id ? { ...x, seed_translation: value } : x));
    try {
      const { error } = await supabase.functions.invoke("seed-translation-manager", {
        body: { action: "set_seed", document_id: doc.id, value },
      });
      if (error) throw error;
      toast.success(value ? "Marked for translation seeding" : "Translation seeding disabled");
      await loadDocs();
    } catch (e) {
      // Revert on failure
      setDocs((prev) => prev.map((x) => x.id === doc.id ? { ...x, seed_translation: !value } : x));
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTogglingDoc(null);
    }
  }

  async function enqueueDoc(docId: string) {
    setEnqueuingDoc(docId);
    try {
      const data = await callManager("enqueue", { document_id: docId }, `enqueue:${docId}`);
      toast.success(`Queued ${data.added} chunk-language pairs (${data.skipped} already cached/queued).`);
      await refreshAll();
    } catch { /* */ }
    finally { setEnqueuingDoc(null); }
  }

  async function enqueueAll() {
    try {
      const data = await callManager("enqueue_all", {}, "enqueue_all");
      toast.success(`Queued ${data.total_added} chunk-language pairs across ${data.documents.length} books.`);
      await refreshAll();
    } catch { /* */ }
  }

  async function startWorker() {
    try {
      await callManager("start", {}, "start");
      toast.success("Translation worker started.");
      supabase.functions.invoke("seed-translation-worker", { body: {} }).catch(() => {});
      await loadQueueStatus();
    } catch { /* */ }
  }

  async function pauseWorker() {
    try {
      await callManager("pause", {}, "pause");
      toast.success("Worker paused.");
      await loadQueueStatus();
    } catch { /* */ }
  }

  async function resetStuck() {
    try {
      const data = await callManager("reset_stuck", {}, "reset_stuck");
      toast.success(`Reset ${data.reset} stuck rows back to pending.`);
      await refreshAll();
    } catch { /* */ }
  }

  async function clearFailed() {
    try {
      const data = await callManager("clear_failed", {}, "clear_failed");
      toast.success(`Removed ${data.deleted} failed rows.`);
      await refreshAll();
    } catch { /* */ }
  }

  const isRunning = queueStatus?.worker?.is_running ?? false;
  const counts = queueStatus?.counts ?? { pending: 0, processing: 0, done: 0, failed: 0 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Seed translations</h1>
        <p className="text-muted-foreground text-sm">
          Pre-translate seeded books into Zulu, Xhosa, Setswana, and Sepedi. Cron pings the worker every 5 minutes while it's running.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Languages className="w-5 h-5" /> Translation queue worker
          </CardTitle>
          <CardDescription>
            Drains the queue one chunk × language at a time. Cached translations are skipped; existing rows are never overwritten.
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
              Add all flagged books to queue
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
              ? <>Worker is <span className="text-primary font-medium">running</span>. Cron pings every 5 min; this tab pings every 8s.</>
              : <>Worker is <span className="font-medium">paused</span>.</>}
            {queueStatus?.worker?.current_language && isRunning && (
              <span className="ml-2">· Current: <span className="font-mono">{queueStatus.worker.current_language}</span></span>
            )}
            {queueStatus?.worker?.last_error && (
              <span className="ml-2 text-destructive">· Last: {queueStatus.worker.last_error}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Books</CardTitle>
          <CardDescription>
            Toggle <span className="font-mono">seed_translation</span> on a book and click "Add to queue" to start.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No seeded books yet.</p>
          ) : (
            <div className="space-y-3">
              {docs.map((d) => {
                const isCurrent = queueStatus?.worker?.current_document_id === d.id;
                const totalCells = d.total_chunks_est * TARGET_LANGS.length;
                const totalCached = TARGET_LANGS.reduce((s, l) => s + (d.cached_per_lang[l] ?? 0), 0);
                const pct = Math.min(100, Math.round((totalCached / totalCells) * 100));
                // Derive a display status from actual cache + current worker activity,
                // not the stale global `translation_status` field on the document row.
                const displayStatus: SeedDoc["translation_status"] =
                  isCurrent ? "processing"
                  : totalCached >= totalCells && totalCells > 0 ? "done"
                  : totalCached > 0 ? "processing"
                  : !d.seed_translation ? "pending"
                  : "pending";
                return (
                  <div key={d.id} className={`border rounded-lg p-4 space-y-2 ${isCurrent ? "border-primary/50 bg-primary/5" : ""}`}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="font-medium truncate flex items-center gap-2">
                          {d.title}
                          {isCurrent && <Badge variant="secondary" className="bg-primary/10 text-primary">processing now</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {d.char_count.toLocaleString()} chars · ~{d.total_chunks_est} chunks × 4 langs
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">seed</span>
                          <Switch
                            checked={d.seed_translation}
                            disabled={togglingDoc === d.id}
                            onCheckedChange={(v) => toggleSeed(d, v)}
                          />
                        </div>
                        <Badge className={statusColors[displayStatus]} variant="secondary">
                          {displayStatus}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => enqueueDoc(d.id)}
                          disabled={enqueuingDoc === d.id || !d.seed_translation}
                        >
                          {enqueuingDoc === d.id
                            ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            : <ListPlus className="w-3.5 h-3.5 mr-1.5" />}
                          Add to queue
                        </Button>
                      </div>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      {TARGET_LANGS.map((l) => {
                        const done = d.cached_per_lang[l] ?? 0;
                        const lpct = Math.min(100, Math.round((done / d.total_chunks_est) * 100));
                        return (
                          <div key={l} className="border rounded px-2 py-1 flex items-center justify-between gap-2">
                            <span className="font-medium">{LANG_LABEL[l]}</span>
                            <span className="font-mono text-muted-foreground">{done}/{d.total_chunks_est} · {lpct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: "default" | "primary" | "success" | "destructive" }) {
  const toneClass = {
    default: "bg-muted text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    destructive: "bg-destructive/15 text-destructive",
  }[tone];
  return (
    <div className="border rounded-lg p-3">
      <div className={`inline-flex items-center text-xs px-2 py-0.5 rounded ${toneClass}`}>{label}</div>
      <div className="text-2xl font-display font-bold mt-1 flex items-center gap-2">
        {value.toLocaleString()}
        {label === "Failed" && value > 0 && <AlertCircle className="w-4 h-4 text-destructive" />}
      </div>
    </div>
  );
}
