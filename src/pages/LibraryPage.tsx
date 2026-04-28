import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Headphones, Brain, Image as ImageIcon, Wifi, WifiOff, FileText, Loader2,
  Search, Play, ArrowRight, Plus, Languages,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { subjects, getSubjectById } from "@/lib/subjects";
import { CreditEstimator } from "@/components/CreditEstimator";
import {
  docMatchesSubject, categorizeDoc, CATEGORY_ORDER, type DocLite, type Category,
} from "@/lib/subject-docs";

type Lesson = {
  id: string;
  title: string;
  subject: string;
  progress: number | null;
  is_downloaded: boolean | null;
  audio_url: string | null;
  document_id: string | null;
  created_at: string;
};

type SeededDoc = DocLite & {
  has_audio?: boolean;
  has_translation?: boolean;
  progress?: number;
  started?: boolean;
};

const subjectIcon = (id: string) => subjects.find((s) => s.id === id)?.icon ?? "📚";
const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? id;

export default function LibraryPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const subjectParam = params.get("subject");
  const subjectsParam = params.get("subjects");

  const activeSubjectIds = useMemo(() => {
    if (subjectParam) return [subjectParam];
    if (subjectsParam) return subjectsParam.split(",").map(s => s.trim()).filter(Boolean);
    return [];
  }, [subjectParam, subjectsParam]);

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [seeded, setSeeded] = useState<SeededDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);

      // User's lessons
      const { data: lessonRows } = await supabase
        .from("lessons")
        .select("id, title, subject, is_downloaded, audio_url, document_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      const lessonIds = (lessonRows ?? []).map(l => l.id);
      let progressMap = new Map<string, { pct: number; updated: string }>();
      if (lessonIds.length > 0) {
        const { data: progs } = await supabase
          .from("lesson_progress")
          .select("lesson_id, audio_progress_pct, last_updated_at")
          .eq("user_id", user.id)
          .in("lesson_id", lessonIds);
        progressMap = new Map((progs ?? []).map(p => [p.lesson_id, {
          pct: Number(p.audio_progress_pct ?? 0),
          updated: p.last_updated_at as string,
        }]));
      }

      const builtLessons: Lesson[] = (lessonRows ?? []).map(l => ({
        ...l,
        progress: Math.round(progressMap.get(l.id)?.pct ?? 0),
      }));

      // Seeded library
      const { data: docs } = await supabase
        .from("documents")
        .select("id, title, subject_type, doc_type, tags")
        .eq("is_seeded", true)
        .order("created_at", { ascending: false })
        .limit(200);

      const docIds = (docs ?? []).map(d => d.id);
      // Which seeded docs already have audio/translation?
      let audioSet = new Set<string>();
      let transSet = new Set<string>();
      if (docIds.length > 0) {
        const [{ data: aRows }, { data: tRows }] = await Promise.all([
          supabase.from("audio_assets").select("document_id").in("document_id", docIds),
          supabase.from("translation_assets").select("document_id").in("document_id", docIds),
        ]);
        audioSet = new Set((aRows ?? []).map(r => r.document_id as string));
        transSet = new Set((tRows ?? []).map(r => r.document_id as string));
      }

      // Map user progress on the document level (best lesson per document)
      const docProgress = new Map<string, number>();
      for (const l of builtLessons) {
        if (!l.document_id) continue;
        const p = l.progress ?? 0;
        const prev = docProgress.get(l.document_id) ?? 0;
        if (p > prev) docProgress.set(l.document_id, p);
      }

      const builtSeeded: SeededDoc[] = (docs ?? []).map(d => ({
        id: d.id,
        title: d.title,
        subject_type: d.subject_type as string,
        doc_type: d.doc_type ?? null,
        tags: d.tags,
        has_audio: audioSet.has(d.id),
        has_translation: transSet.has(d.id),
        progress: docProgress.get(d.id) ?? 0,
        started: docProgress.has(d.id),
      }));

      setLessons(builtLessons);
      setSeeded(builtSeeded);
      setLoading(false);
    })();
  }, [user]);

  // Continue learning: most recently updated user lesson with progress > 0
  const continueLesson = useMemo(() => {
    return lessons.find(l => (l.progress ?? 0) > 0 && l.document_id) ?? lessons[0] ?? null;
  }, [lessons]);

  const filterBySearch = <T extends { title: string }>(items: T[]) =>
    items.filter(i => i.title.toLowerCase().includes(search.toLowerCase()));

  // Filter seeded docs by active subjects
  const subjectFilteredSeeded = useMemo(() => {
    if (activeSubjectIds.length === 0) return seeded;
    return seeded.filter(d => activeSubjectIds.some(sid => docMatchesSubject(d, sid)));
  }, [seeded, activeSubjectIds]);

  const seededVisible = filterBySearch(subjectFilteredSeeded);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<Category, SeededDoc[]>();
    for (const d of seededVisible) {
      const cat = categorizeDoc(d);
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(d);
    }
    return map;
  }, [seededVisible]);

  const downloaded = lessons.filter(l => l.is_downloaded);
  const visibleLessons = filterBySearch(lessons);

  const heading = activeSubjectIds.length === 0
    ? "Library"
    : activeSubjectIds.length === 1
    ? subjectName(activeSubjectIds[0])
    : "Your Subjects";

  const uploadHref = activeSubjectIds.length === 1
    ? `/upload?subject=${encodeURIComponent(activeSubjectIds[0])}`
    : "/upload";

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-display font-bold mb-1">{heading}</h1>
            <p className="text-muted-foreground text-sm">
              Explore books, audio lessons, and translations.
            </p>
            {activeSubjectIds.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {activeSubjectIds.map(sid => (
                  <Badge key={sid} variant="secondary" className="text-[10px]">
                    {subjectIcon(sid)} {subjectName(sid)}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <Link to={uploadHref} className="shrink-0">
            <Button size="sm" className="gap-2 rounded-xl">
              <Plus className="w-4 h-4" /> Upload Content
            </Button>
          </Link>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search books, topics, chapters..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Continue Learning */}
        {continueLesson && continueLesson.document_id && (continueLesson.progress ?? 0) > 0 && (
          <section>
            <h2 className="font-display font-semibold text-sm mb-2 flex items-center gap-2">
              <Play className="w-4 h-4 text-primary" /> Continue learning
            </h2>
            <Link to={`/lesson/${continueLesson.document_id}`}>
              <Card className="hover:shadow-md transition-shadow rounded-2xl">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-2xl shrink-0">
                    {subjectIcon(continueLesson.subject)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {subjectName(continueLesson.subject)}
                    </p>
                    <p className="font-semibold text-sm truncate">{continueLesson.title}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Progress value={continueLesson.progress ?? 0} className="h-1.5 flex-1 max-w-xs" />
                      <span className="text-xs text-muted-foreground">{continueLesson.progress}%</span>
                    </div>
                  </div>
                  <Button size="sm" className="gap-1.5 rounded-xl shrink-0">
                    Continue <Play className="w-3.5 h-3.5 fill-current" />
                  </Button>
                </CardContent>
              </Card>
            </Link>
          </section>
        )}

        {/* Tabs: Library (seeded) vs My Lessons */}
        <Tabs defaultValue="library">
          <TabsList>
            <TabsTrigger value="library">Library ({seededVisible.length})</TabsTrigger>
            <TabsTrigger value="mine">My Lessons ({visibleLessons.length})</TabsTrigger>
            <TabsTrigger value="downloaded">Offline ({downloaded.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="mt-4 space-y-6">
            {loading ? (
              <LoadingState />
            ) : seededVisible.length === 0 ? (
              <EmptyLibrary subjectId={activeSubjectIds[0]} uploadHref={uploadHref} />
            ) : (
              CATEGORY_ORDER.filter(cat => grouped.has(cat)).map(cat => (
                <CategoryRow key={cat} title={cat} docs={grouped.get(cat)!} />
              ))
            )}
          </TabsContent>

          <TabsContent value="mine" className="mt-4 space-y-3">
            {loading ? (
              <LoadingState />
            ) : visibleLessons.length === 0 ? (
              <EmptyMine uploadHref={uploadHref} />
            ) : (
              visibleLessons.map(l => <LessonCard key={l.id} lesson={l} />)
            )}
          </TabsContent>

          <TabsContent value="downloaded" className="mt-4 space-y-3">
            {downloaded.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No downloaded lessons yet. Generate audio on a lesson to make it available offline.
              </p>
            ) : (
              downloaded.map(l => <LessonCard key={l.id} lesson={l} />)
            )}
          </TabsContent>
        </Tabs>
      </motion.div>
    </AppLayout>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

function CategoryRow({ title, docs }: { title: string; docs: SeededDoc[] }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display font-semibold text-base">{title}</h3>
        <span className="text-xs text-muted-foreground">{docs.length}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {docs.map(d => <BookCard key={d.id} doc={d} />)}
      </div>
    </section>
  );
}

function BookCard({ doc }: { doc: SeededDoc }) {
  const status = (doc.progress ?? 0) > 0 ? "Continue" : "Start";
  return (
    <Link to={`/lesson/${doc.id}`} className="snap-start shrink-0 w-56">
      <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all h-full rounded-2xl">
        <CardContent className="p-4 flex flex-col h-full">
          <div className="aspect-[3/4] rounded-lg bg-gradient-to-br from-primary/15 via-secondary/10 to-accent/15 flex items-center justify-center mb-3">
            <FileText className="w-10 h-10 text-primary/60" />
          </div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {doc.subject_type}
          </p>
          <p className="font-display font-semibold text-sm mt-0.5 line-clamp-2 min-h-[2.5rem]">{doc.title}</p>
          {(doc.progress ?? 0) > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <Progress value={doc.progress ?? 0} className="h-1 flex-1" />
              <span className="text-[10px] text-muted-foreground">{doc.progress}%</span>
            </div>
          )}
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              {doc.has_audio && <Headphones className="w-3.5 h-3.5 text-primary" />}
              {doc.has_translation && <Languages className="w-3.5 h-3.5 text-secondary" />}
            </div>
            <span className="text-xs font-medium text-primary inline-flex items-center gap-0.5">
              {status} <ArrowRight className="w-3 h-3" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function EmptyLibrary({ subjectId, uploadHref }: { subjectId?: string; uploadHref: string }) {
  return (
    <Card>
      <CardContent className="p-8 text-center">
        <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <h3 className="font-semibold mb-1">No content available {subjectId ? `for ${subjectName(subjectId)}` : ""} yet</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Be the first — upload a textbook, novel, or notes to start learning.
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          <Link to={uploadHref}>
            <Button size="sm" className="gap-2 rounded-xl">
              <Plus className="w-4 h-4" /> Upload a textbook
            </Button>
          </Link>
          <Link to="/library">
            <Button size="sm" variant="outline" className="gap-2 rounded-xl">
              Explore recommended books
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyMine({ uploadHref }: { uploadHref: string }) {
  return (
    <Card>
      <CardContent className="p-8 text-center">
        <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <h3 className="font-semibold mb-1">No lessons yet</h3>
        <p className="text-sm text-muted-foreground mb-4">Upload a textbook or novel to get started.</p>
        <Link to={uploadHref}>
          <Button size="sm" className="gap-2 rounded-xl">
            <Plus className="w-4 h-4" /> Upload Content
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function LessonCard({ lesson }: { lesson: Lesson }) {
  const progress = lesson.progress ?? 0;
  const hasAudio = !!lesson.audio_url;
  return (
    <Link to={lesson.document_id ? `/lesson/${lesson.document_id}` : "#"} className="block">
      <Card className="hover:shadow-sm hover:border-primary/40 transition-all cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">{subjectIcon(lesson.subject)}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-sm truncate">{lesson.title}</h3>
                {lesson.is_downloaded ? (
                  <Badge variant="secondary" className="text-[10px] gap-1 bg-success/10 text-success border-0 flex-shrink-0">
                    <WifiOff className="w-2.5 h-2.5" /> Offline
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] gap-1 bg-muted border-0 flex-shrink-0">
                    <Wifi className="w-2.5 h-2.5" /> Online
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{subjectName(lesson.subject)}</p>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex gap-1.5">
                  {hasAudio && <Headphones className="w-3.5 h-3.5 text-primary" />}
                  <ImageIcon className="w-3.5 h-3.5 text-secondary opacity-40" />
                  <Brain className="w-3.5 h-3.5 text-accent opacity-40" />
                </div>
                <Progress value={progress} className="flex-1 h-1.5" />
                <span className="text-xs text-muted-foreground">{progress}%</span>
              </div>
              {lesson.document_id && (
                <div className="mt-2.5">
                  <CreditEstimator documentId={lesson.document_id} variant="compact" />
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
