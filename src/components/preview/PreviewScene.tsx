import { motion } from "framer-motion";
import sceneImage from "@/assets/preview-scene-london-fog.jpg";

interface Props {
  sceneNumber: number;
  sceneTitle: string;
  caption: string;
}

export default function PreviewScene({ sceneNumber, sceneTitle, caption }: Props) {
  return (
    <motion.figure
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6 }}
      className="relative rounded-2xl overflow-hidden shadow-2xl shadow-black/20 group"
    >
      <img
        src={sceneImage}
        alt={sceneTitle}
        width={1920}
        height={1080}
        className="w-full h-auto aspect-video object-cover transition-transform duration-700 group-hover:scale-[1.02]"
      />
      {/* Bottom gradient fade */}
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />

      <div className="absolute top-4 left-4">
        <span className="inline-flex items-center gap-1.5 bg-background/90 backdrop-blur text-foreground text-xs font-semibold px-3 py-1.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          Scene {sceneNumber} • Free
        </span>
      </div>

      <figcaption className="absolute inset-x-0 bottom-0 p-6 md:p-8 text-white">
        <h3 className="text-xl md:text-2xl font-display font-bold drop-shadow">
          Scene {sceneNumber}: {sceneTitle}
        </h3>
        <p className="mt-2 text-sm md:text-base text-white/85 italic max-w-2xl drop-shadow">
          "{caption}"
        </p>
      </figcaption>
    </motion.figure>
  );
}
