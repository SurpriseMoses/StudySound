import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Headphones, Brain, Image as ImageIcon, ArrowRight, Play, Sparkles,
  BookOpen, Battery, AlertCircle, Compass, Plus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import AppLayout from "@/components/AppLayout";
import UpgradeForRewardsBanner from "@/components/UpgradeForRewardsBanner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { subjects as ALL_SUBJECTS, getSubjectById } from "@/lib/subjects";

type ProfileBits = {
  display_name: string | null;
  credits_balance: number;
  selected_subjects: string[] | null;
  plan: string | null;
};

type ContinueLesson = {
  lessonId: string;
  documentId: string | null;
  title: string;
  subjectId: string;
  subjectName: string;
  icon: string;
  progress: number;
};

type RecommendedDoc = {
  id: string;
  title: string;
  subjectId: string;
};

const QUICK_ACTIONS = [
  {
    icon: Headphones,
    label: "Generate Audio",
    cost: "1 credit",
    desc: "Turn any text into narration",
    path: "/upload",
    tone: "from-primary/15 to-primary/5 text-primary border-primary/20",
  },
  {
    icon: ImageIcon,
    label: "Generate Visual",
    cost: "1 credit",
    desc: "AI scenes for your lesson",
    path: "/library",
    tone: "from-secondary/15 to-secondary/5 text-secondary border-secondary/20",
  },
  {
    icon: Brain,
    label: "Take Quiz",
    cost: "Free",
    desc: "Test what you've learned",
    path: "/library",
    tone: "from-accent/15 to-accent/5 text-accent border-accent/20",
  },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileBits | null>(null);
  const [cont, setCont] = useState<ContinueLesson | null>(null);
  const [recs, setRecs] = useState<RecommendedDoc[]>([]);
  const [hasLessons, setHasLessons] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);

      // Profile
      const { data: prof } = await supabase
        .from("profiles")
        .select("display_name, credits_balance, selected_subjects, plan")
        .eq("user_id", user.id)
        .maybeSingle();

      // Most recent progress → lesson
      const { data: prog } = await supabase
        .from("lesson_progress")
        .select("lesson_id, audio_progress_pct, last_updated_at")
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
          const subj = getSubjectById(lesson.subject);
          chosen = {
            lessonId: lesson.id,
            documentId: lesson.document_id,
            title: lesson.title,
            subjectId: lesson.subject,
            subjectName: subj?.name ?? lesson.subject,
            icon: subj?.icon ?? "📚",
            progress: Math.round(Number(prog.audio_progress_pct ?? 0)),
          };
        }
      }

      // Has any lessons at all? (drives "new vs returning")
      const { count: lessonCount } = await supabase
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);

      // Recommendations: seeded documents matching selected subjects (best-effort)
      const selected = (prof?.selected_subjects ?? []) as string[];
      let recDocs: RecommendedDoc[] = [];
      if (selected.length) {
        // documents.subject_type is an enum (novel/history/science/other), not our subject id,
        // so we just surface the most recent seeded docs and tag them by their type.
        const { data: docs } = await supabase
          .from("documents")
          .select("id, title, subject_type")
          .eq("is_seeded", true)
          .order("created_at", { ascending: false })
          .limit(4);
        recDocs = (docs ?? []).map((d) => ({
          id: d.id,
          title: d.title,
          subjectId: d.subject_type as string,
        }));
      }

      if (!cancelled) {
        setProfile(prof as ProfileBits | null);
        setCont(chosen);
        setHasLessons((lessonCount ?? 0) > 0);
        setRecs(recDocs);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const userSubjects = useMemo(() => {
    const ids = profile?.selected_subjects ?? [];
    return ids.map((id) => getSubjectById(id)).filter(Boolean) as typeof ALL_SUBJECTS;
  }, [profile]);

  const credits = profile?.credits_balance ?? 0;
  const lowCredits = credits <= 5;
  const firstName = profile?.display_name?.split(" ")[0] || "Learner";
  const isReturning = hasLessons;
  const resumePath = cont?.documentId ? `/lesson/${cont.documentId}` : null;

  return (
    <AppLayout>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="space-y-8"
      >
        {/* Free-tier upsell w/ expiry urgency */}
        <UpgradeForRewardsBanner />

        {/* HERO */}
        <section>
          <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card to-secondary/10 rounded-2xl">
            <CardContent className="p-6 md:p-8">
              <div className="flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-primary/80 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    {loading ? "Welcome" : isReturning ? "Welcome back" : "Welcome"}
                  </p>
                  <h1 className="text-2xl md:text-3xl font-display font-bold mt-1 min-h-[2.25rem] md:min-h-[2.75rem]">
                    {loading ? (
                      <span className="inline-block h-7 md:h-9 w-56 rounded-md bg-muted animate-pulse align-middle" />
                    ) : isReturning ? (
                      `Welcome back, ${firstName} 👋`
                    ) : (
                      `Hi ${firstName} 👋`
                    )}
                  </h1>
                  <p className="text-muted-foreground mt-2 max-w-xl">
                    {loading
                      ? "Loading your learning space…"
                      : isReturning
                      ? "Pick up where you left off, or generate something new."
                      : `You have ${credits} free credits — start your first lesson and turn any text into audio in seconds.`}
                  </p>

                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    {isReturning && resumePath ? (
                      <Link to={resumePath}>
                        <Button size="lg" className="gap-2 rounded-xl">
                          <Play className="w-4 h-4 fill-current" /> Continue learning
                        </Button>
                      </Link>
                    ) : (
                      <Link to="/upload">
                        <Button size="lg" className="gap-2 rounded-xl">
                          <Headphones className="w-4 h-4" /> Generate your first narration
                        </Button>
                      </Link>
                    )}
                    <Link to="/subjects">
                      <Button size="lg" variant="outline" className="gap-2 rounded-xl">
                        <Compass className="w-4 h-4" /> Browse subjects
                      </Button>
                    </Link>
                  </div>
                </div>

                {/* Credits orb */}
                <div className="shrink-0 self-start md:self-center">
                  <div className="rounded-2xl border bg-background/70 backdrop-blur px-5 py-4 text-center min-w-[140px]">
                    <div className="flex items-center justify-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
                      <Battery className="w-3.5 h-3.5" /> Credits
                    </div>
                    <p className="font-display font-bold text-3xl mt-1">{credits}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">1 credit = 1 generation</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* CONTINUE LEARNING */}
        {cont && resumePath && (
          <section>
            <h2 className="font-display font-semibold text-lg mb-3 flex items-center gap-2">
              <Play className="w-4 h-4 text-primary" /> Continue learning
            </h2>
            <Card className="rounded-2xl hover:shadow-md transition-shadow">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center text-3xl shrink-0">
                  {cont.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{cont.subjectName}</p>
                  <p className="font-display font-semibold truncate">{cont.title}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <Progress value={cont.progress} className="h-1.5 flex-1 max-w-xs" />
                    <span className="text-xs text-muted-foreground shrink-0">{cont.progress}%</span>
                  </div>
                </div>
                <Link to={resumePath} className="shrink-0">
                  <Button size="sm" className="gap-1.5 rounded-xl">
                    Continue <Play className="w-3.5 h-3.5 fill-current" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </section>
        )}

        {/* QUICK ACTIONS */}
        <section>
          <h2 className="font-display font-semibold text-lg mb-3">Quick actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {QUICK_ACTIONS.map((a) => (
              <Link key={a.label} to={a.path}>
                <Card
                  className={`rounded-2xl border bg-gradient-to-br ${a.tone} hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer h-full`}
                >
                  <CardContent className="p-5 flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-background/70 flex items-center justify-center">
                      <a.icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-display font-semibold text-foreground">{a.label}</p>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-background/70 text-foreground/70">
                          {a.cost}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{a.desc}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        {/* YOUR SUBJECTS */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-semibold text-lg">Your subjects</h2>
            <Link to="/profile" className="text-xs text-primary hover:underline flex items-center gap-1">
              Edit <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-2xl bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : userSubjects.length === 0 ? (
            <Card className="rounded-2xl border-dashed">
              <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                  <BookOpen className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-display font-semibold">Pick your subjects</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                    Tell us what you're studying and we'll personalize your dashboard.
                  </p>
                </div>
                <Link to="/onboarding">
                  <Button size="sm" className="gap-2 rounded-xl">
                    <Plus className="w-4 h-4" /> Choose subjects
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {userSubjects.map((s) => (
                <Link key={s.id} to={`/subjects?focus=${s.id}`}>
                  <Card className="rounded-2xl hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer h-full">
                    <CardContent className="p-4 flex flex-col gap-2">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl"
                        style={{ backgroundColor: `${s.color.replace("hsl", "hsla").replace(")", " / 0.12)")}` }}
                      >
                        {s.icon}
                      </div>
                      <p className="font-semibold text-sm truncate">{s.name}</p>
                      <p className="text-[11px] text-muted-foreground line-clamp-2">{s.description}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* RECOMMENDED */}
        {recs.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-semibold text-lg">Recommended for you</h2>
              <Link to="/subjects" className="text-xs text-primary hover:underline flex items-center gap-1">
                See all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {recs.slice(0, 4).map((doc) => (
                <Link key={doc.id} to={`/lesson/${doc.id}`}>
                  <Card className="rounded-2xl hover:shadow-md transition-all cursor-pointer h-full">
                    <CardContent className="p-4">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{doc.subjectId}</p>
                      <p className="font-display font-semibold text-sm mt-1 line-clamp-2">{doc.title}</p>
                      <div className="mt-3 flex items-center text-xs text-primary">
                        Open <ArrowRight className="w-3 h-3 ml-1" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* LOW CREDIT NUDGE */}
        {!loading && lowCredits && (
          <section>
            <Card className="rounded-2xl border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-card to-background">
              <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display font-semibold">You're running low on credits</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Only {credits} credit{credits === 1 ? "" : "s"} left. Upgrade to keep generating without interruption.
                  </p>
                </div>
                <Link to="/plans" className="shrink-0">
                  <Button className="rounded-xl gap-2">
                    Upgrade plan <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </section>
        )}
      </motion.div>
    </AppLayout>
  );
}
