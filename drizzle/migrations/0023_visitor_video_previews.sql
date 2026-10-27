CREATE TABLE public.preview_videos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
 storage_path text NOT NULL UNIQUE,
 sort_order integer NOT NULL DEFAULT 0,
 size_bytes bigint,
 created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.preview_videos TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.preview_videos TO authenticated;
GRANT ALL ON public.preview_videos TO service_role;
ALTER TABLE public.preview_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Visitors view preview videos" ON public.preview_videos FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins manage preview videos" ON public.preview_videos FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Visitors read published preview files" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'preview-videos' AND EXISTS (SELECT 1 FROM public.preview_videos v WHERE v.storage_path = name));
CREATE POLICY "Admins manage preview video files" ON storage.objects FOR ALL TO authenticated USING (bucket_id = 'preview-videos' AND public.has_role(auth.uid(), 'admin')) WITH CHECK (bucket_id = 'preview-videos' AND public.has_role(auth.uid(), 'admin'));
CREATE INDEX preview_videos_order_idx ON public.preview_videos(sort_order, created_at);