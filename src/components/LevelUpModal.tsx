import { useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trophy, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProgressionContext } from "@/contexts/ProgressionContext";
import { perksUnlockedBetween } from "@/lib/perks";

export default function LevelUpModal() {
  const { pendingLevelUp, dismissLevelUp } = useProgressionContext();

  const newPerks = useMemo(
    () => (pendingLevelUp ? perksUnlockedBetween(pendingLevelUp.fromLevel, pendingLevelUp.toLevel) : []),
    [pendingLevelUp],
  );

  // Auto-dismiss after a few seconds (longer if perks unlocked, still tap-to-close)
  useEffect(() => {
    if (!pendingLevelUp) return;
    const t = setTimeout(() => dismissLevelUp(), newPerks.length > 0 ? 6500 : 4500);
    return () => clearTimeout(t);
  }, [pendingLevelUp, dismissLevelUp, newPerks.length]);

  return (
    <AnimatePresence>
      {pendingLevelUp && (
        <motion.div
          key="lvlup-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] bg-foreground/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={dismissLevelUp}
        >
          <motion.div
            key="lvlup-card"
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 320, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm rounded-2xl bg-card border shadow-2xl p-6 text-center overflow-hidden"
          >
            <button
              onClick={dismissLevelUp}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Floating sparkles */}
            {[...Array(8)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 0, x: 0, scale: 0 }}
                animate={{
                  opacity: [0, 1, 0],
                  y: [-10, -50 - i * 8],
                  x: [(i % 2 ? 1 : -1) * (10 + i * 4)],
                  scale: [0, 1, 0.5],
                }}
                transition={{ duration: 1.6, delay: i * 0.08, repeat: Infinity, repeatDelay: 0.4 }}
                className="absolute left-1/2 top-1/3 pointer-events-none"
              >
                <Sparkles className="w-3 h-3 text-primary" />
              </motion.div>
            ))}

            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 14, delay: 0.1 }}
              className="mx-auto mb-4 w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg"
            >
              <Trophy className="w-8 h-8 text-primary-foreground" />
            </motion.div>

            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Level up
            </p>
            <h2 className="font-display text-3xl font-bold mt-1">
              You reached Level {pendingLevelUp.toLevel}
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              {pendingLevelUp.toLevel - pendingLevelUp.fromLevel > 1
                ? `+${pendingLevelUp.toLevel - pendingLevelUp.fromLevel} levels gained!`
                : "Keep learning to unlock the next milestone."}
            </p>

            {newPerks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mt-4 text-left rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2"
              >
                <p className="text-[10px] uppercase tracking-wider font-semibold text-primary text-center">
                  {newPerks.length === 1 ? "Perk unlocked" : `${newPerks.length} perks unlocked`}
                </p>
                {newPerks.map((perk, i) => {
                  const Icon = perk.icon;
                  return (
                    <motion.div
                      key={perk.key}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4 + i * 0.1 }}
                      className="flex items-start gap-2.5"
                    >
                      <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                        <Icon className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-display font-semibold leading-tight">
                          {perk.title}
                        </div>
                        <div className="text-[11px] text-muted-foreground leading-snug">
                          {perk.description}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}

            <Button onClick={dismissLevelUp} className="mt-5 w-full">
              Keep going
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
