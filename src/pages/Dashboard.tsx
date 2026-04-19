import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Upload, Headphones, Brain, Image, ArrowRight, Play, Sparkles, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import AppLayout from "@/components/AppLayout";
import UpgradeForRewardsBanner from "@/components/UpgradeForRewardsBanner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { subjects } from "@/lib/subjects";

const startActions = [
  { icon: Upload, label: "Upload Content", desc: "Add a new document", path: "/upload", color: "bg-primary/10 text-primary" },
  { icon: Headphones, label: "My Library", desc: "Open your lessons", path: "/library", color: "bg-secondary/10 text-secondary" },
  { icon: Brain, label: "Browse Subjects", desc: "Explore curriculum", path: "/subjects", color: "bg-accent/10 text-accent" },
  { icon: Image, label: "Plans", desc: "Upgrade for more", path: "/plans", color: "bg-success/10 text-success" },
];

type ContinueLesson = {
  lessonId: string;
  documentId: string | null;
  title: string;
  subject: string;
  icon: string;
  progress: number;
  sectionsCompleted: number;
  sectionsTotal: number;
};

const stats = [
  { label: "Uploads", used: 3, total: 10, icon: Upload },
  { label: "Audio mins", used: 42, total: 120, icon: Headphones },
  { label: "Quiz Qs", used: 18, total: 50, icon: Brain },
  { label: "Visuals", used: 5, total: 0, icon: Image },
];

const subjectIcon = (id: string) => subjects.find((s) => s.id === id)?.icon ?? "📚";
const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? id;

export default function Dashboard() {
  const { user } = useAuth();
  const [cont, setCont] = useState<ContinueLesson | null>(null);
  const [contLoading, setContLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setContLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setContLoading(true);
      // Most recently updated lesson_progress row → join lesson info.
      const { data: prog } = await supabase
        .from("lesson_progress")
        .select("lesson_id, audio_progress_pct, sections_completed, sections_total, last_updated_at")
        .eq("user_id", user.id)
        .order("last_updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let chosen: ContinueLesson | null = null;
      if (prog) {
        const { data: lesson } = await supabase
          .from("lessons")
          .select("id, title, subject, document_id")
          .eq("id", prog.lesson_id)
          .maybeSingle();
        if (lesson) {
          chosen = {
            lessonId: lesson.id,
            documentId: lesson.document_id,
            title: lesson.title,
            subject: subjectName(lesson.subject),
            icon: subjectIcon(lesson.subject),
            progress: Math.round(Number(prog.audio_progress_pct ?? 0)),
            sectionsCompleted: prog.sections_completed ?? 0,
            sectionsTotal: prog.sections_total ?? 0,
          };
        }
      }
      // Fallback: no progress yet — surface the most recent lesson if one exists.
      if (!chosen) {
        const { data: lesson } = await supabase
          .from("lessons")
          .select("id, title, subject, document_id")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lesson) {
          chosen = {
            lessonId: lesson.id,
            documentId: lesson.document_id,
            title: lesson.title,
            subject: subjectName(lesson.subject),
            icon: subjectIcon(lesson.subject),
            progress: 0,
            sectionsCompleted: 0,
            sectionsTotal: 0,
          };
        }
      }
      if (!cancelled) {
        setCont(chosen);
        setContLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const resumePath = cont?.documentId ? `/lesson/${cont.documentId}` : null;

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-display font-bold">Welcome back, Learner 👋</h1>
          <p className="text-muted-foreground mt-1">Pick up where you left off or start something new.</p>
        </div>

        {/* Free-tier upsell — daily rewards locked behind Essential */}
        <UpgradeForRewardsBanner />

        {/* Continue Learning — hero */}
        <section className="mb-10">
          <h2 className="font-display font-semibold text-lg mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Continue Learning
          </h2>

          {contLoading ? (
            <Card className="border-primary/20">
              <CardContent className="p-5 md:p-6">
                <div className="h-16 animate-pulse rounded-xl bg-muted/50" />
              </CardContent>
            </Card>
          ) : cont && resumePath ? (
            <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-secondary/5">
              <CardContent className="p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-5">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-background border flex items-center justify-center text-3xl shrink-0">
                    {cont.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{cont.subject}</p>
                    <p className="font-display font-semibold text-base md:text-lg truncate">{cont.title}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <Progress value={cont.progress} className="h-1.5 flex-1 max-w-xs" />
                      <span className="text-xs font-medium text-muted-foreground shrink-0">{cont.progress}%</span>
                    </div>
                    {cont.sectionsTotal > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Section {Math.min(cont.sectionsCompleted + 1, cont.sectionsTotal)} of {cont.sectionsTotal}
                      </p>
                    )}
                  </div>
                </div>
                <Link to={resumePath} className="shrink-0">
                  <Button size="lg" className="w-full md:w-auto gap-2">
                    <Play className="w-4 h-4 fill-current" /> Resume
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed border-primary/30 bg-gradient-to-br from-primary/5 via-card to-secondary/5">
              <CardContent className="p-6 md:p-8 flex flex-col items-center text-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                  <BookOpen className="w-7 h-7" />
                </div>
                <div>
                  <p className="font-display font-semibold text-lg">Start Learning</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md">
                    You haven't started a lesson yet. Upload your own material or browse ready-made content to get going.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <Link to="/upload" className="w-full sm:w-auto">
                    <Button size="lg" className="w-full gap-2">
                      <Upload className="w-4 h-4" /> Upload Content
                    </Button>
                  </Link>
                  <Link to="/library" className="w-full sm:w-auto">
                    <Button size="lg" variant="outline" className="w-full gap-2">
                      <Headphones className="w-4 h-4" /> Go to Library
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Start Learning — actions */}
        <section className="mb-10">
          <h2 className="font-display font-semibold text-lg mb-3">Start Learning</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {startActions.map(action => (
              <Link key={action.path} to={action.path}>
                <Card className="hover:shadow-md hover:border-primary/30 transition-all cursor-pointer h-full">
                  <CardContent className="p-4 flex flex-col gap-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${action.color}`}>
                      <action.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{action.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{action.desc}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        {/* Usage stats — secondary */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">This month</h2>
            <Link to="/plans" className="text-xs text-primary flex items-center gap-1 hover:underline">
              View plan <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {stats.map(stat => (
              <div key={stat.label} className="rounded-lg border bg-card/50 px-3 py-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <stat.icon className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[11px] font-medium text-muted-foreground">{stat.label}</span>
                </div>
                <p className="text-sm font-display font-semibold">
                  {stat.used}
                  {stat.total > 0 && <span className="text-xs text-muted-foreground font-normal">/{stat.total}</span>}
                </p>
                {stat.total > 0 && <Progress value={(stat.used / stat.total) * 100} className="mt-1.5 h-1" />}
              </div>
            ))}
          </div>
        </section>
      </motion.div>
    </AppLayout>
  );
}
