// Admin page: CAPS curriculum topics, official assessment patterns and
// reference documents used to ground exam-style (never predicted) questions.
import { useEffect, useState } from "react";
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { prettify, quizAdmin } from "@/lib/quiz-bank";

type Row = Record<string, any>;

const CONFIG_FIELDS = [
  { key: "subject", label: "Subject", required: true },
  { key: "grade", label: "Grade", required: true },
  { key: "topic", label: "CAPS topic", required: true },
  { key: "subtopic", label: "Subtopic" },
  { key: "learning_objective", label: "Learning objective" },
  { key: "cognitive_demand", label: "Cognitive demand" },
  { key: "typical_marks", label: "Typical marks" },
];

const PATTERN_FIELDS = [
  { key: "subject", label: "Subject", required: true },
  { key: "grade", label: "Grade" },
  { key: "year", label: "Year" },
  { key: "paper_number", label: "Paper" },
  { key: "topic", label: "Topic" },
  { key: "command_word", label: "Command word" },
  { key: "cognitive_demand", label: "Cognitive demand" },
  { key: "marks", label: "Marks" },
  { key: "pattern_summary", label: "Pattern summary" },
];

const DOC_FIELDS = [
  { key: "title", label: "Title", required: true },
  { key: "reference_type", label: "Type (CAPS / ATP / Exam / Memo)" },
  { key: "subject", label: "Subject" },
  { key: "grade", label: "Grade" },
  { key: "year", label: "Year" },
  { key: "source_url", label: "Source URL" },
];

function NumericKeys(key: string) {
  return ["year", "marks", "typical_marks", "occurrences", "paper_number"].includes(key);
}

function Section({
  title, description, fields, rows, loading, onSave, onDelete, onRefresh, renderRow,
}: {
  title: string;
  description: string;
  fields: { key: string; label: string; required?: boolean }[];
  rows: Row[];
  loading: boolean;
  onSave: (row: Row) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefresh: () => void;
  renderRow: (r: Row) => React.ReactNode;
}) {
  const [draft, setDraft] = useState<Row>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const clean: Row = {};
      for (const f of fields) {
        const v = draft[f.key];
        if (v === undefined || v === "") continue;
        clean[f.key] = NumericKeys(f.key) ? Number(v) : v;
      }
      await onSave(clean);
      setDraft({});
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <Button size="sm" variant="outline" onClick={onRefresh} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">
                {f.label}{f.required && <span className="text-destructive"> *</span>}
              </Label>
              <Input
                value={draft[f.key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
        </Button>

        {loading ? (
          <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing added yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-2 rounded-md border p-3">
                <div className="min-w-0 text-sm">{renderRow(r)}</div>
                <Button size="icon" variant="ghost" onClick={() => onDelete(r.id)} title="Remove">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CurriculumAssessmentPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<Row[]>([]);
  const [patterns, setPatterns] = useState<Row[]>([]);
  const [docs, setDocs] = useState<Row[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [c, p, d] = await Promise.all([
        quizAdmin("curriculum_config"),
        quizAdmin("assessment_patterns"),
        quizAdmin("reference_docs"),
      ]);
      setConfig(c.rows ?? []);
      setPatterns(p.rows ?? []);
      setDocs(d.rows ?? []);
    } catch (e) {
      toast({ title: "Could not load curriculum settings", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const run = async (fn: () => Promise<unknown>, okTitle: string) => {
    try {
      await fn();
      toast({ title: okTitle });
      load();
    } catch (e) {
      toast({ title: "Action failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        These records guide question writing so quizzes stay CAPS-aligned exam-style practice.
        Questions are always original — nothing here is presented to learners as a predicted exam question.
      </p>

      <Section
        title="CAPS curriculum topics"
        description="Topics, objectives and cognitive demand per subject and grade."
        fields={CONFIG_FIELDS}
        rows={config}
        loading={loading}
        onRefresh={load}
        onSave={(row) => run(() => quizAdmin("upsert_curriculum_config", { row }), "Topic saved")}
        onDelete={(id) => run(() => quizAdmin("delete_curriculum_row", { table: "curriculum_config", id }), "Removed")}
        renderRow={(r) => (
          <>
            <p className="font-medium">{r.subject} · Grade {r.grade} · {r.topic}</p>
            <p className="text-xs text-muted-foreground">
              {[r.subtopic, r.learning_objective, r.cognitive_demand && prettify(r.cognitive_demand),
                r.typical_marks && `${r.typical_marks} marks`].filter(Boolean).join(" · ") || "—"}
            </p>
          </>
        )}
      />

      <Section
        title="Assessment patterns"
        description="Patterns observed in official papers: structures, command words and mark weightings."
        fields={PATTERN_FIELDS}
        rows={patterns}
        loading={loading}
        onRefresh={load}
        onSave={(row) => run(() => quizAdmin("upsert_assessment_pattern", { row }), "Pattern saved")}
        onDelete={(id) => run(() => quizAdmin("delete_curriculum_row", { table: "assessment_patterns", id }), "Removed")}
        renderRow={(r) => (
          <>
            <p className="font-medium">
              {r.subject} {r.grade ? `· Grade ${r.grade}` : ""} {r.year ? `· ${r.year}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {[r.topic, r.command_word, r.cognitive_demand && prettify(r.cognitive_demand),
                r.marks && `${r.marks} marks`, r.pattern_summary].filter(Boolean).join(" · ") || "—"}
            </p>
          </>
        )}
      />

      <Section
        title="Reference documents"
        description="CAPS documents, teaching plans, past papers and memoranda used as guidance."
        fields={DOC_FIELDS}
        rows={docs}
        loading={loading}
        onRefresh={load}
        onSave={(row) => run(() => quizAdmin("upsert_reference_doc", { row }), "Reference saved")}
        onDelete={(id) => run(() => quizAdmin("delete_curriculum_row", { table: "curriculum_reference_docs", id }), "Removed")}
        renderRow={(r) => (
          <>
            <p className="font-medium">{r.title}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {r.reference_type && <Badge variant="outline">{r.reference_type}</Badge>}
              {r.subject && <Badge variant="outline">{r.subject}</Badge>}
              {r.grade && <Badge variant="outline">Grade {r.grade}</Badge>}
              {r.year && <Badge variant="outline">{r.year}</Badge>}
            </div>
          </>
        )}
      />
    </div>
  );
}
