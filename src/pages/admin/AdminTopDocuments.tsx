import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Trophy } from "lucide-react";
import { creditsToZAR } from "@/lib/admin-pricing";

type Row = {
  document_id: string;
  title: string;
  audio_unlocks: number;
  translation_unlocks: number;
  visual_unlocks: number;
  total_unlocks: number;
  credits_generated: number;
  audio_cached: number;
  last_activity: string | null;
};

export default function AdminTopDocuments() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.functions.invoke("admin-api", {
        body: { action: "top_documents", limit: 50 },
      });
      setRows((data?.documents ?? []) as Row[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-display font-bold">Top documents</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Ranked by credits generated (revenue proxy). Use this to decide what to pre-generate.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left p-3">#</th>
                    <th className="text-left p-3">Title</th>
                    <th className="text-right p-3">Audio</th>
                    <th className="text-right p-3">Translations</th>
                    <th className="text-right p-3">Visuals</th>
                    <th className="text-right p-3">Total unlocks</th>
                    <th className="text-right p-3">Credits</th>
                    <th className="text-right p-3">Revenue (R)</th>
                    <th className="text-left p-3">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.document_id} className="border-t">
                      <td className="p-3 text-muted-foreground">{i + 1}</td>
                      <td className="p-3 font-medium max-w-[280px] truncate">{r.title}</td>
                      <td className="p-3 text-right">{r.audio_unlocks}</td>
                      <td className="p-3 text-right">{r.translation_unlocks}</td>
                      <td className="p-3 text-right">{r.visual_unlocks}</td>
                      <td className="p-3 text-right font-medium">{r.total_unlocks}</td>
                      <td className="p-3 text-right">{r.credits_generated}</td>
                      <td className="p-3 text-right text-primary font-medium">
                        R{creditsToZAR(r.credits_generated).toFixed(2)}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {r.last_activity ? new Date(r.last_activity).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No activity yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
