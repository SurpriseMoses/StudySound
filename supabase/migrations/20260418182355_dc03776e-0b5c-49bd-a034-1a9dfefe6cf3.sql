-- Enable trigram extension for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index on document titles for fast similarity search
CREATE INDEX IF NOT EXISTS idx_documents_title_trgm
  ON public.documents USING gin (title gin_trgm_ops);

-- Fuzzy search RPC: returns documents ranked by title similarity
CREATE OR REPLACE FUNCTION public.search_documents_fuzzy(
  _query text,
  _threshold real DEFAULT 0.3,
  _limit int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  title text,
  subject_type subject_type,
  char_count int,
  similarity real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.title,
    d.subject_type,
    d.char_count,
    GREATEST(
      similarity(lower(d.title), lower(_query)),
      similarity(lower(regexp_replace(d.title, '\s+', '', 'g')), lower(regexp_replace(_query, '\s+', '', 'g')))
    ) AS similarity
  FROM public.documents d
  WHERE
    lower(d.title) % lower(_query)
    OR lower(d.title) ILIKE '%' || lower(_query) || '%'
    OR similarity(lower(d.title), lower(_query)) >= _threshold
  ORDER BY similarity DESC, d.title
  LIMIT _limit;
$$;

-- Allow authenticated users to call it
GRANT EXECUTE ON FUNCTION public.search_documents_fuzzy(text, real, int) TO authenticated;