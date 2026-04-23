import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Play, Pause, SkipBack, SkipForward, Loader2, Lock, Volume2, Coins, Gauge, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const COST = 1;
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SKIP_CONFIRM_KEY = "studysound:skip-audio-unlock-confirm";

type Props = {
  lessonId: string;
  chunkIndex: number;
  totalChunks: number;
  language: string;
  onAudioReady?: (audioUrl: string) => void;
  onChunkEnded?: () => void;
  onProgress?: (currentSeconds: number, durationSeconds: number) => void;
  onUnlocked?: () => void;
  onSeekChunk?: (delta: number) => void;
  onMeta?: (meta: { text: string; totalChunks: number }) => void;
};

type CheckResult = {
  cache_exists: boolean;
  already_paid: boolean;
  credits_balance: number;
};

export function AudioSection({
  lessonId,
  chunkIndex,
  totalChunks,
  language,
  onAudioReady,
  onChunkEnded,
  onProgress,
  onUnlocked,
  onSeekChunk,
  onMeta,
}: Props) {
  const { toast } = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inflightRef = useRef(false);

  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekProgress, setSeekProgress] = useState([0]);
  const [playbackRate, setPlaybackRate] = useState(1);

  // ---- Status check (no charge, no generation) ----
  const runCheck = useCallback(async () => {
    setChecking(true);
    setAudioUrl(null);
    setIsPlaying(false);
    try {
      const { data, error } = await supabase.functions.invoke("generate-audio", {
        body: { lesson_id: lessonId, chunk_index: chunkIndex, language, check_only: true },
      });
      if (error || !data?.success) throw new Error(error?.message ?? data?.error ?? "Check failed");
      setCheck({
        cache_exists: !!data.cache_exists,
        already_paid: !!data.already_paid,
        credits_balance: data.credits_balance ?? 0,
      });
      onMeta?.({ text: data.text ?? "", totalChunks: data.total_chunks ?? 1 });
      if (data.already_paid) {
        await loadAudio({ autoPlay: false });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Status check failed";
      toast({ title: "Couldn't check audio status", description: msg, variant: "destructive" });
    } finally {
      setChecking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, chunkIndex, language]);

  // ---- Generate / fetch audio (charges if first time) ----
  const loadAudio = useCallback(async ({ autoPlay = true }: { autoPlay?: boolean } = {}) => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-audio", {
        body: { lesson_id: lessonId, chunk_index: chunkIndex, language },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error ?? "Failed");
      setAudioUrl(data.audio_url);
      onAudioReady?.(data.audio_url);
      if (data.credits_charged > 0) {
        toast({
          title: `${data.credits_charged} credit charged`,
          description: `Section ${chunkIndex + 1} unlocked — replay anytime.`,
        });
        setCheck((prev) =>
          prev ? { ...prev, already_paid: true, credits_balance: Math.max(0, prev.credits_balance - data.credits_charged) } : prev,
        );
      } else {
        setCheck((prev) => (prev ? { ...prev, already_paid: true } : prev));
      }
      onUnlocked?.();
      if (autoPlay) {
        // Wait for src to attach, then play
        setTimeout(() => {
          const a = audioRef.current;
          if (a) {
            a.play().then(() => setIsPlaying(true)).catch(() => {});
          }
        }, 50);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load audio";
      toast({ title: "Audio failed", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
      setConfirmOpen(false);
      inflightRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, chunkIndex, language]);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  // ---- Audio element lifecycle ----
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    audio.playbackRate = playbackRate;
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) {
        setSeekProgress([(audio.currentTime / audio.duration) * 100]);
        onProgress?.(audio.currentTime, audio.duration);
      }
    };
    const onLoad = () => setDuration(audio.duration);
    const onEnd = () => {
      setIsPlaying(false);
      onChunkEnded?.();
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onLoad);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onLoad);
      audio.removeEventListener("ended", onEnd);
    };
  }, [audioUrl, playbackRate, onChunkEnded, onProgress]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const handlePlayClick = () => {
    if (generating || inflightRef.current) return;
    // Already unlocked — just play / load.
    if (check?.already_paid || audioUrl) {
      if (audioUrl) togglePlay();
      else loadAudio({ autoPlay: true });
      return;
    }
    // Locked — notify + start narration immediately.
    toast({
      title: "1 credit used",
      description: "Narration starting — replay anytime, no repeat charges.",
    });
    loadAudio({ autoPlay: true });
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

  // ---- States ----

  if (checking) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-5 flex items-center gap-3 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking audio…
        </CardContent>
      </Card>
    );
  }

  // Low credit (and not yet unlocked)
  if (check && !check.already_paid && check.credits_balance < COST) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-sm">You need {COST} credit to play audio</p>
              <p className="text-xs text-muted-foreground mt-1">
                Your balance: <strong className="text-foreground">{check.credits_balance}</strong>
              </p>
              <Button asChild size="sm" className="mt-3">
                <Link to="/topup?from=audio">Top up credits</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isUnlocked = !!(check?.already_paid || audioUrl);
  const playDisabled = generating || inflightRef.current;
  const tooltipLabel = isUnlocked
    ? (isPlaying ? "Pause" : "Play audio")
    : `Play audio (${COST} credit)`;

  return (
    <>
      <Card className="border-primary/20 shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Volume2 className="w-4 h-4 text-primary" />
              Audio narration
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs tabular-nums">
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

          {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}

          {audioUrl && (
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-10">{fmt(currentTime)}</span>
              <Slider value={seekProgress} onValueChange={onSeek} max={100} step={0.5} className="flex-1" />
              <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-10 text-right">{fmt(duration)}</span>
            </div>
          )}

          <div className="flex items-center justify-center gap-4 mt-1">
            {onSeekChunk && (
              <button
                onClick={() => onSeekChunk(-1)}
                disabled={chunkIndex === 0}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Previous section"
              >
                <SkipBack className="w-5 h-5" />
              </button>
            )}
            <TooltipProvider delayDuration={250}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handlePlayClick}
                    disabled={playDisabled}
                    className="w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition shadow-md shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
                    aria-label={tooltipLabel}
                  >
                    {generating ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : isPlaying ? (
                      <Pause className="w-6 h-6" />
                    ) : (
                      <Play className="w-6 h-6 ml-0.5 fill-current" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{tooltipLabel}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {onSeekChunk && (
              <button
                onClick={() => onSeekChunk(1)}
                disabled={chunkIndex >= totalChunks - 1}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                aria-label="Next section"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground text-center mt-3 flex items-center justify-center gap-1">
            <Coins className="w-3 h-3" />
            {isUnlocked ? "Unlocked — free replay" : "1 credit per section · replay free"}
          </p>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!generating) setConfirmOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Volume2 className="w-5 h-5 text-primary" /> Play audio
            </DialogTitle>
            <DialogDescription>
              This will use <strong>{COST} credit</strong>. Continue?
            </DialogDescription>
          </DialogHeader>
          <ul className="text-sm space-y-1.5 my-1">
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-success mt-0.5 shrink-0" />
              <span>Replay anytime — no repeat charges</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-success mt-0.5 shrink-0" />
              <span>Works offline if downloaded</span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Your balance: <strong className="text-foreground">{check?.credits_balance ?? 0}</strong> credits
          </p>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none mt-1">
            <Checkbox
              checked={dontShowAgain}
              onCheckedChange={(v) => setDontShowAgain(v === true)}
            />
            Don't show again
          </label>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={generating}>
              Cancel
            </Button>
            <Button onClick={handleConfirmPlay} disabled={generating}>
              {generating ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…</>
              ) : (
                <><Play className="w-4 h-4 mr-2" /> Play & Use Credit</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
