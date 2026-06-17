import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Loader2, Play, Plus, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";

type Source = {
  id: string;
  name: string;
  source_type: string;
  source_url: string | null;
  license_type: string;
  verification_status: "unverified" | "verified" | "blocked";
  country: string | null;
  curriculum: string | null;
  import_count: number;
  last_import_at: string | null;
};

type Job = {
  id: string;
  source_id: string | null;
  document_id: string | null;
  input_url: string | null;
  title_hint: string | null;
  grade: string | null;
  subject: string | null;
  state: string;
  progress: number;
  last_error: string | null;
  created_at: string;
};

const LICENSES = ["public_domain", "creative_commons", "government_educational", "educational_use", "unknown"];
const STATES = ["unverified", "verified", "blocked"] as const;

export default function AdminIngestion() {
  const { toast } = useToast();
  const [sources, setSources] = useState<Source[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [totals, setTotals] = useState<{ documents: number; chunks: number; audio: number; translations: number }>({
    documents: 0, chunks: 0, audio: 0, translations: 0,
  });
  const [loading, setLoading] = useState(true);
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [editSource, setEditSource] = useState<Partial<Source> | null>(null);

  const refresh = async () => {
    const [s, j, docs, audio, trans] = await Promise.all([
      supabase.from("content_sources").select("*").order("name"),
      supabase.from("ingestion_jobs").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("documents").select("id", { count: "exact", head: true }).eq("is_seeded", true),
      supabase.from("audio_assets").select("id", { count: "exact", head: true }),
      supabase.from("translation_assets").select("id", { count: "exact", head: true }),
    ]);
    setSources((s.data ?? []) as Source[]);
    setJobs((j.data ?? []) as Job[]);
    setTotals({
      documents: docs.count ?? 0,
      chunks: 0,
      audio: audio.count ?? 0,
      translations: trans.count ?? 0,
    });
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const verifiedSources = useMemo(() => sources.filter((s) => s.verification_status === "verified"), [sources]);

  const saveSource = async () => {
    if (!editSource) return;
    const payload: any = {
      name: editSource.name?.trim(),
      source_type: editSource.source_type ?? "web",
      source_url: editSource.source_url ?? null,
      license_type: (editSource.license_type ?? "unknown") as any,
      verification_status: (editSource.verification_status ?? "unverified") as any,
      country: editSource.country ?? null,
      curriculum: editSource.curriculum ?? null,
    };
    if (!payload.name) return toast({ title: "Name required", variant: "destructive" });
    const { error } = editSource.id
      ? await supabase.from("content_sources").update(payload).eq("id", editSource.id)
      : await supabase.from("content_sources").insert(payload);
    if (error) toast({ title: error.message, variant: "destructive" });
    else { setEditSource(null); refresh(); }
  };


  const setVerification = async (s: Source, status: typeof STATES[number]) => {
    const { error } = await supabase.from("content_sources").update({ verification_status: status }).eq("id", s.id);
    if (error) toast({ title: error.message, variant: "destructive" });
    else refresh();
  };

  const kickWorker = async () => {
    const { error } = await supabase.functions.invoke("ingestion-worker", { body: {} });
    if (error) toast({ title: error.message, variant: "destructive" });
    else toast({ title: "Worker kicked" });
    setTimeout(refresh, 1000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Content Ingestion</h1>
          <p className="text-sm text-muted-foreground">Import, validate, clean, chunk, translate and seed educational content.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={kickWorker}><Play className="w-4 h-4 mr-1" /> Kick worker</Button>
          <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="w-4 h-4 mr-1" /> Refresh</Button>
        </div>
      </div>

      <Tabs defaultValue="jobs">
        <TabsList>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* JOBS */}
        <TabsContent value="jobs" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={newJobOpen} onOpenChange={setNewJobOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New ingestion</Button>
              </DialogTrigger>
              <NewJobDialog
                sources={verifiedSources}
                onClose={() => setNewJobOpen(false)}
                onCreated={() => { setNewJobOpen(false); refresh(); }}
              />
            </Dialog>
          </div>

          {loading ? <Loader2 className="animate-spin" /> : jobs.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No ingestion jobs yet.</CardContent></Card>
          ) : jobs.map((j) => (
            <Card key={j.id}>
              <CardContent className="py-4 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-medium text-sm truncate">{j.title_hint ?? j.input_url ?? j.id.slice(0, 8)}</div>
                  <StateBadge state={j.state} />
                </div>
                <Progress value={j.progress} className="h-2" />
                <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                  <span>{j.subject ?? "—"} · Grade {j.grade ?? "—"}</span>
                  <span>{new Date(j.created_at).toLocaleString()}</span>
                  {j.document_id && <span className="text-primary">doc: {j.document_id.slice(0, 8)}</span>}
                </div>
                {j.last_error && <div className="text-xs text-destructive">{j.last_error}</div>}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* SOURCES */}
        <TabsContent value="sources" className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setEditSource({ name: "", license_type: "unknown", verification_status: "unverified", source_type: "web" })}>
              <Plus className="w-4 h-4 mr-1" /> Add source
            </Button>
          </div>
          {sources.map((s) => (
            <Card key={s.id}>
              <CardContent className="py-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{s.source_url ?? "—"}</div>
                  <div className="flex gap-2 mt-1 flex-wrap text-xs">
                    <Badge variant="secondary">{s.license_type}</Badge>
                    <VerifBadge v={s.verification_status} />
                    {s.country && <Badge variant="outline">{s.country}</Badge>}
                    {s.curriculum && <Badge variant="outline">{s.curriculum}</Badge>}
                    <span className="text-muted-foreground">imports: {s.import_count}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => setEditSource(s)}>Edit</Button>
                  {s.verification_status !== "verified"
                    ? <Button size="sm" variant="ghost" onClick={() => setVerification(s, "verified")}><ShieldCheck className="w-4 h-4 mr-1 text-primary" /> Verify</Button>
                    : <Button size="sm" variant="ghost" onClick={() => setVerification(s, "blocked")}><ShieldOff className="w-4 h-4 mr-1 text-destructive" /> Block</Button>}
                </div>
              </CardContent>
            </Card>
          ))}

          <Dialog open={!!editSource} onOpenChange={(o) => !o && setEditSource(null)}>
            <DialogContent>
              <DialogHeader><DialogTitle>{editSource?.id ? "Edit source" : "Add source"}</DialogTitle></DialogHeader>
              {editSource && (
                <div className="space-y-3">
                  <Field label="Name"><Input value={editSource.name ?? ""} onChange={(e) => setEditSource({ ...editSource, name: e.target.value })} /></Field>
                  <Field label="URL"><Input value={editSource.source_url ?? ""} onChange={(e) => setEditSource({ ...editSource, source_url: e.target.value })} /></Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="License">
                      <Select value={editSource.license_type ?? "unknown"} onValueChange={(v) => setEditSource({ ...editSource, license_type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{LICENSES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field label="Status">
                      <Select value={editSource.verification_status ?? "unverified"} onValueChange={(v) => setEditSource({ ...editSource, verification_status: v as any })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{STATES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Country"><Input value={editSource.country ?? ""} onChange={(e) => setEditSource({ ...editSource, country: e.target.value })} placeholder="ZA" /></Field>
                    <Field label="Curriculum"><Input value={editSource.curriculum ?? ""} onChange={(e) => setEditSource({ ...editSource, curriculum: e.target.value })} placeholder="CAPS" /></Field>
                  </div>
                </div>
              )}
              <DialogFooter><Button onClick={saveSource}>Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ANALYTICS */}
        <TabsContent value="analytics" className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Sources" value={sources.length} />
          <Stat label="Documents" value={totals.documents} />
          <Stat label="Audio assets" value={totals.audio} />
          <Stat label="Translations" value={totals.translations} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NewJobDialog({ sources, onClose, onCreated }: { sources: Source[]; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [sourceId, setSourceId] = useState<string>("");
  const [url, setUrl] = useState("");
  const [rawText, setRawText] = useState("");
  const [title, setTitle] = useState("");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!sourceId) return toast({ title: "Pick a source", variant: "destructive" });
    if (!url && !rawText) return toast({ title: "URL or raw text required", variant: "destructive" });
    setBusy(true);
    const { error, data } = await supabase.functions.invoke("ingestion-orchestrator", {
      body: {
        source_id: sourceId,
        input_url: url || undefined,
        input_raw_text: rawText || undefined,
        title_hint: title || undefined,
        grade: grade || undefined,
        subject: subject || undefined,
        curriculum: "CAPS",
        country: "ZA",
      },
    });
    setBusy(false);
    if (error || (data as any)?.error) {
      toast({ title: error?.message ?? (data as any)?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Job created" });
    onCreated();
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>New ingestion job</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <Field label="Source">
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger><SelectValue placeholder="Pick a verified source" /></SelectTrigger>
            <SelectContent>{sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Title hint"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /></Field>
        <Field label="…or paste raw text"><Textarea rows={4} value={rawText} onChange={(e) => setRawText(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Grade"><Input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="10" /></Field>
          <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Mathematics" /></Field>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={submit}>{busy ? <Loader2 className="animate-spin w-4 h-4" /> : "Create"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground font-normal">{label}</CardTitle></CardHeader>
      <CardContent className="text-2xl font-display font-bold">{value.toLocaleString()}</CardContent></Card>
  );
}

function StateBadge({ state }: { state: string }) {
  const terminal = state === "completed" || state === "failed" || state === "cancelled";
  const variant = state === "completed" ? "default" : state === "failed" ? "destructive" : terminal ? "secondary" : "outline";
  return <Badge variant={variant as any}>{state}</Badge>;
}

function VerifBadge({ v }: { v: Source["verification_status"] }) {
  const variant = v === "verified" ? "default" : v === "blocked" ? "destructive" : "secondary";
  return <Badge variant={variant as any}>{v}</Badge>;
}
