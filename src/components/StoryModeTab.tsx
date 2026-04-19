import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Image as ImageIcon, Loader2, Sparkles, ChevronLeft, ChevronRight,
  AlertTriangle, Lock, Play, Pause, Film,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";

const HUMANITIES = new Set(["novel", "history"]);
const SCENE_COST = 6;
const BUNDLE_COST = 15;
const BUNDLE_INDEX = -1;
const FREE_SCENE = 0;

type Scene = {
  id: string;
  scene_index: number;
  prompt_text: string;
  storage_path: string;
  signedUrl?: string;
};

export default function StoryModeTab({
  documentId,
  lessonId,
  subjectType,
}: {
  documentId: string;
  lessonId: string;
  subjectType: string | null;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [unlocked, setUnlocked] = useState<Set<number>>(new Set([FREE_SCENE]));
  const [hasBundle, setHasBundle] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const isHumanities = HUMANITIES.has(subjectType ?? "");
  const autoplayRef = useRef<number | null>(null);

  const signScenes = async (raw: Scene[]): Promise<Scene[]> => {
    if (raw.length === 0) return [];
    const paths = raw.map((s) => s.storage_path);
    const { data, error } = await supabase.storage.from("assets").createSignedUrls(paths, 3600);
    if (error) return raw;
    const byPath = new Map<string, string>();
    (data ?? []).forEach((d) => { if (d.signedUrl && !d.error) byPath.set(d.path ?? "", d.signedUrl); });
    return raw.map((s) => ({ ...s, signedUrl: byPath.get(s.storage_path) }));
  };

  const loadUnlocks = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("scene_unlocks")
      .select("scene_index")
      .eq("user_id", user.id)
      .eq("document_id", documentId);
    const idxs = (data ?? []).map((r: any) => r.scene_index as number);
    const bundle = idxs.includes(BUNDLE_INDEX);
    setHasBundle(bundle);
    setUnlocked(new Set<number>([FREE_SCENE, ...idxs.filter((i) => i >= 0)]));
  }, [user, documentId]);

  const loadScenes = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("image_assets")
      .select("id, scene_index, prompt_text, storage_path")
      .eq("document_id", documentId)
      .order("scene_index", { ascending: true });
    setScenes(await signScenes((data ?? []) as Scene[]));
    await loadUnlocks();
    setLoading(false);
  }, [documentId, loadUnlocks]);

  useEffect(() => { loadScenes(); setActive(0); }, [loadScenes]);

  // Autoplay (only across unlocked scenes)
  useEffect(() => {
    if (!autoplay || scenes.length === 0) return;
    autoplayRef.current = window.setTimeout(() => {
      setActive((i) => {
        // find next unlocked scene
        for (let step = 1; step < scenes.length; step++) {
          const next = (i + step) % scenes.length;
          const s = scenes[next];
          if (hasBundle || unlocked.has(s.scene_index)) return next;
        }
        return i;
      });
    }, 5000);
    return () => { if (autoplayRef.current) clearTimeout(autoplayRef.current); };
  }, [autoplay, active, scenes, unlocked, hasBundle]);

  const generate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-visuals", {
        body: { lesson_id: lessonId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({
        title: data.reused ? "Story scenes ready" : "Story scenes generated",
        description: data.reused
          ? "Free — already created for another reader."
          : `${data.scenes?.length ?? 0} cinematic scenes ready to unlock.`,
      });
      await loadScenes();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Generation failed", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const unlock = async (mode: "scene" | "bundle", scene_index?: number) => {
    setUnlocking(mode === "bundle" ? "bundle" : `scene-${scene_index}`);
    try {
      const { data, error } = await supabase.functions.invoke("unlock-scene", {
        body: { document_id: documentId, mode, scene_index },
      });
      if (error) throw new Error(error.message);
      if (data?.error) {
        if (data.error === "Insufficient credits") {
          toast({
            title: "Not enough credits",
            description: `Need ${data.required}, you have ${data.balance}.`,
            variant: "destructive",
          });
          return;
        }
        throw new Error(data.error);
      }
      toast({
        title: mode === "bundle" ? "Full story unlocked" : "Scene unlocked",
        description: data.charged ? `−${data.charged} credits` : "Already unlocked",
      });
      await loadUnlocks();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Unlock failed", description: msg, variant: "destructive" });
    } finally {
      setUnlocking(null);
    }
  };

  if (!isHumanities) {
    return (
      <Card className="border-warning/30 bg-warning/5">
        <CardContent className="p-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
          <div>
            <p className="text-sm font-medium">Story Mode is for novels and history</p>
            <p className="text-xs text-muted-foreground mt-1">
              STEM lessons use a text + quiz format instead.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading story scenes…
      </div>
    );
  }

  if (scenes.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-10 text-center">
          <Film className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">No story scenes yet</p>
          <p className="text-xs text-muted-foreground mb-4">
            Bring this lesson to life with cinematic illustrations.
          </p>
          <Button onClick={generate} disabled={generating} size="sm">
            {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Unlock story scenes
          </Button>
          <p className="text-[11px] text-muted-foreground mt-3">
            First scene is free • Each next scene {SCENE_COST} credits • Full story {BUNDLE_COST} credits
          </p>
        </CardContent>
      </Card>
    );
  }

  const current = scenes[active];
  const currentLocked = !hasBundle && !unlocked.has(current?.scene_index ?? 0);
  const lockedCount = scenes.filter((s) => !hasBundle && !unlocked.has(s.scene_index)).length;

  return (
    <div className="space-y-4">
      {/* Cinematic viewer — full-bleed dark stage */}
      <div className="relative -mx-4 sm:mx-0 sm:rounded-2xl overflow-hidden bg-black aspect-[16/10] sm:aspect-[16/9] shadow-2xl">
        <AnimatePresence mode="wait">
          {current?.signedUrl ? (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, scale: 1.02 }}
              animate={{
                opacity: 1,
                scale: currentLocked ? 1.02 : [1, 1.06],
              }}
              exit={{ opacity: 0 }}
              transition={{
                opacity: { duration: 0.6 },
                scale: currentLocked
                  ? { duration: 0.6 }
                  : { duration: 12, ease: "linear", repeat: Infinity, repeatType: "reverse" },
              }}
              className="absolute inset-0"
            >
              <img
                src={current.signedUrl}
                alt={current.prompt_text}
                className={`w-full h-full object-cover transition-all duration-700 ${
                  currentLocked ? "blur-2xl scale-110" : ""
                }`}
              />
              {/* Cinematic vignette */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/40 pointer-events-none" />
            </motion.div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <ImageIcon className="w-12 h-12 text-white/20" />
            </div>
          )}
        </AnimatePresence>

        {/* Lock overlay */}
        {currentLocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex flex-col items-center justify-center text-white p-6 text-center"
          >
            <div className="w-14 h-14 rounded-full bg-white/10 backdrop-blur flex items-center justify-center mb-3 ring-1 ring-white/20">
              <Lock className="w-6 h-6" />
            </div>
            <p className="text-xs uppercase tracking-widest text-white/60 mb-1">Scene {(current?.scene_index ?? 0) + 1}</p>
            <p className="text-base font-display font-semibold mb-4 max-w-md">Unlock to reveal this scene</p>
            <div className="flex flex-col sm:flex-row gap-2 w-full max-w-sm">
              <Button
                onClick={() => unlock("scene", current!.scene_index)}
                disabled={unlocking !== null}
                className="flex-1 bg-white text-black hover:bg-white/90"
              >
                {unlocking === `scene-${current?.scene_index}` ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Lock className="w-4 h-4 mr-2" />
                )}
                Unlock scene · {SCENE_COST} credits
              </Button>
              {lockedCount > 1 && !hasBundle && (
                <Button
                  onClick={() => unlock("bundle")}
                  disabled={unlocking !== null}
                  variant="outline"
                  className="flex-1 border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
                >
                  {unlocking === "bundle" ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-2" />
                  )}
                  Unlock full story · {BUNDLE_COST}
                </Button>
              )}
            </div>
          </motion.div>
        )}

        {/* Scene caption (only when unlocked) */}
        {!currentLocked && current && (
          <div className="absolute left-0 right-0 bottom-0 p-4 sm:p-6 text-white pointer-events-none">
            <Badge variant="secondary" className="bg-white/15 text-white border-0 backdrop-blur text-[10px] mb-2">
              Scene {active + 1} of {scenes.length}
              {current.scene_index === FREE_SCENE && " · Free preview"}
            </Badge>
            <p className="text-sm sm:text-base italic leading-snug max-w-2xl line-clamp-3">
              "{current.prompt_text}"
            </p>
          </div>
        )}

        {/* Nav arrows */}
        {scenes.length > 1 && (
          <>
            <button
              onClick={() => setActive((i) => Math.max(0, i - 1))}
              disabled={active === 0}
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 backdrop-blur flex items-center justify-center text-white disabled:opacity-20 hover:bg-white/20 transition"
              aria-label="Previous scene"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => setActive((i) => Math.min(scenes.length - 1, i + 1))}
              disabled={active === scenes.length - 1}
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 backdrop-blur flex items-center justify-center text-white disabled:opacity-20 hover:bg-white/20 transition"
              aria-label="Next scene"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Autoplay toggle */}
        <button
          onClick={() => setAutoplay((v) => !v)}
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/10 backdrop-blur flex items-center justify-center text-white hover:bg-white/20 transition"
          aria-label={autoplay ? "Pause autoplay" : "Start autoplay"}
        >
          {autoplay ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
      </div>

      {/* Thumbnail strip */}
      <div className="flex gap-2 overflow-x-auto pb-2 px-1">
        {scenes.map((s, i) => {
          const locked = !hasBundle && !unlocked.has(s.scene_index);
          return (
            <button
              key={s.id}
              onClick={() => setActive(i)}
              className={`relative shrink-0 w-24 aspect-[16/10] rounded-md overflow-hidden border-2 transition-all ${
                i === active ? "border-primary shadow-md" : "border-transparent opacity-60 hover:opacity-100"
              }`}
              aria-label={`Scene ${i + 1}${locked ? " (locked)" : ""}`}
            >
              {s.signedUrl ? (
                <img
                  src={s.signedUrl}
                  alt=""
                  className={`w-full h-full object-cover ${locked ? "blur-md scale-110" : ""}`}
                />
              ) : (
                <div className="w-full h-full bg-muted" />
              )}
              {locked && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <Lock className="w-3 h-3 text-white" />
                </div>
              )}
              {s.scene_index === FREE_SCENE && (
                <div className="absolute top-0.5 left-0.5 px-1 py-px rounded bg-primary text-[8px] text-primary-foreground font-medium">
                  FREE
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Bundle CTA when scenes are locked */}
      {!hasBundle && lockedCount > 0 && !currentLocked && (
        <Card className="bg-gradient-to-r from-primary/10 to-secondary/10 border-primary/20">
          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-medium">Unlock the full story</p>
              <p className="text-xs text-muted-foreground">
                {lockedCount} scene{lockedCount === 1 ? "" : "s"} remaining ·{" "}
                <span className="line-through opacity-60">{lockedCount * SCENE_COST}</span>{" "}
                <span className="font-semibold text-primary">{BUNDLE_COST} credits</span>
              </p>
            </div>
            <Button onClick={() => unlock("bundle")} disabled={unlocking !== null} size="sm">
              {unlocking === "bundle" ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="w-4 h-4 mr-2" />
              )}
              Unlock all
            </Button>
          </CardContent>
        </Card>
      )}

      {hasBundle && (
        <p className="text-xs text-center text-muted-foreground">
          ✨ Full story unlocked — replay any scene anytime, free.
        </p>
      )}

      <div className="text-center">
        <Link to="/topup" className="text-xs text-primary hover:underline">
          Need more credits? Top up
        </Link>
      </div>
    </div>
  );
}
