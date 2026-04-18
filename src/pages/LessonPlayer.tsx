import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Headphones, Brain, Image as ImageIcon, Play, Pause, SkipBack, SkipForward,
  Loader2, Globe, Coins, Languages, ChevronLeft, ChevronRight, Sparkles, RefreshCw,
  Check, X, RotateCcw, AlertTriangle, Gauge,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { subjects } from "@/lib/subjects";

const LANGS = [
  { code: "en", label: "English" },
  { code: "af", label: "Afrikaans" },
  { code: "zu", label: "isiZulu" },
  { code: "ts", label: "Xitsonga" },
  { code: "nso", label: "Sepedi" },
];

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const HUMANITIES = new Set(["novel", "history"]);

type Tab = "listen" | "visuals" | "quiz";
const VALID_TABS: Tab[] = ["listen", "visuals", "quiz"];

type Lesson = {
  id: string;
  title: string;
  subject: string;
  language: string | null;
  document_id: string | null;
  documents: { subject_type: string | null } | null;
};

type Scene = {
  id: string;
  scene_index: number;
  prompt_text: string;
  storage_path: string;
  signedUrl?: string;
};

type QuizQ = {
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
};

export default function LessonPlayer() {
  const { documentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const tabParam = searchParams.get("tab") as Tab | null;
  const activeTab: Tab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "listen";

  // ---------- Lesson resolution ----------
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    if (!documentId || !user) return;
    (async () => {
      setResolving(true);
      // Find user's lesson for this document, or create one from upload
      const { data: existing } = await supabase
        .from("lessons")
        .select("id, title, subject, language, document_id, documents(subject_type)")
        .eq("user_id", user.id)
        .eq("document_id", documentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        setLesson(existing as Lesson);
        setLanguage(existing.language ?? "en");
        setResolving(false);
        return;
      }

      // No lesson yet — fall back to document metadata only (read-only mode)
      const { data: doc } = await supabase
        .from("documents")
        .select("id, title, subject_type")
        .eq("id", documentId)
        .maybeSingle();
      if (!doc) {
        toast({ title: "Lesson not found", variant: "destructive" });
        navigate("/library");
        return;
      }
      // Create a lesson on the fly so user has progress + audio access
      const { data: upload } = await supabase
        .from("uploads")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (upload) {
        const { data: created } = await supabase
          .from("lessons")
          .insert({
            user_id: user.id,
            document_id: doc.id,
            upload_id: upload.id,
            title: doc.title,
            subject: doc.subject_type ?? "other",
            content_text: "",
          })
          .select("id, title, subject, language, document_id, documents(subject_type)")
          .single();
        if (created) {
          setLesson(created as Lesson);
          setLanguage(created.language ?? "en");
        }
      } else {
        toast({ title: "Open this from your library or upload a document first.", variant: "destructive" });
        navigate("/library");
      }
      setResolving(false);
    })();
  }, [documentId, user, navigate, toast]);

  // ---------- Shared language ----------
  const [language, setLanguage] = useState("en");

  // ---------- Audio / Listen state (lifted, persists across tabs) ----------
  const [chunkIndex, setChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(1);
  const [chunkText, setChunkText] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [seekProgress, setSeekProgress] = useState([0]);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [costPreview, setCostPreview] = useState<{
    total: number; paid: number; remaining: number; balance: number;
  } | null>(null);
  const [hasConfirmed, setHasConfirmed] = useState(false);
  const [chunkAlreadyPaid, setChunkAlreadyPaid] = useState(false);

  // Translation
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationCache, setTranslationCache] = useState<Record<string, string>>({});

  const lessonId = lesson?.id;

  const fetchCostPreview = useCallback(async (lang: string) => {
    if (!lessonId) return;
    const { data, error } = await supabase.functions.invoke("generate-audio", {
      body: { lesson_id: lessonId, language: lang, preview_only: true },
    });
    if (error || !data?.success) return;
    setCostPreview({
      total: data.total_chunks,
      paid: data.paid_chunks,
      remaining: data.remaining_credits_for_full_book,
      balance: data.credits_balance,
    });
    setTotalChunks(data.total_chunks);
  }, [lessonId]);

  const loadChunk = useCallback(async (index: number, lang: string) => {
    if (!lessonId) return;
    setIsLoadingAudio(true);
    setAudioUrl(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-audio", {
        body: { lesson_id: lessonId, chunk_index: index, language: lang },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error ?? "Failed");
      setAudioUrl(data.audio_url);
      setChunkText(data.text);
      setTotalChunks(data.total_chunks);
      setChunkAlreadyPaid(data.credits_charged === 0);
      if (data.credits_charged > 0) {
        toast({ title: "1 credit charged", description: `Section ${index + 1} unlocked — replays free.` });
        fetchCostPreview(lang);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load audio";
      toast({ title: "Audio failed", description: msg, variant: "destructive" });
    } finally {
      setIsLoadingAudio(false);
    }
  }, [lessonId, fetchCostPreview, toast]);

  // Load preview when lesson ready / language changes
  useEffect(() => {
    if (!lesson) return;
    setChunkIndex(0);
    setHasConfirmed(false);
    setAudioUrl(null);
    setChunkText("");
    fetchCostPreview(language);
  }, [lesson?.id, language, fetchCostPreview, lesson]);

  // Once user confirms, load first chunk
  useEffect(() => {
    if (!lesson || !hasConfirmed) return;
    loadChunk(0, language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasConfirmed]);

  // Audio element handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    audio.playbackRate = playbackRate;
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) setSeekProgress([(audio.currentTime / audio.duration) * 100]);
    };
    const onLoad = () => setDuration(audio.duration);
    const onEnd = () => {
      setIsPlaying(false);
      if (chunkIndex + 1 < totalChunks) {
        const next = chunkIndex + 1;
        setChunkIndex(next);
        loadChunk(next, language).then(() => {
          setTimeout(() => audioRef.current?.play(), 200);
          setIsPlaying(true);
        });
      }
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoad);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoad);
      audio.removeEventListener("ended", onEnd);
    };
  }, [audioUrl, chunkIndex, totalChunks, language, loadChunk, playbackRate]);

  // Keep playbackRate in sync
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) { audio.pause(); setIsPlaying(false); }
    else { audio.play(); setIsPlaying(true); }
  };

  const goChunk = (delta: number) => {
    const next = Math.max(0, Math.min(totalChunks - 1, chunkIndex + delta));
    if (next === chunkIndex) return;
    setChunkIndex(next);
    setIsPlaying(false);
    loadChunk(next, language);
  };

  const onSeek = (val: number[]) => {
    const audio = audioRef.current;
    if (!audio || !audio.duration) return;
    audio.currentTime = (val[0] / 100) * audio.duration;
    setSeekProgress(val);
  };

  const fmt = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  // Translation lazy-load
  useEffect(() => {
    if (language === "en") { setTranslatedText(null); return; }
    if (!lessonId || !chunkText) return;
    const cacheKey = `${language}:${chunkIndex}`;
    if (translationCache[cacheKey]) {
      setTranslatedText(translationCache[cacheKey]);
      return;
    }
    let cancelled = false;
    setIsTranslating(true);
    setTranslatedText(null);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("generate-translation", {
          body: { lesson_id: lessonId, chunk_index: chunkIndex, target_language: language },
        });
        if (cancelled) return;
        if (error) throw new Error(error.message);
        if (!data?.success) throw new Error(data?.error ?? "Translation failed");
        setTranslatedText(data.translated_text);
        setTranslationCache((prev) => ({ ...prev, [cacheKey]: data.translated_text }));
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Translation failed";
        toast({ title: "Translation failed", description: msg, variant: "destructive" });
      } finally {
        if (!cancelled) setIsTranslating(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, chunkIndex, chunkText, lessonId]);

  // ---------- Tab change ----------
  const onTabChange = (next: string) => {
    if (next === "listen") setSearchParams({}, { replace: true });
    else setSearchParams({ tab: next }, { replace: true });
  };

  const subjectMeta = subjects.find((s) => s.id === lesson?.subject);
  const subjectIcon = subjectMeta?.icon ?? "📚";
  const subjectName = subjectMeta?.name ?? lesson?.subject ?? "";

  if (resolving || !lesson) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading lesson…
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        {/* Header */}
        <div className="mb-5">
          <Link to="/library" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3">
            <ArrowLeft className="w-4 h-4 mr-1" /> Library
          </Link>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3 min-w-0">
              <span className="text-3xl">{subjectIcon}</span>
              <div className="min-w-0">
                <h1 className="text-xl md:text-2xl font-display font-bold truncate">{lesson.title}</h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <p className="text-muted-foreground text-sm">{subjectName}</p>
                  {lesson.documents?.subject_type && (
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                        lesson.documents.subject_type === "novel"
                          ? "bg-primary/10 text-primary border-primary/30"
                          : "bg-muted text-foreground/70 border-border"
                      }`}
                    >
                      {lesson.documents.subject_type === "novel" ? "📖 Story Mode" : "🎓 Study Mode"}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-40">
                <Globe className="w-4 h-4 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGS.map((l) => (
                  <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={onTabChange} className="mb-32">
          <TabsList className="mb-5">
            <TabsTrigger value="listen" className="gap-1.5">
              <Headphones className="w-4 h-4" /> Listen
            </TabsTrigger>
            <TabsTrigger value="visuals" className="gap-1.5">
              <ImageIcon className="w-4 h-4" /> Visuals
            </TabsTrigger>
            <TabsTrigger value="quiz" className="gap-1.5">
              <Brain className="w-4 h-4" /> Quiz
            </TabsTrigger>
          </TabsList>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === "listen" && (
                <ListenTab
                  hasConfirmed={hasConfirmed}
                  setHasConfirmed={setHasConfirmed}
                  costPreview={costPreview}
                  chunkIndex={chunkIndex}
                  totalChunks={totalChunks}
                  chunkText={chunkText}
                  isLoadingAudio={isLoadingAudio}
                  isTranslating={isTranslating}
                  translatedText={translatedText}
                  language={language}
                  chunkAlreadyPaid={chunkAlreadyPaid}
                />
              )}
              {activeTab === "visuals" && lesson.document_id && (
                <VisualsTab documentId={lesson.document_id} lessonId={lesson.id} subjectType={lesson.documents?.subject_type ?? null} />
              )}
              {activeTab === "quiz" && lesson.document_id && (
                <QuizTab documentId={lesson.document_id} />
              )}
            </motion.div>
          </AnimatePresence>
        </Tabs>

        {/* Persistent audio player */}
        {hasConfirmed && (
          <div className="fixed bottom-0 left-0 right-0 lg:left-64 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="max-w-7xl mx-auto p-3 md:p-4">
              {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">{fmt(currentTime)}</span>
                <Slider value={seekProgress} onValueChange={onSeek} max={100} step={0.5} className="flex-1" />
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">{fmt(duration)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground hidden sm:block">
                  Section <strong className="text-foreground">{chunkIndex + 1}</strong>/{totalChunks}
                  {language !== "en" && (
                    <span className="ml-2 inline-flex items-center gap-1">
                      <Languages className="w-3 h-3" /> {LANGS.find((l) => l.code === language)?.label}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-center gap-3 md:gap-4">
                  <button
                    onClick={() => goChunk(-1)}
                    disabled={chunkIndex === 0 || isLoadingAudio}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Previous section"
                  >
                    <SkipBack className="w-5 h-5" />
                  </button>
                  <button
                    onClick={togglePlay}
                    disabled={!audioUrl || isLoadingAudio}
                    className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-50"
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isLoadingAudio ? <Loader2 className="w-5 h-5 animate-spin" />
                      : isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                  </button>
                  <button
                    onClick={() => goChunk(1)}
                    disabled={chunkIndex >= totalChunks - 1 || isLoadingAudio}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Next section"
                  >
                    <SkipForward className="w-5 h-5" />
                  </button>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs tabular-nums">
                      <Gauge className="w-3.5 h-3.5" />
                      {playbackRate}x
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {SPEEDS.map((s) => (
                      <DropdownMenuItem key={s} onClick={() => setPlaybackRate(s)}>
                        {s}x {playbackRate === s && <Check className="w-3.5 h-3.5 ml-auto" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </AppLayout>
  );
}

// ===================== Listen Tab =====================
function ListenTab(props: {
  hasConfirmed: boolean;
  setHasConfirmed: (v: boolean) => void;
  costPreview: { total: number; paid: number; remaining: number; balance: number } | null;
  chunkIndex: number;
  totalChunks: number;
  chunkText: string;
  isLoadingAudio: boolean;
  isTranslating: boolean;
  translatedText: string | null;
  language: string;
  chunkAlreadyPaid: boolean;
}) {
  const {
    hasConfirmed, setHasConfirmed, costPreview, chunkIndex, totalChunks, chunkText,
    isLoadingAudio, isTranslating, translatedText, language, chunkAlreadyPaid,
  } = props;

  if (!hasConfirmed && costPreview) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <Coins className="w-6 h-6 text-primary mt-0.5 shrink-0" />
            <div className="flex-1">
              <h3 className="font-display font-semibold text-base mb-1">Ready to listen</h3>
              <p className="text-sm text-muted-foreground mb-3">
                This lesson has <strong className="text-foreground">{costPreview.total} sections</strong>.{" "}
                {costPreview.paid > 0 && (
                  <>You've already unlocked <strong className="text-foreground">{costPreview.paid}</strong>. </>
                )}
                Each new section costs <strong className="text-foreground">1 credit</strong>. Replays are free.
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="px-2 py-1 rounded-md bg-background border">
                  Full lesson: <strong>{costPreview.remaining} credits</strong>
                </span>
                <span className="px-2 py-1 rounded-md bg-background border">
                  Your balance: <strong>{costPreview.balance}</strong>
                </span>
              </div>
              <Button
                onClick={() => setHasConfirmed(true)}
                disabled={costPreview.balance < 1 && costPreview.paid === 0}
                className="mt-4"
              >
                <Play className="w-4 h-4 mr-1" />
                {costPreview.paid > 0 ? "Resume listening" : "Start listening (1 credit)"}
              </Button>
              {costPreview.balance < 1 && costPreview.paid === 0 && (
                <p className="text-xs text-destructive mt-2">
                  Insufficient credits. <Link to="/plans" className="underline">Top up</Link>
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6 min-h-[320px]">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h3 className="font-display font-semibold text-sm">
            Section {chunkIndex + 1} of {totalChunks}
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Coins className="w-3 h-3" />
            {chunkAlreadyPaid ? "Free replay" : "Next section costs 1 credit"}
          </div>
        </div>
        {isLoadingAudio ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Generating audio…
          </div>
        ) : isTranslating ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Translating section…
          </div>
        ) : (
          <p className="text-foreground/85 leading-relaxed text-base whitespace-pre-line max-w-prose">
            {language !== "en" && translatedText ? translatedText : chunkText}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ===================== Visuals Tab =====================
function VisualsTab({ documentId, lessonId, subjectType }: { documentId: string; lessonId: string; subjectType: string | null }) {
  const { toast } = useToast();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const isHumanities = HUMANITIES.has(subjectType ?? "");

  const signScenes = async (raw: Scene[]): Promise<Scene[]> => {
    if (raw.length === 0) return [];
    const paths = raw.map((s) => s.storage_path);
    const { data, error } = await supabase.storage.from("assets").createSignedUrls(paths, 3600);
    if (error) return raw;
    const byPath = new Map<string, string>();
    (data ?? []).forEach((d) => { if (d.signedUrl && !d.error) byPath.set(d.path ?? "", d.signedUrl); });
    return raw.map((s) => ({ ...s, signedUrl: byPath.get(s.storage_path) }));
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("image_assets")
      .select("id, scene_index, prompt_text, storage_path")
      .eq("document_id", documentId)
      .order("scene_index", { ascending: true });
    setScenes(await signScenes((data ?? []) as Scene[]));
    setLoading(false);
  }, [documentId]);

  useEffect(() => { load(); setActive(0); }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-visuals", {
        body: { lesson_id: lessonId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({
        title: data.reused ? "Loaded from cache" : "Visuals generated",
        description: data.reused ? "Free — already generated by another student." : `${data.scenes?.length ?? 0} scenes ready.`,
      });
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Generation failed", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  if (!isHumanities) {
    return (
      <Card className="border-warning/30 bg-warning/5">
        <CardContent className="p-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
          <div>
            <p className="text-sm font-medium">Visuals are available for novels and history only</p>
            <p className="text-xs text-muted-foreground mt-1">
              STEM lessons use a text + quiz format instead.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading scenes…
      </div>
    );
  }

  if (scenes.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-10 text-center">
          <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">No visuals yet</p>
          <p className="text-xs text-muted-foreground mb-4">
            Generate 4 illustrated scenes from this lesson.
          </p>
          <Button onClick={generate} disabled={generating} size="sm">
            {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Generate visuals
          </Button>
        </CardContent>
      </Card>
    );
  }

  const current = scenes[active];

  return (
    <div className="space-y-4">
      {/* Large viewer */}
      <Card className="overflow-hidden">
        <div className="relative aspect-[16/10] bg-muted">
          {current?.signedUrl ? (
            <motion.img
              key={current.id}
              src={current.signedUrl}
              alt={current.prompt_text}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ImageIcon className="w-12 h-12 text-muted-foreground" />
            </div>
          )}
          {/* Nav arrows */}
          {scenes.length > 1 && (
            <>
              <button
                onClick={() => setActive((i) => Math.max(0, i - 1))}
                disabled={active === 0}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/80 backdrop-blur flex items-center justify-center disabled:opacity-30 hover:bg-background"
                aria-label="Previous scene"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => setActive((i) => Math.min(scenes.length - 1, i + 1))}
                disabled={active === scenes.length - 1}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/80 backdrop-blur flex items-center justify-center disabled:opacity-30 hover:bg-background"
                aria-label="Next scene"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <Badge variant="secondary" className="text-[10px] mb-1">
              Scene {active + 1} of {scenes.length}
            </Badge>
            <p className="text-sm text-foreground/80 italic line-clamp-2">"{current?.prompt_text}"</p>
          </div>
          <Button onClick={generate} disabled={generating} variant="outline" size="sm">
            {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Regenerate
          </Button>
        </CardContent>
      </Card>

      {/* Thumbnail strip */}
      {scenes.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {scenes.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setActive(i)}
              className={`relative shrink-0 w-24 aspect-[16/10] rounded-md overflow-hidden border-2 transition-all ${
                i === active ? "border-primary shadow-md" : "border-transparent opacity-60 hover:opacity-100"
              }`}
              aria-label={`Scene ${i + 1}`}
            >
              {s.signedUrl ? (
                <img src={s.signedUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-muted" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ===================== Quiz Tab =====================
function QuizTab({ documentId }: { documentId: string }) {
  const { toast } = useToast();
  const [questions, setQuestions] = useState<QuizQ[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [completed, setCompleted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("quiz_assets")
      .select("quiz_json")
      .eq("document_id", documentId)
      .eq("difficulty", "medium")
      .maybeSingle();
    setQuestions(data ? (data.quiz_json as unknown as QuizQ[]) : null);
    setLoading(false);
  }, [documentId]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-quiz", {
        body: { document_id: documentId, difficulty: "medium" },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setQuestions(data.questions);
      setCurrent(0); setSelected(null); setAnswered(false); setScore(0); setCompleted(false);
      toast({
        title: data.reused ? "Loaded from cache" : "Quiz generated",
        description: data.reused ? "Free — already generated by another student." : `${data.questions.length} questions ready.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Quiz failed", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const restart = () => {
    setCurrent(0); setSelected(null); setAnswered(false); setScore(0); setCompleted(false);
  };

  const submit = () => {
    if (!questions || answered || !selected) return;
    setAnswered(true);
    if (selected === questions[current].correct_answer) setScore((s) => s + 1);
  };

  const next = () => {
    if (!questions) return;
    if (current < questions.length - 1) {
      setCurrent((c) => c + 1); setSelected(null); setAnswered(false);
    } else {
      setCompleted(true);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading quiz…
      </div>
    );
  }

  if (!questions) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-10 text-center">
          <Brain className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">No quiz yet for this lesson</p>
          <p className="text-xs text-muted-foreground mb-4">
            Generate 6 multiple-choice questions from the text.
          </p>
          <Button onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Generate quiz
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (completed) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <div className="text-5xl mb-3">{pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "📚"}</div>
          <h2 className="text-3xl font-display font-bold">{pct}%</h2>
          <p className="text-muted-foreground mt-1">{score} / {questions.length} correct</p>
          <p className="text-sm text-muted-foreground mt-1">
            {pct >= 80 ? "Excellent work!" : pct >= 50 ? "Good effort, keep practising!" : "Review the lesson and try again."}
          </p>
          <Button onClick={restart} className="mt-5 gap-2">
            <RotateCcw className="w-4 h-4" /> Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const q = questions[current];
  const isCorrect = selected === q.correct_answer;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground">
          Question {current + 1} of {questions.length}
        </span>
        <span className="text-xs text-muted-foreground">Score: {score}</span>
      </div>
      <Progress value={((current + 1) / questions.length) * 100} className="mb-5 h-2" />

      <Card>
        <CardContent className="p-6">
          <h2 className="text-base md:text-lg font-semibold mb-5">{q.question}</h2>
          <div className="space-y-2.5">
            {q.options.map((opt) => {
              let cls = "border-border hover:border-primary/40";
              if (answered && opt === q.correct_answer) cls = "border-success bg-success/10";
              else if (answered && opt === selected && !isCorrect) cls = "border-destructive bg-destructive/10";
              else if (selected === opt) cls = "border-primary bg-primary/5";
              return (
                <button
                  key={opt}
                  onClick={() => !answered && setSelected(opt)}
                  className={`w-full text-left p-3 rounded-lg border transition-all text-sm font-medium ${cls}`}
                >
                  {opt}
                </button>
              );
            })}
          </div>

          {answered && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-4 p-3 rounded-lg text-sm ${isCorrect ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}
            >
              <div className="flex items-center gap-2 font-medium">
                {isCorrect ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                {isCorrect ? "Correct!" : `The answer is: ${q.correct_answer}`}
              </div>
              {q.explanation && (
                <p className="mt-1.5 text-xs opacity-90">{q.explanation}</p>
              )}
            </motion.div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end mt-4 gap-2">
        {!answered ? (
          <Button onClick={submit} disabled={!selected}>Submit</Button>
        ) : (
          <Button onClick={next} className="gap-2">
            {current < questions.length - 1 ? "Next" : "See Results"}
          </Button>
        )}
      </div>
    </div>
  );
}
