import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  DIFFICULTIES, QUESTION_STATUSES, QUESTION_TYPES, prettify, quizAdmin,
} from "@/lib/quiz-bank";
import QuestionCard, { type BankQuestion } from "./QuestionCard";
import QuestionEditorDialog from "./QuestionEditorDialog";

const ALL = "all";
const PAGE = 25;

export default function QuizQuestionBank() {
  const { toast } = useToast();
  const [books, setBooks] = useState<any[]>([]);
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<BankQuestion | null>(null);
  const [versions, setVersions] = useState<any[] | null>(null);

  const [filters, setFilters] = useState({
    document_id: ALL, status: ALL, difficulty: ALL, question_type: ALL, search: "",
  });

  useEffect(() => {
    quizAdmin("library").then((r) => setBooks(r.books ?? [])).catch(() => {});
  }, []);

  const load = async (p = page) => {
    setLoading(true);
    try {
      const payload: Record<string, unknown> = { limit: PAGE, offset: p * PAGE };
      for (const [k, v] of Object.entries(filters)) if (v && v !== ALL) payload[k] = v;
      const res = await quizAdmin("list_questions", payload);
      setQuestions(res.questions ?? []);
      setCount(res.count ?? 0);
      setSelected([]);
    } catch (e) {
      toast({ title: "Could not load questions", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(0); setPage(0); /* eslint-disable-next-line */ }, [filters.document_id, filters.status, filters.difficulty, filters.question_type]);

  const review = async (decision: string, ids: string[]) => {
    if (ids.length === 0) return;
    try {
      await quizAdmin("review", { question_ids: ids, decision });
      toast({ title: `${ids.length} question(s) ${decision === "publish" ? "published" : decision + "d"}` });
      load();
    } catch (e) {
      toast({ title: "Action failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const openHistory = async (id: string) => {
    try {
      const res = await quizAdmin("question_versions", { question_id: id });
      setVersions(res.versions ?? []);
    } catch (e) {
      toast({ title: "Could not load history", description: (e as Error).message, variant: "destructive" });
    }
  };

  const pages = Math.ceil(count / PAGE);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        <Select value={filters.document_id} onValueChange={(v) => setFilters({ ...filters, document_id: v })}>
          <SelectTrigger><SelectValue placeholder="All books" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All books</SelectItem>
            {books.map((b) => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
          <SelectTrigger><SelectValue placeholder="Any status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any status</SelectItem>
            {QUESTION_STATUSES.map((s) => <SelectItem key={s} value={s}>{prettify(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.difficulty} onValueChange={(v) => setFilters({ ...filters, difficulty: v })}>
          <SelectTrigger><SelectValue placeholder="Any difficulty" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any difficulty</SelectItem>
            {DIFFICULTIES.map((d) => <SelectItem key={d} value={d}>{prettify(d)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.question_type} onValueChange={(v) => setFilters({ ...filters, question_type: v })}>
          <SelectTrigger><SelectValue placeholder="Any type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any type</SelectItem>
            {QUESTION_TYPES.map((t) => <SelectItem key={t} value={t}>{prettify(t)}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Input
            placeholder="Search questions"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") { setPage(0); load(0); } }}
          />
          <Button variant="outline" size="icon" onClick={() => { setPage(0); load(0); }}>
            <Search className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{count.toLocaleString()} question(s)</span>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{selected.length} selected</Badge>
            <Button size="sm" variant="outline" onClick={() => review("approve", selected)}>Approve</Button>
            <Button size="sm" onClick={() => review("publish", selected)}>Publish</Button>
            <Button size="sm" variant="outline" onClick={() => review("reject", selected)}>Reject</Button>
            <Button size="sm" variant="ghost" onClick={() => review("retire", selected)}>Retire</Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No questions match these filters.</p>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => (
            <QuestionCard
              key={q.id}
              q={q}
              selected={selected.includes(q.id)}
              onSelect={(v) => setSelected((s) => (v ? [...s, q.id] : s.filter((x) => x !== q.id)))}
              onEdit={() => setEditing(q)}
              onHistory={() => openHistory(q.id)}
              actions={
                <>
                  {q.status !== "published" && (
                    <Button size="sm" variant="outline" onClick={() => review("publish", [q.id])}>Publish</Button>
                  )}
                  {q.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => review("approve", [q.id])}>Approve</Button>
                  )}
                  {q.status !== "rejected" && (
                    <Button size="sm" variant="ghost" onClick={() => review("reject", [q.id])}>Reject</Button>
                  )}
                  {q.status === "published" && (
                    <Button size="sm" variant="ghost" onClick={() => review("retire", [q.id])}>Retire</Button>
                  )}
                </>
              }
            />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => { const p = page - 1; setPage(p); load(p); }}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page + 1} of {pages}</span>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => { const p = page + 1; setPage(p); load(p); }}>
            Next
          </Button>
        </div>
      )}

      <QuestionEditorDialog question={editing} onOpenChange={(v) => !v && setEditing(null)} onSaved={load} />

      <Dialog open={!!versions} onOpenChange={(v) => !v && setVersions(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Version history</DialogTitle></DialogHeader>
          {(versions ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No earlier versions — this question has never been edited.</p>
          ) : (
            <div className="space-y-3">
              {(versions ?? []).map((v) => (
                <div key={v.id} className="rounded-md border p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="font-medium">Version {v.version}</span>
                    <span className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString()}</span>
                  </div>
                  <p>{v.snapshot?.question}</p>
                  <p className="text-xs text-muted-foreground">
                    {prettify(v.status)}{v.change_reason ? ` · ${v.change_reason}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
