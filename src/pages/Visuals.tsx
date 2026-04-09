import { motion } from "framer-motion";
import { Image, Lock, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import AppLayout from "@/components/AppLayout";

const scenes = [
  { id: 1, paragraph: "The fog crept through the streets of London like a living thing...", emoji: "🌫️🏙️", caption: "Foggy London street scene" },
  { id: 2, paragraph: "Charles Darnay stood in the courtroom, his face pale...", emoji: "⚖️👤", caption: "Courtroom scene with Darnay" },
  { id: 3, paragraph: "The wine cask had been dropped and broken in the street...", emoji: "🍷🏚️", caption: "Saint Antoine wine spill scene" },
  { id: 4, paragraph: "Lucie Manette sat quietly by her father's side...", emoji: "👩‍👧‍👦🕯️", caption: "Lucie with Dr. Manette" },
];

export default function Visuals() {
  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-display font-bold">Visual Scenes</h1>
            <p className="text-muted-foreground text-sm">AI-generated illustrations for your lessons</p>
          </div>
          <Badge variant="secondary" className="gap-1 bg-secondary/10 text-secondary border-0">
            <Image className="w-3 h-3" /> Premium Feature
          </Badge>
        </div>

        {/* Info banner */}
        <Card className="mb-6 border-warning/30 bg-warning/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium">Visual scenes are available for humanities subjects only</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Subjects like English, History, Geography, and Life Sciences support AI-generated visuals.
                STEM subjects (Maths, Physics, etc.) use text + quiz format.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="mb-4">
          <h2 className="font-display font-semibold">A Tale of Two Cities — Chapter 1</h2>
          <p className="text-sm text-muted-foreground">English — 4 scenes generated</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {scenes.map((scene, i) => (
            <motion.div
              key={scene.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className="overflow-hidden hover:shadow-md transition-shadow">
                <div className="aspect-[16/10] bg-muted flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-5xl mb-2">{scene.emoji}</div>
                    <p className="text-sm font-medium text-muted-foreground">{scene.caption}</p>
                  </div>
                </div>
                <CardContent className="p-4">
                  <p className="text-sm text-foreground/80 italic line-clamp-2">"{scene.paragraph}"</p>
                  <p className="text-xs text-muted-foreground mt-2">Scene {scene.id} of 4</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </AppLayout>
  );
}
