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
import { Loader2, Play, Plus, RefreshCw, ShieldCheck, ShieldOff, Download, TrendingUp, Sparkles } from "lucide-react";

type Source = {
  id: string;
  name: string;
  source_type: string;
  source_url: string | null;
  license_type: string;
  verification_status: "unverified" | "verified" | "blocked";
  country: string | null;
  curriculum: string | null;
  grade: string | null;
  subject: string | null;
  last_sync_at: string | null;
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
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="caps">CAPS Sources</TabsTrigger>
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="coverage">
          <CoverageDashboard />
        </TabsContent>

        <TabsContent value="caps">
          <CapsSourcesPanel sources={sources} onChanged={refresh} />
        </TabsContent>




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
  const [topic, setTopic] = useState("");
  const [taxonomy, setTaxonomy] = useState<{ grade: string; subject: string; topic: string | null }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("curriculum_taxonomy")
      .select("grade,subject,topic")
      .eq("country", "ZA")
      .eq("curriculum", "CAPS")
      .order("grade")
      .order("subject")
      .order("topic")
      .then(({ data }) => setTaxonomy((data ?? []) as any));
  }, []);

  const grades = useMemo(
    () => Array.from(new Set(taxonomy.map((t) => t.grade))).sort((a, b) => Number(a) - Number(b)),
    [taxonomy],
  );
  const subjects = useMemo(
    () => Array.from(new Set(taxonomy.filter((t) => t.grade === grade).map((t) => t.subject))).sort(),
    [taxonomy, grade],
  );
  const topics = useMemo(
    () =>
      Array.from(
        new Set(
          taxonomy
            .filter((t) => t.grade === grade && t.subject === subject && t.topic)
            .map((t) => t.topic as string),
        ),
      ).sort(),
    [taxonomy, grade, subject],
  );

  const submit = async () => {
    if (!sourceId) return toast({ title: "Pick a source", variant: "destructive" });
    if (!grade || !subject) return toast({ title: "Pick grade & subject", variant: "destructive" });
    if (!url && !rawText) return toast({ title: "URL or raw text required", variant: "destructive" });
    setBusy(true);
    const titleHint = [title, topic].filter(Boolean).join(" — ") || undefined;
    const { error, data } = await supabase.functions.invoke("ingestion-orchestrator", {
      body: {
        source_id: sourceId,
        input_url: url || undefined,
        input_raw_text: rawText || undefined,
        title_hint: titleHint,
        grade,
        subject,
        topic: topic || undefined,
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
        <div className="grid grid-cols-3 gap-2">
          <Field label="Grade">
            <Select value={grade} onValueChange={(v) => { setGrade(v); setSubject(""); setTopic(""); }}>
              <SelectTrigger><SelectValue placeholder="Grade" /></SelectTrigger>
              <SelectContent>{grades.map((g) => <SelectItem key={g} value={g}>Grade {g}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Subject">
            <Select value={subject} onValueChange={(v) => { setSubject(v); setTopic(""); }} disabled={!grade}>
              <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
              <SelectContent>{subjects.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Topic">
            <Select value={topic} onValueChange={setTopic} disabled={!subject || topics.length === 0}>
              <SelectTrigger><SelectValue placeholder={topics.length ? "Topic" : "—"} /></SelectTrigger>
              <SelectContent>{topics.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Title hint"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /></Field>
        <Field label="…or paste raw text"><Textarea rows={4} value={rawText} onChange={(e) => setRawText(e.target.value)} /></Field>
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

type TaxRow = { grade: string; subject: string; topic: string | null };
type TagRow = { grade: string | null; subject: string | null; topic: string | null; document_id: string };

type CoverageRow = {
  grade: string;
  subject: string;
  topic: string | null;
  resources: number;
  resources_any: number;
  best_confidence: number;
};

const SUBJECT_PRIORITY = new Set([
  "Mathematics", "Physical Sciences", "English Home Language",
  "English First Additional Language", "Life Sciences", "Accounting",
]);

// Importance score for ranking next imports.
const SUBJECT_RANK: Record<string, number> = {
  "Mathematics": 100,
  "Mathematical Literacy": 70,
  "Physical Sciences": 90,
  "Life Sciences": 80,
  "Accounting": 70,
  "Geography": 60,
  "English Home Language": 55,
  "English First Additional Language": 55,
};


function CoverageDashboard() {
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drillGrade, setDrillGrade] = useState<string>("all");
  const [drillSubject, setDrillSubject] = useState<string>("all");
  const [lastSnapshot, setLastSnapshot] = useState<{ covered_topics: number; total_topics: number; created_at: string } | null>(null);

  const load = async () => {
    const [cov, snap] = await Promise.all([
      supabase
        .from("v_caps_coverage" as any)
        .select("grade,subject,topic,resources,resources_any,best_confidence")
        .eq("country", "ZA").eq("curriculum", "CAPS"),
      supabase
        .from("coverage_snapshots" as any)
        .select("covered_topics,total_topics,created_at")
        .eq("country", "ZA").eq("curriculum", "CAPS")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setRows(((cov.data ?? []) as unknown) as CoverageRow[]);
    setLastSnapshot((snap.data as any) ?? null);
    setLoading(false);
  };

  // Persist a snapshot when coverage materially changes (debounced).
  const snapshotIfChanged = async (totalTopics: number, coveredTopics: number, resources: number) => {
    if (!totalTopics) return;
    const { data: latest } = await supabase
      .from("coverage_snapshots" as any)
      .select("covered_topics,total_topics")
      .eq("country", "ZA").eq("curriculum", "CAPS")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if ((latest as any)?.covered_topics === coveredTopics && (latest as any)?.total_topics === totalTopics) return;
    await supabase.from("coverage_snapshots" as any).insert({
      country: "ZA", curriculum: "CAPS",
      total_topics: totalTopics, covered_topics: coveredTopics, resources,
    });
  };

  useEffect(() => {
    load();
    // Auto-refresh whenever new mappings are inserted.
    const ch = supabase
      .channel("content-topic-mapping-coverage")
      .on("postgres_changes", { event: "*", schema: "public", table: "content_topic_mapping" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);


  const stats = useMemo(() => {
    const totalTopics = rows.length;
    const coveredTopics = rows.filter((r) => r.resources > 0).length;

    const subjMap = new Map<string, { grade: string; subject: string; total: number; covered: number; resources: number }>();
    for (const r of rows) {
      const k = `${r.grade}|${r.subject}`;
      if (!subjMap.has(k)) subjMap.set(k, { grade: r.grade, subject: r.subject, total: 0, covered: 0, resources: 0 });
      const e = subjMap.get(k)!;
      e.total += 1;
      if (r.resources > 0) e.covered += 1;
      e.resources += r.resources;
    }
    const subjects = [...subjMap.values()].sort(
      (a, b) => Number(a.grade) - Number(b.grade) || a.subject.localeCompare(b.subject),
    );

    const gradeMap = new Map<string, { grade: string; total: number; covered: number; resources: number; subjects: number }>();
    for (const s of subjects) {
      if (!gradeMap.has(s.grade)) gradeMap.set(s.grade, { grade: s.grade, total: 0, covered: 0, resources: 0, subjects: 0 });
      const e = gradeMap.get(s.grade)!;
      e.total += s.total; e.covered += s.covered; e.resources += s.resources; e.subjects += 1;
    }
    const grades = [...gradeMap.values()].sort((a, b) => Number(a.grade) - Number(b.grade));

    // Gaps ranked by priority: missing high-priority subjects first, then by grade.
    const gaps = rows
      .filter((r) => r.resources === 0)
      .map((r) => ({
        ...r,
        priority: (SUBJECT_PRIORITY.has(r.subject) ? 2 : 1) + (Number(r.grade) >= 11 ? 1 : 0),
      }))
      .sort((a, b) => b.priority - a.priority || Number(a.grade) - Number(b.grade) || a.subject.localeCompare(b.subject));

    // Recommended next imports: uncovered subjects ranked by importance & grade weight.
    const subjectGapMap = new Map<string, { grade: string; subject: string; uncovered: number; total: number }>();
    for (const r of rows) {
      const k = `${r.grade}|${r.subject}`;
      if (!subjectGapMap.has(k)) subjectGapMap.set(k, { grade: r.grade, subject: r.subject, uncovered: 0, total: 0 });
      const e = subjectGapMap.get(k)!;
      e.total += 1;
      if (r.resources === 0) e.uncovered += 1;
    }
    const recommendations = [...subjectGapMap.values()]
      .filter((s) => s.uncovered > 0)
      .map((s) => {
        const gradeWeight = Number(s.grade) >= 11 ? 30 : Number(s.grade) === 10 ? 20 : 10;
        const subjectScore = SUBJECT_RANK[s.subject] ?? 25;
        const demand = (s.uncovered / Math.max(s.total, 1)) * 40;
        return { ...s, score: gradeWeight + subjectScore + demand };
      })
      .sort((a, b) => b.score - a.score);

    return { totalTopics, coveredTopics, subjects, grades, gaps, recommendations };
  }, [rows]);

  // Snapshot coverage when it changes so we can report "Coverage gain since last import".
  useEffect(() => {
    if (loading) return;
    const totalResources = stats.subjects.reduce((sum, s) => sum + s.resources, 0);
    snapshotIfChanged(stats.totalTopics, stats.coveredTopics, totalResources);
  }, [stats.totalTopics, stats.coveredTopics, loading]);

  if (loading) return <Loader2 className="animate-spin mt-4" />;

  const pct = stats.totalTopics ? Math.round((stats.coveredTopics / stats.totalTopics) * 100) : 0;
  const lowSubjects = stats.subjects.filter((s) => s.total > 0 && (s.covered / s.total) * 100 < 80);

  const gain = lastSnapshot ? stats.coveredTopics - lastSnapshot.covered_topics : 0;
  const prevPct = lastSnapshot && lastSnapshot.total_topics
    ? Math.round((lastSnapshot.covered_topics / lastSnapshot.total_topics) * 100)
    : pct;
  const pctGain = pct - prevPct;

  const gradeOptions = ["all", ...stats.grades.map((g) => g.grade)];
  const subjectOptions = ["all", ...Array.from(new Set(
    stats.subjects.filter((s) => drillGrade === "all" || s.grade === drillGrade).map((s) => s.subject),
  ))];
  const drillRows = rows.filter((r) =>
    (drillGrade === "all" || r.grade === drillGrade) &&
    (drillSubject === "all" || r.subject === drillSubject),
  ).sort((a, b) =>
    Number(a.grade) - Number(b.grade) ||
    a.subject.localeCompare(b.subject) ||
    (a.topic ?? "").localeCompare(b.topic ?? ""),
  );

  return (
    <div className="space-y-6 mt-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total CAPS topics" value={stats.totalTopics} />
        <Stat label="Topics with content" value={stats.coveredTopics} />
        <Stat label="Topics without content" value={stats.totalTopics - stats.coveredTopics} />
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground font-normal">Coverage</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            <div className="text-2xl font-display font-bold">{pct}%</div>
            <Progress value={pct} className="h-2" />
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" /> Coverage gain
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Topics covered</div>
            <div className="text-xl font-display font-bold">{stats.coveredTopics}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Topics uncovered</div>
            <div className="text-xl font-display font-bold">{stats.totalTopics - stats.coveredTopics}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Δ topics since last snapshot</div>
            <div className={`text-xl font-display font-bold ${gain > 0 ? "text-primary" : gain < 0 ? "text-destructive" : ""}`}>
              {gain > 0 ? "+" : ""}{gain}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Δ coverage %</div>
            <div className={`text-xl font-display font-bold ${pctGain > 0 ? "text-primary" : pctGain < 0 ? "text-destructive" : ""}`}>
              {pctGain > 0 ? "+" : ""}{pctGain}%
            </div>
          </div>
          {lastSnapshot && (
            <div className="md:col-span-4 text-xs text-muted-foreground">
              Compared to snapshot taken {new Date(lastSnapshot.created_at).toLocaleString()}.
            </div>
          )}
        </CardContent>
      </Card>



      {lowSubjects.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Subjects below 80% coverage ({lowSubjects.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {lowSubjects.map((s) => (
              <Badge key={`${s.grade}-${s.subject}`} variant="destructive">
                G{s.grade} · {s.subject} — {Math.round((s.covered / s.total) * 100)}%
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">By Grade</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-3">Grade</th><th className="py-1 pr-3">Subjects</th>
                <th className="py-1 pr-3">Topics</th><th className="py-1 pr-3">Covered</th>
                <th className="py-1 pr-3">Resources</th><th className="py-1 pr-3">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {stats.grades.map((g) => {
                const p = g.total ? Math.round((g.covered / g.total) * 100) : 0;
                return (
                  <tr key={g.grade} className="border-t">
                    <td className="py-1 pr-3 font-medium">Grade {g.grade}</td>
                    <td className="py-1 pr-3">{g.subjects}</td>
                    <td className="py-1 pr-3">{g.total}</td>
                    <td className="py-1 pr-3">{g.covered}</td>
                    <td className="py-1 pr-3">{g.resources}</td>
                    <td className="py-1 pr-3">
                      <div className="flex items-center gap-2">
                        <Progress value={p} className="h-1.5 w-20" />
                        <span className={p < 80 ? "text-destructive" : ""}>{p}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">Drill-down: topics per grade & subject</CardTitle>
          <div className="flex gap-2">
            <Select value={drillGrade} onValueChange={(v) => { setDrillGrade(v); setDrillSubject("all"); }}>
              <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {gradeOptions.map((g) => (
                  <SelectItem key={g} value={g}>{g === "all" ? "All grades" : `Grade ${g}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={drillSubject} onValueChange={setDrillSubject}>
              <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {subjectOptions.map((s) => (
                  <SelectItem key={s} value={s}>{s === "all" ? "All subjects" : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-3">Grade</th><th className="py-1 pr-3">Subject</th>
                <th className="py-1 pr-3">Topic</th><th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Resources</th><th className="py-1 pr-3">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {drillRows.map((r, i) => (
                <tr key={i} className={`border-t ${r.resources === 0 ? "bg-destructive/5" : ""}`}>
                  <td className="py-1 pr-3">G{r.grade}</td>
                  <td className="py-1 pr-3">{r.subject}</td>
                  <td className="py-1 pr-3">{r.topic ?? <span className="text-muted-foreground italic">(subject-level)</span>}</td>
                  <td className="py-1 pr-3">
                    {r.resources > 0
                      ? <Badge variant="default">Covered</Badge>
                      : <Badge variant="destructive">Gap</Badge>}
                  </td>
                  <td className="py-1 pr-3">{r.resources}</td>
                  <td className="py-1 pr-3 text-muted-foreground">{r.best_confidence > 0 ? r.best_confidence.toFixed(2) : "—"}</td>
                </tr>
              ))}
              {drillRows.length === 0 && (
                <tr><td className="py-3 text-muted-foreground" colSpan={6}>No topics match the current filter.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="border-amber-500/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Content Gaps ({stats.gaps.length}) — prioritised</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 max-h-96 overflow-y-auto">
          {stats.gaps.slice(0, 100).map((g, i) => (
            <div key={i} className="flex items-center justify-between text-sm border-b py-1 last:border-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline">G{g.grade}</Badge>
                <span className="font-medium">{g.subject}</span>
                {g.topic && <span className="text-muted-foreground">· {g.topic}</span>}
              </div>
              {SUBJECT_PRIORITY.has(g.subject) && <Badge variant="secondary">High priority</Badge>}
            </div>
          ))}
          {stats.gaps.length === 0 && <p className="text-muted-foreground text-sm">No gaps — full CAPS coverage 🎉</p>}
          {stats.gaps.length > 100 && (
            <p className="text-xs text-muted-foreground pt-2">Showing top 100 of {stats.gaps.length} gaps.</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Recommended next imports
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Uncovered subjects ranked by grade weight, subject importance, and student demand.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-3">#</th>
                <th className="py-1 pr-3">Grade</th>
                <th className="py-1 pr-3">Subject</th>
                <th className="py-1 pr-3">Uncovered topics</th>
                <th className="py-1 pr-3">Score</th>
              </tr>
            </thead>
            <tbody>
              {stats.recommendations.slice(0, 15).map((r, i) => (
                <tr key={`${r.grade}-${r.subject}`} className="border-t">
                  <td className="py-1 pr-3 text-muted-foreground">{i + 1}</td>
                  <td className="py-1 pr-3">Grade {r.grade}</td>
                  <td className="py-1 pr-3 font-medium">
                    {r.subject}
                    {SUBJECT_PRIORITY.has(r.subject) && (
                      <Badge variant="secondary" className="ml-2 text-[10px]">priority</Badge>
                    )}
                  </td>
                  <td className="py-1 pr-3">{r.uncovered} / {r.total}</td>
                  <td className="py-1 pr-3 text-muted-foreground">{Math.round(r.score)}</td>
                </tr>
              ))}
              {stats.recommendations.length === 0 && (
                <tr><td colSpan={5} className="py-3 text-muted-foreground">All subjects covered.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}


function VerifBadge({ v }: { v: Source["verification_status"] }) {
  const variant = v === "verified" ? "default" : v === "blocked" ? "destructive" : "secondary";
  return <Badge variant={variant as any}>{v}</Badge>;
}

// =============================================================================
// CAPS Sources panel — registry of curriculum-aligned textbook sources
// =============================================================================

const SIYAVULA_PRESETS: Array<{
  name: string;
  subject: string;
  grade: string;
  source_url: string;
}> = [
  // Mathematics
  { name: "Siyavula Mathematics Grade 10", subject: "Mathematics", grade: "10", source_url: "https://www.siyavula.com/read/za/mathematics/grade-10" },
  { name: "Siyavula Mathematics Grade 11", subject: "Mathematics", grade: "11", source_url: "https://www.siyavula.com/read/za/mathematics/grade-11" },
  { name: "Siyavula Mathematics Grade 12", subject: "Mathematics", grade: "12", source_url: "https://www.siyavula.com/read/za/mathematics/grade-12" },
  // Physical Sciences
  { name: "Siyavula Physical Sciences Grade 10", subject: "Physical Sciences", grade: "10", source_url: "https://www.siyavula.com/read/za/physical-sciences/grade-10" },
  { name: "Siyavula Physical Sciences Grade 11", subject: "Physical Sciences", grade: "11", source_url: "https://www.siyavula.com/read/za/physical-sciences/grade-11" },
  { name: "Siyavula Physical Sciences Grade 12", subject: "Physical Sciences", grade: "12", source_url: "https://www.siyavula.com/read/za/physical-sciences/grade-12" },
  // Life Sciences
  { name: "Siyavula Life Sciences Grade 10", subject: "Life Sciences", grade: "10", source_url: "https://www.siyavula.com/read/za/life-sciences/grade-10" },
  { name: "Siyavula Life Sciences Grade 11", subject: "Life Sciences", grade: "11", source_url: "https://www.siyavula.com/read/za/life-sciences/grade-11" },
  { name: "Siyavula Life Sciences Grade 12", subject: "Life Sciences", grade: "12", source_url: "https://www.siyavula.com/read/za/life-sciences/grade-12" },
];

function CapsSourcesPanel({ sources, onChanged }: { sources: Source[]; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const capsRows = useMemo(
    () =>
      sources
        .filter((s) => (s.curriculum ?? "").toUpperCase() === "CAPS")
        .sort(
          (a, b) =>
            (a.subject ?? "").localeCompare(b.subject ?? "") ||
            Number(a.grade ?? 0) - Number(b.grade ?? 0) ||
            a.name.localeCompare(b.name),
        ),
    [sources],
  );

  const bulkImportSiyavula = async () => {
    setBusy(true);
    const existing = new Set(sources.map((s) => s.name));
    const rows = SIYAVULA_PRESETS.filter((p) => !existing.has(p.name)).map((p) => ({
      name: p.name,
      source_type: "web",
      source_url: p.source_url,
      license_type: "creative_commons" as const,
      verification_status: "verified" as const,
      country: "ZA",
      curriculum: "CAPS",
      grade: p.grade,
      subject: p.subject,
    }));
    if (rows.length === 0) {
      toast({ title: "All Siyavula sources already registered" });
      setBusy(false);
      return;
    }
    const { error } = await supabase.from("content_sources").insert(rows as any);
    setBusy(false);
    if (error) toast({ title: error.message, variant: "destructive" });
    else {
      toast({ title: `Registered ${rows.length} Siyavula source${rows.length === 1 ? "" : "s"}` });
      onChanged();
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">CAPS Content Sources</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Registry of curriculum-aligned textbook sources used for bulk ingestion.
            </p>
          </div>
          <Button size="sm" onClick={bulkImportSiyavula} disabled={busy}>
            {busy ? <Loader2 className="animate-spin w-4 h-4 mr-1" /> : <Download className="w-4 h-4 mr-1" />}
            Bulk import Siyavula
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-3">Source name</th>
                <th className="py-1 pr-3">Grade</th>
                <th className="py-1 pr-3">Subject</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">License</th>
                <th className="py-1 pr-3">URL</th>
                <th className="py-1 pr-3">Last sync</th>
              </tr>
            </thead>
            <tbody>
              {capsRows.map((s) => (
                <tr key={s.id} className="border-t align-top">
                  <td className="py-2 pr-3 font-medium">{s.name}</td>
                  <td className="py-2 pr-3">{s.grade ?? "—"}</td>
                  <td className="py-2 pr-3">{s.subject ?? "—"}</td>
                  <td className="py-2 pr-3"><VerifBadge v={s.verification_status} /></td>
                  <td className="py-2 pr-3"><Badge variant="secondary">{s.license_type}</Badge></td>
                  <td className="py-2 pr-3 max-w-[220px] truncate">
                    {s.source_url ? (
                      <a href={s.source_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        {s.source_url}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground text-xs">
                    {s.last_sync_at ? new Date(s.last_sync_at).toLocaleString() : s.last_import_at ? new Date(s.last_import_at).toLocaleString() : "Never"}
                  </td>
                </tr>
              ))}
              {capsRows.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">
                  No CAPS sources yet. Click "Bulk import Siyavula" to register the standard textbook set.
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
