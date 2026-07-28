DO $$
DECLARE docs uuid[];
BEGIN
  SELECT array_agg(id) INTO docs FROM public.documents WHERE grade_level IN ('10','11','12');
  IF docs IS NULL THEN docs := ARRAY[]::uuid[]; END IF;

  DELETE FROM public.document_chunks WHERE document_id = ANY(docs);
  DELETE FROM public.audio_assets WHERE document_id = ANY(docs);
  DELETE FROM public.translation_assets WHERE document_id = ANY(docs);
  DELETE FROM public.translation_blueprints WHERE document_id = ANY(docs);
  DELETE FROM public.translation_seed_queue WHERE document_id = ANY(docs);
  DELETE FROM public.translation_seed_logs WHERE document_id = ANY(docs);
  DELETE FROM public.translation_watermarks WHERE document_id = ANY(docs);
  DELETE FROM public.gemini_context_caches WHERE document_id = ANY(docs);
  DELETE FROM public.image_assets WHERE document_id = ANY(docs);
  DELETE FROM public.quiz_assets WHERE document_id = ANY(docs);
  DELETE FROM public.scene_unlocks WHERE document_id = ANY(docs);
  DELETE FROM public.seed_queue WHERE document_id = ANY(docs);
  DELETE FROM public.seed_logs WHERE document_id = ANY(docs);
  DELETE FROM public.visual_prompts_batch_jobs WHERE document_id = ANY(docs);
  DELETE FROM public.content_topic_mapping WHERE document_id = ANY(docs);
  DELETE FROM public.curriculum_tags WHERE document_id = ANY(docs);
  DELETE FROM public.content_quality_metrics WHERE document_id = ANY(docs);
  DELETE FROM public.user_chunk_access WHERE document_id = ANY(docs);
  DELETE FROM public.user_translation_access WHERE document_id = ANY(docs);
  DELETE FROM public.user_asset_access WHERE document_id = ANY(docs);
  DELETE FROM public.user_activity WHERE document_id = ANY(docs);
  DELETE FROM public.user_usage WHERE document_id = ANY(docs);
  DELETE FROM public.credit_transactions WHERE document_id = ANY(docs);
  DELETE FROM public.translation_rate_log WHERE document_id = ANY(docs);
  UPDATE public.lessons SET document_id = NULL WHERE document_id = ANY(docs);

  DELETE FROM public.ingestion_batch_items
    WHERE ingestion_job_id IN (SELECT id FROM public.ingestion_jobs WHERE grade IN ('10','11','12') OR document_id = ANY(docs));
  DELETE FROM public.ingestion_stage_logs
    WHERE job_id IN (SELECT id FROM public.ingestion_jobs WHERE grade IN ('10','11','12') OR document_id = ANY(docs));
  DELETE FROM public.ingestion_jobs WHERE grade IN ('10','11','12') OR document_id = ANY(docs);

  DELETE FROM public.documents WHERE id = ANY(docs);
END $$;