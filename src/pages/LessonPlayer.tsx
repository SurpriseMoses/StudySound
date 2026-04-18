import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Headphones, Brain, Image as ImageIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AppLayout from "@/components/AppLayout";
import Listen from "./Listen";
import Quiz from "./Quiz";
import Visuals from "./Visuals";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { subjects } from "@/lib/subjects";

type Tab = "listen" | "quiz" | "visuals";
const VALID_TABS: Tab[] = ["listen", "quiz", "visuals"];

export default function LessonPlayer() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [lessonTitle, setLessonTitle] = useState<string>("");
  const [lessonSubject, setLessonSubject] = useState<string>("");

  const tabParam = searchParams.get("tab") as Tab | null;
  const activeTab: Tab = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "listen";

  useEffect(() => {
    if (!lessonId || !user) return;
    (async () => {
      const { data } = await supabase
        .from("lessons")
        .select("title, subject")
        .eq("id", lessonId)
        .maybeSingle();
      if (data) {
        setLessonTitle(data.title);
        setLessonSubject(data.subject);
      }
    })();
  }, [lessonId, user]);

  const onTabChange = (next: string) => {
    if (next === "listen") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: next }, { replace: true });
    }
  };

  const subjectName = subjects.find((s) => s.id === lessonSubject)?.name ?? lessonSubject;
  const subjectIcon = subjects.find((s) => s.id === lessonSubject)?.icon ?? "📚";

  if (!lessonId) {
    navigate("/library");
    return null;
  }

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Link to="/library" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Library
        </Link>

        <div className="mb-6 flex items-start gap-3">
          <span className="text-3xl">{subjectIcon}</span>
          <div className="min-w-0">
            <h1 className="text-2xl font-display font-bold truncate">{lessonTitle || "Loading…"}</h1>
            <p className="text-muted-foreground text-sm">{subjectName}</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="listen" className="gap-1.5">
              <Headphones className="w-4 h-4" /> Listen
            </TabsTrigger>
            <TabsTrigger value="quiz" className="gap-1.5">
              <Brain className="w-4 h-4" /> Quiz
            </TabsTrigger>
            <TabsTrigger value="visuals" className="gap-1.5">
              <ImageIcon className="w-4 h-4" /> Visuals
            </TabsTrigger>
          </TabsList>

          <TabsContent value="listen" forceMount hidden={activeTab !== "listen"}>
            <Listen lessonId={lessonId} embedded />
          </TabsContent>
          <TabsContent value="quiz" forceMount hidden={activeTab !== "quiz"}>
            <Quiz lessonId={lessonId} embedded />
          </TabsContent>
          <TabsContent value="visuals" forceMount hidden={activeTab !== "visuals"}>
            <Visuals lessonId={lessonId} embedded />
          </TabsContent>
        </Tabs>
      </motion.div>
    </AppLayout>
  );
}
