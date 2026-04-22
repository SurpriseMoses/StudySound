import { Link } from "react-router-dom";
import { Check, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function UnlockSection() {
  const benefits = [
    "4 cinematic visual scenes",
    "Full AI narration (premium voice)",
    "Interactive quiz included",
    "Translations in your language",
  ];

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-card to-secondary/5 overflow-hidden relative">
      <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-primary/10 blur-3xl" />
      <CardContent className="p-6 md:p-8 relative">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">Full Story</span>
        </div>
        <h3 className="text-2xl md:text-3xl font-display font-bold">Unlock full story</h3>
        <p className="text-sm text-muted-foreground mt-1">Continue where the preview ends.</p>

        <ul className="mt-5 space-y-2.5">
          {benefits.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
                <Check className="w-3 h-3" />
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <Link to="/onboarding" className="block mt-6">
          <Button size="lg" className="w-full gap-2 h-12 text-base shadow-lg shadow-primary/20">
            Unlock full story — 15 credits
            <ArrowRight className="w-4 h-4" />
          </Button>
        </Link>
        <Link
          to="/topup"
          className="block text-center text-xs text-muted-foreground hover:text-primary mt-3 underline-offset-4 hover:underline"
        >
          Need credits? Top up →
        </Link>
      </CardContent>
    </Card>
  );
}
