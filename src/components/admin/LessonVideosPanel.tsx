import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Loader2, Upload, Trash2, Film, Pencil, Check, X } from "lucide-react";

interface DocOpt { id: string; title: string; subject_type: string; }
interface VideoRow { id: string; title: string; storage_path: string; sort_order: number; size_bytes: number | null; signedUrl?: string; }

const MAX_BYTES = 500 * 1024 * 1024;
const ALLOWED = ["video/mp4", "video/webm", "video/quicktime"];

type Destination = "story" | "preview";

const CONFIG: Record<Destination, { table: "lesson_videos" | "preview_videos"; bucket: string; blurb: string; done: string }> = {
  story: {
    table: "lesson_videos",
    bucket: "lesson-videos",
    blurb: "Upload finished lesson videos (for example from MagicLight). Learners watch them free in Story Mode. Check each video for accuracy before uploading.",
    done: "Now showing in Story Mode.",
  },
  preview: {
    table: "preview_videos",
    bucket: "preview-videos",
    blurb: "Upload a finished video visitors can watch before signing up. It appears on the public Free Preview page for the chosen book. Check it for accuracy first.",
    done: "Now showing on the visitor preview page.",
  },
};

export default function LessonVideosPanel({ docs, destination = "story" }: { docs: DocOpt[]; destination?: Destination }) {
  const cfg = CONFIG[destination];
  const [search, setSearch] = useState("");
  const [docId, setDocId] = useState("");
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedTitle, setEditedTitle] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? docs.filter((d) => d.title.toLowerCase().includes(q)) : docs;
  }, [docs, search]);

  const load = async (id: string) => {
    if (!id) { setVideos([]); return; }
    setLoading(true);
    const { data } = await supabase
      .from(cfg.table)
      .select("id, title, storage_path, sort_order, size_bytes")
      .eq("document_id", id)
      .order("sort_order");
    const rows = (data ?? []) as VideoRow[];
    if (rows.length) {
      const { data: signed } = await supabase.storage
        .from(cfg.bucket)
        .createSignedUrls(rows.map((r) => r.storage_path), 3600);
      const map = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
      rows.forEach((r) => { r.signedUrl = map.get(r.storage_path) ?? undefined; });
    }
    setVideos(rows);
    setLoading(false);
  };

  useEffect(() => { load(docId); }, [docId]);

  const upload = async () => {
    if (!docId || !file) return;
    const extOk = /\.(mp4|m4v|webm|mov)$/i.test(file.name);
    if (!ALLOWED.includes(file.type) && !extOk) {
      toast({ title: "Unsupported file", description: "Use MP4, WebM or MOV.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "File too large", description: "Maximum 500 MB.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
      const path = `${docId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(cfg.bucket)
        .upload(path, file, { contentType: file.type || (ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime" : "video/mp4"), upsert: false });
      if (upErr) throw upErr;
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        document_id: docId,
        title: (title.trim() || file.name).slice(0, 200),
        storage_path: path,
        sort_order: videos.length,
        size_bytes: file.size,
        created_by: user?.id ?? null,
      };
      const doc = docs.find((d) => d.id === docId);
      const { error: insErr } = destination === "preview"
        ? await supabase.from("preview_videos").insert({ ...payload, book_title: doc?.title ?? null })
        : await supabase.from("lesson_videos").insert(payload);
      if (insErr) {
        await supabase.storage.from(cfg.bucket).remove([path]);
        throw insErr;
      }
      toast({ title: "Video uploaded", description: cfg.done });
      setTitle(""); setFile(null);
      await load(docId);
    } catch (e) {
      toast({ title: "Upload failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v: VideoRow) => {
    if (!confirm(`Delete "${v.title}"?`)) return;
    const { error } = await supabase.from(cfg.table).delete().eq("id", v.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    await supabase.storage.from(cfg.bucket).remove([v.storage_path]);
    await load(docId);
  };

  const saveTitle = async (v: VideoRow) => {
    const nextTitle = editedTitle.trim();
    if (!nextTitle || savingTitle) return;
    setSavingTitle(true);
    try {
      const { data, error } = await supabase.from(cfg.table)
        .update({ title: nextTitle })
        .eq("id", v.id)
        .select("id, title")
        .single();
      if (error) throw error;
      setVideos((rows) => rows.map((row) => row.id === data.id ? { ...row, title: data.title } : row));
      setEditingId(null);
      toast({ title: "Video title updated" });
    } catch (e) {
      toast({ title: "Title update failed", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    } finally {
      setSavingTitle(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">{cfg.blurb}</p>
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

      {docId && (
        <Card className="p-4 space-y-3">
          <Input placeholder="Video title (e.g. Chapter 1 — The Arrival)" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          <Input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Video file" />
          <Button onClick={upload} disabled={!file || busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
            {busy ? "Uploading…" : "Upload video"}
          </Button>
          <p className="text-xs text-muted-foreground">MP4, WebM or MOV, up to 500 MB. Smaller files load faster on mobile data.</p>
        </Card>
      )}

      {docId && (loading ? (
        <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading videos…</div>
      ) : videos.length === 0 ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2"><Film className="w-4 h-4" /> No videos for this book yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {videos.map((v) => (
            <Card key={v.id} className="p-3 space-y-2">
              {v.signedUrl && <video src={v.signedUrl} controls preload="metadata" className="w-full rounded-md bg-muted aspect-video" />}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  {editingId === v.id ? (
                    <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); void saveTitle(v); }}>
                      <Input autoFocus aria-label="Edit video title" value={editedTitle} maxLength={200} disabled={savingTitle} onChange={(e) => setEditedTitle(e.target.value)} />
                      <Button type="submit" variant="ghost" size="icon" disabled={!editedTitle.trim() || savingTitle} aria-label="Save video title" title="Save title">
                        {savingTitle ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      </Button>
                      <Button type="button" variant="ghost" size="icon" disabled={savingTitle} onClick={() => setEditingId(null)} aria-label="Cancel title edit" title="Cancel">
                        <X className="w-4 h-4" />
                      </Button>
                    </form>
                  ) : <p className="text-sm font-medium break-words">{v.title}</p>}
                  {v.size_bytes != null && <p className="text-xs text-muted-foreground">{(v.size_bytes / 1048576).toFixed(1)} MB</p>}
                </div>
                {editingId !== v.id && <Button variant="ghost" size="icon" onClick={() => { setEditingId(v.id); setEditedTitle(v.title); }} aria-label={`Edit ${v.title}`} title="Edit title">
                  <Pencil className="w-4 h-4" />
                </Button>}
                <Button variant="ghost" size="icon" disabled={savingTitle} onClick={() => remove(v)} aria-label={`Delete ${v.title}`} title="Delete video">
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
