import { motion } from "framer-motion";
import { Play, Headphones, Eye, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PreviewHeroProps {
  title: string;
  onPlay: () => void;
}

export default function PreviewHero({ title, onPlay }: PreviewHeroProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="text-center max-w-3xl mx-auto"
    >
      <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-semibold px-3 py-1.5 rounded-full uppercase tracking-wide">
        🎧 Free Preview
      </span>
      <h1 className="text-4xl md:text-6xl font-display font-bold mt-5 leading-tight tracking-tight">
        {title}
      </h1>
      <p className="text-lg md:text-xl text-muted-foreground mt-4">
        Turn boring textbooks into cinematic learning
      </p>

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-6 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Headphones className="w-4 h-4 text-primary" /> Listen</span>
        <span className="text-border">•</span>
        <span className="inline-flex items-center gap-1.5"><Eye className="w-4 h-4 text-primary" /> Visualize</span>
        <span className="text-border">•</span>
        <span className="inline-flex items-center gap-1.5"><Brain className="w-4 h-4 text-primary" /> Understand faster</span>
      </div>

      <Button
        size="lg"
        onClick={onPlay}
        className="mt-8 gap-2 h-12 px-7 text-base shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-shadow"
      >
        <Play className="w-5 h-5 fill-current" />
        Play Preview
      </Button>
    </motion.div>
  );
}
