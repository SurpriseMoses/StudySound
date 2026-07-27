UPDATE public.ingestion_jobs
SET state = 'cancelled',
    last_error = 'Cancelled: Siyavula has no Mathematical Literacy books; source switched to DBE CAPS PDF.',
    finished_at = now(),
    updated_at = now()
WHERE id = '1dc321d8-3292-45ef-ae8a-441b6ac5ee37';