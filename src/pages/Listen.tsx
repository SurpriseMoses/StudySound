import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, Pause, SkipBack, SkipForward, Loader2, Globe, ArrowLeft, Coins, Mic2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { subjects } from "@/lib/subjects";

type NarrationStyle = "auto" | "calm" | "dramatic" | "cheerful" | "serious";
type Lesson = { id: string; title: string; subject: string; language: string | null; narration_style: NarrationStyle | null };

const LANGS = [
  { code: "en", label: "English" },
  { code: "af", label: "Afrikaans" },
  { code: "zu", label: "isiZulu" },
  { code: "xh", label: "isiXhosa" },
  { code: "fr", label: "French" },
];

const STYLES: { code: NarrationStyle; label: string; hint: string }[] = [
  { code: "auto", label: "Auto", hint: "Match the subject" },
  { code: "calm", label: "Calm", hint: "Relaxed, slow" },
  { code: "dramatic", label: "Dramatic", hint: "Expressive storytelling" },
  { code: "cheerful", label: "Cheerful", hint: "Bright and warm" },
  { code: "serious", label: "Serious", hint: "Clear and focused" },
];

export default function Listen() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [language, setLanguage] = useState("en");
  const [narrationStyle, setNarrationStyle] = useState<NarrationStyle>("auto");
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

  // Load lesson metadata
  useEffect(() => {
    if (!lessonId || !user) return;
    (async () => {
      const { data, error } = await supabase
        .from("lessons")
        .select("id, title, subject, language, narration_style")
        .eq("id", lessonId)
        .maybeSingle();
      if (error || !data) {
        toast({ title: "Lesson not found", variant: "destructive" });
        navigate("/library");
        return;
      }
      setLesson(data as Lesson);
      setLanguage(data.language ?? "en");
      setNarrationStyle((data.narration_style as NarrationStyle) ?? "auto");
    })();
  }, [lessonId, user, navigate, toast]);

  // Fetch cost preview (no charge, no generation)
  const fetchCostPreview = async (lang: string, style: NarrationStyle) => {
    if (!lessonId) return;
    try {
      const { data, error } = await supabase.functions.invoke("generate-audio", {
        body: { lesson_id: lessonId, language: lang, narration_style: style, preview_only: true },
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
  const loadChunk = async (index: number, lang: string, style: NarrationStyle) => {
    if (!lessonId) return;
    setIsLoading(true);
    setAudioUrl(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-audio", {
        body: { lesson_id: lessonId, chunk_index: index, language: lang, narration_style: style },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error ?? "Failed");
      setAudioUrl(data.audio_url);
      setChunkText(data.text);
      setTotalChunks(data.total_chunks);
      setChunkAlreadyPaid(data.credits_charged === 0);
      if (data.credits_charged > 0) {
        toast({ title: `1 credit charged`, description: `Section ${index + 1} unlocked — replays free.` });
        fetchCostPreview(lang, style);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load audio";
      toast({ title: "Audio failed", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // Persist style change to lesson
  const handleStyleChange = async (next: NarrationStyle) => {
    setNarrationStyle(next);
    if (lessonId) {
      await supabase.from("lessons").update({ narration_style: next }).eq("id", lessonId);
    }
  };

  // Load preview when lesson ready or language/style changes
  useEffect(() => {
    if (!lesson) return;
    setChunkIndex(0);
    setHasConfirmed(false);
    setAudioUrl(null);
    setChunkText("");
    fetchCostPreview(language, narrationStyle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id, language, narrationStyle]);

  // Once user confirms, load the first chunk
  useEffect(() => {
    if (!lesson || !hasConfirmed) return;
    loadChunk(0, language, narrationStyle);
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

  const subjectName = subjects.find((s) => s.id === lesson?.subject)?.name ?? lesson?.subject;

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Link to="/library" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Library
        </Link>

        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-3">
          <div>
            <h1 className="text-2xl font-display font-bold">{lesson?.title ?? "Loading…"}</h1>
            <p className="text-muted-foreground text-sm">{subjectName}</p>
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
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display font-semibold text-sm">
                  Section {chunkIndex + 1} of {totalChunks}
                </h3>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Coins className="w-3 h-3" />
                  {chunkAlreadyPaid ? "Free replay" : "1 credit"}
                </span>
              </div>
              {isLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Generating audio…
                </div>
              ) : (
                <p className="text-foreground/80 leading-relaxed text-sm whitespace-pre-line">{chunkText}</p>
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
    </AppLayout>
  );
}
