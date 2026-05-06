UPDATE public.documents
SET seed_audio_status = 'done', seed_audio_error = NULL
WHERE seed_audio = true
  AND seed_audio_status <> 'done'
  AND NOT EXISTS (
    SELECT 1 FROM public.seed_queue sq
    WHERE sq.document_id = documents.id
      AND sq.status IN ('pending','processing','failed')
  );