import { useState } from "react";
import { motion } from "framer-motion";
import { Image, Check, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import AppLayout from "@/components/AppLayout";
import { subjects, type SubjectCategory } from "@/lib/subjects";

const categories: { id: SubjectCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "humanities", label: "Humanities" },
  { id: "languages", label: "Languages" },
  { id: "sciences", label: "Sciences" },
  { id: "stem", label: "STEM" },
];

export default function Subjects() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [selected, setSelected] = useState<string[]>(["english", "history"]);

  const filtered = subjects.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = activeCategory === "all" || s.category === activeCategory;
    return matchSearch && matchCat;
  });

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-display font-bold mb-1">Subjects</h1>
        <p className="text-muted-foreground text-sm mb-6">Select subjects to study. Subjects with visual support get AI-generated scene illustrations.</p>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search subjects..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  activeCategory === cat.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(subject => {
            const isSelected = selected.includes(subject.id);
            return (
              <Card
                key={subject.id}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  isSelected ? "border-primary ring-1 ring-primary" : ""
                }`}
                onClick={() => toggle(subject.id)}
              >
                <CardContent className="p-4 flex items-start gap-3">
                  <span className="text-2xl mt-0.5">{subject.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm">{subject.name}</h3>
                      {isSelected && <Check className="w-4 h-4 text-primary" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{subject.description}</p>
                    <div className="flex gap-1.5 mt-2">
                      {subject.supportsVisuals ? (
                        <Badge variant="secondary" className="text-[10px] gap-1 bg-primary/10 text-primary border-0">
                          <Image className="w-3 h-3" /> Visuals
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground border-0">
                          Text + Quiz only
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>
    </AppLayout>
  );
}
