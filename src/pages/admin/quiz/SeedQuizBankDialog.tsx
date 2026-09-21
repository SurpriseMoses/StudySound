import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { QUESTION_TYPES, formatZar, prettify, quizAdmin, submitSeedJob } from "@/lib/quiz-bank";

interface Book {
  id: string;
  title: string;
  subject_type: string | null;
  doc_type: string | null;
  grade_level: string | null;
  subject: string | null;
  bank: { total: number; published: number; pending: number };
}

interface Template {
  id: string;
  name: string;
  applies_to: string;
  questions_per_section: number;
  difficulty_mix: Record<string, number>;
  skill_mix: Record<string, number>;
  question_types: string[];
  exam_alignment_level: string;
  is_default: boolean;
}

const MODES = [
  { id: "generate_new", label: "Generate new questions" },
  { id: "regenerate_missing", label: "Regenerate missing questions" },
  { id: "regenerate_rejected", label: "Regenerate rejected questions" },
  { id: "expand_existing", label: "Expand existing bank" },
];

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "af", label: "Afrikaans" },
  { code: "zu", label: "isiZulu" },
  { code: "xh", label: "isiXhosa" },
  { code: "nso", label: "Sepedi" },
  { code: "st", label: "Sesotho" },
  { code: "tn", label: "Setswana" },
  { code: "ss", label: "siSwati" },
  { code: "ve", label: "Tshivenda" },
  { code: "ts", label: "Xitsonga" },
  { code: "nr", label: "isiNdebele" },
];

export default function SeedQuizBankDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<Book[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [generation, setGeneration] = useState<{ available: boolean; message: string | null }>({ available: false, message: null });

  const [selected, setSelected] = useState<string[]>([]);
  const [novelsOnly, setNovelsOnly] = useState(false);
  const [templateId, setTemplateId] = useState<string>("");
  const [perSection, setPerSection] = useState(5);
  const [customPer, setCustomPer] = useState("");
  const [mode, setMode] = useState("generate_new");
  const [language, setLanguage] = useState("en");
  const [scope, setScope] = useState<"full_book" | "range">("full_book");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [mix, setMix] = useState({ easy: 40, medium: 40, hard: 20 });
  const [types, setTypes] = useState<string[]>(["multiple_choice", "true_false", "short_answer"]);
  const [alignment, setAlignment] = useState("low");

  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<any>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const [lib, tpl, gen] = await Promise.all([
          quizAdmin("library"),
          quizAdmin("templates"),
          quizAdmin("generation_status"),
        ]);
        setBooks(lib.books ?? []);
        setTemplates(tpl.templates ?? []);
        setGeneration({ available: !!gen.available, message: gen.message ?? null });
        const def = (tpl.templates ?? []).find((t: Template) => t.is_default);
        if (def) applyTemplate(def);
      } catch (e) {
        toast({ title: "Could not load the library", description: (e as Error).message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyTemplate = (t: Template) => {
    setTemplateId(t.id);
    setPerSection(t.questions_per_section);
    setMix({
      easy: t.difficulty_mix?.easy ?? 40,
      medium: t.difficulty_mix?.medium ?? 40,
      hard: t.difficulty_mix?.hard ?? 20,
    });
    setTypes(t.question_types ?? ["multiple_choice"]);
    setAlignment(t.exam_alignment_level ?? "low");
  };

  const isNovel = (b: Book) => b.subject_type === "novel" || b.doc_type === "novel";
  const visibleBooks = useMemo(
    () => (novelsOnly ? books.filter(isNovel) : books),
    [books, novelsOnly],
  );

  const template = templates.find((t) => t.id === templateId);
  const mixTotal = mix.easy + mix.medium + mix.hard;

  const chunkIndexes = useMemo(() => {
    if (scope !== "range") return null;
    const a = parseInt(rangeFrom, 10);
    const b = parseInt(rangeTo, 10);
    if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
    return Array.from({ length: Math.min(b - a + 1, 2000) }, (_, i) => a + i);
  }, [scope, rangeFrom, rangeTo]);

  const runEstimate = async () => {
    if (selected.length === 0) {
      toast({ title: "Choose at least one book", variant: "destructive" });
      return;
    }
    setEstimating(true);
    setEstimate(null);
    try {
      const res = await quizAdmin("estimate", {
        document_ids: selected,
        questions_per_section: perSection,
        chunk_indexes: chunkIndexes,
      });
      setEstimate(res);
    } catch (e) {
      toast({ title: "Estimate failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setEstimating(false);
    }
  };

  const startJob = async () => {
    if (mixTotal !== 100) {
      toast({ title: "Difficulty split must add up to 100%", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await quizAdmin("create_job", {
        document_ids: selected,
        questions_per_section: perSection,
        chunk_indexes: chunkIndexes,
        scope: scope === "range" ? "selected_sections" : "full_book",
        generation_mode: mode,
        language,
        difficulty_mix: mix,
        skill_mix: template?.skill_mix ?? {},
        question_types: types,
        exam_alignment_level: alignment,
      });
      const jobId = res.job?.id;
      toast({
        title: "Seed job created",
        description: `${res.sections} meaningful sections queued.`,
      });

      if (generation.available && jobId) {
        const sub = await submitSeedJob(jobId);
        if (!sub.ok) {
          toast({
            title: "Job saved, generation not started",
            description: sub.error ?? "Generation service unavailable.",
          });
        } else {
          toast({ title: "Generation started", description: `${sub.submitted} sections sent for generation.` });
        }
      }
      onCreated?.();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Could not create the job", description: (e as Error).message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" /> Seed Quiz Bank
          </DialogTitle>
          <DialogDescription>
            Generate reusable, source-grounded questions from the sections of your existing books.
          </DialogDescription>
        </DialogHeader>

        {!generation.available && generation.message && (
          <div className="flex gap-2 items-start rounded-md border border-accent/40 bg-accent/10 p-3 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-accent shrink-0" />
            <span>{generation.message} You can still configure and queue jobs — they will run once generation is available.</span>
          </div>
        )}

        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : (
          <div className="space-y-5">
            {/* Books */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Books ({selected.length} selected)</Label>
                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox checked={novelsOnly} onCheckedChange={(v) => setNovelsOnly(!!v)} /> Novels only
                  </label>
                  <button className="text-primary" onClick={() => setSelected(visibleBooks.map((b) => b.id))}>Select all</button>
                  <button className="text-muted-foreground" onClick={() => setSelected([])}>Clear</button>
                </div>
              </div>
              <ScrollArea className="h-52 rounded-md border">
                <div className="p-2 space-y-1">
                  {visibleBooks.map((b) => (
                    <label
                      key={b.id}
                      className="flex items-start gap-2 rounded-md p-2 hover:bg-muted cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={selected.includes(b.id)}
                        onCheckedChange={(v) =>
                          setSelected((s) => (v ? [...s, b.id] : s.filter((x) => x !== b.id)))
                        }
                      />
                      <span className="flex-1">
                        <span className="font-medium">{b.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {[b.subject ?? prettify(b.subject_type), b.grade_level ? `Grade ${b.grade_level}` : null]
                            .filter(Boolean).join(" · ")}
                          {b.bank.total > 0 && ` · ${b.bank.total} questions (${b.bank.published} published)`}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Template + mode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Template</Label>
                <Select
                  value={templateId}
                  onValueChange={(v) => {
                    const t = templates.find((x) => x.id === v);
                    if (t) applyTemplate(t);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Choose a template" /></SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Generation mode</Label>
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODES.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Questions per section</Label>
                <Select
                  value={[3, 5, 10].includes(perSection) ? String(perSection) : "custom"}
                  onValueChange={(v) => {
                    if (v === "custom") setPerSection(parseInt(customPer || "7", 10));
                    else setPerSection(parseInt(v, 10));
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
                {![3, 5, 10].includes(perSection) && (
                  <Input
                    type="number" min={1} max={20} value={customPer || perSection}
                    onChange={(e) => { setCustomPer(e.target.value); setPerSection(Math.max(1, Math.min(20, parseInt(e.target.value || "1", 10)))); }}
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Scope */}
            <div className="space-y-1.5">
              <Label>Content scope</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={scope} onValueChange={(v) => setScope(v as "full_book" | "range")}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_book">Entire book</SelectItem>
                    <SelectItem value="range">Selected sections</SelectItem>
                  </SelectContent>
                </Select>
                {scope === "range" && (
                  <>
                    <Input className="w-24" placeholder="from" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
                    <span className="text-muted-foreground text-sm">to</span>
                    <Input className="w-24" placeholder="to" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
                  </>
                )}
              </div>
            </div>

            {/* Difficulty mix */}
            <div className="space-y-1.5">
              <Label>Difficulty split {mixTotal !== 100 && <span className="text-destructive text-xs">(must total 100%)</span>}</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["easy", "medium", "hard"] as const).map((k) => (
                  <div key={k}>
                    <span className="text-xs text-muted-foreground capitalize">{k}</span>
                    <Input
                      type="number" min={0} max={100} value={mix[k]}
                      onChange={(e) => setMix({ ...mix, [k]: parseInt(e.target.value || "0", 10) })}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Question types */}
            <div className="space-y-1.5">
              <Label>Question types</Label>
              <div className="flex flex-wrap gap-2">
                {QUESTION_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTypes((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      types.includes(t) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
                    }`}
                  >
                    {prettify(t)}
                  </button>
                ))}
              </div>
            </div>

            {/* Exam alignment */}
            <div className="space-y-1.5">
              <Label>Exam alignment level</Label>
              <Select value={alignment} onValueChange={setAlignment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low — learning and comprehension</SelectItem>
                  <SelectItem value="medium">Medium — curriculum-aligned formats</SelectItem>
                  <SelectItem value="high">High — CAPS command words and cognitive demand</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Exam-style practice only. Questions are original and never presented as predicted exam questions.
              </p>
            </div>

            {/* Estimate / preview */}
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Seed preview</span>
                <Button size="sm" variant="outline" onClick={runEstimate} disabled={estimating}>
                  {estimating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Calculate"}
                </Button>
              </div>
              {estimate ? (
                <div className="text-sm space-y-1">
                  {estimate.per_book?.map((b: any) => (
                    <div key={b.document_id} className="flex justify-between gap-2">
                      <span className="truncate">{b.title}</span>
                      <span className="text-muted-foreground whitespace-nowrap">
                        {b.meaningful} of {b.total} sections
                      </span>
                    </div>
                  ))}
                  <div className="pt-2 border-t flex flex-wrap gap-x-5 gap-y-1">
                    <span>Meaningful sections: <b>{estimate.estimate.sections}</b></span>
                    <span>Estimated questions: <b>{estimate.estimate.questions.toLocaleString()}</b></span>
                    <span>Estimated cost: <b>{formatZar(estimate.estimate.zar)}</b></span>
                    <span>Processing: <Badge variant="secondary">Batch</Badge></span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Difficulty {mix.easy}% easy / {mix.medium}% medium / {mix.hard}% hard · model {estimate.estimate.model}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Calculate to see meaningful sections, expected question count and the cost estimate from your configured model pricing.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={startJob} disabled={creating || selected.length === 0 || loading} className="gap-2">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Start Seed Job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
