import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Pause, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAudioBlob, getChunks, type OfflineChunk } from "@/lib/offline-store";

type Props = {
  documentId: string;
  language: string;
  chunkIndex: number;
  onSeekChunk: (delta: number) => void;
  onTotalChunks?: (n: number) => void;
};

export default function OfflineListen({
  documentId, language, chunkIndex, onSeekChunk, onTotalChunks,
}: Props) {
  const [chunks, setChunks] = useState<OfflineChunk[] | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let alive = true;
    getChunks(documentId).then((c) => {
      if (!alive) return;
      setChunks(c);
      onTotalChunks?.(c.length || 1);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  useEffect(() => {
    let url: string | null = null;
    setPlaying(false);
    getAudioBlob(documentId, language, chunkIndex).then((blob) => {
      if (blob) {
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      } else {
        setAudioUrl(null);
      }
    });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [documentId, language, chunkIndex]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else a.play().then(() => setPlaying(true)).catch(() => {});
  };

  if (!chunks) return null;

  if (chunks.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          This book isn't saved on your device yet. Connect to the internet and tap “Save offline”.
        </CardContent>
      </Card>
    );
  }

  const text = chunks[Math.min(chunkIndex, chunks.length - 1)]?.text ?? "";

  return (
    <Card>
      <CardContent className="p-6 space-y-4 min-h-[320px]">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display font-semibold text-sm">
            Section {chunkIndex + 1} of {chunks.length}
          </h3>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={chunkIndex === 0} onClick={() => onSeekChunk(-1)} aria-label="Previous">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={chunkIndex >= chunks.length - 1} onClick={() => onSeekChunk(1)} aria-label="Next">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {audioUrl ? (
          <div className="flex items-center gap-3">
            <audio ref={audioRef} src={audioUrl} preload="auto" onEnded={() => setPlaying(false)} />
            <button
              onClick={toggle}
              className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5 fill-current" />}
            </button>
            <span className="text-xs text-muted-foreground">Saved audio · no data used</span>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <VolumeX className="w-4 h-4" /> No saved audio for this section — you can still read it.
          </p>
        )}

        <p className="text-foreground/85 leading-relaxed text-base whitespace-pre-line max-w-prose">
          {text}
        </p>
      </CardContent>
    </Card>
  );
}
