CREATE OR REPLACE FUNCTION public.tsq_maybe_mark_doc_done()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _doc uuid;
  _outstanding int;
BEGIN
  _doc := COALESCE(NEW.document_id, OLD.document_id);
  IF _doc IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*) INTO _outstanding
  FROM public.translation_seed_queue
  WHERE document_id = _doc
    AND status IN ('pending','processing','failed','batched');

  IF _outstanding = 0 THEN
    UPDATE public.documents
    SET translation_status = 'done'
    WHERE id = _doc
      AND seed_translation = true
      AND translation_status <> 'done';
  ELSE
    UPDATE public.documents
    SET translation_status = 'processing'
    WHERE id = _doc
      AND seed_translation = true
      AND translation_status = 'done';
  END IF;
  RETURN NULL;
END;
$function$;