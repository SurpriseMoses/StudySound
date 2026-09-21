import { useEffect, useState } from "react";
import { Loader2, Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { QUESTION_TYPES, prettify, quizAdmin } from "@/lib/quiz-bank";

const blank = {
  id: undefined as string | undefined,
  name: "",
  description: "",
  applies_to: "literature",
  subject: "",
  grade: "",
  questions_per_section: 5,
  difficulty_mix: { easy: 40, medium: 40, hard: 20 },
  question_types: ["multiple_choice"] as string[],
  exam_alignment_level: "low",
};

export default function QuizTemplates() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<any[]>([]);
  const [draft, setDraft] = useState<typeof blank | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await quizAdmin("templates");
      setTemplates(res.templates ?? []);
    } catch (e) {
      toast({ title: "Could not load templates", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    if (!draft) return;
    const mixTotal = draft.difficulty_mix.easy + draft.difficulty_mix.medium + draft.difficulty_mix.hard;
    if (mixTotal !== 100) {
      toast({ title: "Difficulty split must total 100%", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await quizAdmin("upsert_template", {
        template: {
          ...draft,
          subject: draft.subject || null,
          grade: draft.grade || null,
        },
      });
      toast({ title: "Template saved" });
      setDraft(null);
      load();
    } catch (e) {
      toast({ title: "Could not save the template", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Templates pre-fill the seeding options for a subject or book type.</p>
        <Button size="sm" onClick={() => setDraft({ ...blank })} className="gap-1.5">
          <Plus className="w-4 h-4" /> New template
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {templates.map((t) => (
          <Card key={t.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    {t.name}
                    {t.is_default && <Badge variant="secondary">Default</Badge>}
                  </div>
                  {t.description && <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>}
                </div>
                <Button
                  size="icon" variant="ghost"
                  onClick={() => setDraft({
                    id: t.id, name: t.name, description: t.description ?? "",
                    applies_to: t.applies_to, subject: t.subject ?? "", grade: t.grade ?? "",
                    questions_per_section: t.questions_per_section,
                    difficulty_mix: { easy: 40, medium: 40, hard: 20, ...(t.difficulty_mix ?? {}) },
                    question_types: t.question_types ?? ["multiple_choice"],
                    exam_alignment_level: t.exam_alignment_level ?? "low",
                  })}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{prettify(t.applies_to)}</Badge>
                <Badge variant="outline">{t.questions_per_section} per section</Badge>
                <Badge variant="outline">Alignment {prettify(t.exam_alignment_level)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {(t.question_types ?? []).map((x: string) => prettify(x)).join(", ")}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!draft} onOpenChange={(v) => !v && setDraft(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{draft?.id ? "Edit template" : "New template"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Applies to</Label>
                  <Select value={draft.applies_to} onValueChange={(v) => setDraft({ ...draft, applies_to: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="literature">Literature / novels</SelectItem>
                      <SelectItem value="curriculum">Curriculum textbooks</SelectItem>
                      <SelectItem value="study_guide">Study guides</SelectItem>
                      <SelectItem value="any">Any book</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Questions per section</Label>
                  <Input
                    type="number" min={1} max={20} value={draft.questions_per_section}
                    onChange={(e) => setDraft({ ...draft, questions_per_section: parseInt(e.target.value || "1", 10) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Subject (optional)</Label>
                  <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Grade (optional)</Label>
                  <Input value={draft.grade} onChange={(e) => setDraft({ ...draft, grade: e.target.value })} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Difficulty split</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(["easy", "medium", "hard"] as const).map((k) => (
                    <div key={k}>
                      <span className="text-xs text-muted-foreground capitalize">{k}</span>
                      <Input
                        type="number" value={draft.difficulty_mix[k]}
                        onChange={(e) => setDraft({
                          ...draft,
                          difficulty_mix: { ...draft.difficulty_mix, [k]: parseInt(e.target.value || "0", 10) },
                        })}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Question types</Label>
                <div className="flex flex-wrap gap-2">
                  {QUESTION_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setDraft({
                        ...draft,
                        question_types: draft.question_types.includes(t)
                          ? draft.question_types.filter((x) => x !== t)
                          : [...draft.question_types, t],
                      })}
                      className={`text-xs px-2.5 py-1 rounded-full border ${
                        draft.question_types.includes(t)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {prettify(t)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Exam alignment level</Label>
                <Select value={draft.exam_alignment_level} onValueChange={(v) => setDraft({ ...draft, exam_alignment_level: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
