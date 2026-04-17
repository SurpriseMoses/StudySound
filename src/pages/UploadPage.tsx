import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Upload, FileText, X, CheckCircle, AlertCircle, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import AppLayout from "@/components/AppLayout";
import { subjects } from "@/lib/subjects";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

type Status = "uploading" | "extracting" | "done" | "error" | "duplicate";

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

const MAX_BYTES = 20 * 1024 * 1024;

export default function UploadPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const updateFile = (id: string, patch: Partial<UploadFile>) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const processFile = useCallback(async (uf: UploadFile, subject: string) => {
    if (!user) return;
    try {
      // 1. Upload to private storage
      const ext = uf.file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const storagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
      updateFile(uf.id, { status: "uploading", progress: 10 });

      const { error: upErr } = await supabase.storage
        .from("uploads")
        .upload(storagePath, uf.file, { contentType: uf.file.type, upsert: false });
      if (upErr) throw new Error(upErr.message);

      updateFile(uf.id, { status: "extracting", progress: 50, message: "Extracting text…" });

      // 2. Call extract-document
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

      updateFile(uf.id, {
        status: data.reused ? "duplicate" : "done",
        progress: 100,
        message: data.reused
          ? "Already processed — reusing shared content (no AI cost)"
          : `Ready · ${data.char_count.toLocaleString()} chars`,
        documentId: data.document_id,
        lessonId: data.lesson_id,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      updateFile(uf.id, { status: "error", progress: 100, message: msg });
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    }
  }, [user, toast]);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || !user) return;
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
  }, [user, selectedSubject, processFile, toast]);

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const completed = files.filter((f) => f.status === "done" || f.status === "duplicate");
  const goToLibrary = () => navigate("/library");

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-display font-bold mb-1">Upload Content</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Upload textbooks or novels (PDF, DOCX, TXT — max 20MB). We'll extract the text and dedupe globally.
        </p>

        <div className="max-w-2xl space-y-5">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Subject</label>
            <Select value={selectedSubject} onValueChange={setSelectedSubject}>
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
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragOver(false); addFiles(e.dataTransfer.files); }}
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
              isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
            }`}
          >
            <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium text-sm">Drag & drop files here</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">PDF, DOCX, or TXT — up to 20MB</p>
            <label>
              <Button variant="outline" size="sm" className="cursor-pointer" asChild>
                <span>Browse Files</span>
              </Button>
              <input
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                multiple
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
            </label>
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
                        {file.status === "duplicate" && <Sparkles className="w-3.5 h-3.5 text-primary" />}
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
