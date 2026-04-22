import { forwardRef } from "react";
import { Play, Pause, SkipBack, SkipForward, Sparkles, Loader2, AlertCircle } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent } from "@/components/ui/card";

function formatTime(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

interface Props {
  audioSrc: string;
  isPlaying: boolean;
  isLoading?: boolean;
  error?: string | null;
  progress: number[];
  currentTime: number;
  duration: number;
  previewLabel: string;
  onTogglePlay: () => void;
  onSeek: (val: number[]) => void;
  onSkip: (delta: number) => void;
}

const PreviewAudioPlayer = forwardRef<HTMLAudioElement, Props>(function PreviewAudioPlayer(
  { audioSrc, isPlaying, isLoading = false, error = null, progress, currentTime, duration, previewLabel, onTogglePlay, onSeek, onSkip },
  ref,
) {
  const disabled = isLoading || !!error || !audioSrc;

  return (
    <Card className="border-primary/20 overflow-hidden bg-gradient-to-br from-card via-card to-primary/5">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">AI Narration</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Premium voice</p>
            </div>
          </div>
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide inline-flex items-center gap-1 ${
            error ? "bg-destructive/10 text-destructive" : "bg-muted/60 text-muted-foreground"
          }`}>
            {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
            {error && <AlertCircle className="w-3 h-3" />}
            {previewLabel}
          </span>
        </div>

        <audio ref={ref} src={audioSrc || undefined} preload="metadata" />

        {/* Waveform-like progress visualization */}
        <div className="relative mb-2">
          <div className="flex items-end justify-between h-8 gap-[2px] mb-2 px-0.5">
            {Array.from({ length: 48 }).map((_, i) => {
              const filled = (progress[0] / 100) * 48 > i;
              const heights = [4, 8, 14, 10, 18, 22, 16, 24, 20, 12];
              const h = heights[i % heights.length];
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-full transition-colors ${
                    filled ? "bg-primary" : "bg-muted"
                  } ${isPlaying && filled && i === Math.floor((progress[0] / 100) * 48) - 1 ? "animate-pulse" : ""}`}
                  style={{ height: `${h}px` }}
                />
              );
            })}
          </div>
          <Slider value={progress} onValueChange={onSeek} max={100} step={0.1} disabled={disabled} />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground mb-5">
          <span className="font-mono">{formatTime(currentTime)}</span>
          <span className="font-mono">{formatTime(duration)}</span>
        </div>

        <div className="flex items-center justify-center gap-6">
          <button
            onClick={() => onSkip(-10)}
            disabled={disabled}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Skip back 10 seconds"
          >
            <SkipBack className="w-6 h-6" />
          </button>
          <button
            onClick={onTogglePlay}
            disabled={disabled}
            className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-all shadow-lg shadow-primary/30 hover:scale-105 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
            aria-label={isLoading ? "Loading audio" : isPlaying ? "Pause" : "Play"}
          >
            {isLoading ? (
              <Loader2 className="w-7 h-7 animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-7 h-7" />
            ) : (
              <Play className="w-7 h-7 ml-1 fill-current" />
            )}
          </button>
          <button
            onClick={() => onSkip(10)}
            disabled={disabled}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Skip forward 10 seconds"
          >
            <SkipForward className="w-6 h-6" />
          </button>
        </div>

        {error && (
          <p className="mt-4 text-xs text-center text-destructive/80">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
});

export default PreviewAudioPlayer;
