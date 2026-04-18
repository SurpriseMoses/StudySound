import { motion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import AppLayout from "@/components/AppLayout";

const plans = [
  {
    id: "essential",
    name: "Essential",
    price: "R79",
    period: "/month",
    desc: "For learners who prefer listening and practising",
    features: [
      "~2–3 books per month",
      "Audio + Quiz + Translation",
      "Multilingual voices",
      "Offline study mode",
    ],
    popular: false,
  },
  {
    id: "premium",
    name: "Premium",
    price: "R149",
    period: "/month",
    desc: "Full audio-visual learning experience",
    features: [
      "~5–6 books per month",
      "Audio + Quiz + Visuals",
      "Visual scenes for novels & history",
      "Priority processing",
      "Offline study mode",
      "Custom study packs",
    ],
    popular: true,
  },
];

export default function Plans() {
  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-display font-bold">Choose Your Plan</h1>
          <p className="text-muted-foreground text-sm mt-1">Simple plans built for how students actually learn.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-5 max-w-3xl mx-auto">
          {plans.map(plan => (
            <Card key={plan.id} className={`relative overflow-hidden border-2 ${plan.popular ? "border-primary shadow-lg" : "border-border"}`}>
              {plan.popular && (
                <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-bl-lg flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Popular
                </div>
              )}
              <CardContent className="p-6">
                <h2 className="font-display text-xl font-bold">{plan.name}</h2>
                <p className="text-sm text-muted-foreground mt-1">{plan.desc}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-display font-bold">{plan.price}</span>
                  <span className="text-muted-foreground text-sm">{plan.period}</span>
                </div>
                <ul className="mt-5 space-y-2.5">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button className="w-full mt-6" variant={plan.popular ? "default" : "outline"}>
                  {plan.popular ? "Upgrade to Premium" : "Choose Essential"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Need more?{" "}
          <a href="/topup" className="text-foreground font-medium underline underline-offset-4 hover:text-primary">
            Top up credits anytime
          </a>
        </p>
      </motion.div>
    </AppLayout>
  );
}
