import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Shield, ShieldOff, Coins } from "lucide-react";

type Profile = {
  user_id: string;
  display_name: string | null;
  plan: string | null;
  credits_balance: number;
  created_at: string;
  is_admin: boolean;
};

export default function AdminUsers() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: profs }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("user_id, display_name, plan, credits_balance, created_at").order("created_at", { ascending: false }).limit(500),
      supabase.from("user_roles").select("user_id, role").eq("role", "admin"),
    ]);
    const adminSet = new Set((roles ?? []).map((r) => r.user_id));
    setProfiles((profs ?? []).map((p) => ({ ...p, is_admin: adminSet.has(p.user_id) })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggleAdmin = async (p: Profile) => {
    setBusy(p.user_id);
    const { data, error } = await supabase.functions.invoke("admin-api", {
      body: { action: "set_role", user_id: p.user_id, grant: !p.is_admin },
    });
    setBusy(null);
    if (error || !data?.success) {
      toast({ title: "Failed", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    toast({ title: p.is_admin ? "Admin revoked" : "Admin granted" });
    load();
  };

  const adjustCredits = async (p: Profile) => {
    const raw = prompt(`Adjust credits for ${p.display_name ?? p.user_id} (current: ${p.credits_balance}). Enter +N or -N:`, "+50");
    if (!raw) return;
    const delta = parseInt(raw, 10);
    if (Number.isNaN(delta)) { toast({ title: "Invalid number", variant: "destructive" }); return; }
    setBusy(p.user_id);
    const { data, error } = await supabase.functions.invoke("admin-api", {
      body: { action: "adjust_credits", user_id: p.user_id, delta },
    });
    setBusy(null);
    if (error || !data?.success) {
      toast({ title: "Failed", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    toast({ title: `New balance: ${data.balance}` });
    load();
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
                    <th className="text-left p-3">Joined</th>
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.user_id} className="border-t">
                      <td className="p-3 font-medium">
                        {p.display_name ?? "—"}
                        {p.is_admin && <span className="ml-2 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded inline-flex items-center gap-1"><Shield className="w-3 h-3" /> ADMIN</span>}
                      </td>
                      <td className="p-3 text-muted-foreground">{p.plan ?? "free"}</td>
                      <td className="p-3 text-right">{p.credits_balance}</td>
                      <td className="p-3 text-muted-foreground text-xs">{new Date(p.created_at).toLocaleDateString()}</td>
                      <td className="p-3 text-right space-x-2">
                        <Button size="sm" variant="outline" disabled={busy === p.user_id} onClick={() => adjustCredits(p)}>
                          <Coins className="w-3 h-3 mr-1" /> Credits
                        </Button>
                        <Button
                          size="sm"
                          variant={p.is_admin ? "destructive" : "outline"}
                          disabled={busy === p.user_id}
                          onClick={() => toggleAdmin(p)}
                        >
                          {p.is_admin ? <><ShieldOff className="w-3 h-3 mr-1" /> Revoke</> : <><Shield className="w-3 h-3 mr-1" /> Grant admin</>}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No users found.</td></tr>
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
