CREATE OR REPLACE FUNCTION public.admin_translation_health(_document_id uuid DEFAULT NULL, _current_version int DEFAULT 2)
RETURNS TABLE(document_id uuid, total bigint, leaked bigint, stale_version bigint, missing_hash bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ta.document_id,
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE ta.english_leak_detected)::bigint AS leaked,
    COUNT(*) FILTER (WHERE COALESCE(ta.translation_version,1) < _current_version)::bigint AS stale_version,
    COUNT(*) FILTER (WHERE ta.source_text_hash IS NULL)::bigint AS missing_hash
  FROM public.translation_assets ta
  WHERE _document_id IS NULL OR ta.document_id = _document_id
  GROUP BY ta.document_id;
$$;