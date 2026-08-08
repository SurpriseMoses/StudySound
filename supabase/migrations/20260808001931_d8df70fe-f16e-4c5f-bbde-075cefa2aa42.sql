CREATE OR REPLACE FUNCTION public.admin_pipeline_counts(_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'audio', COALESCE((
      SELECT jsonb_object_agg(document_id::text, n) FROM (
        SELECT document_id, COUNT(*) AS n FROM public.audio_assets
        WHERE document_id = ANY(_ids) GROUP BY document_id
      ) a
    ), '{}'::jsonb),
    'translations', COALESCE((
      SELECT jsonb_object_agg(document_id::text, m) FROM (
        SELECT document_id, jsonb_object_agg(target_language, n) AS m FROM (
          SELECT document_id, target_language, COUNT(*) AS n
          FROM public.translation_assets
          WHERE document_id = ANY(_ids) GROUP BY document_id, target_language
        ) x GROUP BY document_id
      ) t
    ), '{}'::jsonb),
    'audio_queue', COALESCE((
      SELECT jsonb_object_agg(document_id::text, m) FROM (
        SELECT document_id, jsonb_object_agg(status, n) AS m FROM (
          SELECT document_id, status::text AS status, COUNT(*) AS n
          FROM public.seed_queue
          WHERE document_id = ANY(_ids) GROUP BY document_id, status
        ) x GROUP BY document_id
      ) q
    ), '{}'::jsonb),
    'translation_queue', COALESCE((
      SELECT jsonb_object_agg(document_id::text, m) FROM (
        SELECT document_id, jsonb_object_agg(target_language, lm) AS m FROM (
          SELECT document_id, target_language, jsonb_object_agg(status, n) AS lm FROM (
            SELECT document_id, target_language, status::text AS status, COUNT(*) AS n
            FROM public.translation_seed_queue
            WHERE document_id = ANY(_ids) GROUP BY document_id, target_language, status
          ) y GROUP BY document_id, target_language
        ) x GROUP BY document_id
      ) q
    ), '{}'::jsonb)
  );
$$;