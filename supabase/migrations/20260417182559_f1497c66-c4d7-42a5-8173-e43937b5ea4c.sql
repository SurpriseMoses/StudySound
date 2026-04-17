CREATE TABLE public.user_chunk_access (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  language TEXT NOT NULL,
  asset_type public.asset_type NOT NULL DEFAULT 'audio',
  credits_charged INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_id, chunk_index, language, asset_type)
);

ALTER TABLE public.user_chunk_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chunk access"
  ON public.user_chunk_access FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chunk access"
  ON public.user_chunk_access FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_user_chunk_access_lookup
  ON public.user_chunk_access (user_id, document_id, language);