import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { prettify, quizAdmin } from "@/lib/quiz-bank";
import QuestionCard, { type BankQuestion } from "./QuestionCard";
import QuestionEditorDialog from "./QuestionEditorDialog";

export default function QuizReviewQueue() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<BankQuestion[]>([]);
  const [flags, setFlags] = useState<any[]>([]);
  const [editing, setEditing] = useState<BankQuestion | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [drafts, pending, fl] = await Promise.all([
        quizAdmin("list_questions", { status: "draft", limit: 50 }),
        quizAdmin("list_questions", { status: "pending_review", limit: 50 }),
        quizAdmin("flags", { status: "open" }),
      ]);
      setQueue([...(pending.questions ?? []), ...(drafts.questions ?? [])]);
      setFlags(fl.flags ?? []);
      setSelected([]);
    } catch (e) {
      toast({ title: "Could not load the review queue", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const review = async (decision: string, ids: string[]) => {
    try {
      await quizAdmin("review", { question_ids: ids, decision });
      toast({ title: `${ids.length} question(s) updated` });
      load();
    } catch (e) {
      toast({ title: "Action failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const resolveFlag = async (id: string, status: string) => {
    try {
      await quizAdmin("resolve_flag", { flag_id: id, status });
      load();
    } catch (e) {
      toast({ title: "Could not update the flag", description: (e as Error).message, variant: "destructive" });
    }
  };

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Nothing reaches learners until it is published here.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          {selected.length > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={() => review("approve", selected)}>Approve {selected.length}</Button>
              <Button size="sm" onClick={() => review("publish", selected)}>Publish {selected.length}</Button>
            </>
          )}
        </div>
      </div>

      {flags.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-display font-semibold">Learner-reported problems ({flags.length})</h2>
          {flags.map((f) => (
            <Card key={f.id}>
              <CardContent className="p-4 space-y-2">
                <p className="text-sm">{f.quiz_questions?.question ?? "Question removed"}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{prettify(f.reason ?? "reported")}</Badge>
                  <span>{new Date(f.created_at).toLocaleString()}</span>
                </div>
                {f.note && <p className="text-xs">{f.note}</p>}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => review("retire", [f.question_id])}>Retire question</Button>
                  <Button size="sm" variant="ghost" onClick={() => resolveFlag(f.id, "resolved")}>Mark resolved</Button>
                  <Button size="sm" variant="ghost" onClick={() => resolveFlag(f.id, "dismissed")}>Dismiss</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-display font-semibold">Awaiting review ({queue.length})</h2>
        {queue.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting for review.</p>}
        {queue.map((q) => (
          <QuestionCard
            key={q.id}
            q={q}
            selected={selected.includes(q.id)}
            onSelect={(v) => setSelected((s) => (v ? [...s, q.id] : s.filter((x) => x !== q.id)))}
            onEdit={() => setEditing(q)}
            actions={
              <>
                <Button size="sm" variant="outline" onClick={() => review("approve", [q.id])}>Approve</Button>
                <Button size="sm" onClick={() => review("publish", [q.id])}>Publish</Button>
                <Button size="sm" variant="ghost" onClick={() => review("reject", [q.id])}>Reject</Button>
              </>
            }
          />
        ))}
      </div>

      <QuestionEditorDialog question={editing} onOpenChange={(v) => !v && setEditing(null)} onSaved={load} />
    </div>
  );
}
