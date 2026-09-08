import { useCallback, useEffect, useState } from "react";
import { Download, Check, Loader2, Trash2, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  deleteBook, formatBytes, getBook, offlineSupported, putAudio, putChunks, saveBook,
  type OfflineBook,
} from "@/lib/offline-store";

type Props = {
  documentId: string | null;
  lessonId: string;
  title: string;
  subject: string | null;
  language: string;
  onChange?: () => void;
};

const MAX_AUDIO_SECTIONS = 60;

export default function OfflineDownloadButton({
  documentId, lessonId, title, subject, language, onChange,
}: Props) {
  const { toast } = useToast();
  const [book, setBook] = useState<OfflineBook | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");

  const refresh = useCallback(async () => {
    if (!documentId) return;
    setBook(await getBook(documentId));
  }, [documentId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!documentId || !offlineSupported) return null;

  const download = async () => {
    setBusy(true);
    setProgress("Saving text…");
    try {
      const { data: chunks, error } = await supabase
        .from("document_chunks")
        .select("chunk_index, text")
        .eq("document_id", documentId)
        .order("chunk_index", { ascending: true });
      if (error) throw new Error(error.message);
      if (!chunks?.length) throw new Error("Nothing to save yet");

      await putChunks(documentId, chunks as { chunk_index: number; text: string }[]);
      let bytes = chunks.reduce((n, c) => n + ((c.text ?? "").length * 2), 0);

      // Audio: only sections this learner has already unlocked — no new charges.
      const { data: unlocked } = await supabase
        .from("user_chunk_access")
        .select("chunk_index")
        .eq("document_id", documentId)
        .eq("language", language)
        .eq("asset_type", "audio")
        .order("chunk_index", { ascending: true });

      const indexes = [...new Set((unlocked ?? []).map(r => r.chunk_index))].slice(0, MAX_AUDIO_SECTIONS);
      let savedAudio = 0;

      for (let i = 0; i < indexes.length; i++) {
        setProgress(`Audio ${i + 1}/${indexes.length}…`);
        try {
          const { data } = await supabase.functions.invoke("generate-audio", {
            body: { lesson_id: lessonId, chunk_index: indexes[i], language },
          });
          if (!data?.audio_url) continue;
          const res = await fetch(data.audio_url);
          if (!res.ok) continue;
          const blob = await res.blob();
          await putAudio(documentId, language, indexes[i], blob);
          bytes += blob.size;
          savedAudio++;
        } catch {
          // skip this section, keep going
        }
      }

      const saved: OfflineBook = {
        id: documentId,
        title,
        subject,
        language,
        totalChunks: chunks.length,
        audioChunks: savedAudio,
        bytes,
        savedAt: Date.now(),
      };
      await saveBook(saved);
      setBook(saved);
      onChange?.();
      toast({
        title: "Saved for offline",
        description: `${chunks.length} sections${savedAudio ? ` and ${savedAudio} audio sections` : ""} · ${formatBytes(bytes)}`,
      });
    } catch (e) {
      toast({
        title: "Couldn't save offline",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const remove = async () => {
    await deleteBook(documentId);
    setBook(null);
    onChange?.();
    toast({ title: "Removed from this device" });
  };

  if (busy) {
    return (
      <Button size="sm" variant="outline" disabled className="gap-1.5">
        <Loader2 className="w-4 h-4 animate-spin" />
        {progress || "Saving…"}
      </Button>
    );
  }

  if (book) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5 text-primary border-primary/30">
            <Check className="w-4 h-4" /> Offline · {formatBytes(book.bytes)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={download}>
            <Download className="w-4 h-4 mr-2" /> Update download
          </DropdownMenuItem>
          <DropdownMenuItem onClick={remove} className="text-destructive focus:text-destructive">
            <Trash2 className="w-4 h-4 mr-2" /> Remove from device
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button size="sm" variant="outline" className="gap-1.5" onClick={download}>
      <Download className="w-4 h-4" /> Save offline
    </Button>
  );
}

export function OfflineBanner() {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground/80">
      <CloudOff className="w-4 h-4 shrink-0" />
      You're offline — showing what's saved on this device.
    </div>
  );
}
