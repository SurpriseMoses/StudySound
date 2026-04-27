-- Track invalid chunks skipped during cleaning/seeding so admin UI can surface them.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS invalid_chunks jsonb NOT NULL DEFAULT '[]'::jsonb;