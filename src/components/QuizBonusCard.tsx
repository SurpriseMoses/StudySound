import { motion } from "framer-motion";
import { Coins, Trophy, Sparkles } from "lucide-react";
import { quizBonusCredits, quizBonusLabel } from "@/lib/progression";
import { cn } from "@/lib/utils";

type Props = {
  scorePct: number;
  awarded?: { credits: number; xp: number } | null;
  className?: string;
};

/**
 * Inline result card shown after quiz completion. Calm UX — no extra modal.
 * Credits + XP are auto-credited server-side; this just visualizes the reward.
 */
export default function QuizBonusCard({ scorePct, awarded, className }: Props) {
  const credits = awarded?.credits ?? quizBonusCredits(scorePct);
  const xp = awarded?.xp ?? (scorePct >= 50 ? 15 : 5);
  const tier =
    scorePct >= 85 ? "top" : scorePct >= 70 ? "high" : scorePct >= 50 ? "mid" : "none";

  const tierStyles = {
    top: "from-primary/15 to-primary/5 border-primary/30",
    high: "from-primary/10 to-primary/5 border-primary/20",
    mid: "from-muted to-background border-border",
    none: "from-muted to-background border-border",
  } as const;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn(
        "rounded-xl border bg-gradient-to-br p-4",
        tierStyles[tier],
        className,
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <Trophy className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wide">
          Performance bonus
        </span>
      </div>
      <p className="text-sm font-medium">{quizBonusLabel(scorePct)}</p>

      <div className="mt-3 flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Coins className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">
            {credits > 0 ? `+${credits} credit${credits === 1 ? "" : "s"}` : "No credits"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">+{xp} XP</span>
        </div>
      </div>

      {credits > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Credits added to your balance automatically.
        </p>
      )}
    </motion.div>
  );
}
