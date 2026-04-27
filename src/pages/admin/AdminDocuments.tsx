import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Search, Sparkles } from "lucide-react";

type Doc = {
  id: string;
  title: string;
  subject_type: string;
  language: string;
  is_seeded: boolean;
  char_count: number;
  cached_chunks: number;
  audio_unlocks: number;
  translation_unlocks: number;
  visual_unlocks: number;
  credits_generated: number;
};

export default function AdminDocuments() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: documents }, { data: assets }, topRes] = await Promise.all([
      supabase.from("documents").select("id, title, subject_type, language, is_seeded, char_count").order("created_at", { ascending: false }).limit(200),
      supabase.from("audio_assets").select("document_id"),
      supabase.functions.invoke("admin-api", { body: { action: "top_documents", limit: 200 } }),
    ]);
    const counts = new Map<string, number>();
    (assets ?? []).forEach((a) => counts.set(a.document_id, (counts.get(a.document_id) ?? 0) + 1));
    const stats = new Map<string, { audio: number; trans: number; vis: number; credits: number }>();
    ((topRes.data?.documents ?? []) as any[]).forEach((r) => {
      stats.set(r.document_id, {
        audio: Number(r.audio_unlocks ?? 0),
        trans: Number(r.translation_unlocks ?? 0),
        vis: Number(r.visual_unlocks ?? 0),
        credits: Number(r.credits_generated ?? 0),
      });
    });
    setDocs((documents ?? []).map((d) => {
      const s = stats.get(d.id);
      return {
        ...d,
        cached_chunks: counts.get(d.id) ?? 0,
        audio_unlocks: s?.audio ?? 0,
        translation_unlocks: s?.trans ?? 0,
        visual_unlocks: s?.vis ?? 0,
        credits_generated: s?.credits ?? 0,
      };
    }));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const regenerate = async (document_id: string, title: string) => {
    if (!confirm(`Clear all cached audio for "${title}"? Users won't be re-charged. Audio will re-generate on next play with current SSML settings.`)) return;
    setBusy(document_id);
    const { data, error } = await supabase.functions.invoke("admin-api", {
      body: { action: "regenerate_document", document_id },
    });
    setBusy(null);
    if (error || !data?.success) {
      toast({ title: "Failed", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Cache cleared", description: `${data.deleted_rows} chunks removed.` });
    load();
  };

  const filtered = docs.filter((d) => d.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-display font-bold">Documents & audio cache</h1>
        <div className="relative w-64">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title…" className="pl-8" />
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
                    <th className="text-left p-3">Title</th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-right p-3">Chars</th>
                    <th className="text-right p-3">Cached</th>
                    <th className="text-right p-3">Audio unlocks</th>
                    <th className="text-right p-3">Trans unlocks</th>
                    <th className="text-right p-3">Visual unlocks</th>
                    <th className="text-right p-3">Credits</th>
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => (
                    <tr key={d.id} className="border-t">
                      <td className="p-3 font-medium max-w-[260px] truncate">
                        {d.title}
                        {d.is_seeded && <span className="ml-2 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">SEEDED</span>}
                      </td>
                      <td className="p-3 text-muted-foreground">{d.subject_type}</td>
                      <td className="p-3 text-right text-muted-foreground">{d.char_count.toLocaleString()}</td>
                      <td className="p-3 text-right">{d.cached_chunks}</td>
                      <td className="p-3 text-right">{d.audio_unlocks}</td>
                      <td className="p-3 text-right">{d.translation_unlocks}</td>
                      <td className="p-3 text-right">{d.visual_unlocks}</td>
                      <td className="p-3 text-right text-primary font-medium">{d.credits_generated}</td>
                      <td className="p-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === d.id || d.cached_chunks === 0}
                          onClick={() => regenerate(d.id, d.title)}
                        >
                          {busy === d.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                          Clear cache
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No documents found.</td></tr>
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
