import { useEffect, useMemo, useState } from "react";
import { List, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Chunk = { chunk_index: number; text: string };

function sectionTitle(text: string) {
  const firstLine = (text || "").trim().split("\n").find((l) => l.trim().length > 0) ?? "";
  const cleaned = firstLine.replace(/\s+/g, " ").trim();
  return cleaned.length > 70 ? `${cleaned.slice(0, 70)}…` : cleaned || "Untitled section";
}

function snippetAround(text: string, query: string) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, 120).replace(/\s+/g, " ");
  const start = Math.max(0, idx - 50);
  return `${start > 0 ? "…" : ""}${text.slice(start, idx + query.length + 80).replace(/\s+/g, " ")}…`;
}

export default function LessonContents({
  documentId,
  currentIndex,
  onJump,
}: {
  documentId: string | null;
  currentIndex: number;
  onJump: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || !documentId || chunks || loading) return;
    setLoading(true);
    supabase
      .from("document_chunks")
      .select("chunk_index, text")
      .eq("document_id", documentId)
      .order("chunk_index", { ascending: true })
      .then(({ data }) => {
        setChunks((data as Chunk[]) ?? []);
        setLoading(false);
      });
  }, [open, documentId, chunks, loading]);

  const results = useMemo(() => {
    if (!chunks) return [];
    const q = query.trim();
    if (!q) return chunks;
    return chunks.filter((c) => c.text?.toLowerCase().includes(q.toLowerCase()));
  }, [chunks, query]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <List className="w-4 h-4" /> Contents & search
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="p-5 pb-3">
          <SheetTitle className="font-display">Contents</SheetTitle>
        </SheetHeader>

        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search inside this book…"
              className="pl-9 pr-9"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {chunks && (
            <p className="text-xs text-muted-foreground mt-2">
              {query.trim()
                ? `${results.length} section${results.length === 1 ? "" : "s"} match`
                : `${chunks.length} sections`}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-6 space-y-1">
          {loading && (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading sections…
            </div>
          )}
          {!loading && chunks && results.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-10">No matches found.</p>
          )}
          {results.map((c) => (
            <button
              key={c.chunk_index}
              onClick={() => {
                onJump(c.chunk_index);
                setOpen(false);
              }}
              className={cn(
                "w-full text-left rounded-lg px-3 py-2.5 transition-colors",
                c.chunk_index === currentIndex ? "bg-primary/10 text-foreground" : "hover:bg-muted",
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-medium text-muted-foreground shrink-0">
                  {c.chunk_index + 1}
                </span>
                <span className="text-sm font-medium leading-snug">{sectionTitle(c.text)}</span>
              </div>
              {query.trim() && (
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {snippetAround(c.text ?? "", query.trim())}
                </p>
              )}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
