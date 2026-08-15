UPDATE public.ingestion_jobs
SET state = 'pending', progress = 0, attempts = 0, last_error = NULL, started_at = NULL, updated_at = now()
WHERE state NOT IN ('completed','failed','cancelled')
  AND updated_at < now() - interval '30 minutes';