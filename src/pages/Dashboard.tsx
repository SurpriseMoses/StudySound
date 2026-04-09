import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Upload, Headphones, Brain, Image, BookOpen, ArrowRight, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import AppLayout from "@/components/AppLayout";

const quickActions = [
  { icon: Upload, label: "Upload Content", path: "/upload", color: "bg-primary/10 text-primary" },
  { icon: Headphones, label: "Listen", path: "/listen", color: "bg-secondary/10 text-secondary" },
  { icon: Brain, label: "Take Quiz", path: "/quiz", color: "bg-accent/10 text-accent" },
  { icon: Image, label: "View Visuals", path: "/visuals", color: "bg-success/10 text-success" },
];

const recentLessons = [
  { title: "Great Expectations — Ch. 3", subject: "English", progress: 72, icon: "📖" },
  { title: "World War II Overview", subject: "History", progress: 45, icon: "🏛️" },
  { title: "Ecosystems & Biomes", subject: "Life Sciences", progress: 90, icon: "🧬" },
];

export default function Dashboard() {
  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-display font-bold">Welcome back, Learner 👋</h1>
          <p className="text-muted-foreground mt-1">Pick up where you left off or start something new.</p>
        </div>

        {/* Usage stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {[
            { label: "Uploads", used: 3, total: 10, icon: Upload },
            { label: "Audio mins", used: 42, total: 120, icon: Headphones },
            { label: "Quiz Qs", used: 18, total: 50, icon: Brain },
            { label: "Visuals", used: 5, total: 0, icon: Image },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">{stat.label}</span>
                </div>
                <p className="text-xl font-display font-bold">
                  {stat.used}{stat.total > 0 && <span className="text-sm text-muted-foreground font-normal">/{stat.total}</span>}
                </p>
                {stat.total > 0 && <Progress value={(stat.used / stat.total) * 100} className="mt-2 h-1.5" />}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {quickActions.map(action => (
            <Link key={action.path} to={action.path}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="p-4 flex flex-col items-center text-center gap-3">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${action.color}`}>
                    <action.icon className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-medium">{action.label}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Recent lessons */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-lg">Recent Lessons</h2>
            <Link to="/library" className="text-sm text-primary flex items-center gap-1 hover:underline">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="space-y-3">
            {recentLessons.map(lesson => (
              <Card key={lesson.title} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center gap-4">
                  <span className="text-2xl">{lesson.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{lesson.title}</p>
                    <p className="text-xs text-muted-foreground">{lesson.subject}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold">{lesson.progress}%</p>
                    </div>
                    <Progress value={lesson.progress} className="w-20 h-1.5" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </motion.div>
    </AppLayout>
  );
}
