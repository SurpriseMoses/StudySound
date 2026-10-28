import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Film } from "lucide-react";
import UploadedVideoPlayer from "@/components/UploadedVideoPlayer";
import { Button } from "@/components/ui/button";

type Video = { id: string; title: string; storage_path: string; signedUrl?: string };

export default function LessonVideos({ documentId }: { documentId: string }) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("lesson_videos")
        .select("id, title, storage_path")
        .eq("document_id", documentId)
        .order("sort_order");
      const rows = (data ?? []) as Video[];
      if (rows.length) {
        const { data: signed } = await supabase.storage
          .from("lesson-videos")
          .createSignedUrls(rows.map((r) => r.storage_path), 3600);
        const map = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
        rows.forEach((r) => { r.signedUrl = map.get(r.storage_path) ?? undefined; });
      }
      if (!cancelled) { setVideos(rows.filter((r) => r.signedUrl)); setActive(0); }
    })();
    return () => { cancelled = true; };
  }, [documentId]);

  if (videos.length === 0) return null;
  const current = videos[active];
  if (!current) return null;

  return (
    <section className="space-y-3" aria-label="Lesson videos">
      <h3 className="text-sm font-display font-semibold flex items-center gap-2">
        <Film className="w-4 h-4 text-primary" /> Watch the story
      </h3>
      <UploadedVideoPlayer key={current.id} src={current.signedUrl} title={current.title} />
      <p className="text-sm font-medium">{current.title}</p>
      {videos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {videos.map((v, i) => (
            <Button
              key={v.id}
              onClick={() => setActive(i)}
              variant="outline"
              size="sm"
              className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${
                i === active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"
              }`}
            >
              {i + 1}. {v.title}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
