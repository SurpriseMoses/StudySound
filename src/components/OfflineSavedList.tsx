import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { WifiOff, Trash2, Headphones, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { deleteBook, formatBytes, listBooks, type OfflineBook } from "@/lib/offline-store";

export default function OfflineSavedList() {
  const [books, setBooks] = useState<OfflineBook[] | null>(null);

  const refresh = useCallback(() => {
    listBooks().then(setBooks);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (!books) return null;

  if (books.length === 0) {
    return (
      <div className="py-10 text-center">
        <WifiOff className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm font-medium mb-1">Nothing saved on this device yet</p>
        <p className="text-xs text-muted-foreground">
          Open any book and tap “Save offline” to read and listen without data.
        </p>
      </div>
    );
  }

  return (
    <>
      {books.map((b) => (
        <Card key={b.id}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Link to={`/lesson/${b.id}`} className="font-medium text-sm hover:underline block truncate">
                {b.title}
              </Link>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{b.totalChunks} sections</span>
                <span className="flex items-center gap-1"><Headphones className="w-3 h-3" />{b.audioChunks} audio</span>
                <span>{formatBytes(b.bytes)}</span>
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Remove download"
              onClick={async () => { await deleteBook(b.id); refresh(); }}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      ))}
    </>
  );
}
