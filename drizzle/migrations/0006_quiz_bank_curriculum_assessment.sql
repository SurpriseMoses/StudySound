-- Curriculum/assessment metadata, validation flags, marks and assessment patterns
-- for the Quiz Bank. Additive only.

ALTER TABLE public.quiz_questions
  ADD COLUMN IF NOT EXISTS question_origin text NOT NULL DEFAULT 'learning',
  ADD COLUMN IF NOT EXISTS assessment_reference_type text,
  ADD COLUMN IF NOT EXISTS assessment_pattern_reference text,
  ADD COLUMN IF NOT EXISTS mark_allocation integer,
  ADD COLUMN IF NOT EXISTS marking_guidance text,
  ADD COLUMN IF NOT EXISTS expected_answer_points jsonb,
  ADD COLUMN IF NOT EXISTS validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'needs_review',
  ADD COLUMN IF NOT EXISTS answer_verified boolean NOT NULL DEFAULT false;

ALTER TABLE public.quiz_questions
  ADD CONSTRAINT quiz_questions_origin_chk
  CHECK (question_origin IN ('learning','curriculum_aligned','exam_aligned'));

ALTER TABLE public.quiz_questions
  ADD CONSTRAINT quiz_questions_validation_status_chk
  CHECK (validation_status IN ('passed','needs_review','failed'));

CREATE INDEX IF NOT EXISTS quiz_questions_origin_idx
  ON public.quiz_questions (question_origin, exam_alignment_level);
CREATE INDEX IF NOT EXISTS quiz_questions_cognitive_idx
  ON public.quiz_questions (cognitive_level);
CREATE INDEX IF NOT EXISTS quiz_questions_validation_idx
  ON public.quiz_questions (validation_status);

-- Learner quiz mode on attempts
ALTER TABLE public.quiz_bank_attempts
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'learning';

-- Settings: configurable cognitive mixes per subject/grade and mode definitions
ALTER TABLE public.quiz_settings
  ADD COLUMN IF NOT EXISTS cognitive_mix_by_subject jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS mode_presets jsonb NOT NULL DEFAULT '{
    "learning": {"label":"Reading Practice","exam_alignment":["none","low"],"cognitive_mix":{"recall":40,"understanding":35,"application":15,"analysis":10}},
    "exam": {"label":"Exam Practice","exam_alignment":["medium","high"],"cognitive_mix":{"recall":30,"understanding":0,"application":30,"analysis":25,"evaluation":15}},
    "mixed": {"label":"Mixed Practice","exam_alignment":["none","low","medium","high"],"cognitive_mix":{}}
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS strict_answer_verification_subjects jsonb NOT NULL
    DEFAULT '["Mathematics","Mathematical Literacy","Physical Sciences"]'::jsonb;

-- Official assessment pattern analysis (admin only, reference material)
CREATE TABLE IF NOT EXISTS public.assessment_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer,
  exam_session text,
  grade text,
  subject text,
  paper_number text,
  section text,
  topic text,
  subtopic text,
  question_type text,
  command_word text,
  cognitive_demand text,
  marks integer,
  skill_assessed text,
  curriculum_reference text,
  pattern_summary text,
  occurrences integer NOT NULL DEFAULT 1,
  source_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessment_patterns_lookup_idx
  ON public.assessment_patterns (subject, grade, topic);
GRANT SELECT ON public.assessment_patterns TO authenticated;
GRANT ALL ON public.assessment_patterns TO service_role;
ALTER TABLE public.assessment_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read assessment patterns"
  ON public.assessment_patterns FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Curriculum & assessment reference documents (CAPS, ATP, exemplars, memos)
CREATE TABLE IF NOT EXISTS public.curriculum_reference_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  reference_type text NOT NULL DEFAULT 'CAPS',
  curriculum_system text NOT NULL DEFAULT 'CAPS',
  curriculum_version text,
  phase text,
  grade text,
  subject text,
  year integer,
  source_url text,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_reference_docs_type_chk CHECK (reference_type IN (
    'CAPS','ATP','diagnostic_assessment','exemplar','past_exam','memorandum','study_guide','textbook','other'
  ))
);
CREATE INDEX IF NOT EXISTS curriculum_reference_docs_lookup_idx
  ON public.curriculum_reference_docs (subject, grade, reference_type);
GRANT SELECT ON public.curriculum_reference_docs TO authenticated;
GRANT ALL ON public.curriculum_reference_docs TO service_role;
ALTER TABLE public.curriculum_reference_docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read curriculum reference docs"
  ON public.curriculum_reference_docs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Curriculum configuration: topics, subtopics, objectives, skills, command words
CREATE TABLE IF NOT EXISTS public.curriculum_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase text,
  grade text NOT NULL,
  subject text NOT NULL,
  curriculum_system text NOT NULL DEFAULT 'CAPS',
  curriculum_version text,
  topic text NOT NULL,
  subtopic text,
  learning_objective text,
  assessment_skill text,
  cognitive_demand text,
  command_words jsonb NOT NULL DEFAULT '[]'::jsonb,
  exam_alignment_level text NOT NULL DEFAULT 'medium',
  typical_marks integer,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_config_exam_chk CHECK (exam_alignment_level IN ('low','medium','high'))
);
CREATE INDEX IF NOT EXISTS curriculum_config_lookup_idx
  ON public.curriculum_config (subject, grade, topic);
GRANT SELECT ON public.curriculum_config TO authenticated;
GRANT ALL ON public.curriculum_config TO service_role;
ALTER TABLE public.curriculum_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read curriculum config"
  ON public.curriculum_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
