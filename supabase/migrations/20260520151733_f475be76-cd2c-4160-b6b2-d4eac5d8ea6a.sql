-- Drop stale audio rows (no text hash recorded = pre-versioning seed).
DELETE FROM public.audio_assets
WHERE clean_text_hash IS NULL OR clean_text_hash = '';

-- Clear any pending queue rows so enqueue_all repopulates cleanly.
DELETE FROM public.seed_queue WHERE status IN ('pending','failed');

-- Reset seed status on every seeded doc so the admin manager re-enqueues them.
UPDATE public.documents
SET seed_audio_status = 'pending',
    seed_audio_progress = -1,
    seed_audio_error = NULL
WHERE seed_audio = true;