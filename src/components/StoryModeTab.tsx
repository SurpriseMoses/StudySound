import { AlertTriangle, Film } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import LessonVideos from "@/components/LessonVideos";

const HUMANITIES = new Set(["novel", "history"]);

/**
 * Story Mode is video-only: admins upload finished lesson videos
 * (e.g. from MagicLight) and learners watch them free here.
 */
export default function StoryModeTab({
  documentId,
  subjectType,
}: {
  documentId: string;
  lessonId: string;
  subjectType: string | null;
}) {
  const isHumanities = HUMANITIES.has(subjectType ?? "");

  if (!isHumanities) {
    return (
      <Card className="border-warning/30 bg-warning/5">
        <CardContent className="p-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
          <div>
            <p className="text-sm font-medium">Story Mode is for novels and history</p>
            <p className="text-xs text-muted-foreground mt-1">
              STEM lessons use a text + quiz format instead.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <LessonVideos documentId={documentId} />
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <Film className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">
            Story videos are added by the BrainGrasp team. New videos appear here automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
