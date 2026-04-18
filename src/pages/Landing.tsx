import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Headphones, Image, Brain, Wifi, BookOpen, Sparkles, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  { icon: Headphones, title: "AI Narration", desc: "Convert any textbook into natural voice narration in multiple languages", color: "text-primary" },
  { icon: Image, title: "Visual Scenes", desc: "AI-generated illustrations for English, History & more (non-STEM)", color: "text-secondary" },
  { icon: Brain, title: "Smart Quizzes", desc: "Auto-generated practice tests from your uploaded content", color: "text-accent" },
  { icon: Wifi, title: "Offline Study", desc: "Download lessons, audio & quizzes for studying without data", color: "text-success" },
];

const plans = [
  {
    name: "Essential",
    price: "R79",
    period: "/month",
    description: "For learners who prefer listening and practising",
    features: ["~2–3 books per month", "Audio + Quiz + Translation", "Multilingual voices", "Offline study mode"],
    cta: "Start Essential",
    popular: false,
  },
  {
    name: "Premium",
    price: "R149",
    period: "/month",
    description: "Full audio-visual learning experience",
    features: ["~5–6 books per month", "Audio + Quiz + Visuals", "Visual scenes for novels & history", "Priority processing", "Offline study mode", "Custom study packs"],
    cta: "Start Premium",
    popular: true,
  },
];

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.5 } }),
};

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-background/90 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            <span className="font-display text-xl font-bold">StudySound</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
            <Link to="/preview" className="hover:text-foreground transition-colors">Free Trial</Link>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/auth">
              <Button variant="ghost" size="sm">Log in</Button>
            </Link>
            <Link to="/onboarding">
              <Button size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[var(--gradient-hero)]" />
        <div className="relative max-w-6xl mx-auto px-4 pt-20 pb-24 md:pt-28 md:pb-32">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-2xl"
          >
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 rounded-full text-sm font-medium mb-6">
              <BookOpen className="w-4 h-4" />
              Built for South African schools
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold leading-tight tracking-tight">
              Study smarter with
              <span className="text-primary"> AI-powered</span> learning
            </h1>
            <p className="mt-5 text-lg text-muted-foreground max-w-xl">
              Turn any textbook into audio lessons, visual scenes, and smart quizzes — tailored to how you learn best.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/preview">
                <Button size="lg" className="gap-2">
                  Try Free Preview <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <Link to="/onboarding">
                <Button variant="outline" size="lg">Sign Up</Button>
              </Link>
            </div>
          </motion.div>

          {/* Floating cards */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="hidden lg:block absolute right-8 top-20 w-80"
          >
            <Card className="shadow-xl border-0 bg-card/80 backdrop-blur">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Headphones className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Now Playing</p>
                    <p className="text-xs text-muted-foreground">Chapter 3 — Great Expectations</p>
                  </div>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full w-2/3 bg-primary rounded-full" />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>4:32</span>
                  <span>6:48</span>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-xl border-0 bg-card/80 backdrop-blur mt-4 ml-8">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="w-4 h-4 text-accent" />
                  <p className="text-sm font-semibold">Quiz Result</p>
                </div>
                <p className="text-2xl font-display font-bold text-primary">85%</p>
                <p className="text-xs text-muted-foreground">17/20 correct — History Chapter 4</p>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 bg-muted/30">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-display font-bold">Everything you need to study better</h2>
            <p className="mt-3 text-muted-foreground max-w-lg mx-auto">Upload any textbook and let AI transform it into the format that works for you.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map((f, i) => (
              <motion.div key={f.title} custom={i} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp}>
                <Card className="h-full border-0 shadow-md hover:shadow-lg transition-shadow">
                  <CardContent className="p-6">
                    <f.icon className={`w-8 h-8 ${f.color} mb-4`} />
                    <h3 className="font-display font-semibold text-lg">{f.title}</h3>
                    <p className="text-sm text-muted-foreground mt-2">{f.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20">
        <div className="max-w-4xl mx-auto px-4">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-display font-bold">Simple, student-friendly pricing</h2>
            <p className="mt-3 text-muted-foreground">Start with a free preview, then choose the plan that fits your learning style.</p>
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
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-10">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="font-display font-bold">StudySound</span>
          </div>
          <p className="text-sm text-muted-foreground">© 2026 StudySound. Built for learners, by learners.</p>
        </div>
      </footer>
    </div>
  );
}
