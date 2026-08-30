import { useEffect, useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";

type FigureRow = {
  id: string;
  label: string | null;
  caption: string | null;
  storage_path: string;
  page_number: number;
};

type Figure = FigureRow & { url: string };

/** "Figure 2.3" / "Fig 2.3" / "fig. 2-3" -> "2.3" */
function labelKey(label: string | null): string | null {
  if (!label) return null;
  const m = label.match(/([0-9]+(?:[.\-][0-9]+)*)/);
  return m ? m[1].replace(/-/g, ".") : null;
}

/** All figure numbers referenced inside a block of lesson text. */
function referencedKeys(text: string): Set<string> {
  const keys = new Set<string>();
  const re = /\b(?:fig(?:ure)?s?\.?|diagram)\s*([0-9]+(?:[.\-][0-9]+)*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) keys.add(m[1].replace(/-/g, "."));
  return keys;
}

interface FigureGalleryProps {
  documentId?: string | null;
  text: string;
  /** Used to show page scans for books whose figures have no printed labels. */
  chunkIndex?: number;
  totalChunks?: number;
}

/**
 * Shows the original textbook diagrams for whichever figures the current
 * section of text refers to. Renders nothing when the book has no figures.
 */
export default function FigureGallery({ documentId, text, chunkIndex = 0, totalChunks = 1 }: FigureGalleryProps) {
  const [rows, setRows] = useState<FigureRow[]>([]);
  const [figures, setFigures] = useState<Figure[]>([]);
  const [zoom, setZoom] = useState<Figure | null>(null);

  const keys = useMemo(() => referencedKeys(text || ""), [text]);

  useEffect(() => {
    if (!documentId) { setRows([]); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("document_figures")
        .select("id,label,caption,storage_path,page_number")
        .eq("document_id", documentId)
        .order("page_number", { ascending: true })
        .limit(2000);
      if (cancelled) return;
      if (error) { console.error("figures load failed", error.message); setRows([]); return; }
      setRows(data ?? []);
    })();
    return () => { cancelled = true; };
  }, [documentId]);

  const matches = useMemo(() => {
    if (!rows.length) return [];
    const labelled = rows.filter((r) => r.label);
    if (labelled.length && keys.size > 0) {
      const seen = new Set<string>();
      const hits = labelled
        .filter((r) => {
          const k = labelKey(r.label);
          if (!k || !keys.has(k)) return false;
          if (seen.has(k + r.storage_path)) return false;
          seen.add(k + r.storage_path);
          return true;
        })
        .slice(0, 6);
      if (hits.length) return hits;
    }
    // Fallback: spread the book's figures evenly across its sections so every
    // section shows the diagrams that belong to roughly that part of the book.
    if (totalChunks < 1) return [];
    const start = Math.floor((chunkIndex / totalChunks) * rows.length);
    const end = Math.max(start + 1, Math.floor(((chunkIndex + 1) / totalChunks) * rows.length));
    return rows.slice(Math.min(start, Math.max(0, rows.length - 1)), Math.min(end, rows.length)).slice(0, 4);

  }, [rows, keys, chunkIndex, totalChunks]);



  useEffect(() => {
    if (!matches.length) { setFigures([]); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.storage
        .from("assets")
        .createSignedUrls(matches.map((m) => m.storage_path), 60 * 60);
      if (cancelled) return;
      if (error || !data) { console.error("figure urls failed", error?.message); setFigures([]); return; }
      setFigures(
        matches
          .map((m, i) => ({ ...m, url: data[i]?.signedUrl ?? "" }))
          .filter((f) => f.url),
      );
    })();
    return () => { cancelled = true; };
  }, [matches]);

  if (!figures.length) return null;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Figures from the textbook
      </h4>
      <div className="grid gap-3 sm:grid-cols-2">
        {figures.map((f) => (
          <figure key={f.id} className="rounded-lg border bg-card overflow-hidden">
            <button
              type="button"
              onClick={() => setZoom(f)}
              className="block w-full bg-muted/40"
              aria-label={`Enlarge ${f.label ?? "figure"}`}
            >
              <img
                src={f.url}
                alt={f.caption || f.label || "Textbook figure"}
                loading="lazy"
                className="w-full h-auto max-h-64 object-contain"
              />
            </button>
            <figcaption className="px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{f.label ?? `Page ${f.page_number}`}</span>
              {f.caption && f.label ? ` — ${f.caption}` : null}
            </figcaption>

          </figure>
        ))}
      </div>

      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="max-w-3xl">
          {zoom && (
            <figure className="space-y-3">
              <img
                src={zoom.url}
                alt={zoom.caption || zoom.label || "Textbook figure"}
                className="w-full h-auto rounded-md"
              />
              <figcaption className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{zoom.label ?? `Page ${zoom.page_number}`}</span>
                {zoom.caption && zoom.label ? ` — ${zoom.caption}` : null}

                <span className="ml-2 opacity-70 inline-flex items-center gap-1">
                  <ImageOff className="w-3 h-3" aria-hidden /> page {zoom.page_number}
                </span>
              </figcaption>
            </figure>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
