import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Flame } from "lucide-react";
import { useDailyRewardContext } from "@/contexts/DailyRewardContext";

/**
 * Small persistent indicator that shows briefly after the daily reward modal
 * closes: "Streak active — keep learning". Auto-hides after a few seconds.
 */
export default function StreakActivePill() {
  const { open, result } = useDailyRewardContext();
  const [show, setShow] = useState(false);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    // When modal closes after a fresh claim, reveal pill briefly
    if (!open && result && !result.alreadyClaimed) {
      setStreak(result.streak);
      setShow(true);
      const t = setTimeout(() => setShow(false), 4500);
      return () => clearTimeout(t);
    }
  }, [open, result]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.95 }}
          transition={{ duration: 0.25 }}
          className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 lg:left-[calc(50%+8rem)]"
        >
          <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
            <Flame className="h-4 w-4 text-primary animate-pulse" />
            <span className="text-xs font-medium">
              <span className="text-primary font-semibold">Day {streak} streak active</span>
              <span className="text-muted-foreground"> — keep learning</span>
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
