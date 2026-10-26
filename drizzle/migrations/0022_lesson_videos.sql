CREATE TABLE public.lesson_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  storage_path text NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'magiclight' CHECK (char_length(source) <= 60),
  sort_order integer NOT NULL DEFAULT 0,
  size_bytes bigint,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lesson_videos_document_idx ON public.lesson_videos(document_id, sort_order);
GRANT SELECT ON public.lesson_videos TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.lesson_videos TO authenticated;
GRANT ALL ON public.lesson_videos TO service_role;
ALTER TABLE public.lesson_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users view lesson videos" ON public.lesson_videos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert lesson videos" ON public.lesson_videos FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update lesson videos" ON public.lesson_videos FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete lesson videos" ON public.lesson_videos FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Signed-in users read lesson video files" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'lesson-videos');
CREATE POLICY "Admins upload lesson video files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'lesson-videos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update lesson video files" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'lesson-videos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete lesson video files" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'lesson-videos' AND public.has_role(auth.uid(), 'admin'));