import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Flame } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RewardResult } from "@/hooks/use-daily-reward";

interface DailyRewardModalProps {
  open: boolean;
  result: RewardResult | null;
  onClose: () => void;
}

const AUTO_DISMISS_MS = 2800;

function useCountUp(target: number, durationMs = 900, start = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) { setValue(0); return; }
    let raf = 0;
    const startTs = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTs) / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, start]);
  return value;
}

export default function DailyRewardModal({ open, result, onClose }: DailyRewardModalProps) {
  const credits = result?.creditsAwarded ?? 0;
  const counted = useCountUp(credits, 900, open && !!result);

  // Auto-dismiss after ~2.8s
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onClose, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [open, onClose]);

  if (!result) return null;

  // Floating particles — small coin dots floating up
  const particles = Array.from({ length: 10 }, (_, i) => i);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm overflow-hidden border-0 p-0 bg-gradient-to-br from-primary/95 via-primary to-accent text-primary-foreground">
        <div className="relative p-8 text-center">
          {/* Floating credit particles */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {particles.map((i) => {
              const left = 10 + (i * 8) + (i % 2 === 0 ? 2 : -2);
              const delay = 0.15 + (i % 5) * 0.08;
              const duration = 1.6 + (i % 3) * 0.2;
              return (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: 40, scale: 0.6 }}
                  animate={{ opacity: [0, 1, 1, 0], y: -120, scale: 1 }}
                  transition={{ duration, delay, ease: "easeOut" }}
                  className="absolute bottom-6 text-xs font-bold text-primary-foreground/80"
                  style={{ left: `${left}%` }}
                >
                  +1
                </motion.span>
              );
            })}
          </div>

          {/* Flame with pulse */}
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.05 }}
            className="relative mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary-foreground/15 backdrop-blur"
          >
            {/* Pulsing rings (CSS-only) */}
            <span className="pointer-events-none absolute inset-0 rounded-full bg-primary-foreground/20 animate-ping" />
            <span className="pointer-events-none absolute inset-2 rounded-full bg-primary-foreground/10 animate-pulse" />
            <Flame className="relative h-10 w-10 text-primary-foreground drop-shadow-[0_0_12px_rgba(255,255,255,0.5)]" />
          </motion.div>

          <DialogTitle asChild>
            <motion.h2
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="font-display text-2xl font-bold"
            >
              Day {result.streak} streak!
            </motion.h2>
          </DialogTitle>

          <DialogDescription asChild>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-1 text-sm text-primary-foreground/85"
            >
              Keep showing up — your streak is building.
            </motion.p>
          </DialogDescription>

          {/* Animated credit count-up */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.4, type: "spring", stiffness: 200 }}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary-foreground/15 px-5 py-2.5 backdrop-blur"
          >
            <span className="text-2xl font-bold tabular-nums">+{counted}</span>
            <span className="text-sm font-medium">credits added</span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
            className="mt-6"
          >
            <Button
              onClick={onClose}
              variant="secondary"
              className="w-full bg-primary-foreground text-primary hover:bg-primary-foreground/90"
            >
              Tap to continue
            </Button>
          </motion.div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
