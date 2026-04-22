import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PreviewFinalCta() {
  return (
    <section className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/80 text-primary-foreground p-10 md:p-16 text-center">
      <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_30%_20%,white,transparent_60%)]" />
      <div className="relative max-w-2xl mx-auto">
        <h2 className="text-3xl md:text-5xl font-display font-bold leading-tight">
          Study faster. Understand better.
        </h2>
        <p className="text-base md:text-lg mt-4 text-primary-foreground/85">
          Join students using StudySound to turn any textbook into a cinematic learning experience.
        </p>
        <Link to="/onboarding" className="inline-block mt-7">
          <Button size="lg" variant="secondary" className="h-12 px-7 text-base gap-2 shadow-xl">
            Get Started Free
            <ArrowRight className="w-4 h-4" />
          </Button>
        </Link>
        <p className="text-xs text-primary-foreground/70 mt-3">No credit card required</p>
      </div>
    </section>
  );
}
