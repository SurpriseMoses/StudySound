import { Link } from "react-router-dom";
import { Coins, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useCreditEstimate, PACK_LABELS } from "@/hooks/use-credit-estimate";

type Variant = "card" | "inline" | "compact";

const STATUS_STYLES = {
  enough: {
    border: "border-success/40 bg-success/5",
    text: "text-success",
    Icon: CheckCircle2,
  },
  close: {
    border: "border-primary/40 bg-primary/5",
    text: "text-primary",
    Icon: Coins,
  },
  short: {
    border: "border-destructive/40 bg-destructive/5",
    text: "text-destructive",
    Icon: AlertTriangle,
  },
};

export function CreditEstimator({
  documentId,
  variant = "card",
  fromContext,
}: {
  documentId: string | null | undefined;
  variant?: Variant;
  fromContext?: "audio" | "quiz" | "visuals";
}) {
  const est = useCreditEstimate(documentId);
  if (est.loading || est.totalSections === 0) return null;

  const style = STATUS_STYLES[est.status];
  const { Icon } = style;
  const pct = Math.round((est.unlockedSections / est.totalSections) * 100);
  const topupHref = `/topup${fromContext ? `?from=${fromContext}` : ""}`;

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Coins className={`w-3 h-3 ${style.text}`} />
        <span>
          {est.unlockedSections}/{est.totalSections} unlocked
        </span>
        {est.status === "short" && (
          <Link to={topupHref} className="text-destructive font-medium hover:underline">
            Top up
          </Link>
        )}
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${style.border}`}>
        <Icon className={`w-3.5 h-3.5 shrink-0 ${style.text}`} />
        <span className="text-foreground/80 flex-1 truncate">{est.message}</span>
        {est.status !== "enough" && est.recommendedPack && (
          <Link to={topupHref} className={`font-semibold hover:underline ${style.text}`}>
            Top up →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-xl border p-4 ${style.border}`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${style.text}`} />
        <div className="flex-1 min-w-0">
          <p className={`font-display font-semibold text-sm ${style.text}`}>{est.message}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {est.unlockedSections} of {est.totalSections} sections unlocked
            {est.remainingSections > 0 && (
              <>
                {" "}· <strong className="text-foreground">{est.creditsNeeded}</strong> credits to finish
              </>
            )}
            {" "}· Balance <strong className="text-foreground">{est.balance}</strong>
          </p>
          <Progress value={pct} className="h-1.5 mt-2.5" />
          {est.status !== "enough" && est.recommendedPack && (
            <Link
              to={topupHref}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              <Sparkles className="w-3 h-3" />
              Recommended: {PACK_LABELS[est.recommendedPack]} →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
