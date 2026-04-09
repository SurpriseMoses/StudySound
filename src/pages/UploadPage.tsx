import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Upload, FileText, X, CheckCircle, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import AppLayout from "@/components/AppLayout";
import { subjects } from "@/lib/subjects";

interface UploadFile {
  id: string;
  name: string;
  size: string;
  status: "uploading" | "done" | "error";
  progress: number;
}

export default function UploadPage() {
  const [selectedSubject, setSelectedSubject] = useState<string>("");
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: UploadFile[] = Array.from(fileList).map(f => ({
      id: crypto.randomUUID(),
      name: f.name,
      size: `${(f.size / 1024 / 1024).toFixed(1)} MB`,
      status: "uploading" as const,
      progress: 0,
    }));
    setFiles(prev => [...prev, ...newFiles]);

    // Simulate upload progress
    newFiles.forEach(file => {
      let p = 0;
      const interval = setInterval(() => {
        p += Math.random() * 25;
        if (p >= 100) {
          p = 100;
          clearInterval(interval);
          setFiles(prev => prev.map(f => f.id === file.id ? { ...f, progress: 100, status: "done" } : f));
        } else {
          setFiles(prev => prev.map(f => f.id === file.id ? { ...f, progress: p } : f));
        }
      }, 400);
    });
  }, []);

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-display font-bold mb-1">Upload Content</h1>
        <p className="text-muted-foreground text-sm mb-6">Upload your textbooks or novels. Supports PDF, DOCX, and TXT files (max 20MB).</p>

        <div className="max-w-2xl space-y-5">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Subject</label>
            <Select value={selectedSubject} onValueChange={setSelectedSubject}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select subject for this upload" />
              </SelectTrigger>
              <SelectContent>
                {subjects.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.icon} {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={e => { e.preventDefault(); setIsDragOver(false); addFiles(e.dataTransfer.files); }}
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
              <input type="file" accept=".pdf,.docx,.txt" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
            </label>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-2">
              {files.map(file => (
                <Card key={file.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <button onClick={() => removeFile(file.id)} className="text-muted-foreground hover:text-destructive ml-2">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">{file.size}</span>
                        {file.status === "uploading" && <Progress value={file.progress} className="flex-1 h-1" />}
                        {file.status === "done" && <CheckCircle className="w-3.5 h-3.5 text-success" />}
                        {file.status === "error" && <AlertCircle className="w-3.5 h-3.5 text-destructive" />}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Button className="w-full" disabled={!selectedSubject || files.length === 0}>
            Process Content with AI
          </Button>
        </div>
      </motion.div>
    </AppLayout>
  );
}
