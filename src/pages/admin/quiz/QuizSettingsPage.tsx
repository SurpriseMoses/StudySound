import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { quizAdmin } from "@/lib/quiz-bank";

export default function QuizSettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [s, setS] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await quizAdmin("settings_get");
      setS(res.settings);
    } catch (e) {
      toast({ title: "Could not load settings", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    setSaving(true);
    try {
      await quizAdmin("settings_update", {
        patch: {
          credit_costs: s.credit_costs,
          min_section_chars: s.min_section_chars,
          default_questions_per_section: s.default_questions_per_section,
          auto_publish_approved: s.auto_publish_approved,
          generation_enabled: s.generation_enabled,
          require_review_subjects: s.require_review_subjects,
          model_pricing: s.model_pricing,
        },
      });
      toast({ title: "Settings saved" });
      load();
    } catch (e) {
      toast({ title: "Could not save settings", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !s) return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  const costs: Record<string, number> = s.credit_costs ?? {};

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Credit cost per quiz length</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Charged from the learner’s existing shared credit balance when a quiz starts.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {Object.keys(costs).sort((a, b) => Number(a) - Number(b)).map((k) => (
              <div key={k}>
                <span className="text-xs text-muted-foreground">{k} questions</span>
                <Input
                  type="number" min={0} value={costs[k]}
                  onChange={(e) => setS({
                    ...s,
                    credit_costs: { ...costs, [k]: parseInt(e.target.value || "0", 10) },
                  })}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Generation</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Generation enabled</Label>
              <p className="text-xs text-muted-foreground">Turn off to stop new seeding without affecting existing questions.</p>
            </div>
            <Switch checked={!!s.generation_enabled} onCheckedChange={(v) => setS({ ...s, generation_enabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Auto-publish approved questions</Label>
              <p className="text-xs text-muted-foreground">Approved questions go live immediately.</p>
            </div>
            <Switch checked={!!s.auto_publish_approved} onCheckedChange={(v) => setS({ ...s, auto_publish_approved: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Minimum section length (characters)</Label>
              <Input
                type="number" value={s.min_section_chars}
                onChange={(e) => setS({ ...s, min_section_chars: parseInt(e.target.value || "0", 10) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Default questions per section</Label>
              <Input
                type="number" min={1} max={20} value={s.default_questions_per_section}
                onChange={(e) => setS({ ...s, default_questions_per_section: parseInt(e.target.value || "1", 10) })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Subjects that always need review before publishing</Label>
            <Input
              value={(s.require_review_subjects ?? []).join(", ")}
              onChange={(e) => setS({
                ...s,
                require_review_subjects: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
              })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Cost estimate inputs</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Model</Label>
            <Input
              value={s.model_pricing?.model ?? ""}
              onChange={(e) => setS({ ...s, model_pricing: { ...s.model_pricing, model: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Rand per US dollar</Label>
            <Input
              type="number" step="0.1" value={s.model_pricing?.usd_to_zar ?? 18.5}
              onChange={(e) => setS({ ...s, model_pricing: { ...s.model_pricing, usd_to_zar: parseFloat(e.target.value || "18.5") } })}
            />
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save settings
      </Button>
    </div>
  );
}
