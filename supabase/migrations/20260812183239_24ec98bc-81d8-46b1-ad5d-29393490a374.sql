ALTER TABLE public.ingestion_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- One active job per idempotency key
CREATE UNIQUE INDEX IF NOT EXISTS uq_ingestion_jobs_active_idem
  ON public.ingestion_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND state NOT IN ('completed','failed','cancelled');

-- One active job per curriculum scope (grade + subject + curriculum + country)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ingestion_jobs_active_scope
  ON public.ingestion_jobs (grade, subject, coalesce(curriculum,''), coalesce(country,''))
  WHERE grade IS NOT NULL
    AND subject IS NOT NULL
    AND state NOT IN ('completed','failed','cancelled');

-- Auto-cancel jobs that have made no progress for a while, so a dead worker
-- cannot leave a scope permanently blocked.
CREATE OR REPLACE FUNCTION public.reclaim_stale_ingestion_jobs(_stale_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.ingestion_jobs
     SET state = 'cancelled',
         finished_at = now(),
         last_error = coalesce(last_error, 'Auto-cancelled: no progress for ' || _stale_minutes || ' minutes')
   WHERE state NOT IN ('completed','failed','cancelled')
     AND updated_at < now() - make_interval(mins => _stale_minutes);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reclaim_stale_ingestion_jobs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reclaim_stale_ingestion_jobs(integer) TO service_role;