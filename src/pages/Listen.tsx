import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, Pause, SkipBack, SkipForward, Loader2, Globe, ArrowLeft, Coins } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { subjects } from "@/lib/subjects";

type Lesson = { id: string; title: string; subject: string; language: string | null };

const LANGS = [
  { code: "en", label: "English" },
  { code: "af", label: "Afrikaans" },
  { code: "zu", label: "isiZulu" },
  { code: "xh", label: "isiXhosa" },
  { code: "fr", label: "French" },
];

export default function Listen() {
  const { lessonId } = useParams();
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

  // Load lesson metadata
  useEffect(() => {
    if (!lessonId || !user) return;
    (async () => {
      const { data, error } = await supabase
        .from("lessons")
        .select("id, title, subject, language")
        .eq("id", lessonId)
        .maybeSingle();
      if (error || !data) {
        toast({ title: "Lesson not found", variant: "destructive" });
        navigate("/library");
        return;
      }
      setLesson(data);
      setLanguage(data.language ?? "en");
    })();
  }, [lessonId, user, navigate, toast]);

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
        // refresh preview so balance + paid count update
        fetchCostPreview(lang);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load audio";
      toast({ title: "Audio failed", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // Load first chunk when lesson ready or language changes
  useEffect(() => {
    if (!lesson) return;
    setChunkIndex(0);
    loadChunk(0, language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.id, language]);

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

        <Card className="mb-4">
          <CardContent className="p-5 min-h-[200px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-sm">
                Section {chunkIndex + 1} of {totalChunks}
              </h3>
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
      </motion.div>
    </AppLayout>
  );
}
