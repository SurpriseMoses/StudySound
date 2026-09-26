import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Alert = { label: string; count: number; to: string };

/** Shows admins a banner when ingestion jobs failed or payments got stuck recently. */
export default function FailureAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const [ing, pay] = await Promise.all([
        supabase.from("ingestion_jobs").select("id", { count: "exact", head: true })
          .eq("state", "failed").gte("updated_at", dayAgo),
        supabase.from("credit_purchases").select("id", { count: "exact", head: true })
          .in("status", ["pending", "failed", "abandoned"]).lt("created_at", hourAgo).gte("created_at", dayAgo),
      ]);
      if (cancelled) return;
      const next: Alert[] = [];
      if (ing.count) next.push({ label: "book imports failed in the last 24h", count: ing.count, to: "/admin/documents" });
      if (pay.count) next.push({ label: "payments not completed after an hour (last 24h)", count: pay.count, to: "/admin/economy" });
      setAlerts(next);
    })();
    return () => { cancelled = true; };
  }, []);

  if (alerts.length === 0) return null;
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-1">
      <div className="flex items-center gap-2 font-semibold text-destructive text-sm">
        <AlertTriangle className="w-4 h-4" /> Needs attention
      </div>
      {alerts.map((a) => (
        <Link key={a.label} to={a.to} className="block text-sm hover:underline">
          <strong>{a.count}</strong> {a.label}
        </Link>
      ))}
    </div>
  );
}
