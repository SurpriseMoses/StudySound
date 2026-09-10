import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { PartyPopper, XCircle, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";

type State =
  | { kind: "checking" }
  | { kind: "success"; credits: number; balance: number | null }
  | { kind: "failed"; message: string };

export default function PaymentCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "checking" });
  const ran = useRef(false);

  const reference = params.get("reference") || params.get("trxref") || "";
  const docId = params.get("doc");
  const from = params.get("from");

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!reference) {
      setState({ kind: "failed", message: "No payment reference found." });
      return;
    }

    (async () => {
      const { data, error } = await supabase.functions.invoke("paystack-verify", {
        body: { reference },
      });
      if (error || data?.error || data?.status !== "success") {
        setState({
          kind: "failed",
          message:
            (data?.error as string) ||
            "We could not confirm this payment. If money left your account, it will be credited shortly.",
        });
        return;
      }
      setState({
        kind: "success",
        credits: data.credits ?? 0,
        balance: data.balance ?? null,
      });
      setTimeout(() => {
        if (docId) navigate(from ? `/lesson/${docId}?tab=${from}` : `/lesson/${docId}`);
        else navigate("/dashboard");
      }, 2200);
    })();
  }, [reference, docId, from, navigate]);

  return (
    <AppLayout>
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-sm">
          {state.kind === "checking" && (
            <>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
                className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4"
              >
                <Coins className="w-7 h-7" />
              </motion.div>
              <h1 className="text-2xl font-display font-bold">Confirming your payment…</h1>
              <p className="text-sm text-muted-foreground mt-2">This only takes a moment.</p>
            </>
          )}

          {state.kind === "success" && (
            <>
              <motion.div
                initial={{ scale: 0, rotate: -45 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 14 }}
                className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-success/15 text-success mb-4"
              >
                <PartyPopper className="w-9 h-9" />
              </motion.div>
              <h1 className="text-2xl md:text-3xl font-display font-bold">Credits added</h1>
              <p className="text-muted-foreground text-sm mt-2">
                <strong className="text-foreground">+{state.credits}</strong> credits are in your
                balance
                {state.balance !== null && (
                  <> — you now have <strong className="text-foreground">{state.balance}</strong></>
                )}
                . Taking you back…
              </p>
            </>
          )}

          {state.kind === "failed" && (
            <>
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 text-destructive mb-4">
                <XCircle className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-display font-bold">Payment not confirmed</h1>
              <p className="text-sm text-muted-foreground mt-2">{state.message}</p>
              <div className="flex gap-2 justify-center mt-5">
                <Link to="/topup">
                  <Button>Try again</Button>
                </Link>
                <Link to="/dashboard">
                  <Button variant="outline">Back to dashboard</Button>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
