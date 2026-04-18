import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { Upload, FileText, X, CheckCircle, AlertCircle, Loader2, Search, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import AppLayout from "@/components/AppLayout";
import { subjects } from "@/lib/subjects";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

type Status = "uploading" | "extracting" | "done" | "error";

interface UploadFile {
  id: string;
  file: File;
  name: string;
  size: string;
  status: Status;
  progress: number;
  message?: string;
  documentId?: string;
  lessonId?: string;
}

interface LibraryMatch {
  id: string;
  title: string;
  subject_type: string;
  char_count: number;
  similarity?: number;
}

const MAX_BYTES = 20 * 1024 * 1024;

export default function UploadPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  // Library search
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<LibraryMatch[] | null>(null);

  // Search library on debounce — uses fuzzy/trigram matching server-side
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setMatches(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      const { data, error } = await supabase.rpc("search_documents_fuzzy", {
        _query: q,
        _threshold: 0.3,
        _limit: 5,
      });
      setSearching(false);
      if (!error) setMatches((data as LibraryMatch[]) ?? []);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const hasMatch = !!matches && matches.length > 0;
  const uploadDisabled = hasMatch;

  const updateFile = (id: string, patch: Partial<UploadFile>) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const processFile = useCallback(async (uf: UploadFile, subject: string) => {
    if (!user) return;
    try {
      const ext = uf.file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const storagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
      updateFile(uf.id, { status: "uploading", progress: 10 });

      const { error: upErr } = await supabase.storage
        .from("uploads")
        .upload(storagePath, uf.file, { contentType: uf.file.type, upsert: false });
      if (upErr) throw new Error(upErr.message);

      updateFile(uf.id, { status: "extracting", progress: 50, message: "Extracting text…" });

      const { data, error } = await supabase.functions.invoke("extract-document", {
        body: {
          storage_path: storagePath,
          file_name: uf.file.name,
          file_type: uf.file.type || ext,
          subject,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error ?? "Extraction failed");

      const reused = !!data.reused;
      updateFile(uf.id, {
        status: "done",
        progress: 100,
        message: reused
          ? "This matches a book already in our library — linked for instant access."
          : `Ready · ${data.char_count.toLocaleString()} chars`,
        documentId: data.document_id,
        lessonId: data.lesson_id,
      });
      if (reused) {
        toast({
          title: "Matched a library book",
          description: "We linked your upload to the existing version for instant access.",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      updateFile(uf.id, { status: "error", progress: 100, message: msg });
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    }
  }, [user, toast]);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || !user) return;
    if (uploadDisabled) {
      toast({ title: "Book already in library", description: "Open it instantly instead of uploading.", variant: "destructive" });
      return;
    }
    if (!selectedSubject) {
      toast({ title: "Pick a subject first", variant: "destructive" });
      return;
    }
    const accepted: UploadFile[] = [];
    Array.from(fileList).forEach((f) => {
      if (f.size > MAX_BYTES) {
        toast({ title: `${f.name} is too large`, description: "Max 20MB", variant: "destructive" });
        return;
      }
      accepted.push({
        id: crypto.randomUUID(),
        file: f,
        name: f.name,
        size: `${(f.size / 1024 / 1024).toFixed(1)} MB`,
        status: "uploading",
        progress: 0,
      });
    });
    setFiles((prev) => [...prev, ...accepted]);
    accepted.forEach((uf) => processFile(uf, selectedSubject));
  }, [user, selectedSubject, processFile, toast, uploadDisabled]);

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const completed = files.filter((f) => f.status === "done");
  const goToLibrary = () => navigate("/library");

  const openInstantly = (docId: string) => {
    navigate(`/lesson/${docId}`);
  };

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-display font-bold mb-1">Upload Content</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Search our library first — if your book is already here, you get instant access.
        </p>

        <div className="max-w-2xl space-y-5">
          {/* Library search */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Search your book first</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. Macbeth, Great Expectations, World War II…"
                className="pl-9"
              />
              {searching && (
                <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />
              )}
            </div>

            {hasMatch && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-success">
                  <CheckCircle className="w-3.5 h-3.5" /> Available in library
                </div>
                {matches!.map((m) => (
                  <Card key={m.id} className="border-success/30 bg-success/5">
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center">
                        <BookOpen className="w-4 h-4 text-success" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{m.title}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {m.subject_type} · {m.char_count.toLocaleString()} chars
                        </p>
                      </div>
                      <Button size="sm" onClick={() => openInstantly(m.id)}>
                        Open instantly
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {matches && matches.length === 0 && searchQuery.trim().length >= 2 && (
              <p className="text-xs text-muted-foreground mt-2">
                No match found — upload your file below.
              </p>
            )}
          </div>

          {/* Upload section — disabled when match found */}
          <div className={uploadDisabled ? "opacity-50 pointer-events-none" : ""}>
            <div className="border-t pt-5">
              <label className="text-sm font-medium mb-1.5 block">Subject</label>
              <Select value={selectedSubject} onValueChange={setSelectedSubject} disabled={uploadDisabled}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select subject for this upload" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.icon} {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              onDragOver={(e) => { if (!uploadDisabled) { e.preventDefault(); setIsDragOver(true); } }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => { if (!uploadDisabled) { e.preventDefault(); setIsDragOver(false); addFiles(e.dataTransfer.files); } }}
              className={`mt-4 border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
                isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
              }`}
            >
              <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium text-sm">Drag & drop files here</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">PDF, DOCX, or TXT — up to 20MB</p>
              <label>
                <Button variant="outline" size="sm" className="cursor-pointer" asChild disabled={uploadDisabled}>
                  <span>Browse Files</span>
                </Button>
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  multiple
                  className="hidden"
                  disabled={uploadDisabled}
                  onChange={(e) => addFiles(e.target.files)}
                />
              </label>
            </div>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              {files.map((file) => (
                <Card key={file.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <button
                          onClick={() => removeFile(file.id)}
                          className="text-muted-foreground hover:text-destructive ml-2"
                          aria-label="Remove"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">{file.size}</span>
                        {(file.status === "uploading" || file.status === "extracting") && (
                          <>
                            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                            <Progress value={file.progress} className="flex-1 h-1" />
                          </>
                        )}
                        {file.status === "done" && <CheckCircle className="w-3.5 h-3.5 text-success" />}
                        {file.status === "error" && <AlertCircle className="w-3.5 h-3.5 text-destructive" />}
                      </div>
                      {file.message && (
                        <p className={`text-xs mt-1 ${file.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                          {file.message}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Button
            className="w-full"
            disabled={completed.length === 0}
            onClick={goToLibrary}
          >
            {completed.length > 0 ? `View ${completed.length} in Library` : "Process Content with AI"}
          </Button>
        </div>
      </motion.div>
    </AppLayout>
  );
}
