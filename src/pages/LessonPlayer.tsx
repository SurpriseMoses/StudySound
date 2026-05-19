import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Headphones, Brain, Image as ImageIcon, Loader2, Globe, Coins,
  Sparkles, Check, X, RotateCcw, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { subjects } from "@/lib/subjects";
import { CreditEstimator } from "@/components/CreditEstimator";
import { useDailyRewardContext } from "@/contexts/DailyRewardContext";
import { useProgressionContext } from "@/contexts/ProgressionContext";
import QuizBonusCard from "@/components/QuizBonusCard";
import { useLessonProgress } from "@/hooks/use-lesson-progress";
import StoryModeTab from "@/components/StoryModeTab";
import { AudioSection } from "@/components/AudioSection";

const LANGS = [
  { code: "en", label: "English" },
  { code: "af", label: "Afrikaans" },
  { code: "zu", label: "isiZulu" },
  { code: "xh", label: "isiXhosa" },
  { code: "nso", label: "Sepedi" },
  { code: "tn", label: "Setswana" },
  { code: "ts", label: "Xitsonga" },
];

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

  const tabParam = searchParams.get("tab") as Tab | null;
  const activeTab: Tab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "listen";

  // ---------- Lesson resolution ----------
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    if (!documentId || !user) return;
    (async () => {
      setResolving(true);
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

  // ---------- Shared language + chunk navigation ----------
  const [language, setLanguage] = useState("en");
  const [chunkIndex, setChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(1);
  const [chunkText, setChunkText] = useState("");

  // Persist progress
  const { update: updateLessonProgress, flush: flushLessonProgress } = useLessonProgress(lesson?.id ?? null);

  // Reward tracking refs
  const listenRewardFired = useRef(false);
  const totalListenedSecondsRef = useRef(0);
  const lastTickRef = useRef(0);

  useEffect(() => {
    // Reset chunk + reward state on language / lesson change
    setChunkIndex(0);
    setChunkText(""); // clear stale text so previous-language text doesn't bleed into the new card
    listenRewardFired.current = false;
    lastTickRef.current = 0;
  }, [language, lesson?.id]);

  useEffect(() => {
    // Reset per-chunk reward flag whenever the section changes
    setChunkText(""); // clear stale text immediately on chunk change
    listenRewardFired.current = false;
    lastTickRef.current = 0;
  }, [chunkIndex]);

  // Reading reward: 60s of active listen-tab presence
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

  // ---------- Audio progress callbacks (per-chunk via AudioSection) ----------
  const handleAudioProgress = useCallback(
    (current: number, duration: number) => {
      if (!duration || !lesson?.id) return;
      const sectionPct = current / duration;

      // Accumulate forward-played seconds (ignore seeks > 2s jumps)
      const delta = current - lastTickRef.current;
      if (delta > 0 && delta < 2) {
        totalListenedSecondsRef.current += delta;
      }
      lastTickRef.current = current;

      const overallPct = ((chunkIndex + sectionPct) / Math.max(1, totalChunks)) * 100;

      updateLessonProgress({
        audio_progress_pct: overallPct,
        last_position_seconds: Math.floor(current),
        audio_listened_seconds: Math.floor(totalListenedSecondsRef.current),
        sections_total: totalChunks,
        sections_completed: Math.max(0, chunkIndex),
        reward_eligible: overallPct >= 70,
      });

      if (!listenRewardFired.current && sectionPct >= 0.7) {
        listenRewardFired.current = true;
        claimDailyReward("listen");
      }
    },
    [lesson?.id, chunkIndex, totalChunks, updateLessonProgress, claimDailyReward],
  );

  const handleChunkEnded = useCallback(() => {
    if (!lesson?.id) return;
    const completedSections = Math.min(totalChunks, chunkIndex + 1);
    const isLastChunk = completedSections >= totalChunks;
    const overallPct = (completedSections / Math.max(1, totalChunks)) * 100;

    updateLessonProgress({
      audio_progress_pct: overallPct,
      sections_completed: completedSections,
      sections_total: totalChunks,
      audio_listened_seconds: Math.floor(totalListenedSecondsRef.current),
      reward_eligible: overallPct >= 70,
    });
    flushLessonProgress();

    awardXp("section_complete", {
      sourceKey: `${lesson.id}:${chunkIndex}`,
      metadata: { language },
    });

    if (isLastChunk) {
      awardXp("lesson_complete", { sourceKey: lesson.id }).then(() => {
        setTimeout(flushLevelUp, 600);
      });
      return;
    }

    // Auto-advance to next chunk
    setChunkIndex((i) => Math.min(totalChunks - 1, i + 1));
    setTimeout(flushLevelUp, 800);
  }, [lesson?.id, chunkIndex, totalChunks, language, updateLessonProgress, flushLessonProgress, awardXp, flushLevelUp]);

  const goChunk = (delta: number) => {
    const next = Math.max(0, Math.min(totalChunks - 1, chunkIndex + delta));
    if (next !== chunkIndex) setChunkIndex(next);
  };

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
            <LanguagePickerWithHint
              language={language}
              onChange={setLanguage}
            />

          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={onTabChange}>
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
                  lessonId={lesson.id}
                  documentId={lesson.document_id}
                  language={language}
                  chunkIndex={chunkIndex}
                  totalChunks={totalChunks}
                  chunkText={chunkText}
                  goChunk={goChunk}
                  onMeta={({ text, totalChunks: t }) => {
                    setChunkText(text);
                    setTotalChunks(t);
                  }}
                  onProgress={handleAudioProgress}
                  onChunkEnded={handleChunkEnded}
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
      </motion.div>
    </AppLayout>
  );
}

// ===================== Listen Tab =====================
function ListenTab(props: {
  lessonId: string;
  documentId: string | null;
  language: string;
  chunkIndex: number;
  totalChunks: number;
  chunkText: string;
  goChunk: (delta: number) => void;
  onMeta: (m: { text: string; totalChunks: number }) => void;
  onProgress: (current: number, duration: number) => void;
  onChunkEnded: () => void;
}) {
  const {
    lessonId, documentId, language, chunkIndex, totalChunks, chunkText, goChunk, onMeta,
    onProgress, onChunkEnded,
  } = props;

  return (
    <>
      {documentId && (
        <div className="mb-4">
          <CreditEstimator documentId={documentId} variant="inline" fromContext="audio" />
        </div>
      )}
      <Card>
        <CardContent className="p-6 space-y-4 min-h-[320px]">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-display font-semibold text-sm">
              Section {chunkIndex + 1} of {totalChunks}
            </h3>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => goChunk(-1)}
                disabled={chunkIndex === 0}
                className="h-7 w-7"
                aria-label="Previous"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => goChunk(1)}
                disabled={chunkIndex >= totalChunks - 1}
                className="h-7 w-7"
                aria-label="Next"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {chunkText && (
            <p className="text-foreground/85 leading-relaxed text-base whitespace-pre-line max-w-prose">
              {chunkText}
            </p>
          )}

          <AudioSection
            key={`${lessonId}-${chunkIndex}-${language}`}
            lessonId={lessonId}
            chunkIndex={chunkIndex}
            totalChunks={totalChunks}
            language={language}
            onMeta={onMeta}
            onProgress={onProgress}
            onChunkEnded={onChunkEnded}
            onSeekChunk={goChunk}
          />

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
    setAttemptId(crypto.randomUUID());
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

    if (!completionFired.current) {
      completionFired.current = true;
      awardXp("quiz_bonus", {
        sourceKey: `${lessonId}:${attemptId}`,
        scorePct: pct,
        metadata: { score, total: questions.length },
      }).then((res) => {
        if (res && !res.duplicate) {
          setBonusAward({ credits: res.creditsAwarded, xp: res.xpAwarded });
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

// ===================== Language picker with first-time "Translate +2" hint =====================
function LanguagePickerWithHint({
  language,
  onChange,
}: {
  language: string;
  onChange: (lang: string) => void;
}) {
  // Show hint until the user has switched to a non-English language at least once.
  const [hasTranslated, setHasTranslated] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("has_translated_once") === "1";
  });
  const [showHint, setShowHint] = useState(false);
  const [fading, setFading] = useState(false);

  // Pulse the hint on mount (and re-pulse periodically) until they translate once.
  useEffect(() => {
    if (hasTranslated) return;
    let fadeTimer: ReturnType<typeof setTimeout>;
    let hideTimer: ReturnType<typeof setTimeout>;
    const cycle = () => {
      setShowHint(true);
      setFading(false);
      fadeTimer = setTimeout(() => setFading(true), 2500);
      hideTimer = setTimeout(() => setShowHint(false), 3000);
    };
    cycle();
    const interval = setInterval(cycle, 12000);
    return () => {
      clearInterval(interval);
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [hasTranslated]);

  const handleChange = (next: string) => {
    if (next !== "en" && !hasTranslated) {
      localStorage.setItem("has_translated_once", "1");
      setHasTranslated(true);
      setShowHint(false);
    }
    onChange(next);
  };

  return (
    <div className="relative flex items-center gap-2">
      {showHint && !hasTranslated && (
        <div
          role="status"
          aria-live="polite"
          className={`hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-primary text-[11px] font-semibold shadow-sm transition-opacity duration-500 ${
            fading ? "opacity-0" : "opacity-100 animate-pulse"
          }`}
        >
          <Sparkles className="w-3 h-3" />
          Translate +2
        </div>
      )}
      <Select value={language} onValueChange={handleChange}>
        <SelectTrigger className="w-40">
          <Globe className="w-4 h-4 mr-1" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LANGS.map((l) => (
            <SelectItem key={l.code} value={l.code}>
              {l.label}
              {l.code !== "en" && (
                <span className="ml-2 text-[10px] text-muted-foreground">+2/sec</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
