import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Coins, Sparkles, Lock, Unlock, Check } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useCreditEstimate, PACK_LABELS } from "@/hooks/use-credit-estimate";

type Props = {
  open: boolean;
  onClose: () => void;
  documentId: string | null | undefined;
  fromContext?: "audio" | "quiz" | "visuals";
  /** Optional: enables the "Unlock now" CTA (deduct 1 credit & continue) */
  onUnlock?: () => Promise<void> | void;
  /** Cost to unlock the next single section (default 1) */
  unlockCost?: number;
};

/**
 * Level 2 — Smart nudge bottom sheet with unlock animation.
 * Slides up, never full-screen.
 */
export function LowCreditNudge({
  open,
  onClose,
  documentId,
  fromContext = "audio",
  onUnlock,
  unlockCost = 1,
}: Props) {
  const est = useCreditEstimate(documentId);
  const topupHref = `/topup?from=${fromContext}${documentId ? `&doc=${documentId}` : ""}`;
  const [unlocking, setUnlocking] = useState<"idle" | "running" | "done">("idle");

  const canUnlock = !!onUnlock && est.balance >= unlockCost;

  const handleUnlock = async () => {
    if (!onUnlock) return;
    setUnlocking("running");
    try {
      await onUnlock();
      setUnlocking("done");
      // Brief celebratory pause, then close
      setTimeout(() => {
        setUnlocking("idle");
        onClose();
      }, 900);
    } catch {
      setUnlocking("idle");
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && unlocking === "idle" && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl pb-8 max-w-lg mx-auto border-t-2 border-primary/20"
      >
        <SheetHeader className="text-left">
          <div className="flex items-center gap-2 mb-2">
            <motion.span
              initial={{ scale: 0.8, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 15 }}
              className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary"
            >
              <Sparkles className="w-4 h-4" />
            </motion.span>
            <SheetTitle className="font-display text-xl">You're so close</SheetTitle>
          </div>
          <SheetDescription className="text-sm text-foreground/80">
            Keep your momentum going — unlock the next section now or top up to finish the book.
          </SheetDescription>
        </SheetHeader>

        <AnimatePresence mode="wait">
          {unlocking === "done" ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="mt-6 py-8 flex flex-col items-center gap-3"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 15 }}
                className="w-14 h-14 rounded-full bg-success/15 text-success flex items-center justify-center"
              >
                <Unlock className="w-6 h-6" />
              </motion.div>
              <p className="font-display font-semibold">Unlocked!</p>
              <p className="text-xs text-muted-foreground">Playing next section…</p>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">You have</p>
                  <motion.p
                    key={est.balance}
                    initial={{ scale: 1.15, color: "hsl(var(--primary))" }}
                    animate={{ scale: 1, color: "hsl(var(--foreground))" }}
                    className="font-display text-2xl font-bold mt-0.5"
                  >
                    {est.balance}
                  </motion.p>
                  <p className="text-[11px] text-muted-foreground">credits</p>
                </div>
                <div className="rounded-xl border bg-primary/5 p-3">
                  <p className="text-xs text-muted-foreground">Need to finish</p>
                  <p className="font-display text-2xl font-bold mt-0.5 text-primary">{est.creditsNeeded}</p>
                  <p className="text-[11px] text-muted-foreground">credits</p>
                </div>
              </div>

              {est.recommendedPack && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="mt-4 rounded-xl border-2 border-primary/40 bg-gradient-to-br from-primary/10 to-transparent p-3 flex items-center gap-3"
                >
                  <Coins className="w-5 h-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] uppercase tracking-wider text-primary font-semibold">
                      Recommended
                    </p>
                    <p className="text-sm font-semibold truncate">{PACK_LABELS[est.recommendedPack]}</p>
                  </div>
                </motion.div>
              )}

              <div className="mt-5 flex flex-col gap-2">
                {canUnlock && (
                  <Button
                    onClick={handleUnlock}
                    disabled={unlocking === "running"}
                    className="w-full gap-2"
                    size="lg"
                  >
                    {unlocking === "running" ? (
                      <>
                        <motion.span
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                          className="inline-block"
                        >
                          <Lock className="w-4 h-4" />
                        </motion.span>
                        Unlocking…
                      </>
                    ) : (
                      <>
                        <Unlock className="w-4 h-4" />
                        Unlock now ({unlockCost} credit{unlockCost > 1 ? "s" : ""})
                      </>
                    )}
                  </Button>
                )}
                <div className="flex flex-col-reverse sm:flex-row gap-2">
                  <Button variant="ghost" className="sm:flex-1" onClick={onClose}>
                    Maybe later
                  </Button>
                  <Button asChild variant={canUnlock ? "outline" : "default"} className="sm:flex-1">
                    <Link to={topupHref} onClick={onClose}>
                      <Coins className="w-4 h-4" /> Get credits
                    </Link>
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Level 3 — Hard block when balance is 0 and nothing unlocked yet.
 */
export function HardCreditBlock({
  documentId,
  fromContext = "audio",
}: {
  documentId: string | null | undefined;
  fromContext?: "audio" | "quiz" | "visuals";
}) {
  const topupHref = `/topup?from=${fromContext}${documentId ? `&doc=${documentId}` : ""}`;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border-2 border-destructive/30 bg-destructive/5 p-8 text-center"
    >
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-destructive/10 text-destructive mb-3">
        <AlertTriangle className="w-5 h-5" />
      </div>
      <h3 className="font-display text-xl font-bold">You're out of credits</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
        Top up to keep listening. Replays of unlocked sections stay free.
      </p>
      <Button asChild className="mt-5">
        <Link to={topupHref}>
          <Coins className="w-4 h-4" /> Top up to continue
        </Link>
      </Button>
    </motion.div>
  );
}
