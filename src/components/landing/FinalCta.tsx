import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function FinalCta() {
  return (
    <section className="py-16 md:py-20">
      <div className="max-w-3xl mx-auto px-4 text-center">
        <h2 className="text-3xl md:text-4xl font-display font-bold">Start studying smarter today</h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Try a real lesson in seconds — no signup needed.
        </p>
        <div className="mt-8">
          <Link to="/preview">
            <Button size="lg" className="gap-2">
              Try Free Preview <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
