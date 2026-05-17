
ALTER TABLE public.translation_assets
  ADD COLUMN IF NOT EXISTS translation_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_text_hash text,
  ADD COLUMN IF NOT EXISTS english_leak_detected boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_translation_assets_dirty
  ON public.translation_assets (document_id, target_language)
  WHERE english_leak_detected = true OR source_text_hash IS NULL;
