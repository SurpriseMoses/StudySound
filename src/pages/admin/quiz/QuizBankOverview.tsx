import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { prettify, quizAdmin } from "@/lib/quiz-bank";
import SeedQuizBankDialog from "./SeedQuizBankDialog";

export default function QuizBankOverview() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [gen, setGen] = useState<{ available: boolean; message: string | null }>({ available: true, message: null });
  const [seedOpen, setSeedOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [res, g] = await Promise.all([quizAdmin("overview"), quizAdmin("generation_status")]);
      setData(res.overview);
      setGen({ available: !!g.available, message: g.message ?? null });
    } catch (e) {
      toast({ title: "Could not load the Quiz Bank", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (loading) {
    return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const totals = data?.totals ?? {};
  const jobs = data?.jobs ?? {};
  const byStatus: Record<string, number> = {
    draft: totals.draft ?? 0,
    pending_review: totals.pending_review ?? 0,
    approved: totals.approved ?? 0,
    published: totals.published ?? 0,
    rejected: totals.rejected ?? 0,
    retired: totals.retired ?? 0,
  };
  const cards = [
    { label: "Books with questions", value: `${data?.books_with_bank ?? 0}/${data?.books_total ?? 0}` },
    { label: "Total questions", value: totals.total ?? 0 },
    { label: "Published", value: totals.published ?? 0 },
    { label: "Awaiting review", value: (totals.draft ?? 0) + (totals.pending_review ?? 0) },
    { label: "Jobs running", value: jobs.running ?? 0 },
    { label: "Jobs completed", value: jobs.completed ?? 0 },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Questions are generated once from your book sections, reviewed, then reused by every learner.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setSeedOpen(true)} className="gap-1.5">
            <Plus className="w-4 h-4" /> Seed Quiz Bank
          </Button>
        </div>
      </div>

      {!gen.available && gen.message && (
        <div className="flex gap-2 items-start rounded-md border border-accent/40 bg-accent/10 p-3 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-accent shrink-0" />
          <span>{gen.message} Everything already in the bank keeps working for learners.</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <div className="text-2xl font-bold font-display">
                {typeof c.value === "number" ? c.value.toLocaleString() : c.value}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{c.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Questions by status</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.keys(byStatus).length === 0 && (
              <p className="text-sm text-muted-foreground">No questions yet. Start by seeding a book.</p>
            )}
            {Object.entries(byStatus).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span>{prettify(k)}</span>
                <Badge variant="secondary">{Number(v).toLocaleString()}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Coverage by book</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(data?.by_book ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No seeded books yet.</p>
            )}
            {(data?.by_book ?? []).slice(0, 8).map((b: any) => (
              <div key={b.document_id} className="flex items-center justify-between text-sm gap-2">
                <span className="truncate">{b.title}</span>
                <span className="text-muted-foreground whitespace-nowrap">
                  {b.published} published / {b.total}
                </span>
              </div>
            ))}
            <Link to="/admin/quiz-bank/jobs" className="text-sm text-primary inline-block pt-1">View seed jobs</Link>
          </CardContent>
        </Card>
      </div>

      <SeedQuizBankDialog open={seedOpen} onOpenChange={setSeedOpen} onCreated={load} />
    </div>
  );
}
