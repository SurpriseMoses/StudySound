import { AlertTriangle } from "lucide-react";
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
            <AlertTriangle className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <p className="font-medium">Backend function logs</p>
              <p className="text-sm text-muted-foreground mt-1">
                Recent failures from <code>generate-audio</code>, <code>regenerate-audio-chunk</code>,
                <code> extract-document</code>, and other backend functions are kept in your Lovable Cloud backend.
                Open the backend panel and filter by status code <code>5xx</code> or search by function name.
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Tip: from the project settings, open the Backend panel to view real-time logs and recent invocations.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
