import { Lock, Check } from "lucide-react";

interface Scene {
  number: number;
  title: string;
  unlocked: boolean;
}

const scenes: Scene[] = [
  { number: 1, title: "London fog", unlocked: true },
  { number: 2, title: "The courtroom", unlocked: false },
  { number: 3, title: "Tellson's Bank", unlocked: false },
  { number: 4, title: "By the Thames", unlocked: false },
];

export default function SceneStrip() {
  return (
    <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
      <div className="flex gap-3 min-w-max md:min-w-0 md:grid md:grid-cols-4">
        {scenes.map((s) => (
          <div
            key={s.number}
            className={`relative w-40 md:w-auto rounded-xl border p-4 transition-all ${
              s.unlocked
                ? "border-primary/30 bg-primary/5"
                : "border-border bg-muted/30 opacity-75"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground">Scene {s.number}</span>
              {s.unlocked ? (
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                  <Check className="w-3 h-3" />
                </span>
              ) : (
                <Lock className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </div>
            <p className={`text-sm font-medium ${s.unlocked ? "text-foreground" : "text-muted-foreground"}`}>
              {s.title}
            </p>
            <p className="text-[10px] mt-1 uppercase tracking-wide font-semibold text-primary">
              {s.unlocked ? "Unlocked" : "Locked"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
