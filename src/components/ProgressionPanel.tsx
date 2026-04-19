import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Sparkles, Target, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProgressionContext } from "@/contexts/ProgressionContext";
import { levelProgress, xpThreshold } from "@/lib/progression";
import { cn } from "@/lib/utils";

type XpEvent = {
  id: string;
  source: string;
  xp_awarded: number;
  credits_awarded: number;
  created_at: string;
};

const SOURCE_LABELS: Record<string, string> = {
  section_complete: "Section completed",
  lesson_complete: "Lesson completed",
  daily_reward: "Daily reward",
  quiz_bonus: "Quiz bonus",
};

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function ProgressionPanel() {
  const { user } = useAuth();
  const { xp, loading } = useProgressionContext();
  const [events, setEvents] = useState<XpEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("xp_events")
        .select("id, source, xp_awarded, credits_awarded, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8);
      if (!cancelled) {
        setEvents(data ?? []);
        setEventsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, xp]);

  const { level, xpIntoLevel, xpForNext, pct, currentLevelXp, nextLevelXp } = levelProgress(xp);

  const upcoming = [1, 2, 3].map((n) => {
    const lvl = level + n;
    const threshold = xpThreshold(lvl);
    return {
      level: lvl,
      threshold,
      xpRemaining: threshold - xp,
    };
  });

  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" /> Progression
          </h2>
          {!loading && (
            <span className="text-xs text-muted-foreground font-medium">
              {xp.toLocaleString()} XP total
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
                  {xpIntoLevel} / {xpForNext} XP into level
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Next level</div>
              <div className="text-sm font-display font-semibold">
                {nextLevelXp - xp} XP to go
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
          <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground font-medium">
            <span>Lvl {level} · {currentLevelXp.toLocaleString()} XP</span>
            <span>Lvl {level + 1} · {nextLevelXp.toLocaleString()} XP</span>
          </div>
        </div>

        {/* Upcoming thresholds */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-sm font-display font-semibold">Upcoming levels</h3>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {upcoming.map((u, i) => (
              <div
                key={u.level}
                className={cn(
                  "rounded-lg border p-3 text-center",
                  i === 0 ? "border-primary/40 bg-primary/5" : "bg-muted/30",
                )}
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Level
                </div>
                <div className="text-xl font-display font-bold mt-0.5">{u.level}</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {u.threshold.toLocaleString()} XP
                </div>
                <div className="text-[10px] text-primary font-semibold mt-1">
                  +{u.xpRemaining.toLocaleString()} to go
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent XP events */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-sm font-display font-semibold">Recent activity</h3>
          </div>
          {eventsLoading ? (
            <div className="text-xs text-muted-foreground py-4 text-center">Loading…</div>
          ) : events.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center border rounded-lg bg-muted/20">
              No XP earned yet — start a lesson to begin
            </div>
          ) : (
            <div className="space-y-1.5">
              {events.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {SOURCE_LABELS[e.source] ?? e.source}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatRelative(e.created_at)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-display font-semibold text-primary">
                      +{e.xp_awarded} XP
                    </span>
                    {e.credits_awarded > 0 && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                        +{e.credits_awarded}c
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
