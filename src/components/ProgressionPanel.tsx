import { motion } from "framer-motion";
import { Trophy, Sparkles, Lock, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useProgressionContext } from "@/contexts/ProgressionContext";
import { levelProgress, xpThreshold } from "@/lib/progression";
import { unlockedPerks, nextPerks } from "@/lib/perks";
import { cn } from "@/lib/utils";

export default function ProgressionPanel() {
  const { xp, loading } = useProgressionContext();
  const { level, xpIntoLevel, xpForNext, pct, nextLevelXp } = levelProgress(xp);
  const nextLevel = level + 1;
  const nextLevelThreshold = xpThreshold(nextLevel);
  const earned = unlockedPerks(level);
  const upcoming = nextPerks(level, 3);

  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" /> Progression
          </h2>
          {!loading && (
            <span className="text-xs text-muted-foreground font-medium">
              {xp.toLocaleString()} XP
            </span>
          )}
        </div>

        {/* Current level + XP bar */}
        <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-transparent p-4">
          <div className="flex items-end justify-between mb-2">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Current level
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-3xl font-display font-bold">{level}</span>
                <span className="text-xs text-muted-foreground">
                  {xpIntoLevel} / {xpForNext} XP
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Next level</div>
              <div className="text-sm font-display font-semibold">
                Lvl {nextLevel} · {nextLevelXp - xp} XP to go
              </div>
            </div>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden bg-muted">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70"
            />
          </div>
        </div>

        {/* Upcoming rewards (max 3) */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-sm font-display font-semibold">Upcoming rewards</h3>
          </div>
          {upcoming.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center border rounded-lg bg-muted/20">
              All perks unlocked — you're a Master Scholar!
            </div>
          ) : (
            <div className="space-y-1.5">
              {upcoming.map((p, i) => {
                const Icon = p.icon;
                return (
                  <div
                    key={p.key}
                    className={cn(
                      "flex items-center gap-2.5 py-2 px-3 rounded-lg",
                      i === 0 ? "border border-primary/30 bg-primary/5" : "bg-muted/30",
                    )}
                  >
                    <div
                      className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                        i === 0 ? "bg-primary/15" : "bg-muted",
                      )}
                    >
                      <Icon
                        className={cn(
                          "w-3.5 h-3.5",
                          i === 0 ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium leading-tight">{p.title}</div>
                      <div className="text-[11px] text-muted-foreground leading-snug truncate">
                        {p.description}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground shrink-0">
                      <Lock className="w-3 h-3" />
                      Lvl {p.level}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Unlocked perks (compact) */}
        {earned.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Check className="w-3.5 h-3.5 text-primary" />
              <h3 className="text-sm font-display font-semibold">
                Unlocked
                <span className="text-muted-foreground font-normal ml-1.5">
                  ({earned.length})
                </span>
              </h3>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {earned.map((p) => {
                const Icon = p.icon;
                return (
                  <div
                    key={p.key}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-full border border-primary/30 bg-primary/5 text-[11px]"
                    title={p.description}
                  >
                    <Icon className="w-3 h-3 text-primary" />
                    <span className="font-medium">{p.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
