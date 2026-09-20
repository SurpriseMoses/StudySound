import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Sparkles, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { PLAN_OPTIONS, type PlanOption } from "@/lib/plans";

export default function Plans() {
  const { user } = useAuth();
  const [currentPlan, setCurrentPlan] = useState<string>("free");
  const [renewsAt, setRenewsAt] = useState<string | null>(null);
  const [subStatus, setSubStatus] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const [{ data: profile }, { data: sub }] = await Promise.all([
        supabase.from("profiles").select("plan").eq("user_id", user.id).maybeSingle(),
        supabase
          .from("subscriptions")
          .select("plan, status, current_period_end")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      if (!active) return;
      setCurrentPlan(profile?.plan ?? "free");
      setRenewsAt(sub?.current_period_end ?? null);
      setSubStatus(sub?.status ?? null);
    })();
    return () => {
      active = false;
    };
  }, [user]);

  const startCheckout = async (plan: PlanOption) => {
    setProcessing(plan.id);
    try {
      const callback = new URL("/payment/callback", window.location.origin);
      callback.searchParams.set("kind", "plan");
      const { data, error } = await supabase.functions.invoke("paystack-subscribe", {
        body: { plan_id: plan.id, callback_url: callback.toString() },
      });
      if (error) throw error;
      if (data?.error || !data?.authorization_url) {
        throw new Error(data?.error || "Could not start checkout");
      }
      window.location.href = data.authorization_url as string;
    } catch (e) {
      setProcessing(null);
      toast({
        title: "Payment could not start",
        description: e instanceof Error ? e.message : "Please try again in a moment.",
        variant: "destructive",
      });
    }
  };

  const cancelPlan = async () => {
    setCancelling(true);
    try {
      const { data, error } = await supabase.functions.invoke("paystack-cancel-subscription");
      if (error) throw error;
      if (data?.error) throw new Error(data.error as string);
      setSubStatus("cancelled");
      toast({
        title: "Plan cancelled",
        description: "You keep your credits and access until the end of this month.",
      });
    } catch (e) {
      toast({
        title: "Could not cancel",
        description: e instanceof Error ? e.message : "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-display font-bold">Choose Your Plan</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Simple plans built for how students actually learn.
          </p>
          {currentPlan !== "free" && (
            <p className="text-sm mt-3">
              <Badge variant="secondary" className="mr-2">
                Current: {currentPlan}
              </Badge>
              {subStatus === "cancelled"
                ? "Cancelled — active until the end of this month."
                : renewsAt
                ? `Renews ${new Date(renewsAt).toLocaleDateString()}`
                : null}
            </p>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-5 max-w-3xl mx-auto">
          {PLAN_OPTIONS.map(plan => {
            const isCurrent = currentPlan === plan.id && subStatus !== "cancelled";
            const busy = processing === plan.id;
            return (
              <Card
                key={plan.id}
                className={`relative overflow-hidden border-2 ${plan.popular ? "border-primary shadow-lg" : "border-border"}`}
              >
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
                  <Button
                    className="w-full mt-6"
                    variant={plan.popular ? "default" : "outline"}
                    disabled={isCurrent || busy || processing !== null}
                    onClick={() => startCheckout(plan)}
                  >
                    {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {isCurrent
                      ? "Current plan"
                      : busy
                      ? "Opening checkout…"
                      : currentPlan !== "free"
                      ? `Switch to ${plan.name}`
                      : plan.popular
                      ? "Upgrade to Premium"
                      : "Choose Essential"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {currentPlan !== "free" && subStatus !== "cancelled" && (
          <div className="text-center mt-6">
            <Button variant="ghost" size="sm" onClick={cancelPlan} disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Cancel my plan"}
            </Button>
          </div>
        )}

        <p className="text-center text-sm text-muted-foreground mt-6">
          Need more?{" "}
          <a
            href="/topup"
            className="text-foreground font-medium underline underline-offset-4 hover:text-primary"
          >
            Top up credits anytime
          </a>
        </p>
      </motion.div>
    </AppLayout>
  );
}
