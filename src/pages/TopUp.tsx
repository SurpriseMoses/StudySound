import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Coins, Sparkles, Zap, Check, PartyPopper } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { CreditEstimator } from "@/components/CreditEstimator";

type Pack = {
  id: string;
  credits: number;
  bonus?: number;
  price: string;
  tagline: string;
  popular?: boolean;
};

const packs: Pack[] = [
  { id: "starter", credits: 40, price: "R50", tagline: "1–2 study sessions, great for quick revision" },
  { id: "popular", credits: 100, bonus: 10, price: "R100", tagline: "2–3 lessons or books, most popular choice", popular: true },
  { id: "power", credits: 220, price: "R200", tagline: "5–6 lessons or full study coverage" },
];

const contextCopy: Record<string, { title: string; sub: string }> = {
  audio: { title: "Continue listening", sub: "Top up to unlock the next section" },
  quiz: { title: "Keep quizzing", sub: "Top up to generate more questions" },
  visuals: { title: "Bring scenes to life", sub: "Top up to render more visuals" },
  default: { title: "Continue learning", sub: "Top up to keep your momentum going" },
};

export default function TopUp() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [balance, setBalance] = useState<number | null>(null);
  const [selected, setSelected] = useState<string>("popular");
  const [success, setSuccess] = useState<{ credits: number } | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  const ctx = params.get("from") || "default";
  const copy = contextCopy[ctx] || contextCopy.default;
  const docId = params.get("doc");

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("credits_balance")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setBalance(data?.credits_balance ?? 0));
  }, [user]);

  const handleCheckout = async (pack: Pack) => {
    setProcessing(pack.id);
    // TODO: real Flutterwave checkout. For now, optimistic UI for animation.
    await new Promise((r) => setTimeout(r, 700));
    const total = pack.credits + (pack.bonus ?? 0);
    setBalance((b) => (b ?? 0) + total);
    setProcessing(null);
    setSuccess({ credits: total });
    // Auto-return after success
    setTimeout(() => {
      if (docId) {
        navigate(ctx === "default" ? `/lesson/${docId}` : `/lesson/${docId}?tab=${ctx}`);
      } else {
        navigate(-1);
      }
    }, 1600);
  };

  return (
    <AppLayout>
      <AnimatePresence mode="wait">
        {success ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="min-h-[60vh] flex items-center justify-center"
          >
            <div className="text-center max-w-sm">
              <motion.div
                initial={{ scale: 0, rotate: -45 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 14 }}
                className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-success/15 text-success mb-4"
              >
                <PartyPopper className="w-9 h-9" />
              </motion.div>
              <h1 className="text-2xl md:text-3xl font-display font-bold">Credits added</h1>
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="text-muted-foreground text-sm mt-2"
              >
                <strong className="text-foreground">+{success.credits}</strong> credits are now in your balance.
                Returning to your lesson…
              </motion.p>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ duration: 1.5, ease: "linear" }}
                className="h-0.5 bg-primary/60 rounded-full mt-6"
              />
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="max-w-3xl mx-auto"
          >
            <button
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>

            {/* Header */}
            <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-6 mb-6">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                {copy.title}
              </p>
              <div className="flex items-end justify-between mt-2 gap-4 flex-wrap">
                <div>
                  <h1 className="text-2xl md:text-3xl font-display font-bold">Top up credits</h1>
                  <p className="text-sm text-muted-foreground mt-1">{copy.sub}</p>
                </div>
                <div className="flex items-center gap-2 bg-card border rounded-full px-4 py-2">
                  <Coins className="w-4 h-4 text-primary" />
                  <span className="text-sm text-muted-foreground">Balance</span>
                  <motion.span
                    key={balance ?? 0}
                    initial={{ scale: 1.15 }}
                    animate={{ scale: 1 }}
                    className="font-display font-bold"
                  >
                    {balance === null ? "…" : balance}
                  </motion.span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-primary" />
                Most lessons cost 20–40 credits
              </p>
            </div>

            {/* Per-document estimator */}
            {docId && (
              <div className="mb-6">
                <CreditEstimator documentId={docId} variant="card" />
              </div>
            )}

            {/* Packs — staggered entrance */}
            <motion.div
              className="grid md:grid-cols-3 gap-4"
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
              }}
            >
              {packs.map((pack) => {
                const isSelected = selected === pack.id;
                const isPopular = pack.popular;
                const isProcessing = processing === pack.id;
                return (
                  <motion.div
                    key={pack.id}
                    variants={{
                      hidden: { opacity: 0, y: 16, scale: 0.96 },
                      show: { opacity: 1, y: 0, scale: 1 },
                    }}
                    transition={{ type: "spring", stiffness: 260, damping: 22 }}
                    whileHover={{ y: -3 }}
                    onClick={() => setSelected(pack.id)}
                    className="cursor-pointer"
                  >
                    <Card
                      className={`relative h-full border-2 transition-all ${
                        isPopular
                          ? "border-primary shadow-xl shadow-primary/15 md:scale-[1.03]"
                          : isSelected
                          ? "border-primary/60"
                          : "border-border"
                      }`}
                    >
                      {isPopular && (
                        <motion.div
                          initial={{ y: -10, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{ delay: 0.4 }}
                          className="absolute -top-2.5 left-1/2 -translate-x-1/2"
                        >
                          <Badge className="bg-primary text-primary-foreground gap-1 px-3 shadow-md">
                            <Sparkles className="w-3 h-3" /> Most Popular
                          </Badge>
                        </motion.div>
                      )}
                      <CardContent className="p-5 flex flex-col h-full">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-3xl font-display font-bold">{pack.credits}</span>
                          <span className="text-sm text-muted-foreground">credits</span>
                        </div>
                        {pack.bonus && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary mt-1">
                            <Sparkles className="w-3 h-3" /> +{pack.bonus} bonus credits
                          </span>
                        )}
                        <div className="text-xl font-display font-bold mt-3">{pack.price}</div>
                        <p className="text-xs text-muted-foreground mt-2 flex-1">{pack.tagline}</p>
                        <Button
                          className="w-full mt-4"
                          variant={isPopular ? "default" : "outline"}
                          disabled={isProcessing || !!processing}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCheckout(pack);
                          }}
                        >
                          {isProcessing ? (
                            <motion.span
                              animate={{ rotate: 360 }}
                              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                              className="inline-block"
                            >
                              <Coins className="w-4 h-4" />
                            </motion.span>
                          ) : (
                            isSelected && <Check className="w-4 h-4" />
                          )}
                          {isProcessing ? "Processing…" : `Get ${pack.credits}${pack.bonus ? ` +${pack.bonus}` : ""}`}
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </motion.div>

            <div className="text-center mt-8">
              <button
                onClick={() => navigate("/plans")}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Upgrade to <span className="text-primary font-semibold">Premium</span> for full experience →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppLayout>
  );
}
