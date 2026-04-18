import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Coins, Sparkles, Zap, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
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
  {
    id: "starter",
    credits: 40,
    price: "R50",
    tagline: "1–2 study sessions, great for quick revision",
  },
  {
    id: "popular",
    credits: 100,
    bonus: 10,
    price: "R100",
    tagline: "2–3 lessons or books, most popular choice",
    popular: true,
  },
  {
    id: "power",
    credits: 220,
    price: "R200",
    tagline: "5–6 lessons or full study coverage",
  },
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

  const ctx = params.get("from") || "default";
  const copy = contextCopy[ctx] || contextCopy.default;

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("credits_balance")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setBalance(data?.credits_balance ?? 0));
  }, [user]);

  const handleCheckout = (pack: Pack) => {
    toast.info(`Checkout for ${pack.credits}${pack.bonus ? `+${pack.bonus}` : ""} credits coming soon`);
  };

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto">
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
              <span className="font-display font-bold">
                {balance === null ? "…" : balance}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-primary" />
            Most lessons cost 20–40 credits
          </p>
        </div>

        {/* Packs */}
        <div className="grid md:grid-cols-3 gap-4">
          {packs.map((pack) => {
            const isSelected = selected === pack.id;
            const isPopular = pack.popular;
            return (
              <motion.div
                key={pack.id}
                whileHover={{ y: -2 }}
                onClick={() => setSelected(pack.id)}
                className="cursor-pointer"
              >
                <Card
                  className={`relative h-full border-2 transition-all ${
                    isPopular
                      ? "border-primary shadow-lg shadow-primary/10"
                      : isSelected
                      ? "border-primary/60"
                      : "border-border"
                  }`}
                >
                  {isPopular && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground gap-1 px-3">
                      <Sparkles className="w-3 h-3" /> Most Popular
                    </Badge>
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCheckout(pack);
                      }}
                    >
                      {isSelected && <Check className="w-4 h-4" />}
                      Get {pack.credits}{pack.bonus ? ` +${pack.bonus}` : ""}
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Bottom note */}
        <div className="text-center mt-8">
          <button
            onClick={() => navigate("/plans")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Upgrade to <span className="text-primary font-semibold">Premium</span> for full experience →
          </button>
        </div>
      </motion.div>
    </AppLayout>
  );
}
