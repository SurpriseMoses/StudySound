
-- Trigger to mark documents.translation_status='done' once the last queue row finishes
CREATE OR REPLACE FUNCTION public.tsq_maybe_mark_doc_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _doc uuid;
  _outstanding int;
BEGIN
  _doc := COALESCE(NEW.document_id, OLD.document_id);
  IF _doc IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*) INTO _outstanding
  FROM public.translation_seed_queue
  WHERE document_id = _doc
    AND status IN ('pending','processing','failed');

  IF _outstanding = 0 THEN
    UPDATE public.documents
    SET translation_status = 'done'
    WHERE id = _doc
      AND seed_translation = true
      AND translation_status <> 'done';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_tsq_mark_doc_done ON public.translation_seed_queue;
CREATE TRIGGER trg_tsq_mark_doc_done
AFTER INSERT OR UPDATE OR DELETE ON public.translation_seed_queue
FOR EACH ROW
EXECUTE FUNCTION public.tsq_maybe_mark_doc_done();

-- Backfill any doc currently stuck not-done despite a fully-drained queue
UPDATE public.documents d
SET translation_status = 'done'
WHERE d.seed_translation = true
  AND d.translation_status <> 'done'
  AND NOT EXISTS (
    SELECT 1 FROM public.translation_seed_queue q
    WHERE q.document_id = d.id
      AND q.status IN ('pending','processing','failed')
  );
