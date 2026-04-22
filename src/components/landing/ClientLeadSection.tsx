import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ClientLeadSection() {
  return (
    <section className="py-12 bg-foreground text-background">
      <div className="max-w-5xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
        <div>
          <h3 className="font-display text-xl md:text-2xl font-bold">Want an app like this for your business?</h3>
          <p className="text-sm opacity-75 mt-1">We build production-ready AI products for teams of any size.</p>
        </div>
        <a href="mailto:hello@studysound.app">
          <Button size="lg" variant="secondary" className="gap-2">
            Let's build it <ArrowRight className="w-4 h-4" />
          </Button>
        </a>
      </div>
    </section>
  );
}
