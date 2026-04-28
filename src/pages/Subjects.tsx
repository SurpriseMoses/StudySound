import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Image, Check, Search, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import AppLayout from "@/components/AppLayout";
import { subjects, type SubjectCategory } from "@/lib/subjects";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const categories: { id: SubjectCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "humanities", label: "Humanities" },
  { id: "languages", label: "Languages" },
  { id: "sciences", label: "Sciences" },
  { id: "stem", label: "STEM" },
];

export default function Subjects() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [selected, setSelected] = useState<string[]>([]);

  // Load any previously persisted selection so the user sees their state.
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("selected_subjects")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data?.selected_subjects?.length) setSelected(data.selected_subjects);
    })();
  }, [user]);

  const filtered = subjects.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = activeCategory === "all" || s.category === activeCategory;
    return matchSearch && matchCat;
  });

  const persist = async (next: string[]) => {
    if (!user) return;
    await supabase.from("profiles").update({ selected_subjects: next }).eq("user_id", user.id);
  };

  // SINGLE TAP = jump directly into Library for that subject.
  // Also persist as a selected subject for future personalization.
  const openSubject = async (id: string) => {
    const next = selected.includes(id) ? selected : [...selected, id];
    setSelected(next);
    persist(next); // fire-and-forget
    navigate(`/library?subject=${encodeURIComponent(id)}`);
  };

  // Long press / checkbox-style multi-select handled via the small toggle button.
  const toggleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const next = selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id];
    setSelected(next);
    persist(next);
  };

  const continueMulti = () => {
    if (selected.length === 0) return;
    if (selected.length === 1) navigate(`/library?subject=${encodeURIComponent(selected[0])}`);
    else navigate(`/library?subjects=${selected.map(encodeURIComponent).join(",")}`);
  };

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="pb-24">
        <h1 className="text-2xl font-display font-bold mb-1">Subjects</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Tap a subject to open its library. Tap the checkmark to select multiple, then continue.
        </p>

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
                className={`cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 ${
                  isSelected ? "border-primary ring-1 ring-primary" : ""
                }`}
                onClick={() => openSubject(subject.id)}
              >
                <CardContent className="p-4 flex items-start gap-3">
                  <span className="text-2xl mt-0.5">{subject.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-sm">{subject.name}</h3>
                      <button
                        onClick={(e) => toggleSelect(e, subject.id)}
                        aria-label={isSelected ? "Deselect" : "Select"}
                        className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs shrink-0 transition-colors ${
                          isSelected ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5" />}
                      </button>
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
                      <span className="text-[10px] text-primary ml-auto inline-flex items-center gap-0.5">
                        Open <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>

      {/* Sticky multi-select CTA */}
      {selected.length >= 2 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur p-3 flex items-center gap-3 md:left-64">
          <p className="text-sm flex-1 truncate">
            <span className="font-semibold">{selected.length}</span> subjects selected
          </p>
          <Button onClick={continueMulti} className="gap-2 rounded-xl">
            Continue <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </AppLayout>
  );
}
