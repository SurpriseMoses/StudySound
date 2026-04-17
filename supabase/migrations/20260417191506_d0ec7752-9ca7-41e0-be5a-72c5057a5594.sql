ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS grade_level TEXT,
  ADD COLUMN IF NOT EXISTS is_seeded BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_seeded_grade
  ON public.documents (is_seeded, grade_level) WHERE is_seeded = true;