UPDATE public.content_sources
SET name = 'DBE Mind the Gap Study Guides',
    notes = COALESCE(notes,'') || ' Study guides: free to download.'
WHERE id = '8025856d-21e8-4123-bb44-f2f0aa3a5c4d';

INSERT INTO public.ingestion_jobs (source_id, input_url, title_hint, grade, subject, curriculum, country, state, idempotency_key)
SELECT '8025856d-21e8-4123-bb44-f2f0aa3a5c4d',
       'https://www.studyclix.co.za/posts/401/Mind-the-Gap-Study-Guide#' || lower(replace(s.subject,' ','-')),
       'Mind the Gap ' || s.subject || ' Grade 12 Study Guide',
       '12', s.subject, 'CAPS', 'ZA', 'pending',
       'mtg-12-' || lower(replace(s.subject,' ','-'))
FROM (VALUES ('Geography'),('History'),('Accounting'),('Economics'),('Business Studies'),('Life Orientation'),('English First Additional Language')) AS s(subject)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ingestion_jobs j
  WHERE j.idempotency_key = 'mtg-12-' || lower(replace(s.subject,' ','-'))
    AND j.state NOT IN ('completed','failed','cancelled')
);