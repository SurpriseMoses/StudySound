UPDATE public.translation_seed_queue
SET priority = 100,
    status = 'pending',
    started_at = NULL,
    delayed_until = NULL,
    attempts = 0
WHERE document_id = '2789f407-4ca3-43a1-92cf-dc3dd0fa4b29'
  AND target_language IN ('ts','af')
  AND status IN ('pending','processing');