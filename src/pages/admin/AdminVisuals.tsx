import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import LessonVideosPanel from "@/components/admin/LessonVideosPanel";
import LegacyVisualsPanel from "@/components/admin/LegacyVisualsPanel";

export default function AdminVisuals() {
  const [docs, setDocs] = useState<{ id: string; title: string; subject_type: string }[]>([]);
  useEffect(() => {
    void supabase.from("documents").select("id, title, subject_type").order("title").limit(500)
      .then(({ data }) => setDocs(data ?? []));
  }, []);
  return <div className="space-y-6">
    <h1 className="text-2xl font-display font-bold">Visuals</h1>
    <Tabs defaultValue="videos">
      <TabsList className="flex h-auto flex-wrap justify-start">
        <TabsTrigger value="videos">Story Mode</TabsTrigger>
        <TabsTrigger value="preview">Visitor preview</TabsTrigger>
        <TabsTrigger value="existing">Existing images</TabsTrigger>
      </TabsList>
      <TabsContent value="videos"><LessonVideosPanel docs={docs} /></TabsContent>
      <TabsContent value="preview"><LessonVideosPanel docs={docs} destination="preview" /></TabsContent>
      <TabsContent value="existing"><LegacyVisualsPanel docs={docs} /></TabsContent>
    </Tabs>
  </div>;
}
