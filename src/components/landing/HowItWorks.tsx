import { Upload, Wand2, GraduationCap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const steps = [
  { icon: Upload, title: "Upload your textbook", desc: "Any PDF, notes, or study material" },
  { icon: Wand2, title: "AI transforms it instantly", desc: "Audio lessons, visuals & quizzes generated" },
  { icon: GraduationCap, title: "Learn your way", desc: "Listen, read, or test yourself" },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-16 md:py-20">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-display font-bold">How it works</h2>
          <p className="mt-3 text-muted-foreground">Three steps from textbook to mastery.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {steps.map((s, i) => (
            <Card key={s.title} className="border-0 shadow-md hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                    {i + 1}
                  </div>
                  <s.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-display font-semibold text-lg">{s.title}</h3>
                <p className="text-sm text-muted-foreground mt-2">{s.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
