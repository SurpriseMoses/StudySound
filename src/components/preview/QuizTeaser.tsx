import { useState } from "react";
import { Brain, CheckCircle2, XCircle, ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { macbethPreviewQuiz, scoreMacbethPreview } from "@/lib/macbeth-preview";

export default function QuizTeaser() {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(macbethPreviewQuiz.map(() => null));
  const [checked, setChecked] = useState(false);
  const [finished, setFinished] = useState(false);
  const question = macbethPreviewQuiz[index];
  const selected = answers[index];
  const correct = selected === question.correctIndex;

  const restart = () => {
    setAnswers(macbethPreviewQuiz.map(() => null));
    setIndex(0);
    setChecked(false);
    setFinished(false);
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-secondary/15 flex items-center justify-center">
              <Brain className="w-4 h-4 text-secondary" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">Macbeth · Act I quiz</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Free preview · 5 questions</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Free
          </span>
        </div>

        {finished ? (
          <div className="space-y-4" aria-live="polite">
            <p className="font-display text-2xl font-bold">{scoreMacbethPreview(answers)} / {macbethPreviewQuiz.length}</p>
            <p className="text-sm text-muted-foreground">Act I complete</p>
            <Button variant="outline" onClick={restart}><RotateCcw /> Try again</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">Question {index + 1} of {macbethPreviewQuiz.length}</p>
            <fieldset className="space-y-3" disabled={checked}>
              <legend className="text-sm font-semibold mb-3">{question.question}</legend>
              {question.options.map((option, optionIndex) => (
                <label key={option} className={`flex items-start gap-3 rounded-md border p-3 text-sm cursor-pointer ${selected === optionIndex ? "border-primary bg-primary/5" : "border-border bg-background"}`}>
                  <input
                    type="radio"
                    name={`macbeth-question-${index}`}
                    value={optionIndex}
                    checked={selected === optionIndex}
                    onChange={() => setAnswers((previous) => previous.map((value, i) => i === index ? optionIndex : value))}
                    className="mt-0.5 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 break-words">{option}</span>
                </label>
              ))}
            </fieldset>
            {checked && (
              <div className="border-t pt-3 space-y-2" role="status">
                <p className={`flex items-center gap-2 text-sm font-semibold ${correct ? "text-primary" : "text-destructive"}`}>
                  {correct ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {correct ? "Correct" : "Not quite"}
                </p>
                {!correct && <p className="text-sm font-medium">Answer: {question.options[question.correctIndex]}</p>}
                <p className="text-sm leading-relaxed text-muted-foreground">{question.explanation}</p>
              </div>
            )}
            {checked ? (
              <Button className="w-full" onClick={() => {
                if (index === macbethPreviewQuiz.length - 1) setFinished(true);
                else { setIndex((value) => value + 1); setChecked(false); }
              }}>
                {index === macbethPreviewQuiz.length - 1 ? "See results" : "Next question"} <ArrowRight />
              </Button>
            ) : (
              <Button className="w-full" disabled={selected === null} onClick={() => setChecked(true)}>Check answer</Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
