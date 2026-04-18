import { Link } from "react-router-dom";
import { AlertTriangle, Coins, Sparkles, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useCreditEstimate, PACK_LABELS } from "@/hooks/use-credit-estimate";

type Props = {
  open: boolean;
  onClose: () => void;
  documentId: string | null | undefined;
  fromContext?: "audio" | "quiz" | "visuals";
};

/**
 * Level 2 — Smart nudge bottom sheet.
 * Shows when user tries to play a locked section and balance is low.
 */
export function LowCreditNudge({ open, onClose, documentId, fromContext = "audio" }: Props) {
  const est = useCreditEstimate(documentId);
  const topupHref = `/topup?from=${fromContext}${documentId ? `&doc=${documentId}` : ""}`;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8 max-w-lg mx-auto">
        <SheetHeader className="text-left">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary">
              <Sparkles className="w-4 h-4" />
            </span>
            <SheetTitle className="font-display text-xl">You're almost there</SheetTitle>
          </div>
          <SheetDescription className="text-sm text-foreground/80">
            Just a few more credits to keep going. Most students top up once and finish their book.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">You have</p>
            <p className="font-display text-xl font-bold mt-0.5">{est.balance}</p>
            <p className="text-[11px] text-muted-foreground">credits</p>
          </div>
          <div className="rounded-lg border bg-primary/5 p-3">
            <p className="text-xs text-muted-foreground">Need to finish</p>
            <p className="font-display text-xl font-bold mt-0.5 text-primary">{est.creditsNeeded}</p>
            <p className="text-[11px] text-muted-foreground">credits</p>
          </div>
        </div>

        {est.recommendedPack && (
          <div className="mt-4 rounded-xl border-2 border-primary/40 bg-gradient-to-br from-primary/10 to-transparent p-3 flex items-center gap-3">
            <Coins className="w-5 h-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-primary font-semibold">Recommended</p>
              <p className="text-sm font-semibold truncate">{PACK_LABELS[est.recommendedPack]}</p>
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2">
          <Button variant="ghost" className="sm:flex-1" onClick={onClose}>
            Maybe later
          </Button>
          <Button asChild className="sm:flex-1">
            <Link to={topupHref} onClick={onClose}>
              <Coins className="w-4 h-4" /> Top up now
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Level 3 — Hard block. Renders inline when balance is 0 and user has nothing left to unlock.
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
    <div className="rounded-2xl border-2 border-destructive/30 bg-destructive/5 p-8 text-center">
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
    </div>
  );
}
