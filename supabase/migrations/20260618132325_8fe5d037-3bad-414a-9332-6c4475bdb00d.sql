
CREATE TABLE IF NOT EXISTS public.content_topic_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index integer,
  country text NOT NULL DEFAULT 'ZA',
  curriculum text NOT NULL DEFAULT 'CAPS',
  grade text NOT NULL,
  subject text NOT NULL,
  topic text,
  subtopic text,
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'auto',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS content_topic_mapping_uniq
  ON public.content_topic_mapping (document_id, COALESCE(chunk_index, -1), country, curriculum, grade, subject, COALESCE(topic,''), COALESCE(subtopic,''));
CREATE INDEX IF NOT EXISTS content_topic_mapping_lookup
  ON public.content_topic_mapping (country, curriculum, grade, subject, topic);
CREATE INDEX IF NOT EXISTS content_topic_mapping_doc
  ON public.content_topic_mapping (document_id);

GRANT SELECT ON public.content_topic_mapping TO authenticated;
GRANT ALL ON public.content_topic_mapping TO service_role;

ALTER TABLE public.content_topic_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read mappings"
  ON public.content_topic_mapping FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage mappings"
  ON public.content_topic_mapping FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER content_topic_mapping_set_updated_at
  BEFORE UPDATE ON public.content_topic_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Coverage rollup view: per (grade, subject, topic) with resource counts.
CREATE OR REPLACE VIEW public.v_caps_coverage AS
SELECT
  t.country,
  t.curriculum,
  t.grade,
  t.subject,
  t.topic,
  COUNT(DISTINCT m.document_id) FILTER (WHERE m.confidence >= 0.4) AS resources,
  COUNT(DISTINCT m.document_id) AS resources_any,
  COALESCE(MAX(m.confidence), 0) AS best_confidence
FROM public.curriculum_taxonomy t
LEFT JOIN public.content_topic_mapping m
  ON m.country = t.country
 AND m.curriculum = t.curriculum
 AND m.grade = t.grade
 AND m.subject = t.subject
 AND COALESCE(m.topic,'') = COALESCE(t.topic,'')
GROUP BY t.country, t.curriculum, t.grade, t.subject, t.topic;

GRANT SELECT ON public.v_caps_coverage TO authenticated, anon;
