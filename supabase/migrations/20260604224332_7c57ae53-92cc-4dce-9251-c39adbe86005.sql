-- Backfill: reopen any seeded document wrongly marked 'done' while
-- translation_seed_queue still has outstanding rows.
UPDATE public.documents d
SET translation_status = 'processing'
WHERE d.seed_translation = true
  AND d.translation_status = 'done'
  AND EXISTS (
    SELECT 1
    FROM public.translation_seed_queue q
    WHERE q.document_id = d.id
      AND q.status IN ('pending','processing','failed','batched')
  );