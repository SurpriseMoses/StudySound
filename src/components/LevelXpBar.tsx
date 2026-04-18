import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { useProgressionContext } from "@/contexts/ProgressionContext";
import { levelProgress } from "@/lib/progression";
import { cn } from "@/lib/utils";

type Props = {
  variant?: "sidebar" | "inline";
  className?: string;
};

/**
 * Compact level + XP progress display.
 * - sidebar: dark theme, fits in AppLayout sidebar footer
 * - inline: light theme, embedded in dashboards / profile
 */
export default function LevelXpBar({ variant = "sidebar", className }: Props) {
  const { xp, loading } = useProgressionContext();
  const { level, xpIntoLevel, xpForNext, pct } = levelProgress(xp);

  if (loading) return null;

  const isSidebar = variant === "sidebar";

  return (
    <div
      className={cn(
        "rounded-lg p-3",
        isSidebar
          ? "bg-sidebar-accent/60 text-sidebar-foreground"
          : "border bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Trophy className={cn("w-3.5 h-3.5", isSidebar ? "text-sidebar-primary" : "text-primary")} />
          <span className="text-xs font-semibold">Level {level}</span>
        </div>
        <span className={cn("text-[10px] font-medium", isSidebar ? "text-sidebar-foreground/60" : "text-muted-foreground")}>
          {xpIntoLevel} / {xpForNext} XP
        </span>
      </div>
      <div
        className={cn(
          "h-1.5 w-full rounded-full overflow-hidden",
          isSidebar ? "bg-sidebar-foreground/15" : "bg-muted",
        )}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className={cn("h-full rounded-full", isSidebar ? "bg-sidebar-primary" : "bg-primary")}
        />
      </div>
    </div>
  );
}
