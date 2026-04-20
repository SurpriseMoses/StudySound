import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, Pause, SkipBack, SkipForward, Loader2, Globe, ArrowLeft, Coins, RefreshCw, Languages } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import AppLayout from "@/components/AppLayout";
import { ProtectedTranslation } from "@/components/ProtectedTranslation";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { subjects } from "@/lib/subjects";

type Lesson = {
  id: string;
  title: string;
  subject: string;
  language: string | null;
  documents: { subject_type: string | null } | null;
};

const LANGS = [
  { code: "en", label: "English" },
  { code: "af", label: "Afrikaans" },
  { code: "zu", label: "isiZulu" },
  { code: "ts", label: "Xitsonga" },
  { code: "nso", label: "Sepedi" },
];

interface ListenProps {
  lessonId?: string;
  embedded?: boolean;
}

export default function Listen({ lessonId: lessonIdProp, embedded = false }: ListenProps = {}) {
  const params = useParams();
  const lessonId = lessonIdProp ?? params.lessonId;
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [language, setLanguage] = useState("en");
  const [chunkIndex, setChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(1);
  const [chunkText, setChunkText] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState([0]);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [costPreview, setCostPreview] = useState<{
    total: number;
    paid: number;
    remaining: number;
    balance: number;
  } | null>(null);
  const [hasConfirmed, setHasConfirmed] = useState(false);
  const [chunkAlreadyPaid, setChunkAlreadyPaid] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Translation state — driven by the same `language` selector that drives audio
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationCache, setTranslationCache] = useState<Record<string, string>>({});

  // Check admin role
  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(!!data);
    })();
  }, [user]);

  // Load lesson metadata
  useEffect(() => {
    if (!lessonId || !user) return;
    (async () => {
      const { data, error } = await supabase
        .from("lessons")
        .select("id, title, subject, language, documents(subject_type)")
        .eq("id", lessonId)
        .maybeSingle();
      if (error || !data) {
        toast({ title: "Lesson not found", variant: "destructive" });
        navigate("/library");
        return;
      }
      setLesson(data as Lesson);
      setLanguage(data.language ?? "en");
    })();
  }, [lessonId, user, navigate, toast]);

  // Fetch cost preview (no charge, no generation)
  const fetchCostPreview = async (lang: string) => {
    if (!lessonId) return;
    try {
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
    } catch {
      // silent
    }
  };

  // Fetch audio for current chunk
  const loadChunk = async (index: number, lang: string) => {
    if (!lessonId) return;
    setIsLoading(true);
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
        toast({ title: `1 credit charged`, description: `Section ${index + 1} unlocked — replays free.` });
        fetchCostPreview(lang);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load audio";
      toast({ title: "Audio failed", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // Load preview when lesson ready or language changes
  useEffect(() => {
    if (!lesson) return;
    setChunkIndex(0);
    setHasConfirmed(false);
    setAudioUrl(null);
    setChunkText("");
    fetchCostPreview(language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id, language]);

  // Once user confirms, load the first chunk
  useEffect(() => {
    if (!lesson || !hasConfirmed) return;
    loadChunk(0, language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasConfirmed]);

  // Audio element handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) setProgress([(audio.currentTime / audio.duration) * 100]);
    };
    const onLoad = () => setDuration(audio.duration);
    const onEnd = () => {
      setIsPlaying(false);
      // Auto-advance
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
  }, [audioUrl, chunkIndex, totalChunks, language]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play();
      setIsPlaying(true);
    }
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
    setProgress(val);
  };

  const fmt = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  // Admin: clear cached audio for current chunk and re-render
  const regenerateChunk = async () => {
    if (!lessonId || !isAdmin) return;
    setIsRegenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("regenerate-audio-chunk", {
        body: { lesson_id: lessonId, chunk_index: chunkIndex, language },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error ?? "Failed");
      toast({ title: "Cache cleared", description: `${data.deleted_rows} row(s) removed. Reloading…` });
      setIsPlaying(false);
      await loadChunk(chunkIndex, language);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to regenerate";
      toast({ title: "Regenerate failed", description: msg, variant: "destructive" });
    } finally {
      setIsRegenerating(false);
    }
  };

  const subjectName = subjects.find((s) => s.id === lesson?.subject)?.name ?? lesson?.subject;

  // Lazy-load translation for the currently visible chunk only — driven by the audio language picker
  useEffect(() => {
    if (language === "en") {
      setTranslatedText(null);
      return;
    }
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
        if (data.credits_charged > 0) {
          toast({
            title: `1 credit charged`,
            description: `Translation unlocked for section ${chunkIndex + 1} — replays free.`,
          });
        }
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

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    embedded ? <>{children}</> : <AppLayout>{children}</AppLayout>;

  return (
    <Wrapper>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        {!embedded && (
          <Link to="/library" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="w-4 h-4 mr-1" /> Library
          </Link>
        )}

        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-3">
          <div>
            {!embedded && <h1 className="text-2xl font-display font-bold">{lesson?.title ?? "Loading…"}</h1>}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-muted-foreground text-sm">{subjectName}</p>
              {lesson?.documents?.subject_type && (
                (() => {
                  const isStory = lesson.documents.subject_type === "novel";
                  return (
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                        isStory
                          ? "bg-primary/10 text-primary border-primary/30"
                          : "bg-muted text-foreground/70 border-border"
                      }`}
                      title={isStory
                        ? "Story Mode: slower, expressive narration for novels"
                        : "Study Mode: clear, focused narration for textbooks & notes"}
                    >
                      {isStory ? "📖 Story Mode" : "🎓 Study Mode"}
                    </span>
                  );
                })()
              )}
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

        {/* Cost preview gate — shown until user confirms first play */}
        {!hasConfirmed && costPreview && (
          <Card className="mb-4 border-primary/30 bg-primary/5">
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
                    Each new section costs <strong className="text-foreground">1 credit</strong> and is free on replay.
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
        )}

        {hasConfirmed && (
          <Card className="mb-4">
            <CardContent className="p-5 min-h-[200px]">
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <h3 className="font-display font-semibold text-sm">
                  Section {chunkIndex + 1} of {totalChunks}
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {language !== "en" && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Languages className="w-3 h-3" />
                      Translated to {LANGS.find((l) => l.code === language)?.label ?? language}
                    </span>
                  )}
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={regenerateChunk}
                      disabled={isRegenerating || isLoading}
                      className="h-7 text-xs"
                    >
                      {isRegenerating ? (
                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      ) : (
                        <RefreshCw className="w-3 h-3 mr-1" />
                      )}
                      Regenerate
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Coins className="w-3 h-3" />
                    {chunkAlreadyPaid ? "Free replay" : "1 credit"}
                  </span>
                </div>
              </div>
              {isLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Generating audio…
                </div>
              ) : isTranslating ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Translating section…
                </div>
      ) : language !== "en" && translatedText ? (
                <ProtectedTranslation
                  text={translatedText}
                  className="text-foreground/80 leading-relaxed text-sm whitespace-pre-line outline-none"
                />
              ) : (
                <p className="text-foreground/80 leading-relaxed text-sm whitespace-pre-line">
                  {chunkText}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {hasConfirmed && (
          <Card className="sticky bottom-4 border-primary/20 shadow-lg">
            <CardContent className="p-4">
              {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}
              <Slider value={progress} onValueChange={onSeek} max={100} step={0.5} className="mb-2" />
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                <span>{fmt(currentTime)}</span>
                <span>{fmt(duration)}</span>
              </div>
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={() => goChunk(-1)}
                  disabled={chunkIndex === 0 || isLoading}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <SkipBack className="w-5 h-5" />
                </button>
                <button
                  onClick={togglePlay}
                  disabled={!audioUrl || isLoading}
                  className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                </button>
                <button
                  onClick={() => goChunk(1)}
                  disabled={chunkIndex >= totalChunks - 1 || isLoading}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <SkipForward className="w-5 h-5" />
                </button>
              </div>
            </CardContent>
          </Card>
        )}
      </motion.div>
    </Wrapper>
  );
}
