import { Link } from "react-router-dom";
import { Lock, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function QuizTeaser() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-secondary/15 flex items-center justify-center">
              <Brain className="w-4 h-4 text-secondary" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">Quiz</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Test your understanding</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <Lock className="w-3 h-3" /> Locked
          </span>
        </div>

        <div className="relative rounded-lg border border-dashed border-border bg-muted/20 p-5 overflow-hidden">
          <div className="select-none blur-sm pointer-events-none">
            <p className="text-sm font-medium mb-3">
              What atmospheric element wraps itself around lampposts and doorways in the opening?
            </p>
            <div className="space-y-2">
              {["Snow", "Fog", "Smoke", "Rain"].map((opt) => (
                <div key={opt} className="text-sm px-3 py-2 rounded-md border border-border bg-background">
                  {opt}
                </div>
              ))}
            </div>
          </div>
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-background via-background/80 to-background/20">
            <Link to="/onboarding">
              <Button size="sm" variant="secondary" className="gap-2 shadow">
                <Lock className="w-3.5 h-3.5" /> Unlock to try quiz
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
