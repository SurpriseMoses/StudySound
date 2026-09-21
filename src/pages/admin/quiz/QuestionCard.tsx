import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronUp, Pencil, History } from "lucide-react";
import { prettify, STATUS_TONE, type QuestionStatus } from "@/lib/quiz-bank";

export interface BankQuestion {
  id: string;
  question: string;
  question_type: string;
  options: string[] | null;
  correct_answer: string | null;
  acceptable_answers: string[] | null;
  items: string[] | null;
  correct_order: number[] | null;
  explanation: string | null;
  working: string | null;
  difficulty: string;
  skill: string | null;
  topic: string | null;
  status: QuestionStatus;
  language: string;
  version: number;
  manually_edited: boolean;
  chunk_index: number | null;
  subject: string | null;
  grade: string | null;
  cognitive_level: string | null;
  command_word: string | null;
  caps_topic: string | null;
  exam_alignment_level: string | null;
  source_reference: string | null;
  times_served: number;
  times_answered: number;
  times_correct: number;
  ai_validated?: boolean | null;
  validation_status?: string | null;
  validation?: Record<string, unknown> | null;
  answer_verified?: boolean | null;
  question_origin?: string | null;
  mark_allocation?: number | null;
  marking_guidance?: string | null;
  expected_answer_points?: string[] | null;
  assessment_reference?: string | null;
  documents?: { title: string; grade_level: string | null; subject_type: string | null } | null;
}

const STRICT_SUBJECTS = ["mathematics", "physical science", "physical sciences", "mathematical literacy", "accounting"];

/** AI generated → AI validated → Admin approved → Published */
function trustStage(q: BankQuestion): { label: string; tone: string } {
  if (q.status === "published") return { label: "Published", tone: "bg-success/15 text-success" };
  if (q.status === "approved") return { label: "Admin approved", tone: "bg-primary/15 text-primary" };
  if (q.validation_status === "failed") return { label: "Validation failed", tone: "bg-destructive/15 text-destructive" };
  if (q.ai_validated || q.validation_status === "passed") return { label: "AI validated", tone: "bg-accent/15 text-accent" };
  return { label: "AI generated", tone: "bg-muted text-muted-foreground" };
}

export default function QuestionCard({
  q, selected, onSelect, onEdit, onHistory, actions,
}: {
  q: BankQuestion;
  selected?: boolean;
  onSelect?: (v: boolean) => void;
  onEdit?: () => void;
  onHistory?: () => void;
  actions?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const success = q.times_answered > 0 ? Math.round((q.times_correct / q.times_answered) * 100) : null;
  const stage = trustStage(q);
  const subjectText = `${q.subject ?? ""} ${q.documents?.subject_type ?? ""}`.toLowerCase();
  const strict = STRICT_SUBJECTS.some((s) => subjectText.includes(s));
  const needsAnswerCheck = strict && !q.answer_verified && q.status !== "published";
  const notes = Array.isArray((q.validation as any)?.notes) ? ((q.validation as any).notes as string[]) : [];

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start gap-2">
          {onSelect && (
            <Checkbox className="mt-1" checked={!!selected} onCheckedChange={(v) => onSelect(!!v)} />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{q.question}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <Badge className={STATUS_TONE[q.status]} variant="secondary">{prettify(q.status)}</Badge>
              <Badge className={stage.tone} variant="secondary">{stage.label}</Badge>
              <Badge variant="outline">{prettify(q.difficulty)}</Badge>
              <Badge variant="outline">{prettify(q.question_type)}</Badge>
              {q.skill && <Badge variant="outline">{prettify(q.skill)}</Badge>}
              {q.question_origin && <Badge variant="outline">{prettify(q.question_origin)}</Badge>}
              {q.mark_allocation ? <Badge variant="outline">{q.mark_allocation} marks</Badge> : null}
              {q.answer_verified && <Badge variant="outline">Answer checked</Badge>}
              {q.manually_edited && <Badge variant="outline">Edited</Badge>}
              <span className="text-xs text-muted-foreground">v{q.version}</span>
            </div>
            {needsAnswerCheck && (
              <p className="text-xs text-destructive mt-1.5">
                Stricter review: this {q.subject ?? "subject"} answer must be checked before publishing.
              </p>
            )}
            <div className="text-xs text-muted-foreground mt-1.5 truncate">
              {q.documents?.title ?? ""}
              {q.chunk_index != null && ` · section ${q.chunk_index + 1}`}
              {` · ${q.language.toUpperCase()}`}
              {success != null && ` · ${success}% correct of ${q.times_answered}`}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onEdit && (
              <Button size="icon" variant="ghost" onClick={onEdit} title="Edit question">
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            )}
            {onHistory && (
              <Button size="icon" variant="ghost" onClick={onHistory} title="Version history">
                <History className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button size="icon" variant="ghost" onClick={() => setOpen((o) => !o)} title="Details">
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {open && (
          <div className="pl-1 space-y-2 text-sm border-t pt-3">
            {q.options && q.options.length > 0 && (
              <ul className="space-y-1">
                {q.options.map((o) => (
                  <li key={o} className={o === q.correct_answer ? "text-success font-medium" : "text-muted-foreground"}>
                    {o === q.correct_answer ? "✓ " : "• "}{o}
                  </li>
                ))}
              </ul>
            )}
            {!q.options?.length && q.correct_answer && (
              <p><span className="text-muted-foreground">Answer: </span>{q.correct_answer}</p>
            )}
            {q.acceptable_answers?.length ? (
              <p className="text-muted-foreground text-xs">Also accepted: {q.acceptable_answers.join(", ")}</p>
            ) : null}
            {q.working && <p className="text-xs"><span className="text-muted-foreground">Working: </span>{q.working}</p>}
            {q.explanation && <p className="text-xs"><span className="text-muted-foreground">Explanation: </span>{q.explanation}</p>}
            {q.source_reference && (
              <p className="text-xs text-muted-foreground">Source: “{q.source_reference}”</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {q.subject && <span>{q.subject}</span>}
              {q.grade && <span>Grade {q.grade}</span>}
              {q.caps_topic && <span>CAPS: {q.caps_topic}</span>}
              {q.cognitive_level && <span>{prettify(q.cognitive_level)}</span>}
              {q.command_word && <span>Command: {q.command_word}</span>}
              {q.exam_alignment_level && <span>Alignment: {prettify(q.exam_alignment_level)}</span>}
              <span>Served {q.times_served}×</span>
            </div>
          </div>
        )}

        {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
      </CardContent>
    </Card>
  );
}
