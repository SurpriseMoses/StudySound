import { useState, useRef, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import PreviewHero from "@/components/preview/PreviewHero";
import PreviewAudioPlayer from "@/components/preview/PreviewAudioPlayer";
import UnlockSection from "@/components/preview/UnlockSection";
import QuizTeaser from "@/components/preview/QuizTeaser";
import PreviewFinalCta from "@/components/preview/PreviewFinalCta";
import { macbethPreview } from "@/lib/macbeth-preview";
import UploadedVideoPlayer from "@/components/UploadedVideoPlayer";

export default function Preview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const [params] = useSearchParams();
  const docId = params.get("doc") ?? macbethPreview.documentId;
  const [audioSrc, setAudioSrc] = useState<string>("");
  const [previewLabel, setPreviewLabel] = useState<string>("Loading…");
  const [isLoadingAudio, setIsLoadingAudio] = useState<boolean>(true);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState([0]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videos, setVideos] = useState<{ id: string; title: string; url: string }[]>([]);

  useEffect(() => {
    // Visitor preview videos are admin-uploaded finished videos (e.g. MagicLight)
    // stored in a private bucket; anonymous visitors get short-lived signed links.
    // Feature the ?doc= book when it has videos; otherwise feature the book with
    // the most recently uploaded preview video.
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("preview_videos")
        .select("id, document_id, title, book_title, storage_path")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      const rows = data ?? [];
      if (!rows.length || cancelled) { if (!cancelled) setVideos([]); return; }
      const fallbackDoc = rows[0].document_id as string;
      const featuredDoc = rows.some((r) => r.document_id === docId) ? docId : fallbackDoc;
      const featured = rows.filter((r) => r.document_id === featuredDoc);
      const { data: signed } = await supabase.storage
        .from("preview-videos")
        .createSignedUrls(featured.map((r) => r.storage_path), 3600);
      const map = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
      if (!cancelled) {
        setVideos(featured
          .map((r) => ({ id: r.id, title: r.book_title ? `${r.book_title} — ${r.title}` : r.title, url: map.get(r.storage_path) ?? "" }))
          .filter((v) => v.url));
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  useEffect(() => {
    // Free preview uses a pre-recorded real narration clip — no live generation
    // (avoids provider cost and failures for anonymous visitors).
    setAudioSrc(macbethPreview.audioUrl);
    setPreviewLabel("Macbeth · English");
    setAudioError(null);
    setIsLoadingAudio(false);
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
    const onError = () => {
      setIsPlaying(false);
      setAudioError("The Macbeth narration could not load. Please refresh and try again.");
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
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
            <span className="font-display font-bold">BrainGrasp</span>
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
        <PreviewHero title={macbethPreview.title} onPlay={scrollToPlayer} />

        {/* WATCH THE STORY — admin-uploaded finished videos */}
        {videos.length > 0 && (
          <section className="space-y-4">
            <div>
              <h2 className="font-display font-semibold text-lg">Watch the story</h2>
              <p className="text-sm text-muted-foreground">A finished video preview — free, no sign-up needed.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {videos.map((v) => (
                <div key={v.id} className="min-w-0 space-y-2">
                  <UploadedVideoPlayer src={v.url} title={v.title} />
                  <p className="text-sm font-medium break-words">{v.title}</p>
                </div>
              ))}
            </div>
          </section>
        )}

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
                  {macbethPreview.scene}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">William Shakespeare · Three witches arrange to meet Macbeth after the battle.</p>
                <div className="prose prose-sm max-w-none text-foreground/85 leading-relaxed whitespace-pre-line">
                  {macbethPreview.excerpt}
                </div>
                <p className="mt-4 text-xs text-muted-foreground">Public-domain text · Project Gutenberg, ebook 1533</p>
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
