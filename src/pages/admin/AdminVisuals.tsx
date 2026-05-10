import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Loader2, Upload, Trash2, ImageIcon } from "lucide-react";

const TOTAL_SCENES = 4; // scene_index 0..3 (0 is free preview, 1..3 paid)

interface DocOpt { id: string; title: string; subject_type: string; }
interface SceneRow {
  scene_index: number;
  storage_path: string;
  prompt_text: string;
  signedUrl?: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const url = r.result as string;
      res(url.split(",")[1] || "");
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export default function AdminVisuals() {
  const [docs, setDocs] = useState<DocOpt[]>([]);
  const [search, setSearch] = useState("");
  const [docId, setDocId] = useState<string>("");
  const [scenes, setScenes] = useState<SceneRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [prompts, setPrompts] = useState<Record<number, string>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("documents")
        .select("id, title, subject_type")
        .in("subject_type", ["novel", "history"])
        .order("title")
        .limit(500);
      setDocs(data ?? []);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => d.title.toLowerCase().includes(q));
  }, [docs, search]);

  const loadScenes = async (id: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("image_assets")
      .select("scene_index, storage_path, prompt_text")
      .eq("document_id", id)
      .order("scene_index");
    const rows = (data ?? []) as SceneRow[];
    if (rows.length) {
      const { data: signed } = await supabase.storage
        .from("assets")
        .createSignedUrls(rows.map((r) => r.storage_path), 3600);
      const byPath = new Map((signed ?? []).map((s) => [s.path!, s.signedUrl]));
      rows.forEach((r) => (r.signedUrl = byPath.get(r.storage_path)));
    }
    setScenes(rows);
    const p: Record<number, string> = {};
    rows.forEach((r) => (p[r.scene_index] = r.prompt_text));
    setPrompts(p);
    setLoading(false);
  };

  useEffect(() => {
    if (docId) loadScenes(docId);
    else { setScenes([]); setPrompts({}); }
  }, [docId]);

  const sceneAt = (idx: number) => scenes.find((s) => s.scene_index === idx);

  const handleUpload = async (idx: number, file: File) => {
    if (!docId) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image.", variant: "destructive" });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast({ title: "Too large", description: "Max 8MB per image.", variant: "destructive" });
      return;
    }
    setUploadingIdx(idx);
    try {
      const b64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("admin-upload-visual", {
        body: {
          document_id: docId,
          scene_index: idx,
          prompt_text: prompts[idx] || "",
          image_base64: b64,
          content_type: file.type,
        },
      });
      if (error || (data as any)?.error) throw new Error(error?.message || (data as any)?.error);
      toast({ title: `Scene ${idx} uploaded`, description: "Visible to learners on unlock." });
      await loadScenes(docId);
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingIdx(null);
    }
  };

  const handleDelete = async (idx: number) => {
    if (!docId) return;
    if (!confirm(`Delete scene ${idx}?`)) return;
    setUploadingIdx(idx);
    try {
      const { data, error } = await supabase.functions.invoke("admin-delete-visual", {
        body: { document_id: docId, scene_index: idx },
      });
      if (error || (data as any)?.error) throw new Error(error?.message || (data as any)?.error);
      toast({ title: `Scene ${idx} deleted` });
      await loadScenes(docId);
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    } finally {
      setUploadingIdx(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Visual scenes</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload custom illustrations per book. Cached globally; learners pay credits to unlock each scene.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <Input
          placeholder="Search book title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={docId}
          onChange={(e) => setDocId(e.target.value)}
        >
          <option value="">— Select a book —</option>
          {filtered.map((d) => (
            <option key={d.id} value={d.id}>
              [{d.subject_type}] {d.title}
            </option>
          ))}
        </select>
      </Card>

      {docId && (
        loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: TOTAL_SCENES }).map((_, idx) => {
              const s = sceneAt(idx);
              const busy = uploadingIdx === idx;
              return (
                <Card key={idx} className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">
                      Scene {idx} {idx === 0 && <span className="text-xs text-muted-foreground">(free preview)</span>}
                    </div>
                    {s && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => handleDelete(idx)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  <div className="aspect-video rounded-md border bg-muted/40 flex items-center justify-center overflow-hidden">
                    {s?.signedUrl ? (
                      <img src={s.signedUrl} alt={`Scene ${idx}`} className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-muted-foreground text-sm flex flex-col items-center gap-1">
                        <ImageIcon className="w-6 h-6" />
                        <span>No image</span>
                      </div>
                    )}
                  </div>

                  <Textarea
                    rows={2}
                    placeholder="Caption / prompt (shown internally)"
                    value={prompts[idx] ?? ""}
                    onChange={(e) => setPrompts((p) => ({ ...p, [idx]: e.target.value }))}
                  />

                  <label className="block">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) handleUpload(idx, f);
                      }}
                    />
                    <Button asChild className="w-full" disabled={busy}>
                      <span>
                        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                        {s ? "Replace image" : "Upload image"}
                      </span>
                    </Button>
                  </label>
                </Card>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
