-- Shared translation cache (like audio_assets)
CREATE TABLE public.translation_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  source_language TEXT NOT NULL DEFAULT 'en',
  target_language TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index, target_language)
);

CREATE INDEX idx_translation_assets_doc_lang ON public.translation_assets(document_id, target_language);

ALTER TABLE public.translation_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read translation_assets"
  ON public.translation_assets FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can delete translation_assets"
  ON public.translation_assets FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Per-user paid access for translation chunks
CREATE TABLE public.user_translation_access (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  target_language TEXT NOT NULL,
  credits_charged INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_id, chunk_index, target_language)
);

CREATE INDEX idx_user_translation_access_user ON public.user_translation_access(user_id, document_id);

ALTER TABLE public.user_translation_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own translation access"
  ON public.user_translation_access FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own translation access"
  ON public.user_translation_access FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);