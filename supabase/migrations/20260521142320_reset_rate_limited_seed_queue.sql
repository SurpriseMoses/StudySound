-- Reset chunks that were marked 'failed' purely because of upstream
-- Gemini/Azure 429 quota responses. They are not really failed — the
-- worker now treats rate-limits as soft retries, so re-queue them.
UPDATE public.seed_queue
SET status = 'pending',
    attempts = 0,
    started_at = NULL,
    delayed_until = now() + interval '2 minutes',
    last_error = NULL
WHERE status = 'failed'
  AND last_error ILIKE '%rate-limited%';
