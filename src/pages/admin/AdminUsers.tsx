import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Shield, ShieldOff, Coins, Flag } from "lucide-react";

type Profile = {
  user_id: string;
  display_name: string | null;
  plan: string | null;
  credits_balance: number;
  created_at: string;
  is_flagged: boolean;
  cooldown_until: string | null;
  is_admin: boolean;
  spend_30d: number;
};

export default function AdminUsers() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: profs }, { data: roles }, { data: tx }] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id, display_name, plan, credits_balance, created_at, is_flagged, cooldown_until")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("user_roles").select("user_id, role").eq("role", "admin"),
      supabase.from("credit_transactions").select("user_id, amount").lt("amount", 0).gte("created_at", since),
    ]);
    const adminSet = new Set((roles ?? []).map((r) => r.user_id));
    const spend = new Map<string, number>();
    (tx ?? []).forEach((t: any) => spend.set(t.user_id, (spend.get(t.user_id) ?? 0) + Math.abs(t.amount)));
    setProfiles((profs ?? []).map((p: any) => ({
      ...p,
      is_admin: adminSet.has(p.user_id),
      spend_30d: spend.get(p.user_id) ?? 0,
    })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const callAdmin = async (action: string, body: Record<string, unknown>, successTitle: string) => {
    const { data, error } = await supabase.functions.invoke("admin-api", { body: { action, ...body } });
    if (error || !data?.success) {
      toast({ title: "Failed", description: error?.message ?? data?.error, variant: "destructive" });
      return false;
    }
    toast({ title: successTitle });
    return true;
  };

  const toggleAdmin = async (p: Profile) => {
    setBusy(p.user_id);
    await callAdmin("set_role", { user_id: p.user_id, grant: !p.is_admin }, p.is_admin ? "Admin revoked" : "Admin granted");
    setBusy(null); load();
  };

  const adjustCredits = async (p: Profile) => {
    const raw = prompt(`Adjust credits for ${p.display_name ?? p.user_id} (current: ${p.credits_balance}). Enter +N or -N:`, "+50");
    if (!raw) return;
    const delta = parseInt(raw, 10);
    if (Number.isNaN(delta)) { toast({ title: "Invalid number", variant: "destructive" }); return; }
    setBusy(p.user_id);
    await callAdmin("adjust_credits", { user_id: p.user_id, delta }, "Credits adjusted");
    setBusy(null); load();
  };

  const toggleFlag = async (p: Profile) => {
    setBusy(p.user_id);
    if (p.is_flagged) {
      await callAdmin("unflag_user", { user_id: p.user_id }, "User unflagged");
    } else {
      const reason = prompt("Reason for flagging?", "Suspected abuse") ?? "Flagged by admin";
      await callAdmin("flag_user", { user_id: p.user_id, reason }, "User flagged");
    }
    setBusy(null); load();
  };

  const filtered = profiles.filter((p) => (p.display_name ?? "").toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-display font-bold">Users & roles</h1>
        <div className="relative w-64">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name…" className="pl-8" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left p-3">Name</th>
                    <th className="text-left p-3">Plan</th>
                    <th className="text-right p-3">Credits</th>
                    <th className="text-right p-3">Spent (30d)</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Joined</th>
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const cooling = p.cooldown_until && new Date(p.cooldown_until) > new Date();
                    return (
                      <tr key={p.user_id} className={`border-t ${p.is_flagged ? "bg-destructive/5" : ""}`}>
                        <td className="p-3 font-medium">
                          {p.display_name ?? "—"}
                          {p.is_admin && <span className="ml-2 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded inline-flex items-center gap-1"><Shield className="w-3 h-3" /> ADMIN</span>}
                        </td>
                        <td className="p-3 text-muted-foreground">{p.plan ?? "free"}</td>
                        <td className="p-3 text-right">{p.credits_balance}</td>
                        <td className="p-3 text-right text-muted-foreground">{p.spend_30d}</td>
                        <td className="p-3">
                          {p.is_flagged && <span className="text-[10px] bg-destructive/15 text-destructive px-1.5 py-0.5 rounded mr-1">FLAGGED</span>}
                          {cooling && <span className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">COOLDOWN</span>}
                          {!p.is_flagged && !cooling && <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className="p-3 text-muted-foreground text-xs">{new Date(p.created_at).toLocaleDateString()}</td>
                        <td className="p-3 text-right space-x-1">
                          <Button size="sm" variant="outline" disabled={busy === p.user_id} onClick={() => adjustCredits(p)}>
                            <Coins className="w-3 h-3 mr-1" /> Credits
                          </Button>
                          <Button size="sm" variant={p.is_flagged ? "outline" : "destructive"} disabled={busy === p.user_id} onClick={() => toggleFlag(p)}>
                            <Flag className="w-3 h-3 mr-1" /> {p.is_flagged ? "Unflag" : "Flag"}
                          </Button>
                          <Button size="sm" variant={p.is_admin ? "destructive" : "outline"} disabled={busy === p.user_id} onClick={() => toggleAdmin(p)}>
                            {p.is_admin ? <><ShieldOff className="w-3 h-3 mr-1" /> Revoke</> : <><Shield className="w-3 h-3 mr-1" /> Admin</>}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No users found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
