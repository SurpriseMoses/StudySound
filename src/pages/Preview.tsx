import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, Pause, SkipBack, SkipForward, Volume2, ArrowRight, Sparkles, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";

const sampleText = `It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness. Charles Darnay and Sydney Carton stood in the courtroom, their fates intertwined in ways neither could yet fathom.

The fog crept through the streets of London like a living thing, wrapping itself around lampposts and doorways. In the Tellson's Bank, the clerks bent over their ledgers, scratching away with quill pens.

"It is a far, far better thing that I do, than I have ever done," Carton whispered to himself, staring out at the grey Thames below.`;

export default function Preview() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState([35]);
  const [speed, setSpeed] = useState(1);

  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-50 bg-background/90 backdrop-blur border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="font-display font-bold">StudySound</span>
          </Link>
          <Link to="/onboarding">
            <Button size="sm" className="gap-2">Sign Up <ArrowRight className="w-3.5 h-3.5" /></Button>
          </Link>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="bg-primary/10 text-primary text-sm font-medium px-3 py-1.5 rounded-full inline-flex items-center gap-2 mb-4">
            🎧 Free Trial Preview
          </div>
          <h1 className="text-3xl md:text-4xl font-display font-bold">A Tale of Two Cities</h1>
          <p className="text-muted-foreground mt-2">by Charles Dickens — Chapter 1 Preview</p>
        </motion.div>

        <div className="grid lg:grid-cols-5 gap-6 mt-8">
          {/* Text panel */}
          <div className="lg:col-span-3 space-y-5">
            <Card>
              <CardContent className="p-6">
                <h3 className="font-display font-semibold mb-4">📖 Chapter Text</h3>
                <div className="prose prose-sm max-w-none text-foreground/85 leading-relaxed whitespace-pre-line">
                  {sampleText}
                </div>
              </CardContent>
            </Card>

            {/* Audio Player */}
            <Card className="border-primary/20">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-display font-semibold text-sm">🎧 AI Narration</h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <button
                      onClick={() => setSpeed(s => s === 2 ? 0.5 : s + 0.25)}
                      className="px-2 py-1 rounded bg-muted hover:bg-muted/80 font-medium"
                    >
                      {speed}x
                    </button>
                    <Volume2 className="w-4 h-4" />
                  </div>
                </div>
                <Slider value={progress} onValueChange={setProgress} max={100} step={1} className="mb-3" />
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                  <span>1:12</span>
                  <span>3:24</span>
                </div>
                <div className="flex items-center justify-center gap-4">
                  <button className="text-muted-foreground hover:text-foreground"><SkipBack className="w-5 h-5" /></button>
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition"
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                  </button>
                  <button className="text-muted-foreground hover:text-foreground"><SkipForward className="w-5 h-5" /></button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Visual Scene */}
          <div className="lg:col-span-2 space-y-5">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Image className="w-4 h-4 text-secondary" />
                  <h3 className="font-display font-semibold text-sm">AI Visual Scene</h3>
                </div>
                <div className="aspect-[4/3] rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                  <div className="text-center p-6">
                    <div className="text-4xl mb-3">🌫️🏙️</div>
                    <p className="text-sm text-muted-foreground font-medium">London fog scene</p>
                    <p className="text-xs text-muted-foreground mt-1">AI-generated preview</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3 italic">
                  "The fog crept through the streets of London like a living thing..."
                </p>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-5 text-center">
                <h3 className="font-display font-semibold mb-2">Unlock Full Access</h3>
                <p className="text-sm text-muted-foreground mb-4">Get AI narration, visuals & quizzes for all your subjects</p>
                <Link to="/onboarding">
                  <Button className="w-full gap-2">
                    Get Started <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
