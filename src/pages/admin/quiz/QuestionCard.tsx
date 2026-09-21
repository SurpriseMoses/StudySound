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
  documents?: { title: string; grade_level: string | null; subject_type: string | null } | null;
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
              <Badge variant="outline">{prettify(q.difficulty)}</Badge>
              <Badge variant="outline">{prettify(q.question_type)}</Badge>
              {q.skill && <Badge variant="outline">{prettify(q.skill)}</Badge>}
              {q.manually_edited && <Badge variant="outline">Edited</Badge>}
              <span className="text-xs text-muted-foreground">v{q.version}</span>
            </div>
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
