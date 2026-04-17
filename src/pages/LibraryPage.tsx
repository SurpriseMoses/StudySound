import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Headphones, Brain, Image as ImageIcon, Wifi, WifiOff, FileText, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { subjects } from "@/lib/subjects";
import { Link } from "react-router-dom";

type Lesson = {
  id: string;
  title: string;
  subject: string;
  progress: number | null;
  is_downloaded: boolean | null;
  audio_url: string | null;
  created_at: string;
};

const subjectIcon = (id: string) => subjects.find((s) => s.id === id)?.icon ?? "📚";
const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? id;

export default function LibraryPage() {
  const { user } = useAuth();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("lessons")
        .select("id, title, subject, progress, is_downloaded, audio_url, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setLessons(data ?? []);
      setLoading(false);
    })();
  }, [user]);

  const downloaded = lessons.filter((l) => l.is_downloaded);

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-display font-bold mb-1">Library</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Your saved lessons, quizzes, and visuals. Downloaded items work offline.
        </p>

        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All ({lessons.length})</TabsTrigger>
            <TabsTrigger value="downloaded">Downloaded ({downloaded.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
              </div>
            ) : lessons.length === 0 ? (
              <EmptyState />
            ) : (
              lessons.map((lesson) => <LessonCard key={lesson.id} lesson={lesson} />)
            )}
          </TabsContent>

          <TabsContent value="downloaded" className="mt-4 space-y-3">
            {downloaded.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No downloaded lessons yet. Generate audio on a lesson to make it available offline.
              </p>
            ) : (
              downloaded.map((lesson) => <LessonCard key={lesson.id} lesson={lesson} />)
            )}
          </TabsContent>
        </Tabs>
      </motion.div>
    </AppLayout>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="p-8 text-center">
        <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <h3 className="font-semibold mb-1">No lessons yet</h3>
        <p className="text-sm text-muted-foreground mb-4">Upload a textbook or novel to get started.</p>
        <Link to="/upload" className="text-primary text-sm font-medium hover:underline">
          Upload content →
        </Link>
      </CardContent>
    </Card>
  );
}

function LessonCard({ lesson }: { lesson: Lesson }) {
  const progress = lesson.progress ?? 0;
  const hasAudio = !!lesson.audio_url;
  return (
    <Link to={`/listen/${lesson.id}`} className="block">
      <Card className="hover:shadow-sm hover:border-primary/40 transition-all cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
          <span className="text-2xl">{subjectIcon(lesson.subject)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-sm truncate">{lesson.title}</h3>
              {lesson.is_downloaded ? (
                <Badge variant="secondary" className="text-[10px] gap-1 bg-success/10 text-success border-0 flex-shrink-0">
                  <WifiOff className="w-2.5 h-2.5" /> Offline
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] gap-1 bg-muted border-0 flex-shrink-0">
                  <Wifi className="w-2.5 h-2.5" /> Online
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{subjectName(lesson.subject)}</p>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex gap-1.5">
                {hasAudio && <Headphones className="w-3.5 h-3.5 text-primary" />}
                <ImageIcon className="w-3.5 h-3.5 text-secondary opacity-40" />
                <Brain className="w-3.5 h-3.5 text-accent opacity-40" />
              </div>
              <Progress value={progress} className="flex-1 h-1.5" />
              <span className="text-xs text-muted-foreground">{progress}%</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
