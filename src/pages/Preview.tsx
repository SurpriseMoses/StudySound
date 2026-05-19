import { useState, useRef, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import PreviewHero from "@/components/preview/PreviewHero";
import PreviewAudioPlayer from "@/components/preview/PreviewAudioPlayer";
import PreviewScene from "@/components/preview/PreviewScene";
import SceneStrip from "@/components/preview/SceneStrip";
import UnlockSection from "@/components/preview/UnlockSection";
import QuizTeaser from "@/components/preview/QuizTeaser";
import PreviewFinalCta from "@/components/preview/PreviewFinalCta";

// Default seeded document for the public Free Preview ("A Tale of Two Cities — Ch. 1").
const DEFAULT_PREVIEW_DOC_ID = "11111111-1111-1111-1111-111111111111";

const sampleText = `It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness. The fog crept through the streets of London like a living thing, wrapping itself around lampposts and doorways.

In the courtroom, Charles Darnay and Sydney Carton stood as their fates entwined — neither yet aware of the sacrifice that would bind them.`;

const SCENE_CAPTION =
  "The fog crept through the streets of London like a living thing, wrapping itself around lampposts and doorways.";

export default function Preview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const [params] = useSearchParams();
  const docId = params.get("doc") ?? DEFAULT_PREVIEW_DOC_ID;
  const [audioSrc, setAudioSrc] = useState<string>("");
  const [previewLabel, setPreviewLabel] = useState<string>("Loading…");
  const [isLoadingAudio, setIsLoadingAudio] = useState<boolean>(true);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState([0]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingAudio(true);
    setAudioError(null);
    setPreviewLabel("Generating audio…");
    (async () => {
      const { data, error } = await supabase.functions.invoke("generate-audio", {
        body: {
          document_id: docId,
          chunk_index: 0,
          language: "en",
          speaking_style: "general",
          preview: true,
          preview_mode: true,
        },
      });
      if (cancelled) return;
      if (!error && data?.success && data.audio_url) {
        const label = data.cache_state === "Cached" ? "Cached preview" : "Generated preview";
        if (data.cache_state === "Cached") {
          console.log("Preview audio: cache hit");
        } else {
          console.log("Preview audio: saved to cache");
        }
        setAudioSrc(data.audio_url);
        setPreviewLabel(label);
        setIsLoadingAudio(false);
      } else {
        const msg = (data as { error?: string } | null)?.error ?? error?.message ?? "Audio not available";
        console.error("Preview audio failed:", msg);
        setAudioError(msg);
        setPreviewLabel("Audio unavailable");
        setIsLoadingAudio(false);
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
    const audio = audioRef.current;
    if (!audio) return;
    setIsPlaying(false);
    audio.load();
  }, [audioSrc]);

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

  const scrollToPlayer = () => {
    playerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => { void togglePlay(); }, 400);
  };

  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 bg-background/85 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="font-display font-bold">StudySound</span>
          </Link>
          <Link to="/onboarding">
            <Button size="sm" className="gap-2">
              Sign Up <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-12 md:py-16 space-y-14 md:space-y-20">
        {/* HERO */}
        <PreviewHero title="A Tale of Two Cities" onPlay={scrollToPlayer} />

        {/* VISUAL SCENE — main focus */}
        <section>
          <PreviewScene
            sceneNumber={1}
            sceneTitle="London fog"
            caption={SCENE_CAPTION}
          />
        </section>

        {/* SCENE PROGRESSION */}
        <section>
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="font-display font-semibold text-lg">Scene progression</h2>
              <p className="text-sm text-muted-foreground">1 of 10+ scenes available in preview</p>
            </div>
            <span className="text-xs text-muted-foreground">25% explored</span>
          </div>
          <SceneStrip />
        </section>

        {/* AUDIO + UNLOCK */}
        <section ref={playerRef} className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <PreviewAudioPlayer
              ref={audioRef}
              audioSrc={audioSrc}
              isPlaying={isPlaying}
              isLoading={isLoadingAudio}
              error={audioError}
              progress={progress}
              currentTime={currentTime}
              duration={duration}
              previewLabel={previewLabel}
              onTogglePlay={togglePlay}
              onSeek={onSeek}
              onSkip={skip}
            />

            <Card>
              <CardContent className="p-6">
                <h3 className="font-display font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">
                  Chapter excerpt
                </h3>
                <div className="prose prose-sm max-w-none text-foreground/85 leading-relaxed whitespace-pre-line">
                  {sampleText}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <UnlockSection />
            <QuizTeaser />
          </div>
        </section>

        {/* FINAL CTA */}
        <PreviewFinalCta />
      </main>
    </div>
  );
}
