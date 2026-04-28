import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, RefreshCw, Search, Sparkles, Mic2, Languages,
  Play, Pause, AlertCircle, CheckCircle2, Clock, Filter,
} from "lucide-react";

type Lang = "zu" | "xh" | "af" | "st" | "tn";
const ALL_LANGS: Lang[] = ["zu", "xh", "af", "st", "tn"];
const LANG_LABEL: Record<string, string> = {
  zu: "isiZulu", xh: "isiXhosa", af: "Afrikaans", st: "Sesotho", tn: "Setswana",
};

type LangProgress = {
  language: string;
  done: number;
  total_estimate: number;
  pct: number;
  queue: { pending: number; in_progress: number; failed: number };
};

type PipelineDoc = {
  id: string;
  title: string;
  subject_type: string;
  language: string;
  is_seeded: boolean;
  char_count: number;
  cleaning_version: number;
  invalid_chunks: number[];
  updated_at: string;
  stages: {
    cleaning: { version: number; invalid: number };
    audio: {
      status: string;
      cached: number;
      total_estimate: number;
      pct: number;
      queue: { pending: number; in_progress: number; failed: number; done: number };
      error: string | null;
    };
    translation: { status: string; languages: LangProgress[] };
  };
};

type WorkerState = {
  audio: { is_running: boolean; counts: Record<string, number> } | null;
  trans: { is_running: boolean; counts: Record<string, number> } | null;
};

export default function AdminPipeline() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<PipelineDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [worker, setWorker] = useState<WorkerState>({ audio: null, trans: null });
  const tickRef = useRef<number | null>(null);

  const loadPipeline = async () => {
    const { data, error } = await supabase.functions.invoke("admin-api", {
      body: { action: "pipeline_status", limit: 200, languages: ALL_LANGS },
    });
    if (error) {
      toast({ title: "Failed to load pipeline", description: error.message, variant: "destructive" });
      return;
    }
    setDocs((data?.documents ?? []) as PipelineDoc[]);
  };

  const loadWorkerState = async () => {
    const [audioRes, transRes] = await Promise.all([
      supabase.functions.invoke("seed-queue-manager", { body: { action: "status" } }),
      supabase.functions.invoke("seed-translation-manager", { body: { action: "status" } }),
    ]);
    setWorker({
      audio: audioRes.data ? { is_running: !!audioRes.data.worker?.is_running, counts: audioRes.data.counts ?? {} } : null,
      trans: transRes.data ? { is_running: !!transRes.data.worker?.is_running, counts: transRes.data.counts ?? {} } : null,
    });
  };

  const refreshAll = async () => {
    setLoading(true);
    await Promise.all([loadPipeline(), loadWorkerState()]);
    setLoading(false);
  };

  useEffect(() => { refreshAll(); }, []);

  // Auto-poll while any worker runs
  useEffect(() => {
    const anyRunning = !!(worker.audio?.is_running || worker.trans?.is_running);
    if (!anyRunning) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    if (tickRef.current) return;
    tickRef.current = window.setInterval(() => {
      // Kick workers and refresh
      if (worker.audio?.is_running) supabase.functions.invoke("seed-queue-worker", { body: {} }).catch(() => {});
      if (worker.trans?.is_running) supabase.functions.invoke("seed-translation-worker", { body: {} }).catch(() => {});
      Promise.all([loadPipeline(), loadWorkerState()]);
    }, 8000);
    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, [worker.audio?.is_running, worker.trans?.is_running]);

  // Pipeline actions per document
  async function reclean(doc: PipelineDoc) {
    if (!confirm(`Re-clean "${doc.title}"?\n\nOverwrites clean_text, bumps cleaning_version. Existing audio is invalidated lazily on next play.`)) return;
    setBusy(`reclean:${doc.id}`);
    const { data, error } = await supabase.functions.invoke("admin-api", {
      body: { action: "reclean_document", document_id: doc.id },
    });
    setBusy(null);
    if (error || !data?.success) {
      toast({ title: "Re-clean failed", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Re-cleaned", description: `${data.chunks} chunks · ${data.invalid_chunks?.length ?? 0} skipped.` });
    await loadPipeline();
  }

  async function enqueueAudio(doc: PipelineDoc) {
    setBusy(`audio:${doc.id}`);
    const { data, error } = await supabase.functions.invoke("seed-queue-manager", {
      body: { action: "enqueue", document_id: doc.id },
    });
    setBusy(null);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Queued for audio", description: `${data?.added ?? 0} new chunks (${data?.skipped ?? 0} skipped).` });
    await refreshAll();
  }

  async function enqueueTranslation(doc: PipelineDoc, lang: Lang) {
    setBusy(`trans:${doc.id}:${lang}`);
    const { data, error } = await supabase.functions.invoke("seed-translation-manager", {
      body: { action: "enqueue", document_id: doc.id, target_language: lang },
    });
    setBusy(null);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Queued ${LANG_LABEL[lang]}`, description: `${data?.added ?? 0} chunks.` });
    await refreshAll();
  }

  async function enqueueAllTranslations(doc: PipelineDoc) {
    setBusy(`transAll:${doc.id}`);
    let total = 0;
    for (const lang of ALL_LANGS) {
      const { data } = await supabase.functions.invoke("seed-translation-manager", {
        body: { action: "enqueue", document_id: doc.id, target_language: lang },
      });
      total += data?.added ?? 0;
    }
    setBusy(null);
    toast({ title: "Queued all languages", description: `${total} chunks across ${ALL_LANGS.length} languages.` });
    await refreshAll();
  }

  async function workerControl(kind: "audio" | "trans", op: "start" | "pause") {
    const fn = kind === "audio" ? "seed-queue-manager" : "seed-translation-manager";
    setBusy(`${kind}-${op}`);
    const { error } = await supabase.functions.invoke(fn, { body: { action: op } });
    setBusy(null);
    if (error) { toast({ title: `${op} failed`, description: error.message, variant: "destructive" }); return; }
    if (op === "start") {
      const worker_fn = kind === "audio" ? "seed-queue-worker" : "seed-translation-worker";
      supabase.functions.invoke(worker_fn, { body: {} }).catch(() => {});
    }
    await loadWorkerState();
  }

  const filtered = docs.filter((d) => d.title.toLowerCase().includes(search.toLowerCase()));

  const StageIcon = ({ pct }: { pct: number }) =>
    pct >= 100 ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> :
    pct > 0 ? <Clock className="w-4 h-4 text-amber-500" /> :
    <Clock className="w-4 h-4 text-muted-foreground" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold">Pipeline Manager</h1>
          <p className="text-sm text-muted-foreground">Cleaning → Audio → Translation. One view, one click.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title…" className="pl-8" />
          </div>
          <Button size="sm" variant="outline" onClick={refreshAll} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Worker controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Mic2 className="w-4 h-4 text-primary" />
              <div>
                <div className="font-medium text-sm">Audio worker</div>
                <div className="text-xs text-muted-foreground">
                  {worker.audio
                    ? `${worker.audio.is_running ? "Running" : "Idle"} · pending ${worker.audio.counts.pending ?? 0} · failed ${worker.audio.counts.failed ?? 0}`
                    : "—"}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant={worker.audio?.is_running ? "secondary" : "default"} disabled={busy === "audio-start"} onClick={() => workerControl("audio", "start")}>
                <Play className="w-3 h-3 mr-1" /> Start
              </Button>
              <Button size="sm" variant="outline" disabled={busy === "audio-pause"} onClick={() => workerControl("audio", "pause")}>
                <Pause className="w-3 h-3 mr-1" /> Pause
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Languages className="w-4 h-4 text-primary" />
              <div>
                <div className="font-medium text-sm">Translation worker</div>
                <div className="text-xs text-muted-foreground">
                  {worker.trans
                    ? `${worker.trans.is_running ? "Running" : "Idle"} · pending ${worker.trans.counts.pending ?? 0} · failed ${worker.trans.counts.failed ?? 0}`
                    : "—"}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant={worker.trans?.is_running ? "secondary" : "default"} disabled={busy === "trans-start"} onClick={() => workerControl("trans", "start")}>
                <Play className="w-3 h-3 mr-1" /> Start
              </Button>
              <Button size="sm" variant="outline" disabled={busy === "trans-pause"} onClick={() => workerControl("trans", "pause")}>
                <Pause className="w-3 h-3 mr-1" /> Pause
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Document pipeline cards */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading pipeline…</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">No documents found.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((d) => {
            const audioBusy = busy === `audio:${d.id}`;
            const recleanBusy = busy === `reclean:${d.id}`;
            const transAllBusy = busy === `transAll:${d.id}`;
            return (
              <Card key={d.id}>
                <CardContent className="p-4 space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium truncate max-w-md">{d.title}</h3>
                        {d.is_seeded && <Badge variant="secondary" className="text-[10px]">SEEDED</Badge>}
                        <Badge variant="outline" className="text-[10px]">{d.subject_type}</Badge>
                        <Badge variant="outline" className="text-[10px]">v{d.cleaning_version}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {(d.char_count ?? 0).toLocaleString()} chars
                        {d.invalid_chunks.length > 0 && (
                          <span className="ml-2 text-amber-600">· {d.invalid_chunks.length} invalid</span>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" disabled={recleanBusy} onClick={() => reclean(d)}>
                      {recleanBusy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Sparkles className="w-3 h-3 mr-1" />}
                      Re-clean
                    </Button>
                  </div>

                  {/* Stages grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Cleaning stage */}
                    <div className="border rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="text-xs uppercase text-muted-foreground flex items-center gap-1">
                          <Sparkles className="w-3 h-3" /> Cleaning
                        </div>
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      </div>
                      <div className="text-sm">Version {d.stages.cleaning.version}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.stages.cleaning.invalid > 0
                          ? <span className="text-amber-600">{d.stages.cleaning.invalid} chunks flagged</span>
                          : "All chunks valid"}
                      </div>
                    </div>

                    {/* Audio stage */}
                    <div className="border rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="text-xs uppercase text-muted-foreground flex items-center gap-1">
                          <Mic2 className="w-3 h-3" /> Audio
                        </div>
                        <StageIcon pct={d.stages.audio.pct} />
                      </div>
                      <Progress value={d.stages.audio.pct} className="h-1.5" />
                      <div className="text-xs text-muted-foreground flex items-center justify-between">
                        <span>{d.stages.audio.cached} / {d.stages.audio.total_estimate} ({d.stages.audio.pct}%)</span>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={audioBusy} onClick={() => enqueueAudio(d)}>
                          {audioBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Enqueue"}
                        </Button>
                      </div>
                      {(d.stages.audio.queue.pending + d.stages.audio.queue.in_progress + d.stages.audio.queue.failed) > 0 && (
                        <div className="text-[10px] text-muted-foreground">
                          queue: {d.stages.audio.queue.pending}p · {d.stages.audio.queue.in_progress}r
                          {d.stages.audio.queue.failed > 0 && <span className="text-destructive"> · {d.stages.audio.queue.failed}f</span>}
                        </div>
                      )}
                      {d.stages.audio.error && (
                        <div className="text-[10px] text-destructive flex items-start gap-1">
                          <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span className="truncate">{d.stages.audio.error}</span>
                        </div>
                      )}
                    </div>

                    {/* Translation stage */}
                    <div className="border rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="text-xs uppercase text-muted-foreground flex items-center gap-1">
                          <Languages className="w-3 h-3" /> Translations
                        </div>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={transAllBusy} onClick={() => enqueueAllTranslations(d)}>
                          {transAllBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Enqueue all"}
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {d.stages.translation.languages.map((l) => {
                          const lBusy = busy === `trans:${d.id}:${l.language}`;
                          return (
                            <div key={l.language} className="flex items-center gap-2 text-xs">
                              <span className="w-16 text-muted-foreground">{LANG_LABEL[l.language] ?? l.language}</span>
                              <Progress value={l.pct} className="h-1 flex-1" />
                              <span className="w-14 text-right tabular-nums text-muted-foreground">{l.done}/{l.total_estimate}</span>
                              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" disabled={lBusy} onClick={() => enqueueTranslation(d, l.language as Lang)}>
                                {lBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : "+"}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
