import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Search } from "lucide-react";

type Doc = {
  id: string;
  title: string;
  subject_type: string;
  language: string;
  is_seeded: boolean;
  char_count: number;
  cached_chunks: number;
};

export default function AdminDocuments() {
  const { toast } = useToast();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    // Fetch documents and audio_assets count separately (RLS allows authenticated read)
    const [{ data: documents }, { data: assets }] = await Promise.all([
      supabase.from("documents").select("id, title, subject_type, language, is_seeded, char_count").order("created_at", { ascending: false }).limit(200),
      supabase.from("audio_assets").select("document_id"),
    ]);
    const counts = new Map<string, number>();
    (assets ?? []).forEach((a) => counts.set(a.document_id, (counts.get(a.document_id) ?? 0) + 1));
    setDocs((documents ?? []).map((d) => ({ ...d, cached_chunks: counts.get(d.id) ?? 0 })));
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
                    <th className="text-left p-3">Lang</th>
                    <th className="text-right p-3">Chars</th>
                    <th className="text-right p-3">Cached chunks</th>
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => (
                    <tr key={d.id} className="border-t">
                      <td className="p-3 font-medium">
                        {d.title}
                        {d.is_seeded && <span className="ml-2 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">SEEDED</span>}
                      </td>
                      <td className="p-3 text-muted-foreground">{d.subject_type}</td>
                      <td className="p-3 text-muted-foreground">{d.language}</td>
                      <td className="p-3 text-right text-muted-foreground">{d.char_count.toLocaleString()}</td>
                      <td className="p-3 text-right">{d.cached_chunks}</td>
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
                    <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No documents found.</td></tr>
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
