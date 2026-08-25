CREATE TABLE public.document_figures (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  page_number integer NOT NULL DEFAULT 0,
  label text,
  caption text,
  storage_path text NOT NULL,
  width integer,
  height integer,
  bytes integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX document_figures_doc_path_key ON public.document_figures (document_id, storage_path);
CREATE INDEX document_figures_doc_page_idx ON public.document_figures (document_id, page_number);
CREATE INDEX document_figures_doc_label_idx ON public.document_figures (document_id, label);

GRANT SELECT ON public.document_figures TO authenticated;
GRANT ALL ON public.document_figures TO service_role;

ALTER TABLE public.document_figures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read document figures"
ON public.document_figures FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage document figures"
ON public.document_figures FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can read figure images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'assets' AND name LIKE 'figures/%');