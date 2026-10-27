import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Loader2, Trash2, ImageOff } from "lucide-react";

interface DocOpt { id: string; title: string; subject_type: string; }
interface SceneRow { id: string; lesson_id: string; paragraph_index: number; prompt_text: string | null; image_url: string | null; status: string | null; }

/**
 * Delete-only manager for existing generated scene images.
 * New visuals come from uploaded lesson videos; this panel exists so admins
 * can remove outdated or unwanted images from older books.
 */
export default function LegacyVisualsPanel({ docs }: { docs: DocOpt[] }) {
  const [search, setSearch] = useState("");
  const [docId, setDocId] = useState("");
  const [scenes, setScenes] = useState<SceneRow[]>([]);
  const [loading, setLoading] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? docs.filter((d) => d.title.toLowerCase().includes(q)) : docs;
  }, [docs, search]);

  const load = async (id: string) => {
    if (!id) { setScenes([]); return; }
    setLoading(true);
    const { data: lessons } = await supabase.from("lessons").select("id").eq("document_id", id);
    const lessonIds = (lessons ?? []).map((l) => l.id);
    if (!lessonIds.length) { setScenes([]); setLoading(false); return; }
    const { data } = await supabase
      .from("visual_scenes")
      .select("id, lesson_id, paragraph_index, prompt_text, image_url, status")
      .in("lesson_id", lessonIds)
      .order("paragraph_index");
    setScenes((data ?? []) as SceneRow[]);
    setLoading(false);
  };

  useEffect(() => { load(docId); }, [docId]);

  const remove = async (s: SceneRow) => {
    if (!confirm(`Delete scene ${s.paragraph_index + 1}? This cannot be undone.`)) return;
    const { error } = await supabase.from("visual_scenes").delete().eq("id", s.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Scene deleted" });
    await load(docId);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Older books have generated scene images. New visuals come from uploaded lesson videos. Use this panel to review and delete existing images.
        </p>
        <Input placeholder="Search book title…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={docId}
          onChange={(e) => setDocId(e.target.value)}
          aria-label="Choose book"
        >
          <option value="">Choose a book…</option>
          {filtered.map((d) => <option key={d.id} value={d.id}>{d.title} ({d.subject_type})</option>)}
        </select>
      </Card>

      {docId && (loading ? (
        <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading images…</div>
      ) : scenes.length === 0 ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><ImageOff className="w-4 h-4" /> No scene images for this book.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {scenes.map((s) => (
            <Card key={s.id} className="p-3 space-y-2">
              {s.image_url && <img src={s.image_url} alt={s.prompt_text ?? `Scene ${s.paragraph_index + 1}`} className="w-full rounded-md bg-muted aspect-video object-cover" loading="lazy" />}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Scene {s.paragraph_index + 1}</p>
                  {s.status && <p className="text-xs text-muted-foreground">{s.status}</p>}
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(s)} aria-label={`Delete scene ${s.paragraph_index + 1}`}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}
