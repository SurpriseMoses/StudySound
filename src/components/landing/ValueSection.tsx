import { Headphones, Globe, Brain, Smartphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const values = [
  { icon: Headphones, title: "Learn faster", desc: "Turn reading into listening", color: "text-primary" },
  { icon: Globe, title: "Understand better", desc: "Translate difficult content instantly", color: "text-accent" },
  { icon: Brain, title: "Remember more", desc: "Practice with AI quizzes", color: "text-secondary" },
  { icon: Smartphone, title: "Study anywhere", desc: "Offline mode included", color: "text-success" },
];

export default function ValueSection() {
  return (
    <section id="features" className="py-16 md:py-20">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-display font-bold">Why students use StudySound</h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {values.map(v => (
            <Card key={v.title} className="border-0 shadow-md hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <v.icon className={`w-8 h-8 ${v.color} mb-4`} />
                <h3 className="font-display font-semibold text-lg">{v.title}</h3>
                <p className="text-sm text-muted-foreground mt-2">{v.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-center text-sm text-muted-foreground mt-10">
          Designed for real students preparing for exams · Built around the South African curriculum
        </p>
      </div>
    </section>
  );
}
