import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Globe, Loader2, Lock, Sparkles, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ProtectedTranslation } from "@/components/ProtectedTranslation";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const TRANSLATION_COST = 2;

const LANG_LABELS: Record<string, string> = {
  en: "English", af: "Afrikaans", zu: "isiZulu", xh: "isiXhosa",
  nso: "Sepedi", tn: "Setswana", ts: "Xitsonga", fr: "French",
};

interface Props {
  lessonId: string;
  chunkIndex: number;
  language: string; // target language code (already set by global picker)
  /** Whether to render the sticky mobile unlock bar (default true). */
  stickyMobile?: boolean;
}

type CheckState = {
  cache_exists: boolean;
  already_paid: boolean;
  credits_balance: number;
};

/**
 * Per-section translation flow:
 *  - check_only on mount → know if user already paid
 *  - if paid → fetch & render translated text
 *  - if not paid + cache exists → blurred preview + unlock CTA
 *  - if not paid + no cache → unlock CTA
 *  - if balance < cost → top-up CTA
 *  - confirmation modal before charging
 *  - sticky mobile unlock bar
 */
export function TranslationSection({ lessonId, chunkIndex, language, stickyMobile = true }: Props) {
  const { toast } = useToast();
  const [check, setCheck] = useState<CheckState | null>(null);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const langLabel = LANG_LABELS[language] ?? language.toUpperCase();

  // 1. Check cache + paid status whenever section/language changes
  useEffect(() => {
    if (language === "en" || !lessonId) {
      setCheck(null);
      setTranslatedText(null);
      return;
    }
    let cancelled = false;
    setIsChecking(true);
    setTranslatedText(null);
    setCheck(null);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("generate-translation", {
          body: { lesson_id: lessonId, chunk_index: chunkIndex, target_language: language, check_only: true },
        });
        if (cancelled) return;
        if (error || !data?.success) throw new Error(data?.error ?? error?.message ?? "Check failed");
        const c: CheckState = {
          cache_exists: !!data.cache_exists,
          already_paid: !!data.already_paid,
          credits_balance: data.credits_balance ?? 0,
        };
        setCheck(c);
        if (c.already_paid) await fetchTranslated();
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Check failed";
          toast({ title: "Translation check failed", description: msg, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setIsChecking(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, chunkIndex, language]);

  // Fetch the actual translated text (only when user has access — server returns it for free on replays)
  const fetchTranslated = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("generate-translation", {
        body: { lesson_id: lessonId, chunk_index: chunkIndex, target_language: language },
      });
      if (error || !data?.success) throw new Error(data?.error ?? error?.message ?? "Translation failed");
      setTranslatedText(data.translated_text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Translation failed";
      toast({ title: "Translation failed", description: msg, variant: "destructive" });
    }
  }, [lessonId, chunkIndex, language, toast]);

  const handleConfirmUnlock = async () => {
    setConfirmOpen(false);
    setIsUnlocking(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-translation", {
        body: { lesson_id: lessonId, chunk_index: chunkIndex, target_language: language },
      });
      if (error || !data?.success) throw new Error(data?.error ?? error?.message ?? "Translation failed");
      setTranslatedText(data.translated_text);
      setCheck((prev) => prev
        ? { ...prev, already_paid: true, cache_exists: true, credits_balance: Math.max(0, prev.credits_balance - (data.credits_charged ?? 0)) }
        : prev);
      if (data.credits_charged > 0) {
        toast({
          title: `Translation unlocked`,
          description: `${data.credits_charged} credits • Yours forever in ${langLabel}.`,
        });
      } else {
        toast({ title: `Translation unlocked`, description: `Already in your library — no charge.` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Translation failed";
      toast({ title: "Unlock failed", description: msg, variant: "destructive" });
    } finally {
      setIsUnlocking(false);
    }
  };

  // Don't render anything if user is on English
  if (language === "en") return null;

  // Loading: initial check
  if (isChecking || !check) {
    return (
      <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Checking translation…
        </div>
      </div>
    );
  }

  // Unlocking — skeleton
  if (isUnlocking) {
    return (
      <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-primary mb-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          Translating to {langLabel}…
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-[95%]" />
          <Skeleton className="h-3 w-[90%]" />
          <Skeleton className="h-3 w-[97%]" />
          <Skeleton className="h-3 w-[60%]" />
        </div>
      </div>
    );
  }

  // ✅ Unlocked — show translated text
  if (check.already_paid && translatedText) {
    return (
      <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.03] p-5">
        <div className="flex items-center gap-2 text-xs font-medium text-primary mb-3">
          <Globe className="w-3.5 h-3.5" />
          Translated · {langLabel}
          <span className="ml-auto text-[10px] text-muted-foreground font-normal">Yours forever</span>
        </div>
        <ProtectedTranslation
          text={translatedText}
          className="text-foreground/85 leading-relaxed text-sm whitespace-pre-line outline-none"
        />
      </div>
    );
  }

  // 💳 Insufficient credits
  if (check.credits_balance < TRANSLATION_COST) {
    return (
      <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        <div className="flex items-center gap-2 text-sm font-medium mb-1">
          <Coins className="w-4 h-4 text-destructive" />
          You need {TRANSLATION_COST} credits to unlock translation
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Balance: <strong className="text-foreground">{check.credits_balance}</strong> credits.
          One-time unlock — yours forever after.
        </p>
        <Button asChild size="sm" className="w-full sm:w-auto">
          <Link to="/topup?from=translation">
            <Coins className="w-4 h-4 mr-1" /> Top up credits
          </Link>
        </Button>
      </div>
    );
  }

  // 🌍 Unlock CTA — with optional blurred preview if cache exists
  return (
    <>
      <div className="mt-4 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.06] to-primary/[0.02] p-5">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="w-4 h-4 text-primary" />
          <h4 className="font-display font-semibold text-sm">Translate this section</h4>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Understand this content in <strong className="text-foreground">{langLabel}</strong>.{" "}
          <span className="text-primary font-medium">One-time unlock. Yours forever.</span>
        </p>

        {check.cache_exists && (
          <div
            className="relative mb-4 rounded-lg border border-border bg-muted/40 p-3 overflow-hidden select-none"
            aria-label="Blurred translation preview"
          >
            <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
              <Lock className="w-3 h-3" /> Translation preview
            </div>
            <div
              className="text-xs leading-relaxed text-foreground/70 line-clamp-4"
              style={{ filter: "blur(5px)", userSelect: "none" }}
              aria-hidden
            >
              {/* Decorative placeholder text — real translation only revealed after unlock */}
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
              tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam,
              quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo
              consequat. Duis aute irure dolor in reprehenderit.
            </div>
            <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background/95 to-transparent flex items-end justify-center pb-1">
              <span className="text-[10px] text-muted-foreground font-medium">Unlock to view</span>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <Button
            onClick={() => setConfirmOpen(true)}
            className="w-full sm:w-auto"
          >
            <Sparkles className="w-4 h-4 mr-1" />
            Unlock translation — {TRANSLATION_COST} credits
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Balance: <strong className="text-foreground">{check.credits_balance}</strong>
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          One-time unlock. No repeat charges. For personal study use only.
        </p>
      </div>

      {/* Sticky mobile unlock bar */}
      {stickyMobile && (
        <div className="sm:hidden fixed bottom-20 left-0 right-0 z-20 px-3 pointer-events-none">
          <Button
            onClick={() => setConfirmOpen(true)}
            className="w-full shadow-lg pointer-events-auto"
            size="lg"
          >
            <Globe className="w-4 h-4 mr-2" />
            Unlock translation — {TRANSLATION_COST} credits
          </Button>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              Unlock Translation
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 pt-1">
                <p>
                  Translate this section into <strong className="text-foreground">{langLabel}</strong>.
                </p>
                <ul className="text-sm space-y-1.5 text-foreground/80">
                  <li>• One-time cost: <strong>{TRANSLATION_COST} credits</strong></li>
                  <li>• Available <strong>forever</strong> after unlock</li>
                  <li>• No charges on re-open</li>
                </ul>
                <p className="text-xs text-muted-foreground">
                  Your balance after: <strong className="text-foreground">{Math.max(0, check.credits_balance - TRANSLATION_COST)}</strong> credits.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmUnlock}>
              <Sparkles className="w-4 h-4 mr-1" />
              Confirm & Translate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
