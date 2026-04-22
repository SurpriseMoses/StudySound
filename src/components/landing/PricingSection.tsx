import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const plans = [
  {
    name: "Essential",
    price: "R79",
    period: "/month",
    description: "For learners who prefer listening and practising",
    features: ["Up to 3 study packs per month", "Audio + Quiz + Translation", "Multilingual voices", "Offline study mode"],
    cta: "Start Essential",
    popular: false,
  },
  {
    name: "Premium",
    price: "R149",
    period: "/month",
    description: "Full audio-visual learning experience",
    features: ["Up to 6 study packs per month", "Audio + Quiz + Visuals", "Priority processing", "Offline study mode", "Custom study packs"],
    cta: "Start Premium",
    popular: true,
  },
];

export default function PricingSection() {
  return (
    <section id="pricing" className="py-16 md:py-20 bg-muted/30">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-display font-bold">Simple, student-friendly pricing</h2>
          <p className="mt-3 text-muted-foreground">Start with a free preview — upgrade when you're ready.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          {plans.map(plan => (
            <Card key={plan.name} className={`relative overflow-hidden border-2 ${plan.popular ? "border-primary shadow-lg" : "border-border"}`}>
              {plan.popular && (
                <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-bl-lg">
                  Most Popular
                </div>
              )}
              <CardContent className="p-7">
                <h3 className="font-display text-xl font-bold">{plan.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                <div className="mt-5 flex items-baseline gap-1">
                  <span className="text-4xl font-display font-bold">{plan.price}</span>
                  <span className="text-muted-foreground text-sm">{plan.period}</span>
                </div>
                <ul className="mt-6 space-y-3">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to="/onboarding">
                  <Button className="w-full mt-7" variant={plan.popular ? "default" : "outline"}>
                    {plan.cta}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground mt-8">
          <span>🎓 Perfect for exam prep</span>
          <span>🔄 Cancel anytime</span>
          <span>⚡ Instant access</span>
        </div>
      </div>
    </section>
  );
}
