import { useState, useRef, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, Pause, SkipBack, SkipForward, Volume2, ArrowRight, Sparkles, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";

const SAMPLE_AUDIO_URL = "/preview-audio.mp3";

function formatTime(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const sampleText = `It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness. Charles Darnay and Sydney Carton stood in the courtroom, their fates intertwined in ways neither could yet fathom.

The fog crept through the streets of London like a living thing, wrapping itself around lampposts and doorways. In the Tellson's Bank, the clerks bent over their ledgers, scratching away with quill pens.

"It is a far, far better thing that I do, than I have ever done," Carton whispered to himself, staring out at the grey Thames below.`;

export default function Preview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [params] = useSearchParams();
  const docId = params.get("doc");
  const [audioSrc, setAudioSrc] = useState<string>(SAMPLE_AUDIO_URL);
  const [previewLabel, setPreviewLabel] = useState<string>("Sample audio");
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState([0]);
  const [speed, setSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // If a document_id is provided, try to load its pre-generated preview audio.
  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.functions.invoke("generate-audio", {
        body: { document_id: docId, chunk_index: 0, preview: true },
      });
      if (cancelled) return;
      if (!error && data?.success && data.audio_url) {
        setAudioSrc(data.audio_url);
        setPreviewLabel("Cached preview");
      } else {
        setPreviewLabel("Preview not available — playing sample");
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) setProgress([(audio.currentTime / audio.duration) * 100]);
    };
    const onLoaded = () => setDuration(audio.duration || 0);
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        await audio.play();
        setIsPlaying(true);
      }
    } catch (e) {
      console.error("Audio play failed", e);
    }
  };

  const onSeek = (val: number[]) => {
    setProgress(val);
    const audio = audioRef.current;
    if (audio && audio.duration) {
      audio.currentTime = (val[0] / 100) * audio.duration;
    }
  };

  const skip = (delta: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = Math.max(0, Math.min((audio.duration || 0), audio.currentTime + delta));
  };

  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 bg-background/90 backdrop-blur border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="font-display font-bold">StudySound</span>
          </Link>
          <Link to="/onboarding">
            <Button size="sm" className="gap-2">Sign Up <ArrowRight className="w-3.5 h-3.5" /></Button>
          </Link>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="bg-primary/10 text-primary text-sm font-medium px-3 py-1.5 rounded-full inline-flex items-center gap-2 mb-4">
            🎧 Free Trial Preview
          </div>
          <h1 className="text-3xl md:text-4xl font-display font-bold">A Tale of Two Cities</h1>
          <p className="text-muted-foreground mt-2">by Charles Dickens — Chapter 1 Preview</p>
        </motion.div>

        <div className="grid lg:grid-cols-5 gap-6 mt-8">
          {/* Text panel */}
          <div className="lg:col-span-3 space-y-5">
            <Card>
              <CardContent className="p-6">
                <h3 className="font-display font-semibold mb-4">📖 Chapter Text</h3>
                <div className="prose prose-sm max-w-none text-foreground/85 leading-relaxed whitespace-pre-line">
                  {sampleText}
                </div>
              </CardContent>
            </Card>

            {/* Audio Player */}
            <Card className="border-primary/20">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-display font-semibold text-sm">🎧 AI Narration</h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <button
                      onClick={() => setSpeed(s => s === 2 ? 0.5 : s + 0.25)}
                      className="px-2 py-1 rounded bg-muted hover:bg-muted/80 font-medium"
                    >
                      {speed}x
                    </button>
                    <Volume2 className="w-4 h-4" />
                  </div>
                </div>
                <audio ref={audioRef} src={SAMPLE_AUDIO_URL} preload="metadata" />
                <Slider value={progress} onValueChange={onSeek} max={100} step={0.1} className="mb-3" />
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
                <div className="flex items-center justify-center gap-4">
                  <button onClick={() => skip(-10)} className="text-muted-foreground hover:text-foreground"><SkipBack className="w-5 h-5" /></button>
                  <button
                    onClick={togglePlay}
                    className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition"
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                  </button>
                  <button onClick={() => skip(10)} className="text-muted-foreground hover:text-foreground"><SkipForward className="w-5 h-5" /></button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Visual Scene */}
          <div className="lg:col-span-2 space-y-5">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Image className="w-4 h-4 text-secondary" />
                  <h3 className="font-display font-semibold text-sm">AI Visual Scene</h3>
                </div>
                <div className="aspect-[4/3] rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                  <div className="text-center p-6">
                    <div className="text-4xl mb-3">🌫️🏙️</div>
                    <p className="text-sm text-muted-foreground font-medium">London fog scene</p>
                    <p className="text-xs text-muted-foreground mt-1">AI-generated preview</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3 italic">
                  "The fog crept through the streets of London like a living thing..."
                </p>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-5 text-center">
                <h3 className="font-display font-semibold mb-2">Unlock Full Access</h3>
                <p className="text-sm text-muted-foreground mb-4">Get AI narration, visuals & quizzes for all your subjects</p>
                <Link to="/onboarding">
                  <Button className="w-full gap-2">
                    Get Started <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
