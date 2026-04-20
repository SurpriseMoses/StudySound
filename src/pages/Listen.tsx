import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Globe, ArrowLeft, Loader2, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import AppLayout from "@/components/AppLayout";
import { TranslationSection } from "@/components/TranslationSection";
import { AudioSection } from "@/components/AudioSection";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { subjects } from "@/lib/subjects";

type Lesson = {
  id: string;
  title: string;
  subject: string;
  language: string | null;
  documents: { subject_type: string | null } | null;
};

const LANGS = [
  { code: "en", label: "English" },
  { code: "af", label: "Afrikaans" },
  { code: "zu", label: "isiZulu" },
  { code: "ts", label: "Xitsonga" },
  { code: "nso", label: "Sepedi" },
];

interface ListenProps {
  lessonId?: string;
  embedded?: boolean;
}

export default function Listen({ lessonId: lessonIdProp, embedded = false }: ListenProps = {}) {
  const params = useParams();
  const lessonId = lessonIdProp ?? params.lessonId;
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [language, setLanguage] = useState("en");
  const [chunkIndex, setChunkIndex] = useState(0);
  const [totalChunks, setTotalChunks] = useState(1);
  const [chunkText, setChunkText] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Check admin role
  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(!!data);
    })();
  }, [user]);

  // Load lesson metadata
  useEffect(() => {
    if (!lessonId || !user) return;
    (async () => {
      const { data, error } = await supabase
        .from("lessons")
        .select("id, title, subject, language, documents(subject_type)")
        .eq("id", lessonId)
        .maybeSingle();
      if (error || !data) {
        toast({ title: "Lesson not found", variant: "destructive" });
        navigate("/library");
        return;
      }
      setLesson(data as Lesson);
      setLanguage(data.language ?? "en");
      setChunkIndex(0);
    })();
  }, [lessonId, user, navigate, toast]);

  // Reset on language change
  useEffect(() => {
    setChunkIndex(0);
  }, [language, lesson?.id]);

  const goChunk = (delta: number) => {
    const next = Math.max(0, Math.min(totalChunks - 1, chunkIndex + delta));
    if (next !== chunkIndex) setChunkIndex(next);
  };

  // Admin: clear cached audio for current chunk and re-render
  const regenerateChunk = async () => {
    if (!lessonId || !isAdmin) return;
    setIsRegenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("regenerate-audio-chunk", {
        body: { lesson_id: lessonId, chunk_index: chunkIndex, language },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error ?? "Failed");
      toast({ title: "Cache cleared", description: `${data.deleted_rows} row(s) removed.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to regenerate";
      toast({ title: "Regenerate failed", description: msg, variant: "destructive" });
    } finally {
      setIsRegenerating(false);
    }
  };

  const subjectName = subjects.find((s) => s.id === lesson?.subject)?.name ?? lesson?.subject;

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    embedded ? <>{children}</> : <AppLayout>{children}</AppLayout>;

  return (
    <Wrapper>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        {!embedded && (
          <Link to="/library" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="w-4 h-4 mr-1" /> Library
          </Link>
        )}

        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-3">
          <div>
            {!embedded && <h1 className="text-2xl font-display font-bold">{lesson?.title ?? "Loading…"}</h1>}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-muted-foreground text-sm">{subjectName}</p>
              {lesson?.documents?.subject_type && (
                (() => {
                  const isStory = lesson.documents.subject_type === "novel";
                  return (
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                        isStory
                          ? "bg-primary/10 text-primary border-primary/30"
                          : "bg-muted text-foreground/70 border-border"
                      }`}
                    >
                      {isStory ? "📖 Story Mode" : "🎓 Study Mode"}
                    </span>
                  );
                })()
              )}
            </div>
          </div>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="w-40">
              <Globe className="w-4 h-4 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGS.map((l) => (
                <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {lesson && lessonId && (
          <Card className="mb-4">
            <CardContent className="p-5 min-h-[200px] space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-display font-semibold text-sm">
                  Section {chunkIndex + 1} of {totalChunks}
                </h3>
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={regenerateChunk}
                      disabled={isRegenerating}
                      className="h-7 text-xs"
                    >
                      {isRegenerating ? (
                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      ) : (
                        <RefreshCw className="w-3 h-3 mr-1" />
                      )}
                      Regenerate
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => goChunk(-1)}
                    disabled={chunkIndex === 0}
                    className="h-7 w-7"
                    aria-label="Previous"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => goChunk(1)}
                    disabled={chunkIndex >= totalChunks - 1}
                    className="h-7 w-7"
                    aria-label="Next"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {chunkText && (
                <p className="text-foreground/80 leading-relaxed text-sm whitespace-pre-line">
                  {chunkText}
                </p>
              )}

              <AudioSection
                key={`${lessonId}-${chunkIndex}-${language}`}
                lessonId={lessonId}
                chunkIndex={chunkIndex}
                totalChunks={totalChunks}
                language={language}
                onMeta={({ text, totalChunks: t }) => {
                  setChunkText(text);
                  setTotalChunks(t);
                }}
                onChunkEnded={() => goChunk(1)}
                onSeekChunk={goChunk}
              />

              {chunkText && (
                <TranslationSection
                  lessonId={lessonId}
                  chunkIndex={chunkIndex}
                  language={language}
                />
              )}
            </CardContent>
          </Card>
        )}
      </motion.div>
    </Wrapper>
  );
}
