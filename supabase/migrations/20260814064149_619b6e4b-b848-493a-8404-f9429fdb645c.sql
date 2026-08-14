DO $$
DECLARE ids uuid[];
BEGIN
  SELECT array_agg(id) INTO ids FROM public.documents
  WHERE grade_level IN ('8','9')
    AND source_url LIKE '%education.gov.za%';

  IF ids IS NULL THEN RETURN; END IF;

  DELETE FROM public.audio_assets WHERE document_id = ANY(ids);
  DELETE FROM public.translation_assets WHERE document_id = ANY(ids);
  DELETE FROM public.image_assets WHERE document_id = ANY(ids);
  DELETE FROM public.quiz_assets WHERE document_id = ANY(ids);
  DELETE FROM public.translation_blueprints WHERE document_id = ANY(ids);
  DELETE FROM public.translation_watermarks WHERE document_id = ANY(ids);
  DELETE FROM public.translation_rate_log WHERE document_id = ANY(ids);
  DELETE FROM public.translation_seed_logs WHERE document_id = ANY(ids);
  DELETE FROM public.translation_seed_queue WHERE document_id = ANY(ids);
  DELETE FROM public.seed_logs WHERE document_id = ANY(ids);
  DELETE FROM public.seed_queue WHERE document_id = ANY(ids);
  DELETE FROM public.scene_unlocks WHERE document_id = ANY(ids);
  DELETE FROM public.user_chunk_access WHERE document_id = ANY(ids);
  DELETE FROM public.user_translation_access WHERE document_id = ANY(ids);
  DELETE FROM public.user_asset_access WHERE document_id = ANY(ids);
  DELETE FROM public.user_usage WHERE document_id = ANY(ids);
  DELETE FROM public.user_activity WHERE document_id = ANY(ids);
  DELETE FROM public.lessons WHERE document_id = ANY(ids);
  DELETE FROM public.content_quality_metrics WHERE document_id = ANY(ids);
  DELETE FROM public.content_topic_mapping WHERE document_id = ANY(ids);
  DELETE FROM public.curriculum_tags WHERE document_id = ANY(ids);
  DELETE FROM public.gemini_context_caches WHERE document_id = ANY(ids);
  DELETE FROM public.visual_prompts_batch_jobs WHERE document_id = ANY(ids);
  DELETE FROM public.document_chunks WHERE document_id = ANY(ids);

  UPDATE public.credit_transactions SET document_id = NULL WHERE document_id = ANY(ids);
  UPDATE public.ingestion_jobs SET document_id = NULL WHERE document_id = ANY(ids);
  UPDATE public.ingestion_jobs SET state = 'cancelled'
    WHERE grade IN ('8','9') AND state NOT IN ('completed','failed','cancelled');

  DELETE FROM public.documents WHERE id = ANY(ids);
END $$;