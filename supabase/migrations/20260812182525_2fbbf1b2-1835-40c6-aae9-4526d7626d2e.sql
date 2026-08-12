UPDATE public.ingestion_jobs
SET state = 'cancelled',
    progress = 100,
    finished_at = now(),
    last_error = 'Duplicate re-kick: Grade 11 content already ingested and published'
WHERE grade = '11'
  AND state = 'downloading'
  AND document_id IS NULL;