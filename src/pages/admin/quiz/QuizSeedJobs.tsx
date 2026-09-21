import { useEffect, useState } from "react";
import { Loader2, Plus, Pause, Play, X, RotateCcw, Send, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { formatZar, pollSeedJob, prettify, quizAdmin, submitSeedJob } from "@/lib/quiz-bank";
import SeedQuizBankDialog from "./SeedQuizBankDialog";

export default function QuizSeedJobs() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [seedOpen, setSeedOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await quizAdmin("list_jobs", { limit: 100 });
      setJobs(res.jobs ?? []);
    } catch (e) {
      toast({ title: "Could not load jobs", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const control = async (jobId: string, ctl: string) => {
    setBusy(jobId);
    try {
      await quizAdmin("job_control", { job_id: jobId, control: ctl });
      await load();
    } catch (e) {
      toast({ title: "Action failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const submit = async (jobId: string) => {
    setBusy(jobId);
    try {
      const res = await submitSeedJob(jobId);
      if (!res.ok) {
        toast({ title: "Generation not started", description: res.error ?? "Generation service unavailable." });
      } else {
        toast({ title: "Generation started", description: `${res.submitted} sections sent.` });
      }
      await load();
    } catch (e) {
      toast({ title: "Could not start generation", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const poll = async (jobId: string) => {
    setBusy(jobId);
    try {
      await pollSeedJob(jobId);
      await load();
      toast({ title: "Checked for finished questions" });
    } catch (e) {
      toast({ title: "Check failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Seed jobs can be paused, resumed, cancelled and retried at any time.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setSeedOpen(true)} className="gap-1.5"><Plus className="w-4 h-4" /> New job</Button>
        </div>
      </div>

      {jobs.length === 0 && <p className="text-sm text-muted-foreground">No seed jobs yet.</p>}

      <div className="space-y-3">
        {jobs.map((j) => {
          const done = j.sections_completed ?? 0;
          const total = j.total_sections ?? 0;
          const pctDone = total > 0 ? Math.round((done / total) * 100) : 0;
          const running = busy === j.id;
          return (
            <Card key={j.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-sm">
                      {j.documents?.title ?? `${(j.document_ids ?? []).length} books`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {prettify(j.generation_mode)} · {j.questions_per_section} per section · {j.language?.toUpperCase()} ·
                      {" "}{new Date(j.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {j.paused && <Badge variant="secondary">Paused</Badge>}
                    <Badge variant="secondary">{prettify(j.status)}</Badge>
                  </div>
                </div>

                <Progress value={pctDone} className="h-2" />
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <span>Sections {done}/{total}</span>
                  <span>Questions {j.questions_generated ?? 0} kept · {j.questions_rejected ?? 0} discarded · {j.duplicates_skipped ?? 0} duplicates</span>
                  <span>Estimated {formatZar(j.estimated_cost_zar)}</span>
                  {j.gemini_batch_name && <span>Batch active</span>}
                </div>
                {j.error_message && <p className="text-xs text-destructive">{j.error_message}</p>}

                <div className="flex flex-wrap gap-2">
                  {!j.gemini_batch_name && !["completed", "cancelled"].includes(j.status) && (
                    <Button size="sm" variant="outline" disabled={running} onClick={() => submit(j.id)} className="gap-1.5">
                      <Send className="w-3.5 h-3.5" /> Start generation
                    </Button>
                  )}
                  {j.gemini_batch_name && (
                    <Button size="sm" variant="outline" disabled={running} onClick={() => poll(j.id)} className="gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5" /> Check progress
                    </Button>
                  )}
                  {!j.paused ? (
                    <Button size="sm" variant="ghost" disabled={running} onClick={() => control(j.id, "pause")} className="gap-1.5">
                      <Pause className="w-3.5 h-3.5" /> Pause
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={running} onClick={() => control(j.id, "resume")} className="gap-1.5">
                      <Play className="w-3.5 h-3.5" /> Resume
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={running} onClick={() => control(j.id, "retry_failed")} className="gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5" /> Retry failed
                  </Button>
                  {j.status !== "cancelled" && (
                    <Button size="sm" variant="ghost" disabled={running} onClick={() => control(j.id, "cancel")} className="gap-1.5 text-destructive">
                      <X className="w-3.5 h-3.5" /> Cancel
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <SeedQuizBankDialog open={seedOpen} onOpenChange={setSeedOpen} onCreated={load} />
    </div>
  );
}
