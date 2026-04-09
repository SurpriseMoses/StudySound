import { useState } from "react";
import { motion } from "framer-motion";
import { Play, Pause, SkipBack, SkipForward, Volume2, Download, Globe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AppLayout from "@/components/AppLayout";

const sampleChapters = [
  { id: 1, title: "Chapter 1 — The Period", duration: "6:48", active: true },
  { id: 2, title: "Chapter 2 — The Mail", duration: "8:12", active: false },
  { id: 3, title: "Chapter 3 — The Night Shadows", duration: "5:34", active: false },
];

const sampleText = `It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity.

There were a king with a large jaw and a queen with a plain face, on the throne of England; there were a king with a large jaw and a queen with a fair face, on the throne of France. In both countries it was clearer than crystal to the lords of the State preserves of loaves and fishes, that things in general were settled for ever.`;

export default function Listen() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState([25]);
  const [speed, setSpeed] = useState("1");
  const [language, setLanguage] = useState("en");

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-3">
          <div>
            <h1 className="text-2xl font-display font-bold">A Tale of Two Cities</h1>
            <p className="text-muted-foreground text-sm">English — Charles Dickens</p>
          </div>
          <div className="flex gap-2">
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-36">
                <Globe className="w-4 h-4 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="af">Afrikaans</SelectItem>
                <SelectItem value="zu">isiZulu</SelectItem>
                <SelectItem value="fr">French</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon">
              <Download className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-5">
          {/* Chapter list */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm mb-3">Chapters</h3>
            {sampleChapters.map(ch => (
              <Card key={ch.id} className={`cursor-pointer transition-all ${ch.active ? "border-primary bg-primary/5" : "hover:shadow-sm"}`}>
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {ch.active ? (
                      <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                        <Play className="w-3 h-3 ml-0.5" />
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-medium">{ch.id}</div>
                    )}
                    <span className="text-sm font-medium">{ch.title}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{ch.duration}</span>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Text + Player */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardContent className="p-5">
                <h3 className="font-display font-semibold mb-3">Chapter 1 — The Period</h3>
                <div className="prose prose-sm max-w-none text-foreground/80 leading-relaxed whitespace-pre-line">
                  {sampleText}
                </div>
              </CardContent>
            </Card>

            {/* Player */}
            <Card className="sticky bottom-4 border-primary/20 shadow-lg">
              <CardContent className="p-4">
                <Slider value={progress} onValueChange={setProgress} max={100} step={1} className="mb-2" />
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                  <span>1:42</span>
                  <span>6:48</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Select value={speed} onValueChange={setSpeed}>
                      <SelectTrigger className="w-16 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["0.5", "0.75", "1", "1.25", "1.5", "2"].map(s => (
                          <SelectItem key={s} value={s}>{s}x</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Volume2 className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-3">
                    <button className="text-muted-foreground hover:text-foreground"><SkipBack className="w-5 h-5" /></button>
                    <button
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90"
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                    </button>
                    <button className="text-muted-foreground hover:text-foreground"><SkipForward className="w-5 h-5" /></button>
                  </div>
                  <div className="w-20" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </motion.div>
    </AppLayout>
  );
}
