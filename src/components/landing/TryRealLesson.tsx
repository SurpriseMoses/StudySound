import { Link } from "react-router-dom";
import { useState, useRef } from "react";
import { Play, Pause, ArrowRight, Image as ImageIcon, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const SAMPLE_AUDIO = "/preview-audio.mp3";

const questions = [
  {
    q: "What famous opening line begins A Tale of Two Cities?",
    options: ["It was the best of times…", "Call me Ishmael.", "All happy families…"],
    correct: 0,
  },
  {
    q: "Which two cities does the novel contrast?",
    options: ["Paris & Rome", "London & Paris", "London & Cape Town"],
    correct: 1,
  },
];

export default function TryRealLesson() {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>([null, null]);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
    } else {
      a.play().catch(() => {});
    }
    setPlaying(!playing);
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <section className="py-16 md:py-20 bg-muted/30">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-10">
          <span className="inline-block bg-secondary/10 text-secondary px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide mb-3">
            Live demo
          </span>
          <h2 className="text-3xl md:text-4xl font-display font-bold">Try a real lesson (free)</h2>
          <p className="mt-3 text-muted-foreground">A Tale of Two Cities — Chapter 1 Preview</p>
        </div>

        <Card className="border-0 shadow-xl">
          <CardContent className="p-6 md:p-8 space-y-6">
            {/* Audio */}
            <div>
              <audio
                ref={audioRef}
                src={SAMPLE_AUDIO}
                onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
                onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
                onEnded={() => setPlaying(false)}
              />
              <div className="flex items-center gap-4">
                <button
                  onClick={toggle}
                  className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:scale-105 transition-transform"
                  aria-label={playing ? "Pause" : "Play"}
                >
                  {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
                </button>
                <div className="flex-1">
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: duration ? `${(time / duration) * 100}%` : "0%" }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
                    <span>{fmt(time)}</span>
                    <span>{duration ? fmt(duration) : "0:00"}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Visual scene */}
            <div className="rounded-xl overflow-hidden border bg-gradient-to-br from-primary/15 via-accent/10 to-secondary/15">
              <div className="aspect-[16/7] flex items-center justify-center">
                <ImageIcon className="w-12 h-12 text-primary/50" />
              </div>
              <div className="p-3 bg-card border-t">
                <p className="text-sm italic text-muted-foreground text-center">
                  Foggy streets of 18th-century London at dawn.
                </p>
              </div>
            </div>

            {/* Quiz */}
            <div className="grid md:grid-cols-2 gap-4">
              {questions.map((q, qi) => (
                <div key={qi} className="rounded-xl border p-4 bg-card">
                  <p className="text-sm font-semibold mb-3">{qi + 1}. {q.q}</p>
                  <div className="space-y-1.5">
                    {q.options.map((opt, i) => {
                      const sel = answers[qi];
                      const isSel = sel === i;
                      const isCorrect = q.correct === i;
                      const showState = sel !== null && isSel;
                      return (
                        <button
                          key={opt}
                          onClick={() => {
                            const next = [...answers];
                            next[qi] = i;
                            setAnswers(next);
                          }}
                          className={`w-full text-left text-sm px-3 py-2 rounded-lg border transition-colors flex items-center justify-between ${
                            showState
                              ? isCorrect
                                ? "border-primary bg-primary/10"
                                : "border-destructive bg-destructive/10"
                              : "border-border hover:bg-muted"
                          }`}
                        >
                          {opt}
                          {showState && (isCorrect ? <Check className="w-4 h-4 text-primary" /> : <X className="w-4 h-4 text-destructive" />)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-center pt-2">
              <Link to="/preview">
                <Button size="lg" className="gap-2">
                  Unlock full lesson <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
