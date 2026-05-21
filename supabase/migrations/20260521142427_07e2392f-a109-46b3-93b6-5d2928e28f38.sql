UPDATE public.seed_queue
SET status = 'pending',
    attempts = 0,
    started_at = NULL,
    delayed_until = now() + interval '2 minutes',
    last_error = NULL
WHERE status = 'failed'
  AND last_error ILIKE '%rate-limited%';