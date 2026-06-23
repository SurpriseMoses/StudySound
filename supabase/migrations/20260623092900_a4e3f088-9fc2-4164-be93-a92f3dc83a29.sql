
-- Create consolidated Siyavula source
INSERT INTO public.content_sources (id, name, source_type, source_url, license_type, verification_status, country, curriculum, notes)
VALUES (
  '11111111-2222-4333-8444-555555555555',
  'Siyavula',
  'index_page',
  'https://www.siyavula.com/read/za',
  'creative_commons',
  'verified',
  'ZA',
  'CAPS',
  'Consolidated Siyavula textbooks (CC-BY). Pick grade & subject per job.'
)
ON CONFLICT (id) DO NOTHING;

-- Reassign existing jobs/documents from per-grade Siyavula rows to consolidated source
WITH old_siyavula AS (
  SELECT id FROM public.content_sources
  WHERE name LIKE 'Siyavula %Grade%'
)
UPDATE public.ingestion_jobs
SET source_id = '11111111-2222-4333-8444-555555555555'
WHERE source_id IN (SELECT id FROM old_siyavula);

WITH old_siyavula AS (
  SELECT id FROM public.content_sources
  WHERE name LIKE 'Siyavula %Grade%'
)
UPDATE public.documents
SET source_id = '11111111-2222-4333-8444-555555555555'
WHERE source_id IN (SELECT id FROM old_siyavula);

-- Delete the per-grade Siyavula sources
DELETE FROM public.content_sources
WHERE name LIKE 'Siyavula %Grade%';
