import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Loader2, Upload, Trash2, ImageIcon, FileStack, X, CheckCircle2, AlertCircle } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

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

      <Tabs defaultValue="single">
        <TabsList>
          <TabsTrigger value="single">Single book</TabsTrigger>
          <TabsTrigger value="batch"><FileStack className="w-4 h-4 mr-1.5" /> Batch upload</TabsTrigger>
          <TabsTrigger value="prompts">Generate prompts</TabsTrigger>
        </TabsList>

        <TabsContent value="prompts" className="mt-4">
          <GeneratePromptsPanel docs={docs} />
        </TabsContent>


        <TabsContent value="single" className="space-y-4 mt-4">
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
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleDelete(idx)}>
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
        </TabsContent>

        <TabsContent value="batch" className="mt-4">
          <BatchUpload docs={docs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------- Batch upload ----------

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

type BatchStatus = "ready" | "ambiguous" | "no-match" | "bad-name" | "uploading" | "done" | "error";
interface BatchRow {
  file: File;
  scene_index: number | null;
  doc_id: string | null;
  doc_title: string | null;
  candidates: DocOpt[];
  status: BatchStatus;
  message?: string;
}

function BatchUpload({ docs }: { docs: DocOpt[] }) {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const slugIndex = useMemo(() => {
    const map = new Map<string, DocOpt[]>();
    for (const d of docs) {
      const k = slugify(d.title);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(d);
    }
    return map;
  }, [docs]);

  const parseFiles = (files: FileList | File[]) => {
    const out: BatchRow[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        out.push({ file, scene_index: null, doc_id: null, doc_title: null, candidates: [], status: "bad-name", message: "Not an image" });
        continue;
      }
      const base = file.name.replace(/\.[^.]+$/, "");
      // Patterns: "{slug-or-id}__scene{N}" or "{slug-or-id}__{N}" or "{slug-or-id}-scene-{N}"
      const m = base.match(/^(.+?)(?:__|--|-+)(?:scene[-_]?)?(\d)$/i);
      if (!m) {
        out.push({ file, scene_index: null, doc_id: null, doc_title: null, candidates: [], status: "bad-name",
          message: 'Use "{book-slug}__sceneN.png" (N = 0-3)' });
        continue;
      }
      const key = m[1].toLowerCase();
      const sceneIdx = Number(m[2]);
      if (sceneIdx < 0 || sceneIdx > 3) {
        out.push({ file, scene_index: null, doc_id: null, doc_title: null, candidates: [], status: "bad-name", message: "Scene must be 0-3" });
        continue;
      }
      // Try exact slug, then docId prefix, then contains
      let cands: DocOpt[] = slugIndex.get(slugify(key)) ?? [];
      if (cands.length === 0) {
        cands = docs.filter((d) => d.id.toLowerCase().startsWith(key) || key.startsWith(d.id.toLowerCase().slice(0, 8)));
      }
      if (cands.length === 0) {
        const slugKey = slugify(key);
        cands = docs.filter((d) => slugify(d.title).includes(slugKey) || slugKey.includes(slugify(d.title)));
      }
      if (cands.length === 0) {
        out.push({ file, scene_index: sceneIdx, doc_id: null, doc_title: null, candidates: [], status: "no-match",
          message: `No book matches "${key}"` });
      } else if (cands.length > 1) {
        out.push({ file, scene_index: sceneIdx, doc_id: cands[0].id, doc_title: cands[0].title, candidates: cands, status: "ambiguous",
          message: `${cands.length} books match — pick one` });
      } else {
        out.push({ file, scene_index: sceneIdx, doc_id: cands[0].id, doc_title: cands[0].title, candidates: cands, status: "ready" });
      }
    }
    setRows((prev) => [...prev, ...out]);
  };

  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const clearAll = () => setRows([]);
  const updateRow = (i: number, patch: Partial<BatchRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const uploadOne = async (i: number) => {
    const r = rows[i];
    if (!r.doc_id || r.scene_index == null) return;
    updateRow(i, { status: "uploading", message: undefined });
    try {
      const b64 = await fileToBase64(r.file);
      const { data, error } = await supabase.functions.invoke("admin-upload-visual", {
        body: {
          document_id: r.doc_id,
          scene_index: r.scene_index,
          prompt_text: "",
          image_base64: b64,
          content_type: r.file.type,
        },
      });
      if (error || (data as any)?.error) throw new Error(error?.message || (data as any)?.error);
      updateRow(i, { status: "done" });
    } catch (e: any) {
      updateRow(i, { status: "error", message: e.message });
    }
  };

  const runBatch = async () => {
    const queue = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.status === "ready");
    if (queue.length === 0) {
      toast({ title: "Nothing to upload", description: "Resolve issues or add files first." });
      return;
    }
    setRunning(true);
    setProgress({ done: 0, total: queue.length });
    const concurrency = 3;
    let cursor = 0;
    let completed = 0;
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (true) {
        const next = cursor++;
        if (next >= queue.length) break;
        await uploadOne(queue[next].i);
        completed++;
        setProgress({ done: completed, total: queue.length });
      }
    });
    await Promise.all(workers);
    setRunning(false);
    toast({ title: "Batch complete", description: `${completed} of ${queue.length} uploaded.` });
  };

  const readyCount = rows.filter((r) => r.status === "ready").length;
  const issueCount = rows.filter((r) => ["ambiguous","no-match","bad-name","error"].includes(r.status)).length;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="text-sm space-y-1">
          <div className="font-semibold">Filename convention</div>
          <p className="text-muted-foreground">
            Name each image <code className="px-1 rounded bg-muted">book-slug__sceneN.png</code> where
            <code className="mx-1 rounded bg-muted px-1">N</code> is 0-3 (0 = free preview).
            Example: <code className="px-1 rounded bg-muted">dr-jekyll-and-mr-hyde__scene0.png</code>.
            Slugs are matched against book titles automatically.
          </p>
        </div>
        <label className="block">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            disabled={running}
            onChange={(e) => {
              if (e.target.files) parseFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button asChild disabled={running}>
            <span><Upload className="w-4 h-4 mr-2" /> Add image files</span>
          </Button>
        </label>
      </Card>

      {rows.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary">{rows.length} files</Badge>
              <Badge className="bg-emerald-600 hover:bg-emerald-600">{readyCount} ready</Badge>
              {issueCount > 0 && <Badge variant="destructive">{issueCount} issues</Badge>}
              {running && <span className="text-muted-foreground">Uploading {progress.done}/{progress.total}…</span>}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={running} onClick={clearAll}>Clear</Button>
              <Button disabled={running || readyCount === 0} onClick={runBatch}>
                {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                Upload {readyCount} ready
              </Button>
            </div>
          </div>

          <div className="divide-y rounded-md border">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3 text-sm">
                <StatusIcon status={r.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.file.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.doc_title ? <>→ {r.doc_title} · scene {r.scene_index}</> : (r.message || "—")}
                    {r.status === "error" && r.message && <span className="text-destructive"> · {r.message}</span>}
                  </div>
                </div>
                {r.status === "ambiguous" && (
                  <select
                    className="rounded border bg-background px-2 py-1 text-xs max-w-[180px]"
                    value={r.doc_id ?? ""}
                    onChange={(e) => {
                      const sel = r.candidates.find((c) => c.id === e.target.value);
                      updateRow(i, { doc_id: e.target.value, doc_title: sel?.title ?? null, status: "ready", message: undefined });
                    }}
                  >
                    {r.candidates.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                )}
                <Button size="sm" variant="ghost" disabled={running} onClick={() => removeRow(i)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: BatchStatus }) {
  if (status === "done") return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
  if (status === "uploading") return <Loader2 className="w-4 h-4 animate-spin shrink-0" />;
  if (status === "ready") return <ImageIcon className="w-4 h-4 text-muted-foreground shrink-0" />;
  return <AlertCircle className="w-4 h-4 text-destructive shrink-0" />;
}

