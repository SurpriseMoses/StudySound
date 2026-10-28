DROP POLICY IF EXISTS "Signed-in users read lesson video files" ON storage.objects;
CREATE POLICY "Signed-in users read lesson video files" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'lesson-videos' AND EXISTS (SELECT 1 FROM public.lesson_videos v WHERE v.storage_path = objects.name));

DROP POLICY IF EXISTS "Visitors read published preview files" ON storage.objects;
CREATE POLICY "Visitors read published preview files" ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'preview-videos' AND EXISTS (SELECT 1 FROM public.preview_videos v WHERE v.storage_path = objects.name AND v.document_id IS NOT NULL));

DROP POLICY IF EXISTS "Signed-in users view lesson videos" ON public.lesson_videos;
CREATE POLICY "Signed-in users view lesson videos" ON public.lesson_videos FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND document_id IS NOT NULL AND storage_path IS NOT NULL);

DROP POLICY IF EXISTS "Visitors view preview videos" ON public.preview_videos;
CREATE POLICY "Visitors view preview videos" ON public.preview_videos FOR SELECT TO anon, authenticated
USING (document_id IS NOT NULL AND storage_path IS NOT NULL);