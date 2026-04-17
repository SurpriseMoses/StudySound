import { ExternalLink, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function AdminErrors() {
  // Edge function logs are stored in Lovable Cloud's logging system. We surface a link
  // (admins are expected to have backend access). We keep the section here as a stable
  // entry point in the dashboard so future in-app log viewing can replace this.
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-display font-bold">Error log</h1>
      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />
            <div>
              <p className="font-medium">Edge function logs are stored in Lovable Cloud.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Open the backend to view recent failures from <code>generate-audio</code>,
                <code> regenerate-audio-chunk</code>, <code>extract-document</code>, and other functions.
                Filter by status code <code>5xx</code> or search the function name.
              </p>
            </div>
          </div>
          <a
            href="https://supabase.com/dashboard/project/_/functions"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Open backend logs <ExternalLink className="w-3 h-3" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
