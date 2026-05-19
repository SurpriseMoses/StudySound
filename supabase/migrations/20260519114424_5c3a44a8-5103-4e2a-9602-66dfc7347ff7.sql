
CREATE TABLE public.translation_blueprints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL UNIQUE,
  blueprint_text TEXT NOT NULL,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.translation_blueprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage translation_blueprints"
  ON public.translation_blueprints FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_translation_blueprints_updated_at
  BEFORE UPDATE ON public.translation_blueprints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.gemini_context_caches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL,
  target_language TEXT NOT NULL,
  cache_name TEXT NOT NULL,
  model TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, target_language, model)
);

ALTER TABLE public.gemini_context_caches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage gemini_context_caches"
  ON public.gemini_context_caches FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX gemini_caches_expiry_idx ON public.gemini_context_caches (expires_at);
