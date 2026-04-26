import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Zap, Headphones, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

const trustBullets = [
  { icon: Zap, label: "No signup required" },
  { icon: Headphones, label: "Instant audio preview" },
  { icon: Globe, label: "Multiple languages" },
];

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-[var(--gradient-hero)]" />
      <div className="relative max-w-4xl mx-auto px-4 pt-20 pb-24 md:pt-28 md:pb-32 text-center">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold leading-[1.1] tracking-tight">
            Turn any textbook into <span className="text-primary">audio, visuals & quizzes</span>
          </h1>
          <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto">
            Upload your book and start learning in minutes — listen, see, and test what you know.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Link to="/preview">
              <Button size="lg" className="gap-2">
                Try Free Preview <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <a href="#how-it-works">
              <Button variant="outline" size="lg">See How It Works</Button>
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground justify-center">
            {trustBullets.map(b => (
              <li key={b.label} className="flex items-center gap-1.5">
                <b.icon className="w-4 h-4 text-primary" />
                {b.label}
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
    </section>
  );
}
