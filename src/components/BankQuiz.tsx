import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Coins, Flag, CheckCircle2, XCircle, Trophy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { quizPlay } from "@/lib/quiz-bank";

interface PlayQuestion {
  position: number;
  question_id: string;
  question: string;
  question_type: string;
  options: string[] | null;
  items: string[] | null;
  difficulty: string;
  skill: string | null;
  topic: string | null;
  cognitive_level?: string | null;
  command_word?: string | null;
  mark_allocation?: number | null;
  caps_topic?: string | null;
  practice_label?: string | null;
}

interface Preset { id: string; label: string; questions: number }

type ModeId = "learning" | "exam" | "mixed";

const MODE_COPY: Record<ModeId, { label: string; blurb: string }> = {
  learning: { label: "Learning practice", blurb: "Understand the section — recall and understanding first." },
  exam: { label: "Exam practice", blurb: "CAPS exam-style questions with command words and marks. Practice only." },
  mixed: { label: "Mixed practice", blurb: "A blend of learning and exam-style questions." },
};

export default function BankQuiz({
  documentId, chunkIndex, language = "en",
}: {
  documentId: string;
  chunkIndex?: number | null;
  language?: string;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [avail, setAvail] = useState<any>(null);
  const [preset, setPreset] = useState<string>("standard");
  const [mode, setMode] = useState<ModeId>("learning");
  const [scope, setScope] = useState<"section" | "book">(typeof chunkIndex === "number" ? "section" : "book");
  const [starting, setStarting] = useState(false);

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PlayQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<any>(null);

  const loadAvailability = async () => {
    setLoading(true);
    try {
      const res = await quizPlay("availability", {
        document_id: documentId,
        chunk_index: typeof chunkIndex === "number" ? chunkIndex : null,
        language,
      });
      setAvail(res);
    } catch (e) {
      toast({ title: "Could not load the quiz", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAvailability(); /* eslint-disable-next-line */ }, [documentId, chunkIndex, language]);

  const presets: Preset[] = avail?.presets ?? [];
  const costs: Record<string, number> = avail?.credit_costs ?? {};
  const chosen = presets.find((p) => p.id === preset) ?? presets[0];
  const cost = chosen ? (costs[String(chosen.questions)] ?? 0) : 0;
  const available = scope === "section" ? (avail?.section_questions ?? 0) : (avail?.book_questions ?? 0);

  const start = async () => {
    setStarting(true);
    try {
      const res = await quizPlay("start", {
        document_id: documentId,
        scope,
        chunk_index: typeof chunkIndex === "number" ? chunkIndex : null,
        language,
        preset,
        mode,
        idempotency_key: `${documentId}-${scope}-${chunkIndex ?? "all"}-${preset}-${mode}-${Date.now()}`,
      });
      if (res.error === "no_questions") {
        toast({ title: "No questions yet", description: res.message });
        return;
      }
      if (res.error === "insufficient_credits") {
        toast({
          title: "Not enough credits",
          description: `This quiz needs ${res.required} credits — you have ${res.balance}.`,
          variant: "destructive",
        });
        return;
      }
      setAttemptId(res.attempt_id);
      setQuestions(res.questions ?? []);
      setIdx(0);
      setAnswer("");
      setFeedback(null);
      setResult(null);
      if (res.credits_charged > 0) {
        toast({ title: `${res.credits_charged} credits used`, description: `Balance: ${res.new_balance}` });
      }
    } catch (e) {
      toast({ title: "Could not start the quiz", description: (e as Error).message, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  const current = questions[idx];

  const submitAnswer = async () => {
    if (!attemptId || !current || !answer.trim()) return;
    setChecking(true);
    try {
      const res = await quizPlay("answer", { attempt_id: attemptId, position: current.position, answer });
      setFeedback(res);
    } catch (e) {
      toast({ title: "Could not save your answer", description: (e as Error).message, variant: "destructive" });
    } finally {
      setChecking(false);
    }
  };

  const next = async () => {
    if (idx + 1 < questions.length) {
      setIdx(idx + 1);
      setAnswer("");
      setFeedback(null);
      return;
    }
    try {
      const res = await quizPlay("complete", { attempt_id: attemptId });
      setResult(res);
    } catch (e) {
      toast({ title: "Could not finish the quiz", description: (e as Error).message, variant: "destructive" });
    }
  };

  const flag = async () => {
    if (!current) return;
    try {
      await quizPlay("flag", { question_id: current.question_id, reason: "learner_report" });
      toast({ title: "Thanks — we'll check this question" });
    } catch (e) {
      toast({ title: "Could not report this", description: (e as Error).message, variant: "destructive" });
    }
  };

  const correctPct = useMemo(
    () => (result ? Math.round((result.score ?? 0) * 100) : 0),
    [result],
  );

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  // ---------------------------------------------------------------- results
  if (result) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <Trophy className="w-8 h-8 mx-auto text-accent" />
            <div className="text-3xl font-display font-bold">{correctPct}%</div>
            <p className="text-sm text-muted-foreground">
              {result.correct_count} of {result.total_questions} correct
            </p>
            <Button className="mt-2 gap-2" onClick={() => { setResult(null); setAttemptId(null); loadAvailability(); }}>
              <RotateCcw className="w-4 h-4" /> Practise again
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {(result.review ?? []).map((r: any) => (
            <Card key={r.position}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start gap-2">
                  {r.is_correct
                    ? <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
                    : <XCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />}
                  <p className="text-sm font-medium">{r.question}</p>
                </div>
                <p className="text-xs"><span className="text-muted-foreground">Your answer: </span>{r.given_answer || "—"}</p>
                {!r.is_correct && (
                  <p className="text-xs"><span className="text-muted-foreground">Correct: </span>{r.correct_answer}</p>
                )}
                {r.working && <p className="text-xs text-muted-foreground">Working: {r.working}</p>}
                {r.explanation && <p className="text-xs text-muted-foreground">{r.explanation}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- in-progress
  if (attemptId && current) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Question {idx + 1} of {questions.length}</span>
          <div className="flex flex-wrap items-center gap-2">
            {current.practice_label && <Badge variant="secondary">{current.practice_label}</Badge>}
            {current.mark_allocation ? (
              <Badge variant="outline">{current.mark_allocation} mark{current.mark_allocation === 1 ? "" : "s"}</Badge>
            ) : null}
            <Badge variant="outline">{current.difficulty}</Badge>
            <Button size="icon" variant="ghost" onClick={flag} title="Report a problem">
              <Flag className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <Progress value={((idx) / questions.length) * 100} className="h-2" />

        <Card>
          <CardContent className="p-5 space-y-4">
            <p className="font-medium">{current.question}</p>

            {current.options?.length ? (
              <div className="space-y-2">
                {current.options.map((o) => (
                  <button
                    key={o}
                    disabled={!!feedback}
                    onClick={() => setAnswer(o)}
                    className={`w-full text-left text-sm rounded-md border px-3 py-2 transition-colors ${
                      answer === o ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                    } ${feedback && o === feedback.correct_answer ? "border-success bg-success/10" : ""}`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            ) : (
              <Input
                placeholder="Type your answer"
                value={answer}
                disabled={!!feedback}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitAnswer(); }}
              />
            )}

            {feedback && (
              <div className="rounded-md border p-3 space-y-1 text-sm">
                <p className={feedback.is_correct ? "text-success font-medium" : "text-destructive font-medium"}>
                  {feedback.is_correct ? "Correct" : `Not quite — ${feedback.correct_answer}`}
                </p>
                {feedback.working && <p className="text-xs text-muted-foreground">Working: {feedback.working}</p>}
                {feedback.explanation && <p className="text-xs text-muted-foreground">{feedback.explanation}</p>}
              </div>
            )}

            {!feedback ? (
              <Button onClick={submitAnswer} disabled={checking || !answer.trim()} className="w-full gap-2">
                {checking && <Loader2 className="w-4 h-4 animate-spin" />} Check answer
              </Button>
            ) : (
              <Button onClick={next} className="w-full">
                {idx + 1 < questions.length ? "Next question" : "See results"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ------------------------------------------------------------------- setup
  return (
    <div className="space-y-4">
      {available === 0 ? (
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <p className="font-medium">No quiz questions here yet</p>
            <p className="text-sm text-muted-foreground">
              Practice questions for this {scope === "section" ? "section" : "book"} haven’t been added yet.
              {typeof chunkIndex === "number" && (avail?.book_questions ?? 0) > 0 && " Try a whole-book quiz instead."}
            </p>
            {typeof chunkIndex === "number" && (avail?.book_questions ?? 0) > 0 && (
              <Button variant="outline" onClick={() => setScope("book")}>Quiz the whole book</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
              <p className="font-medium">Practice quiz</p>
              <p className="text-sm text-muted-foreground">
                {available} question{available === 1 ? "" : "s"} available ·
                {" "}exam-style practice, not predicted exam questions
              </p>
            </div>

            {typeof chunkIndex === "number" && (
              <div className="flex gap-2">
                {(["section", "book"] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={scope === s ? "default" : "outline"}
                    onClick={() => setScope(s)}
                  >
                    {s === "section" ? "This section" : "Whole book"}
                  </Button>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Choose how you want to practise</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {(["learning", "exam", "mixed"] as const).map((m) => {
                  const label = (avail?.modes ?? {})[m]?.label ?? MODE_COPY[m].label;
                  const disabled = m === "exam" && (avail?.exam_questions ?? 0) === 0;
                  return (
                    <button
                      key={m}
                      disabled={disabled}
                      onClick={() => setMode(m)}
                      className={`rounded-md border p-3 text-left transition-colors disabled:opacity-50 ${
                        mode === m ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                      }`}
                    >
                      <div className="text-sm font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">
                        {disabled ? "No exam-style questions here yet" : MODE_COPY[m].blurb}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>



            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  className={`rounded-md border p-3 text-left transition-colors ${
                    preset === p.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                  }`}
                >
                  <div className="text-sm font-medium">{p.questions} questions</div>
                  <div className="text-xs text-muted-foreground">{costs[String(p.questions)] ?? 0} credits</div>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
                <Coins className="w-4 h-4" /> Balance {avail?.balance ?? 0} credits
              </span>
              <div className="flex gap-2">
                {cost > (avail?.balance ?? 0) && (
                  <Button asChild size="sm" variant="outline"><Link to="/topup">Top up</Link></Button>
                )}
                <Button onClick={start} disabled={starting || available === 0} className="gap-2">
                  {starting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Start quiz · {cost} credits
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
