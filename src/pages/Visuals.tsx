import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Image as ImageIcon, AlertTriangle, Sparkles, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AppLayout from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

type LessonOpt = {
  id: string;
  title: string;
  subject: string;
  document_id: string | null;
  documents: { subject_type: string | null } | null;
};

type Scene = {
  id: string;
  scene_index: number;
  prompt_text: string;
  storage_path: string;
  signedUrl?: string;
  paragraph?: string;
};

const HUMANITIES = new Set(["novel", "history"]);

interface VisualsProps {
  lessonId?: string;
  embedded?: boolean;
}

export default function Visuals({ lessonId: initialLessonId, embedded = false }: VisualsProps = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [lessons, setLessons] = useState<LessonOpt[]>([]);
  const [selectedLessonId, setSelectedLessonId] = useState<string>(initialLessonId ?? "");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const selectedLesson = lessons.find((l) => l.id === selectedLessonId);
  const isHumanities = selectedLesson ? HUMANITIES.has(selectedLesson.documents?.subject_type ?? "") : false;

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase
        .from("lessons")
        .select("id, title, subject, document_id, documents(subject_type)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) {
        toast({ title: "Failed to load lessons", description: error.message, variant: "destructive" });
        return;
      }
      setLessons((data ?? []) as LessonOpt[]);
    })();
  }, [user, toast]);

  const signScenes = async (raw: Scene[]): Promise<Scene[]> => {
    if (raw.length === 0) return [];
    const paths = raw.map((s) => s.storage_path);
    // Batch sign — single request, more reliable than sequential
    const { data, error } = await supabase.storage.from("assets").createSignedUrls(paths, 3600);
    if (error) {
      console.error("[Visuals] createSignedUrls error:", error);
      return raw;
    }
    const byPath = new Map<string, string>();
    (data ?? []).forEach((d) => {
      if (d.signedUrl && !d.error) byPath.set(d.path ?? "", d.signedUrl);
      else console.warn("[Visuals] sign failed for", d.path, d.error);
    });
    return raw.map((s) => ({ ...s, signedUrl: byPath.get(s.storage_path) }));
  };

  const loadCached = async (lesson: LessonOpt) => {
    if (!lesson.document_id) { setScenes([]); return; }
    setLoading(true);
    const { data } = await supabase
      .from("image_assets")
      .select("id, scene_index, prompt_text, storage_path")
      .eq("document_id", lesson.document_id)
      .order("scene_index", { ascending: true });
    setScenes(await signScenes((data ?? []) as Scene[]));
    setLoading(false);
  };

  useEffect(() => {
    if (!selectedLesson) { setScenes([]); return; }
    loadCached(selectedLesson);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLessonId]);

  const generate = async () => {
    if (!selectedLesson) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-visuals", {
        body: { lesson_id: selectedLesson.id },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({
        title: data.reused ? "Loaded from cache" : "Visuals generated",
        description: data.reused
          ? "These scenes were already generated — instant, no cost."
          : `${data.scenes?.length ?? 0} scenes ready.`,
      });
      await loadCached(selectedLesson);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Generation failed", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    embedded ? <>{children}</> : <AppLayout>{children}</AppLayout>;

  return (
    <Wrapper>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        {!embedded && (
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-display font-bold">Visual Scenes</h1>
              <p className="text-muted-foreground text-sm">AI-generated illustrations for your lessons</p>
            </div>
            <Badge variant="secondary" className="gap-1 bg-secondary/10 text-secondary border-0">
              <ImageIcon className="w-3 h-3" /> Premium Feature
            </Badge>
          </div>
        )}

        <Card className="mb-6 border-warning/30 bg-warning/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Available for humanities subjects (novels, history)</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                STEM subjects use text + quiz format. Scenes are cached globally — once generated, every student gets them instantly.
              </p>
            </div>
          </CardContent>
        </Card>

        {!embedded && (
          <div className="max-w-2xl mb-6">
            <label className="text-sm font-medium mb-1.5 block">Choose a lesson</label>
            <Select value={selectedLessonId} onValueChange={setSelectedLessonId}>
              <SelectTrigger>
                <SelectValue placeholder={lessons.length === 0 ? "No lessons yet — upload one first" : "Select a lesson"} />
              </SelectTrigger>
              <SelectContent>
                {lessons.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.title} — {l.subject}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selectedLesson && (
          <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-display font-semibold">{selectedLesson.title}</h2>
              <p className="text-sm text-muted-foreground">
                {selectedLesson.subject}
                {scenes.length > 0 && ` — ${scenes.length} scene${scenes.length === 1 ? "" : "s"} ready`}
              </p>
            </div>
            {isHumanities ? (
              <Button onClick={generate} disabled={generating} size="sm">
                {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> :
                  scenes.length > 0 ? <RefreshCw className="w-4 h-4 mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                {scenes.length > 0 ? "Regenerate" : "Generate Visuals"}
              </Button>
            ) : (
              <Badge variant="outline" className="text-xs">STEM lesson — visuals not supported</Badge>
            )}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading scenes…
          </div>
        )}

        {!loading && selectedLesson && scenes.length === 0 && isHumanities && (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center">
              <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium">No visuals yet for this lesson</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click "Generate Visuals" to create 4 illustrated scenes from the text.
              </p>
            </CardContent>
          </Card>
        )}

        {scenes.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-4">
            {scenes.map((scene, i) => (
              <motion.div
                key={scene.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
              >
                <Card className="overflow-hidden hover:shadow-md transition-shadow">
                  <div className="aspect-[16/10] bg-muted flex items-center justify-center overflow-hidden">
                    {scene.signedUrl ? (
                      <img
                        src={scene.signedUrl}
                        alt={scene.prompt_text}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="w-10 h-10 text-muted-foreground" />
                    )}
                  </div>
                  <CardContent className="p-4">
                    <p className="text-sm text-foreground/80 italic line-clamp-3">"{scene.prompt_text}"</p>
                    <p className="text-xs text-muted-foreground mt-2">Scene {scene.scene_index} of {scenes.length}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </Wrapper>
  );
}
