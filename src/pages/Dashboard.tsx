import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Upload, Headphones, Brain, Image, ArrowRight, Play, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import AppLayout from "@/components/AppLayout";

const startActions = [
  { icon: Upload, label: "Upload Content", desc: "Add a new document", path: "/upload", color: "bg-primary/10 text-primary" },
  { icon: Headphones, label: "My Library", desc: "Open your lessons", path: "/library", color: "bg-secondary/10 text-secondary" },
  { icon: Brain, label: "Browse Subjects", desc: "Explore curriculum", path: "/subjects", color: "bg-accent/10 text-accent" },
  { icon: Image, label: "Plans", desc: "Upgrade for more", path: "/plans", color: "bg-success/10 text-success" },
];

const continueLesson = {
  title: "Great Expectations — Ch. 3",
  subject: "English",
  progress: 72,
  icon: "📖",
  path: "/library",
};

const stats = [
  { label: "Uploads", used: 3, total: 10, icon: Upload },
  { label: "Audio mins", used: 42, total: 120, icon: Headphones },
  { label: "Quiz Qs", used: 18, total: 50, icon: Brain },
  { label: "Visuals", used: 5, total: 0, icon: Image },
];

export default function Dashboard() {
  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-display font-bold">Welcome back, Learner 👋</h1>
          <p className="text-muted-foreground mt-1">Pick up where you left off or start something new.</p>
        </div>

        {/* Continue Learning — hero */}
        <section className="mb-10">
          <h2 className="font-display font-semibold text-lg mb-3 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Continue Learning
          </h2>
          <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-secondary/5">
            <CardContent className="p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-5">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-background border flex items-center justify-center text-3xl shrink-0">
                  {continueLesson.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{continueLesson.subject}</p>
                  <p className="font-display font-semibold text-base md:text-lg truncate">{continueLesson.title}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <Progress value={continueLesson.progress} className="h-1.5 flex-1 max-w-xs" />
                    <span className="text-xs font-medium text-muted-foreground shrink-0">{continueLesson.progress}%</span>
                  </div>
                </div>
              </div>
              <Link to={continueLesson.path} className="shrink-0">
                <Button size="lg" className="w-full md:w-auto gap-2">
                  <Play className="w-4 h-4 fill-current" /> Resume
                </Button>
              </Link>
            </CardContent>
          </Card>
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
