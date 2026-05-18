import { useEffect, useRef, useState } from "react";
import { Loader2, Languages, RefreshCw, Play, Pause, ListPlus, AlertCircle, Trash2, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  queue_counts: { pending: number; processing: number; done: number; failed: number };
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

type Category = "rate_limited" | "skipped" | "failed" | "other_pending";
type Breakdown = {
  total_rows: number;
  by_language: Record<string, Record<Category, number>>;
  by_attempts: Record<string, Record<Category, number>>;
  documents: Array<{
    document_id: string; title: string;
    rate_limited: number; skipped: number; failed: number; other_pending: number;
    max_attempts: number; sample_error: string | null;
  }>;
  top_errors: Array<{ message: string; count: number }>;
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
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(true);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);
  const tickRef = useRef<number | null>(null);

  async function loadBreakdown() {
    setLoadingBreakdown(true);
    try {
      const { data, error } = await supabase.functions.invoke("seed-translation-manager", {
        body: { action: "breakdown" },
      });
      if (error) throw error;
      setBreakdown({
        total_rows: data.total_rows,
        by_language: data.by_language ?? {},
        by_attempts: data.by_attempts ?? {},
        documents: data.documents ?? [],
        top_errors: data.top_errors ?? [],
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingBreakdown(false);
    }
  }

  async function retryRows(filters: { document_id?: string; target_language?: string; category?: "rate_limited" | "failed" | "all_failed" }) {
    try {
      const { data, error } = await supabase.functions.invoke("seed-translation-manager", {
        body: { action: "retry", ...filters },
      });
      if (error) throw error;
      toast.success(`Re-queued ${data?.retried ?? 0} rows.`);
      await Promise.all([loadBreakdown(), loadQueueStatus(), loadDocs()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadDocs() {
    const { data: docRows, error } = await supabase
      .from("documents")
      .select("id, title, char_count, seed_translation, translation_status, seed_audio")
      .or("seed_audio.eq.true,seed_translation.eq.true")
      .order("title", { ascending: true });
    if (error) { toast.error(error.message); return; }
    const ids = (docRows ?? []).map((d) => d.id);
    const cachedByDocLang = new Map<string, Record<string, number>>();
    const queueByDoc = new Map<string, SeedDoc["queue_counts"]>();
    if (ids.length > 0) {
      const [{ data: assets }, { data: queueRows }] = await Promise.all([
        supabase
          .from("translation_assets")
          .select("document_id, target_language")
          .in("document_id", ids)
          .in("target_language", TARGET_LANGS as unknown as string[]),
        supabase
          .from("translation_seed_queue")
          .select("document_id, status")
          .in("document_id", ids),
      ]);
      (assets ?? []).forEach((a) => {
        const m = cachedByDocLang.get(a.document_id) ?? {};
        m[a.target_language] = (m[a.target_language] ?? 0) + 1;
        cachedByDocLang.set(a.document_id, m);
      });
      (queueRows ?? []).forEach((row) => {
        const counts = queueByDoc.get(row.document_id) ?? { pending: 0, processing: 0, done: 0, failed: 0 };
        const status = row.status as keyof SeedDoc["queue_counts"];
        if (status in counts) counts[status] += 1;
        queueByDoc.set(row.document_id, counts);
      });
    }
    setDocs(
      (docRows ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        char_count: d.char_count,
        seed_translation: !!d.seed_translation,
        translation_status: (d.translation_status ?? "pending") as SeedDoc["translation_status"],
        queue_counts: queueByDoc.get(d.id) ?? { pending: 0, processing: 0, done: 0, failed: 0 },
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
    if (breakdownOpen) await loadBreakdown();
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
        <Collapsible open={breakdownOpen} onOpenChange={setBreakdownOpen}>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" /> Retry & error breakdown
                </CardTitle>
                <CardDescription>
                  Rate-limited, failed, and skipped chunks broken down by target language and attempt count.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={loadBreakdown} variant="ghost" size="sm" disabled={loadingBreakdown}>
                  {loadingBreakdown
                    ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                  Refresh
                </Button>
                <Button
                  onClick={() => retryRows({ category: "all_failed" })}
                  variant="outline" size="sm"
                  disabled={!breakdown || (breakdown.documents.reduce((s, d) => s + d.failed + d.rate_limited, 0) === 0)}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Retry all failed
                </Button>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm">
                    {breakdownOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </Button>
                </CollapsibleTrigger>
              </div>
            </div>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-6">
              {!breakdown ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading breakdown…
                </div>
              ) : breakdown.total_rows === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No retried, failed, or skipped rows. 🎉
                </p>
              ) : (
                <>
                  {/* By language */}
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      By target language
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground border-b">
                            <th className="py-1.5 pr-3">Language</th>
                            <th className="py-1.5 px-2 text-right">Rate-limited</th>
                            <th className="py-1.5 px-2 text-right">Failed</th>
                            <th className="py-1.5 px-2 text-right">Skipped</th>
                            <th className="py-1.5 px-2 text-right">Other</th>
                            <th className="py-1.5 pl-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {TARGET_LANGS.map((l) => {
                            const r = breakdown.by_language[l] ?? { rate_limited: 0, failed: 0, skipped: 0, other_pending: 0 };
                            return (
                              <tr key={l} className="border-b last:border-b-0">
                                <td className="py-1.5 pr-3 font-medium">{LANG_LABEL[l]}</td>
                                <td className="py-1.5 px-2 text-right font-mono">{r.rate_limited}</td>
                                <td className="py-1.5 px-2 text-right font-mono">{r.failed}</td>
                                <td className="py-1.5 px-2 text-right font-mono">{r.skipped}</td>
                                <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{r.other_pending}</td>
                                <td className="py-1.5 pl-2 text-right">
                                  <Button
                                    size="sm" variant="ghost"
                                    disabled={r.rate_limited + r.failed === 0}
                                    onClick={() => retryRows({ target_language: l, category: "all_failed" })}
                                  >
                                    <RotateCcw className="w-3 h-3 mr-1" /> Retry
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* By attempts */}
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      By attempt count
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                      {Object.keys(breakdown.by_attempts)
                        .sort((a, b) => Number(a) - Number(b))
                        .map((k) => {
                          const r = breakdown.by_attempts[k];
                          const total = r.rate_limited + r.failed + r.skipped + r.other_pending;
                          return (
                            <div key={k} className="border rounded p-2 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="font-medium">attempt {k}</span>
                                <span className="font-mono text-muted-foreground">{total}</span>
                              </div>
                              <div className="mt-1 space-y-0.5 text-muted-foreground">
                                <div className="flex justify-between"><span>rate-limited</span><span className="font-mono">{r.rate_limited}</span></div>
                                <div className="flex justify-between"><span>failed</span><span className="font-mono">{r.failed}</span></div>
                                <div className="flex justify-between"><span>skipped</span><span className="font-mono">{r.skipped}</span></div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {/* Per-document */}
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      Top documents with issues
                    </div>
                    <div className="space-y-2">
                      {breakdown.documents.map((d) => (
                        <div key={d.document_id} className="border rounded-lg p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="font-medium truncate">{d.title}</div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {d.rate_limited > 0 && (
                                <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
                                  rate-limited {d.rate_limited}
                                </Badge>
                              )}
                              {d.failed > 0 && (
                                <Badge variant="secondary" className="bg-destructive/15 text-destructive">
                                  failed {d.failed}
                                </Badge>
                              )}
                              {d.skipped > 0 && (
                                <Badge variant="secondary" className="bg-muted text-muted-foreground">
                                  skipped {d.skipped}
                                </Badge>
                              )}
                              <Badge variant="outline" className="font-mono">max {d.max_attempts} attempts</Badge>
                              <Button
                                size="sm" variant="outline"
                                disabled={d.rate_limited + d.failed === 0}
                                onClick={() => retryRows({ document_id: d.document_id, category: "all_failed" })}
                              >
                                <RotateCcw className="w-3 h-3 mr-1" /> Retry
                              </Button>
                            </div>
                          </div>
                          {d.sample_error && (
                            <div className="text-xs text-muted-foreground font-mono truncate" title={d.sample_error}>
                              {d.sample_error}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Top error messages */}
                  {breakdown.top_errors.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                        Top error messages
                      </div>
                      <div className="space-y-1">
                        {breakdown.top_errors.map((e, i) => (
                          <div key={i} className="flex items-start justify-between gap-3 text-xs border rounded px-2 py-1">
                            <span className="font-mono truncate flex-1" title={e.message}>{e.message}</span>
                            <span className="font-mono text-muted-foreground shrink-0">×{e.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
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
                const queueOutstanding = d.queue_counts.pending + d.queue_counts.processing + d.queue_counts.failed;
                const hasQueueHistory = Object.values(d.queue_counts).some((count) => count > 0);
                const displayStatus: SeedDoc["translation_status"] =
                  d.translation_status === "done" || (d.seed_translation && hasQueueHistory && queueOutstanding === 0) ? "done"
                  : d.queue_counts.failed > 0 || d.translation_status === "failed" ? "failed"
                  : isCurrent || d.queue_counts.pending > 0 || d.queue_counts.processing > 0 || d.translation_status === "processing" ? "processing"
                  : "pending";
                const pct = displayStatus === "done" ? 100 : Math.min(100, Math.round((totalCached / totalCells) * 100));
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
