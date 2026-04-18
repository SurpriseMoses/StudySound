import { motion, AnimatePresence } from "framer-motion";
import { Flame, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RewardResult } from "@/hooks/use-daily-reward";

interface DailyRewardModalProps {
  open: boolean;
  result: RewardResult | null;
  onClose: () => void;
}

export default function DailyRewardModal({ open, result, onClose }: DailyRewardModalProps) {
  if (!result) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm overflow-hidden border-0 p-0 bg-gradient-to-br from-primary/95 via-primary to-accent text-primary-foreground">
        <div className="relative p-8 text-center">
          {/* Sparkle background */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {[...Array(8)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0 }}
                animate={{
                  opacity: [0, 1, 0],
                  scale: [0, 1.2, 0],
                  x: Math.cos((i / 8) * Math.PI * 2) * 90,
                  y: Math.sin((i / 8) * Math.PI * 2) * 90,
                }}
                transition={{ duration: 1.2, delay: 0.2 + i * 0.05, ease: "easeOut" }}
                className="absolute left-1/2 top-1/2"
              >
                <Sparkles className="h-4 w-4 text-primary-foreground/70" />
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.05 }}
            className="relative mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary-foreground/15 backdrop-blur"
          >
            <Flame className="h-10 w-10 text-primary-foreground" />
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

          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.4, type: "spring", stiffness: 200 }}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary-foreground/15 px-5 py-2.5 backdrop-blur"
          >
            <AnimatePresence mode="popLayout">
              <motion.span
                key={result.creditsAwarded}
                initial={{ y: -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-2xl font-bold"
              >
                +{result.creditsAwarded}
              </motion.span>
            </AnimatePresence>
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
              Keep learning
            </Button>
          </motion.div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
