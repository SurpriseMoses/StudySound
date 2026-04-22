ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS raw_text text,
  ADD COLUMN IF NOT EXISTS seed_audio boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seed_audio_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS seed_audio_progress integer NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS seed_audio_error text;

ALTER TABLE public.documents
  ALTER COLUMN clean_text DROP NOT NULL;

-- Constrain status to known states
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_seed_audio_status_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_seed_audio_status_check
      CHECK (seed_audio_status IN ('pending','cleaning','processing','done','failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_seed_queue
  ON public.documents (seed_audio_status)
  WHERE seed_audio = true AND seed_audio_status <> 'done';