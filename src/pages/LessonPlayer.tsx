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
import { CreditEstimator } from "@/components/CreditEstimator";
import { LowCreditNudge, HardCreditBlock } from "@/components/LowCreditNudge";
import { useDailyRewardContext } from "@/contexts/DailyRewardContext";
import { useProgressionContext } from "@/contexts/ProgressionContext";
import QuizBonusCard from "@/components/QuizBonusCard";
import { useLessonProgress } from "@/hooks/use-lesson-progress";
import StoryModeTab from "@/components/StoryModeTab";

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
  const { claim: claimDailyReward } = useDailyRewardContext();
  const { awardXp, flushLevelUp } = useProgressionContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listenRewardFired = useRef(false);
  const lastListenTickRef = useRef<number>(0);
  const totalListenedSecondsRef = useRef<number>(0);

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

  // Persist playback progress into dedicated lesson_progress table (throttled).
  const { update: updateLessonProgress, flush: flushLessonProgress } = useLessonProgress(lesson?.id ?? null);
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
  const [nudgeOpen, setNudgeOpen] = useState(false);

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
      if (audio.duration) {
        const sectionPct = audio.currentTime / audio.duration;
        setSeekProgress([sectionPct * 100]);

        // Accumulate "real" seconds listened (forward playback only — ignore seeks/jumps).
        const now = audio.currentTime;
        const last = lastListenTickRef.current;
        const delta = now - last;
        if (delta > 0 && delta < 2) {
          totalListenedSecondsRef.current += delta;
        }
        lastListenTickRef.current = now;

        // Overall lesson progress across all chunks
        const overallPct = ((chunkIndex + sectionPct) / Math.max(1, totalChunks)) * 100;
        const rewardEligible = overallPct >= 70;

        updateLessonProgress({
          audio_progress_pct: overallPct,
          last_position_seconds: Math.floor(audio.currentTime),
          audio_listened_seconds: Math.floor(totalListenedSecondsRef.current),
          sections_total: totalChunks,
          sections_completed: Math.max(0, chunkIndex),
          reward_eligible: rewardEligible,
        });

        if (!listenRewardFired.current && sectionPct >= 0.7) {
          listenRewardFired.current = true;
          claimDailyReward("listen");
        }
      }
    };
    const onLoad = () => setDuration(audio.duration);
    const onEnd = () => {
      setIsPlaying(false);

      const completedSections = Math.min(totalChunks, chunkIndex + 1);
      const isLastChunk = completedSections >= totalChunks;
      const overallPct = (completedSections / Math.max(1, totalChunks)) * 100;
      // Persist the section completion immediately (no throttle).
      updateLessonProgress({
        audio_progress_pct: overallPct,
        sections_completed: completedSections,
        sections_total: totalChunks,
        last_position_seconds: Math.floor(audio.currentTime),
        audio_listened_seconds: Math.floor(totalListenedSecondsRef.current),
        reward_eligible: overallPct >= 70,
      });
      flushLessonProgress();

      // Award section_complete XP (idempotent on lesson_id:chunk_index)
      if (lesson?.id) {
        awardXp("section_complete", {
          sourceKey: `${lesson.id}:${chunkIndex}`,
          metadata: { language },
        });
      }

      if (isLastChunk) {
        // Award lesson_complete XP (idempotent on lesson_id)
        if (lesson?.id) {
          awardXp("lesson_complete", { sourceKey: lesson.id }).then(() => {
            // Surface any queued level-up after the lesson naturally ends
            setTimeout(flushLevelUp, 600);
          });
        }
        return;
      }

      // Smart nudge: section just completed — best moment to convert.
      const remainingNeeded = costPreview ? costPreview.remaining : 0;
      const balance = costPreview?.balance ?? 0;
      if (remainingNeeded > 0 && balance < Math.max(1, Math.ceil(remainingNeeded * 0.3))) {
        setNudgeOpen(true);
        return; // pause auto-advance until user decides
      }
      // Smooth fade-out before advancing
      const fadeOut = () => new Promise<void>((resolve) => {
        const start = audio.volume;
        const steps = 8;
        let i = 0;
        const id = setInterval(() => {
          i += 1;
          audio.volume = Math.max(0, start * (1 - i / steps));
          if (i >= steps) { clearInterval(id); audio.volume = start; resolve(); }
        }, 30);
      });
      fadeOut().then(() => {
        const next = chunkIndex + 1;
        setChunkIndex(next);
        loadChunk(next, language).then(() => {
          setTimeout(() => audioRef.current?.play(), 200);
          setIsPlaying(true);
        });
        // After section transitions, if user just leveled up, surface modal
        setTimeout(flushLevelUp, 800);
      });
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoad);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoad);
      audio.removeEventListener("ended", onEnd);
    };
  }, [audioUrl, chunkIndex, totalChunks, language, loadChunk, playbackRate, costPreview, claimDailyReward, lesson?.id, awardXp, flushLevelUp, updateLessonProgress, flushLessonProgress]);

  // Reset the per-chunk listening tick when the audio source changes (new chunk).
  useEffect(() => {
    lastListenTickRef.current = 0;
  }, [audioUrl]);

  // Reset the listen reward fired flag when the chunk changes
  useEffect(() => {
    listenRewardFired.current = false;
  }, [chunkIndex, audioUrl]);

  // Reading reward: 60s of active page presence on the listen tab counts as "reading"
  useEffect(() => {
    if (activeTab !== "listen") return;
    let elapsed = 0;
    let lastTick = Date.now();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") {
        lastTick = Date.now();
        return;
      }
      const now = Date.now();
      elapsed += (now - lastTick) / 1000;
      lastTick = now;
      if (elapsed >= 60) {
        clearInterval(interval);
        claimDailyReward("reading");
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTab, claimDailyReward]);

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
    // Level 2: block forward into a locked section when balance can't cover it
    if (delta > 0 && costPreview && next >= costPreview.paid && costPreview.balance < 1) {
      setNudgeOpen(true);
      return;
    }
    setChunkIndex(next);
    setIsPlaying(false);
    loadChunk(next, language);
  };

  // Unlock next section from the nudge: load it, then auto-play
  const unlockNext = useCallback(async () => {
    const next = Math.min(totalChunks - 1, chunkIndex + 1);
    setChunkIndex(next);
    setIsPlaying(false);
    await loadChunk(next, language);
    setTimeout(() => {
      audioRef.current?.play();
      setIsPlaying(true);
    }, 250);
  }, [chunkIndex, totalChunks, language, loadChunk]);

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
              <ImageIcon className="w-4 h-4" /> Story Mode
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
                  documentId={lesson.document_id}
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
                <StoryModeTab documentId={lesson.document_id} lessonId={lesson.id} subjectType={lesson.documents?.subject_type ?? null} />
              )}
              {activeTab === "quiz" && lesson.document_id && (
                <QuizTab
                  documentId={lesson.document_id}
                  lessonId={lesson.id}
                  onFirstAnswer={() => claimDailyReward("quiz")}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </Tabs>

        {/* Smart nudge — bottom sheet */}
        <LowCreditNudge
          open={nudgeOpen}
          onClose={() => setNudgeOpen(false)}
          documentId={lesson.document_id}
          fromContext="audio"
          onUnlock={unlockNext}
          unlockCost={1}
        />

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
  documentId: string | null;
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
    documentId, hasConfirmed, setHasConfirmed, costPreview, chunkIndex, totalChunks, chunkText,
    isLoadingAudio, isTranslating, translatedText, language, chunkAlreadyPaid,
  } = props;

  const estimator = documentId ? (
    <div className="mb-4">
      <CreditEstimator documentId={documentId} variant="inline" fromContext="audio" />
    </div>
  ) : null;

  // Level 3: Hard block when out of credits and nothing unlocked yet
  if (!hasConfirmed && costPreview && costPreview.balance < 1 && costPreview.paid === 0) {
    return (
      <>
        {estimator}
        <HardCreditBlock documentId={documentId} fromContext="audio" />
      </>
    );
  }

  // Level 1: Soft warning — balance covers <30% of remaining cost
  const showSoftWarning =
    costPreview &&
    costPreview.remaining > 0 &&
    costPreview.balance > 0 &&
    costPreview.balance < Math.max(1, Math.ceil(costPreview.remaining * 0.3));

  const softWarning = showSoftWarning ? (
    <div className="mb-4 flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-primary/40 bg-primary/5">
      <Coins className="w-3.5 h-3.5 text-primary shrink-0" />
      <span className="text-foreground/80 flex-1">
        Low credits — you may run out before finishing this book.
      </span>
      <Link
        to={`/topup?from=audio${documentId ? `&doc=${documentId}` : ""}`}
        className="text-primary font-semibold hover:underline"
      >
        Top up →
      </Link>
    </div>
  ) : null;

  if (!hasConfirmed && costPreview) {
    return (
      <>
        {estimator}
        {softWarning}
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
            </div>
          </div>
        </CardContent>
      </Card>
      </>
    );
  }

  return (
    <>
      {estimator}
      {softWarning}
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
    </>
  );
}

// ===================== Quiz Tab =====================
function QuizTab({
  documentId,
  lessonId,
  onFirstAnswer,
}: {
  documentId: string;
  lessonId: string;
  onFirstAnswer?: () => void;
}) {
  const firstAnswerFired = useRef(false);
  const completionFired = useRef(false);
  const { toast } = useToast();
  const { awardXp, flushLevelUp } = useProgressionContext();
  const [questions, setQuestions] = useState<QuizQ[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [bonusAward, setBonusAward] = useState<{ credits: number; xp: number } | null>(null);
  const [attemptId, setAttemptId] = useState<string>(() => crypto.randomUUID());

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
    setBonusAward(null);
    completionFired.current = false;
    setAttemptId(crypto.randomUUID()); // new attempt → new idempotency key
  };

  const submit = () => {
    if (!questions || answered || !selected) return;
    setAnswered(true);
    if (selected === questions[current].correct_answer) setScore((s) => s + 1);
    if (!firstAnswerFired.current) {
      firstAnswerFired.current = true;
      onFirstAnswer?.();
    }
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

    // Award quiz_bonus exactly once per attempt (idempotent on attemptId)
    if (!completionFired.current) {
      completionFired.current = true;
      awardXp("quiz_bonus", {
        sourceKey: `${lessonId}:${attemptId}`,
        scorePct: pct,
        metadata: { score, total: questions.length },
      }).then((res) => {
        if (res && !res.duplicate) {
          setBonusAward({ credits: res.creditsAwarded, xp: res.xpAwarded });
          // Surface level-up after the user sees their result
          setTimeout(flushLevelUp, 1500);
        }
      });
    }

    return (
      <Card>
        <CardContent className="p-8 md:p-10 text-center">
          <div className="text-5xl mb-3">{pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "📚"}</div>
          <h2 className="text-3xl font-display font-bold">{pct}%</h2>
          <p className="text-muted-foreground mt-1">{score} / {questions.length} correct</p>
          <p className="text-sm text-muted-foreground mt-1">
            {pct >= 80 ? "Excellent work!" : pct >= 50 ? "Good effort, keep practising!" : "Review the lesson and try again."}
          </p>

          <div className="mt-5 max-w-sm mx-auto text-left">
            <QuizBonusCard scorePct={pct} awarded={bonusAward} />
          </div>

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
