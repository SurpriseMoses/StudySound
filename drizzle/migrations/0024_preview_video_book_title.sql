ALTER TABLE public.preview_videos ADD COLUMN IF NOT EXISTS book_title TEXT;

-- Backfill existing preview videos from the documents table
UPDATE public.preview_videos pv
SET book_title = d.title
FROM public.documents d
WHERE pv.document_id = d.id
  AND (pv.book_title IS NULL OR pv.book_title = '');

COMMENT ON COLUMN public.preview_videos.book_title IS 'Book title captured at upload time so anonymous visitors can see it without document-table access';