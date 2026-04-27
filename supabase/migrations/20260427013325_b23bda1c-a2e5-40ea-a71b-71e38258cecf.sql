
-- 1. Track cleaning version on documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS cleaning_version integer NOT NULL DEFAULT 1;

-- 2. Track cleaning version + content hash on each cached audio chunk
ALTER TABLE public.audio_assets
  ADD COLUMN IF NOT EXISTS cleaning_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clean_text_hash text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_audio_assets_doc_chunk_lang
  ON public.audio_assets (document_id, chunk_index, language);

-- 3. Trigger: bump documents.cleaning_version whenever clean_text changes
CREATE OR REPLACE FUNCTION public.bump_cleaning_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.clean_text IS DISTINCT FROM OLD.clean_text THEN
    NEW.cleaning_version := COALESCE(OLD.cleaning_version, 1) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documents_bump_cleaning_version ON public.documents;
CREATE TRIGGER trg_documents_bump_cleaning_version
BEFORE UPDATE ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.bump_cleaning_version();
