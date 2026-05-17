UPDATE public.translation_seed_queue
SET status='pending', attempts=0, delayed_until=NULL, last_error=NULL, updated_at=now()
WHERE status IN ('failed','pending') AND last_error ILIKE '%Azure%';