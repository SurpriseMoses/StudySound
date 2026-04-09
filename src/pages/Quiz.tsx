import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, Check, X, ArrowRight, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import AppLayout from "@/components/AppLayout";

interface Question {
  id: number;
  text: string;
  type: "mcq" | "tf" | "fill";
  options?: string[];
  answer: string;
}

const sampleQuestions: Question[] = [
  { id: 1, text: "What city is described as having fog 'like a living thing'?", type: "mcq", options: ["Paris", "London", "New York", "Dublin"], answer: "London" },
  { id: 2, text: "Charles Darnay and Sydney Carton look alike.", type: "tf", answer: "True" },
  { id: 3, text: "The novel begins with the famous line: 'It was the _____ of times'", type: "fill", answer: "best" },
  { id: 4, text: "Who works at Tellson's Bank?", type: "mcq", options: ["Darnay", "Carton", "Lorry", "Manette"], answer: "Lorry" },
  { id: 5, text: "The story is set during the French Revolution.", type: "tf", answer: "True" },
];

export default function Quiz() {
  const [currentQ, setCurrentQ] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [fillAnswer, setFillAnswer] = useState("");

  const q = sampleQuestions[currentQ];
  const isCorrect = (selected || fillAnswer.toLowerCase()) === q.answer.toLowerCase();

  const handleAnswer = () => {
    if (answered) return;
    setAnswered(true);
    if (isCorrect) setScore(s => s + 1);
  };

  const nextQuestion = () => {
    if (currentQ < sampleQuestions.length - 1) {
      setCurrentQ(c => c + 1);
      setSelected(null);
      setAnswered(false);
      setFillAnswer("");
    } else {
      setCompleted(true);
    }
  };

  const restart = () => {
    setCurrentQ(0);
    setSelected(null);
    setAnswered(false);
    setScore(0);
    setCompleted(false);
    setFillAnswer("");
  };

  if (completed) {
    const pct = Math.round((score / sampleQuestions.length) * 100);
    return (
      <AppLayout>
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md mx-auto text-center py-16">
          <div className="text-5xl mb-4">{pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "📚"}</div>
          <h2 className="text-3xl font-display font-bold">{pct}%</h2>
          <p className="text-muted-foreground mt-2">{score}/{sampleQuestions.length} correct answers</p>
          <p className="text-sm text-muted-foreground mt-1">
            {pct >= 80 ? "Excellent work!" : pct >= 50 ? "Good effort, keep practising!" : "Review the chapter and try again."}
          </p>
          <Button onClick={restart} className="mt-6 gap-2">
            <RotateCcw className="w-4 h-4" /> Try Again
          </Button>
        </motion.div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-accent" />
              <h1 className="text-xl font-display font-bold">Quiz</h1>
            </div>
            <span className="text-sm text-muted-foreground">{currentQ + 1} / {sampleQuestions.length}</span>
          </div>
          <Progress value={((currentQ + 1) / sampleQuestions.length) * 100} className="mb-6 h-2" />

          <Card>
            <CardContent className="p-6">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground uppercase">
                  {q.type === "mcq" ? "Multiple Choice" : q.type === "tf" ? "True or False" : "Fill in the Blank"}
                </span>
              </div>
              <h2 className="text-lg font-semibold mb-5">{q.text}</h2>

              {q.type === "mcq" && q.options && (
                <div className="space-y-2.5">
                  {q.options.map(opt => {
                    let cls = "border-border hover:border-primary/30";
                    if (answered && opt === q.answer) cls = "border-success bg-success/10";
                    else if (answered && opt === selected && !isCorrect) cls = "border-destructive bg-destructive/10";
                    else if (selected === opt) cls = "border-primary bg-primary/5";
                    return (
                      <button
                        key={opt}
                        onClick={() => !answered && setSelected(opt)}
                        className={`w-full text-left p-3 rounded-lg border transition-all text-sm font-medium ${cls}`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {q.type === "tf" && (
                <div className="flex gap-3">
                  {["True", "False"].map(opt => {
                    let cls = "border-border hover:border-primary/30";
                    if (answered && opt === q.answer) cls = "border-success bg-success/10";
                    else if (answered && opt === selected && !isCorrect) cls = "border-destructive bg-destructive/10";
                    else if (selected === opt) cls = "border-primary bg-primary/5";
                    return (
                      <button
                        key={opt}
                        onClick={() => !answered && setSelected(opt)}
                        className={`flex-1 p-3 rounded-lg border transition-all text-sm font-semibold ${cls}`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {q.type === "fill" && (
                <input
                  value={fillAnswer}
                  onChange={e => setFillAnswer(e.target.value)}
                  disabled={answered}
                  placeholder="Type your answer..."
                  className="w-full p-3 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}

              {answered && (
                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className={`mt-4 p-3 rounded-lg text-sm ${isCorrect ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  {isCorrect ? (
                    <span className="flex items-center gap-2"><Check className="w-4 h-4" /> Correct!</span>
                  ) : (
                    <span className="flex items-center gap-2"><X className="w-4 h-4" /> The answer is: {q.answer}</span>
                  )}
                </motion.div>
              )}
            </CardContent>
          </Card>

          <div className="flex justify-end mt-4 gap-2">
            {!answered ? (
              <Button onClick={handleAnswer} disabled={!selected && !fillAnswer}>Submit Answer</Button>
            ) : (
              <Button onClick={nextQuestion} className="gap-2">
                {currentQ < sampleQuestions.length - 1 ? <>Next <ArrowRight className="w-4 h-4" /></> : "See Results"}
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </AppLayout>
  );
}
