import { useState } from "react";
import { Play, Pause, Brain, Image as ImageIcon, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function ProductPreviewMock() {
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      {/* Audio mock */}
      <Card className="shadow-xl border-0 bg-card/90 backdrop-blur">
        <CardContent className="p-5">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setPlaying(p => !p)}
              className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:scale-105 transition-transform"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
            <div className="flex-1">
              <p className="text-sm font-semibold">Chapter 1 — A Tale of Two Cities</p>
              <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full bg-primary rounded-full transition-all duration-700 ${playing ? "w-3/4" : "w-1/3"}`} />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
                <span>1:12</span>
                <span>3:24</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Visual scene mock */}
      <Card className="shadow-xl border-0 bg-card/90 backdrop-blur ml-6">
        <CardContent className="p-4">
          <div className="rounded-lg aspect-video bg-gradient-to-br from-primary/20 via-accent/15 to-secondary/20 flex items-center justify-center mb-3">
            <ImageIcon className="w-10 h-10 text-primary/60" />
          </div>
          <p className="text-xs italic text-muted-foreground text-center">
            "It was the best of times, it was the worst of times…"
          </p>
        </CardContent>
      </Card>

      {/* Quiz mock */}
      <Card className="shadow-xl border-0 bg-card/90 backdrop-blur mr-6">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4 text-accent" />
            <p className="text-sm font-semibold">Quick check</p>
          </div>
          <p className="text-sm mb-3">Where does Chapter 1 take place?</p>
          <div className="space-y-1.5">
            {["London & Paris", "New York", "Cape Town"].map((opt, i) => (
              <button
                key={opt}
                onClick={() => setSelected(i)}
                className={`w-full text-left text-xs px-3 py-2 rounded-lg border transition-colors flex items-center justify-between ${
                  selected === i
                    ? i === 0
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-destructive bg-destructive/10"
                    : "border-border hover:bg-muted"
                }`}
              >
                {opt}
                {selected === i && i === 0 && <Check className="w-3.5 h-3.5 text-primary" />}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
