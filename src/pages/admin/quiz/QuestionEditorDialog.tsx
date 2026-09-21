import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DIFFICULTIES, quizAdmin } from "@/lib/quiz-bank";
import type { BankQuestion } from "./QuestionCard";

export default function QuestionEditorDialog({
  question, onOpenChange, onSaved,
}: {
  question: BankQuestion | null;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [correct, setCorrect] = useState("");
  const [explanation, setExplanation] = useState("");
  const [working, setWorking] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [marks, setMarks] = useState("");
  const [guidance, setGuidance] = useState("");
  const [verified, setVerified] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!question) return;
    setText(question.question);
    setOptions(question.options ?? []);
    setCorrect(question.correct_answer ?? "");
    setExplanation(question.explanation ?? "");
    setWorking(question.working ?? "");
    setDifficulty(question.difficulty);
    setMarks(question.mark_allocation != null ? String(question.mark_allocation) : "");
    setGuidance(question.marking_guidance ?? "");
    setVerified(!!question.answer_verified);
    setReason("");
  }, [question]);

  const save = async () => {
    if (!question) return;
    if (options.length > 0 && !options.includes(correct)) {
      toast({ title: "The correct answer must match one of the options", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await quizAdmin("update_question", {
        question_id: question.id,
        reason: reason || "admin edit",
        patch: {
          question: text,
          options: options.length ? options : null,
          correct_answer: correct,
          explanation,
          working: working || null,
          difficulty,
          mark_allocation: marks ? Number(marks) : null,
          marking_guidance: guidance || null,
          answer_verified: verified,
        },
      });
      toast({ title: "Question updated", description: "The previous version was kept in history." });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!question} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit question</DialogTitle>
          <DialogDescription>Editing saves a new version and keeps the previous one in history.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Question</Label>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </div>

          {options.length > 0 && (
            <div className="space-y-1.5">
              <Label>Options</Label>
              {options.map((o, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    value={o}
                    onChange={(e) => {
                      const next = [...options];
                      const was = next[i];
                      next[i] = e.target.value;
                      setOptions(next);
                      if (correct === was) setCorrect(e.target.value);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant={correct === o ? "default" : "outline"}
                    onClick={() => setCorrect(o)}
                  >
                    Correct
                  </Button>
                </div>
              ))}
            </div>
          )}

          {options.length === 0 && (
            <div className="space-y-1.5">
              <Label>Correct answer</Label>
              <Input value={correct} onChange={(e) => setCorrect(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Explanation</Label>
            <Textarea rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Working (calculations)</Label>
            <Textarea rows={2} value={working} onChange={(e) => setWorking(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Difficulty</Label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIFFICULTIES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reason for change</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional note" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Marks</Label>
              <Input
                type="number"
                min={1}
                value={marks}
                onChange={(e) => setMarks(e.target.value)}
                placeholder="e.g. 2"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Marking guidance</Label>
              <Input value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="How marks are awarded" />
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-md border p-3">
            <Checkbox checked={verified} onCheckedChange={(v) => setVerified(!!v)} className="mt-0.5" />
            <span className="text-sm">
              I have checked this answer myself
              <span className="block text-xs text-muted-foreground">
                Required before publishing Mathematics and Physical Sciences questions.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save new version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
