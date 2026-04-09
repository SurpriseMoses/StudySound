import { motion } from "framer-motion";
import { Download, Headphones, Brain, Image, Wifi, WifiOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AppLayout from "@/components/AppLayout";

const savedLessons = [
  { id: 1, title: "Great Expectations — Ch. 1-3", subject: "English", icon: "📖", downloaded: true, hasAudio: true, hasVisuals: true, hasQuiz: true, progress: 72 },
  { id: 2, title: "World War II", subject: "History", icon: "🏛️", downloaded: true, hasAudio: true, hasVisuals: true, hasQuiz: true, progress: 45 },
  { id: 3, title: "Ecosystems", subject: "Life Sciences", icon: "🧬", downloaded: false, hasAudio: true, hasVisuals: true, hasQuiz: true, progress: 90 },
  { id: 4, title: "Algebra Basics", subject: "Mathematics", icon: "📐", downloaded: false, hasAudio: true, hasVisuals: false, hasQuiz: true, progress: 20 },
];

export default function LibraryPage() {
  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-display font-bold mb-1">Library</h1>
        <p className="text-muted-foreground text-sm mb-6">Your saved lessons, quizzes, and visuals. Downloaded items work offline.</p>

        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="downloaded">Downloaded</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4 space-y-3">
            {savedLessons.map(lesson => (
              <LessonCard key={lesson.id} lesson={lesson} />
            ))}
          </TabsContent>

          <TabsContent value="downloaded" className="mt-4 space-y-3">
            {savedLessons.filter(l => l.downloaded).map(lesson => (
              <LessonCard key={lesson.id} lesson={lesson} />
            ))}
          </TabsContent>
        </Tabs>
      </motion.div>
    </AppLayout>
  );
}

function LessonCard({ lesson }: { lesson: typeof savedLessons[0] }) {
  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">{lesson.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-sm truncate">{lesson.title}</h3>
              {lesson.downloaded ? (
                <Badge variant="secondary" className="text-[10px] gap-1 bg-success/10 text-success border-0 flex-shrink-0">
                  <WifiOff className="w-2.5 h-2.5" /> Offline
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] gap-1 bg-muted border-0 flex-shrink-0">
                  <Wifi className="w-2.5 h-2.5" /> Online
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{lesson.subject}</p>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex gap-1.5">
                {lesson.hasAudio && <Headphones className="w-3.5 h-3.5 text-primary" />}
                {lesson.hasVisuals && <Image className="w-3.5 h-3.5 text-secondary" />}
                {lesson.hasQuiz && <Brain className="w-3.5 h-3.5 text-accent" />}
              </div>
              <Progress value={lesson.progress} className="flex-1 h-1.5" />
              <span className="text-xs text-muted-foreground">{lesson.progress}%</span>
            </div>
          </div>
          {!lesson.downloaded && (
            <Button variant="outline" size="icon" className="flex-shrink-0 h-8 w-8">
              <Download className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
