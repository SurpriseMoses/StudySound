import { useEffect, useState } from "react";
import { Loader2, BookOpenCheck, Sparkles, RefreshCw, AlertCircle, Play, Pause } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type SeedDoc = {
  id: string;
  title: string;
  char_count: number;
  seed_audio_status: "pending" | "cleaning" | "processing" | "done" | "failed";
  seed_audio_progress: number;
  seed_audio_error: string | null;
  cached_chunks: number;
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
  const [runningDoc, setRunningDoc] = useState<string | null>(null);
  const [autoLoop, setAutoLoop] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    // Pull seeded docs + a count of cached audio chunks per doc.
    const { data: docRows, error } = await supabase
      .from("documents")
      .select("id, title, char_count, seed_audio_status, seed_audio_progress, seed_audio_error")
      .eq("seed_audio", true)
      .order("title", { ascending: true });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    const ids = (docRows ?? []).map((d) => d.id);
    const cachedCounts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: assets } = await supabase
        .from("audio_assets")
        .select("document_id")
        .in("document_id", ids)
        .eq("language", "en")
        .eq("voice_name", "en-GB-LibbyNeural")
        .eq("speaking_style", "general");
      (assets ?? []).forEach((a) => {
        cachedCounts.set(a.document_id, (cachedCounts.get(a.document_id) ?? 0) + 1);
      });
    }
    setDocs(
      (docRows ?? []).map((d) => ({
        ...d,
        seed_audio_status: d.seed_audio_status as SeedDoc["seed_audio_status"],
        cached_chunks: cachedCounts.get(d.id) ?? 0,
      })),
    );
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function seedTexts() {
    setSeedingTexts(true);
    try {
      const { data, error } = await supabase.functions.invoke("seed-curriculum", { body: {} });
      if (error) throw error;
      toast.success(`Seeded ${data?.total ?? 0} books. ${JSON.stringify(data?.counts ?? {})}`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Seeding failed: ${msg}`);
    } finally {
      setSeedingTexts(false);
    }
  }

  async function runOneBatch(
    docId: string,
  ): Promise<{ done: boolean; error?: string; rateLimited?: boolean; retryAfterMs?: number }> {
    const { data, error } = await supabase.functions.invoke("seed-audio-assets", {
      body: { document_id: docId, max_chunks: 25 },
    });
    if (error) return { done: false, error: error.message };
    if (data?.rate_limited) {
      return { done: false, rateLimited: true, retryAfterMs: data.retry_after_ms ?? 30000 };
    }
    if (data?.success === false) return { done: false, error: data?.error ?? "Batch failed" };
    return { done: data?.status === "done" };
  }

  async function generateBatch(docId: string) {
    setRunningDoc(docId);
    try {
      const res = await runOneBatch(docId);
      if (res.rateLimited) toast.warning("Azure rate limit hit. Wait a moment, then run again.");
      else if (res.error) toast.error(res.error);
      else toast.success(res.done ? "Document fully narrated 🎉" : "Batch complete. Run again to continue.");
      await load();
    } finally {
      setRunningDoc(null);
    }
  }

  async function runAutoLoop(docId: string) {
    setAutoLoop(docId);
    try {
      // Up to 80 iterations * 25 chunks = 2000 chunks max. Pauses on rate limit.
      for (let i = 0; i < 80; i++) {
        const res = await runOneBatch(docId);
        await load();
        if (res.rateLimited) {
          const wait = res.retryAfterMs ?? 30000;
          toast.message(`Rate limited — waiting ${Math.round(wait / 1000)}s before retrying…`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        if (res.error) {
          toast.error(`Stopped at iteration ${i + 1}: ${res.error}`);
          break;
        }
        if (res.done) {
          toast.success("Document fully narrated 🎉");
          break;
        }
      }
    } finally {
      setAutoLoop(null);
    }
  }

  const totalCached = docs.reduce((s, d) => s + d.cached_chunks, 0);
  const totalDone = docs.filter((d) => d.seed_audio_status === "done").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Seed audio</h1>
        <p className="text-muted-foreground text-sm">
          Pre-generate Azure narration for public-domain books so every user gets instant playback.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpenCheck className="w-5 h-5" /> Step 1 — Seed book texts
          </CardTitle>
          <CardDescription>
            Downloads cleaned text from Project Gutenberg into the documents table.
            Idempotent: rerunning updates existing rows.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button onClick={seedTexts} disabled={seedingTexts}>
            {seedingTexts ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Seed / refresh book texts
          </Button>
          <span className="text-sm text-muted-foreground">
            {docs.length} books seeded · {totalDone} fully narrated · {totalCached} chunks cached
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" /> Step 2 — Generate audio
          </CardTitle>
          <CardDescription>
            Each batch generates up to 25 new chunks via Azure TTS (en-GB-LibbyNeural).
            Safe to re-run; cached chunks are skipped. "Auto-run" loops batches until the book is fully narrated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No seeded books yet. Run Step 1 first.
            </p>
          ) : (
            <div className="space-y-3">
              {docs.map((d) => {
                const totalEst = Math.max(1, Math.ceil((d.char_count || 0) / 700));
                const pct = Math.min(100, Math.round((d.cached_chunks / totalEst) * 100));
                const isRunning = runningDoc === d.id;
                const isLooping = autoLoop === d.id;
                return (
                  <div key={d.id} className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{d.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {d.char_count.toLocaleString()} chars · ~{totalEst} chunks · {d.cached_chunks} cached
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={statusColors[d.seed_audio_status]} variant="secondary">
                          {d.seed_audio_status}
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => generateBatch(d.id)}
                          disabled={isRunning || isLooping || d.seed_audio_status === "done"}
                        >
                          {isRunning ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
                          Run 1 batch
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => runAutoLoop(d.id)}
                          disabled={isRunning || isLooping || d.seed_audio_status === "done"}
                        >
                          {isLooping ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                          {isLooping ? "Looping…" : "Auto-run to done"}
                        </Button>
                      </div>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                    {d.seed_audio_error && (
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
          <div className="mt-4 flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={load}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
            {autoLoop && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Pause className="w-3 h-3" /> Auto-loop runs in this tab — keep it open.
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
