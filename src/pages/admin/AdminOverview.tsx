import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, UserPlus, BookOpen, Coins, Headphones } from "lucide-react";

type Analytics = {
  new_signups: number;
  new_lessons: number;
  credits_spent: number;
  audio_minutes_generated: number;
  lessons_by_day: { date: string; count: number }[];
};

export default function AdminOverview() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.functions.invoke("admin-api", { body: { action: "analytics" } });
      if (error || !data?.success) {
        setErr(error?.message ?? data?.error ?? "Failed to load analytics");
      } else {
        setData(data as Analytics);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading analytics…</div>;
  if (err) return <p className="text-destructive text-sm">{err}</p>;
  if (!data) return null;

  const stats = [
    { label: "New signups (30d)", value: data.new_signups, icon: UserPlus },
    { label: "New lessons (30d)", value: data.new_lessons, icon: BookOpen },
    { label: "Credits spent (30d)", value: data.credits_spent, icon: Coins },
    { label: "Audio minutes (30d)", value: data.audio_minutes_generated, icon: Headphones },
  ];

  const maxCount = Math.max(1, ...data.lessons_by_day.map((d) => d.count));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-display font-bold">Overview</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <s.icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-display font-bold">{s.value.toLocaleString()}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lessons created — last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          {data.lessons_by_day.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lessons yet.</p>
          ) : (
            <div className="flex items-end gap-1 h-40">
              {data.lessons_by_day.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.count}`}>
                  <div
                    className="w-full bg-primary/70 hover:bg-primary rounded-t"
                    style={{ height: `${(d.count / maxCount) * 100}%` }}
                  />
                  <span className="text-[9px] text-muted-foreground rotate-45 origin-top-left">{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
