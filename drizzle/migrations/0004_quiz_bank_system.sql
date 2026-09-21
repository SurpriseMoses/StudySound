-- ============================================================
-- Quiz Bank system. Reuses: documents (books), document_chunks (sections),
-- profiles.credits_balance (wallet), credit_transactions + user_usage (ledger),
-- user_roles/has_role (admin auth).
-- ============================================================

-- ---------- questions ----------
CREATE TABLE public.quiz_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index integer,
  chunk_id uuid REFERENCES public.document_chunks(id) ON DELETE SET NULL,
  language text NOT NULL DEFAULT 'en',
  question_hash text NOT NULL,
  source_content_hash text,
  quiz_bank_version integer NOT NULL DEFAULT 1,

  question text NOT NULL,
  question_type text NOT NULL DEFAULT 'multiple_choice',
  options jsonb,
  correct_answer text,
  acceptable_answers jsonb,
  items jsonb,
  correct_order jsonb,
  explanation text,
  working text,

  difficulty text NOT NULL DEFAULT 'medium',
  skill text,
  topic text,
  source_reference text,

  grade text,
  subject text,
  phase text,
  curriculum_system text,
  curriculum_version text,
  caps_topic text,
  caps_subtopic text,
  learning_outcome text,
  assessment_skill text,
  cognitive_level text,
  command_word text,
  exam_alignment_level text NOT NULL DEFAULT 'low',
  source_material_type text,
  curriculum_reference text,

  status text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  manually_edited boolean NOT NULL DEFAULT false,
  ai_validated boolean NOT NULL DEFAULT false,
  generation_job_id uuid,
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  retired_at timestamptz,
  replaced_by_id uuid,

  source_question_id uuid,
  translation_version integer,

  times_served integer NOT NULL DEFAULT 0,
  times_answered integer NOT NULL DEFAULT 0,
  times_correct integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quiz_questions_status_chk CHECK (status IN ('draft','pending_review','approved','published','rejected','retired')),
  CONSTRAINT quiz_questions_difficulty_chk CHECK (difficulty IN ('easy','medium','hard')),
  CONSTRAINT quiz_questions_type_chk CHECK (question_type IN ('multiple_choice','true_false','short_answer','ordering','vocabulary','inference','analysis')),
  CONSTRAINT quiz_questions_exam_chk CHECK (exam_alignment_level IN ('low','medium','high'))
);

CREATE UNIQUE INDEX quiz_questions_dedupe_idx
  ON public.quiz_questions (document_id, COALESCE(chunk_index, -1), language, question_hash);
CREATE INDEX quiz_questions_doc_status_idx ON public.quiz_questions (document_id, status);
CREATE INDEX quiz_questions_published_pick_idx ON public.quiz_questions (document_id, language, difficulty, skill) WHERE status = 'published';
CREATE INDEX quiz_questions_status_idx ON public.quiz_questions (status);
CREATE INDEX quiz_questions_job_idx ON public.quiz_questions (generation_job_id);

GRANT SELECT ON public.quiz_questions TO authenticated;
GRANT ALL ON public.quiz_questions TO service_role;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Learners read published questions"
  ON public.quiz_questions FOR SELECT TO authenticated
  USING (status = 'published' OR public.has_role(auth.uid(), 'admin'));

-- ---------- version history ----------
CREATE TABLE public.quiz_question_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  status text NOT NULL,
  source_content_hash text,
  generation_job_id uuid,
  change_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, version)
);
GRANT SELECT ON public.quiz_question_versions TO authenticated;
GRANT ALL ON public.quiz_question_versions TO service_role;
ALTER TABLE public.quiz_question_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read question versions"
  ON public.quiz_question_versions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ---------- seed jobs ----------
CREATE TABLE public.quiz_seed_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  document_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  scope text NOT NULL DEFAULT 'full_book',
  chunk_indexes jsonb,
  language text NOT NULL DEFAULT 'en',
  generation_mode text NOT NULL DEFAULT 'generate_new',
  questions_per_section integer NOT NULL DEFAULT 5,
  difficulty_mix jsonb NOT NULL DEFAULT '{"easy":40,"medium":40,"hard":20}'::jsonb,
  skill_mix jsonb NOT NULL DEFAULT '{}'::jsonb,
  question_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  exam_alignment_level text NOT NULL DEFAULT 'low',
  model text,
  pricing_snapshot jsonb,
  estimated_questions integer NOT NULL DEFAULT 0,
  estimated_cost_zar numeric,
  total_sections integer NOT NULL DEFAULT 0,
  target_questions integer NOT NULL DEFAULT 0,
  generated_questions integer NOT NULL DEFAULT 0,
  approved_questions integer NOT NULL DEFAULT 0,
  published_questions integer NOT NULL DEFAULT 0,
  failed_questions integer NOT NULL DEFAULT 0,
  duplicate_questions integer NOT NULL DEFAULT 0,
  invalid_questions integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued',
  paused boolean NOT NULL DEFAULT false,
  cancel_requested boolean NOT NULL DEFAULT false,
  batch_name text,
  batch_submitted_at timestamptz,
  batch_state text,
  created_by uuid,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_seed_jobs_status_chk CHECK (status IN ('queued','processing','completed','partially_completed','failed','cancelled'))
);
CREATE INDEX quiz_seed_jobs_status_idx ON public.quiz_seed_jobs (status, created_at DESC);
GRANT SELECT ON public.quiz_seed_jobs TO authenticated;
GRANT ALL ON public.quiz_seed_jobs TO service_role;
ALTER TABLE public.quiz_seed_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read seed jobs"
  ON public.quiz_seed_jobs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.quiz_seed_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.quiz_seed_jobs(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  chunk_id uuid,
  batch_position integer,
  source_content_hash text,
  requested_questions integer NOT NULL DEFAULT 5,
  generated_questions integer NOT NULL DEFAULT 0,
  duplicate_questions integer NOT NULL DEFAULT 0,
  invalid_questions integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, document_id, chunk_index)
);
CREATE INDEX quiz_seed_job_items_job_idx ON public.quiz_seed_job_items (job_id, status);
GRANT SELECT ON public.quiz_seed_job_items TO authenticated;
GRANT ALL ON public.quiz_seed_job_items TO service_role;
ALTER TABLE public.quiz_seed_job_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read seed job items"
  ON public.quiz_seed_job_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ---------- learner attempts (bank-based) ----------
CREATE TABLE public.quiz_bank_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index integer,
  scope text NOT NULL DEFAULT 'section',
  preset text NOT NULL DEFAULT 'standard',
  language text NOT NULL DEFAULT 'en',
  total_questions integer NOT NULL DEFAULT 0,
  credits_charged integer NOT NULL DEFAULT 0,
  idempotency_key text,
  correct_count integer NOT NULL DEFAULT 0,
  score numeric,
  duration_seconds integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX quiz_bank_attempts_idem_idx ON public.quiz_bank_attempts (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX quiz_bank_attempts_user_idx ON public.quiz_bank_attempts (user_id, created_at DESC);
GRANT SELECT ON public.quiz_bank_attempts TO authenticated;
GRANT ALL ON public.quiz_bank_attempts TO service_role;
ALTER TABLE public.quiz_bank_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own quiz attempts"
  ON public.quiz_bank_attempts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.quiz_bank_attempt_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.quiz_bank_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.quiz_questions(id) ON DELETE RESTRICT,
  question_version integer NOT NULL DEFAULT 1,
  position integer NOT NULL,
  question_snapshot jsonb NOT NULL,
  given_answer text,
  is_correct boolean,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, position)
);
CREATE INDEX quiz_bank_attempt_questions_q_idx ON public.quiz_bank_attempt_questions (question_id);
GRANT SELECT ON public.quiz_bank_attempt_questions TO authenticated;
GRANT ALL ON public.quiz_bank_attempt_questions TO service_role;
ALTER TABLE public.quiz_bank_attempt_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own attempt questions"
  ON public.quiz_bank_attempt_questions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.quiz_bank_attempts a WHERE a.id = attempt_id AND a.user_id = auth.uid())
  );

-- ---------- adaptive performance ----------
CREATE TABLE public.quiz_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index integer,
  skill text,
  difficulty text,
  question_type text,
  attempts integer NOT NULL DEFAULT 0,
  correct integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX quiz_performance_key_idx ON public.quiz_performance
  (user_id, document_id, COALESCE(chunk_index, -1), COALESCE(skill,''), COALESCE(difficulty,''), COALESCE(question_type,''));
GRANT SELECT ON public.quiz_performance TO authenticated;
GRANT ALL ON public.quiz_performance TO service_role;
ALTER TABLE public.quiz_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own quiz performance"
  ON public.quiz_performance FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.quiz_question_exposure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  question_id uuid NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  times_seen integer NOT NULL DEFAULT 0,
  times_correct integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  UNIQUE (user_id, question_id)
);
GRANT SELECT ON public.quiz_question_exposure TO authenticated;
GRANT ALL ON public.quiz_question_exposure TO service_role;
ALTER TABLE public.quiz_question_exposure ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own question exposure"
  ON public.quiz_question_exposure FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- ---------- flags ----------
CREATE TABLE public.quiz_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  flagged_by uuid,
  source text NOT NULL DEFAULT 'admin',
  reason text,
  status text NOT NULL DEFAULT 'open',
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_flags_status_chk CHECK (status IN ('open','resolved','dismissed'))
);
CREATE INDEX quiz_flags_question_idx ON public.quiz_flags (question_id, status);
GRANT SELECT, INSERT ON public.quiz_flags TO authenticated;
GRANT ALL ON public.quiz_flags TO service_role;
ALTER TABLE public.quiz_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users flag questions"
  ON public.quiz_flags FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = flagged_by);
CREATE POLICY "Read own or admin flags"
  ON public.quiz_flags FOR SELECT TO authenticated
  USING (auth.uid() = flagged_by OR public.has_role(auth.uid(), 'admin'));

-- ---------- settings (single config row + templates) ----------
CREATE TABLE public.quiz_settings (
  id integer PRIMARY KEY DEFAULT 1,
  credit_costs jsonb NOT NULL DEFAULT '{"5":1,"10":2,"20":4,"50":10,"100":20}'::jsonb,
  presets jsonb NOT NULL DEFAULT '[{"id":"quick","label":"Quick Quiz","questions":5},{"id":"standard","label":"Standard Quiz","questions":10},{"id":"deep","label":"Deep Practice","questions":20},{"id":"mastery","label":"Mastery Quiz","questions":50}]'::jsonb,
  model_pricing jsonb NOT NULL DEFAULT '{"model":"gemini-2.5-flash","input_usd_per_million":0.10,"output_usd_per_million":0.40,"batch_discount":0.5,"usd_to_zar":18.5}'::jsonb,
  min_section_chars integer NOT NULL DEFAULT 900,
  default_questions_per_section integer NOT NULL DEFAULT 5,
  require_review_subjects jsonb NOT NULL DEFAULT '["Mathematics","Mathematical Literacy","Physical Sciences"]'::jsonb,
  auto_publish_approved boolean NOT NULL DEFAULT false,
  generation_enabled boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_settings_singleton_chk CHECK (id = 1)
);
INSERT INTO public.quiz_settings (id) VALUES (1);
GRANT SELECT ON public.quiz_settings TO authenticated;
GRANT ALL ON public.quiz_settings TO service_role;
ALTER TABLE public.quiz_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read quiz settings"
  ON public.quiz_settings FOR SELECT TO authenticated USING (true);

CREATE TABLE public.quiz_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  applies_to text NOT NULL DEFAULT 'literature',
  subject text,
  grade text,
  questions_per_section integer NOT NULL DEFAULT 5,
  difficulty_mix jsonb NOT NULL DEFAULT '{"easy":40,"medium":40,"hard":20}'::jsonb,
  skill_mix jsonb NOT NULL DEFAULT '{}'::jsonb,
  question_types jsonb NOT NULL DEFAULT '["multiple_choice","true_false","short_answer"]'::jsonb,
  cognitive_mix jsonb NOT NULL DEFAULT '{}'::jsonb,
  exam_alignment_level text NOT NULL DEFAULT 'low',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.quiz_templates TO authenticated;
GRANT ALL ON public.quiz_templates TO service_role;
ALTER TABLE public.quiz_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read quiz templates"
  ON public.quiz_templates FOR SELECT TO authenticated USING (true);

INSERT INTO public.quiz_templates (name, description, applies_to, skill_mix, question_types, cognitive_mix, exam_alignment_level, is_default)
VALUES
  ('Literature (default)', 'Comprehension-weighted mix for English novels and plays.', 'literature',
   '{"comprehension":40,"vocabulary":20,"inference":20,"analysis":15,"literary_devices":5}'::jsonb,
   '["multiple_choice","true_false","short_answer","ordering"]'::jsonb,
   '{"recall":35,"understanding":30,"application":15,"analysis":15,"evaluation":5}'::jsonb,
   'low', true),
  ('CAPS curriculum (exam-style)', 'CAPS-aligned exam-style practice for curriculum subjects.', 'curriculum',
   '{"definitions":20,"concepts":25,"application":25,"interpretation":15,"analysis":15}'::jsonb,
   '["multiple_choice","short_answer","true_false"]'::jsonb,
   '{"recall":25,"understanding":25,"application":25,"analysis":15,"evaluation":10}'::jsonb,
   'high', false),
  ('Mathematics / Physical Sciences (strict)', 'Calculation-focused with mandatory working and stricter review.', 'stem',
   '{"routine_procedures":30,"complex_procedures":30,"problem_solving":25,"reasoning":15}'::jsonb,
   '["multiple_choice","short_answer"]'::jsonb,
   '{"knowledge":20,"application":30,"calculations":30,"analysis":20}'::jsonb,
   'high', false);

-- ---------- admin aggregate (kept server-side, admin-gated) ----------
CREATE OR REPLACE FUNCTION public.quiz_bank_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'published', COUNT(*) FILTER (WHERE status = 'published'),
        'pending_review', COUNT(*) FILTER (WHERE status = 'pending_review'),
        'draft', COUNT(*) FILTER (WHERE status = 'draft'),
        'approved', COUNT(*) FILTER (WHERE status = 'approved'),
        'rejected', COUNT(*) FILTER (WHERE status = 'rejected'),
        'retired', COUNT(*) FILTER (WHERE status = 'retired')
      ) FROM public.quiz_questions
    ),
    'jobs', (
      SELECT jsonb_build_object(
        'running', COUNT(*) FILTER (WHERE status IN ('queued','processing')),
        'completed', COUNT(*) FILTER (WHERE status IN ('completed','partially_completed')),
        'failed', COUNT(*) FILTER (WHERE status = 'failed')
      ) FROM public.quiz_seed_jobs
    ),
    'books_with_bank', (SELECT COUNT(DISTINCT document_id) FROM public.quiz_questions),
    'books_total', (SELECT COUNT(*) FROM public.documents),
    'by_difficulty', (
      SELECT COALESCE(jsonb_object_agg(difficulty, n), '{}'::jsonb)
      FROM (SELECT difficulty, COUNT(*) n FROM public.quiz_questions GROUP BY difficulty) d
    ),
    'by_type', (
      SELECT COALESCE(jsonb_object_agg(question_type, n), '{}'::jsonb)
      FROM (SELECT question_type, COUNT(*) n FROM public.quiz_questions GROUP BY question_type) t
    ),
    'by_skill', (
      SELECT COALESCE(jsonb_object_agg(COALESCE(skill,'unspecified'), n), '{}'::jsonb)
      FROM (SELECT skill, COUNT(*) n FROM public.quiz_questions GROUP BY skill) s
    ),
    'by_book', (
      SELECT COALESCE(jsonb_agg(row_to_json(b)), '[]'::jsonb) FROM (
        SELECT d.id AS document_id, d.title,
               COUNT(q.id) AS total,
               COUNT(q.id) FILTER (WHERE q.status = 'published') AS published,
               COUNT(q.id) FILTER (WHERE q.status IN ('draft','pending_review')) AS pending,
               COUNT(q.id) FILTER (WHERE q.status = 'rejected') AS rejected,
               COUNT(q.id) FILTER (WHERE q.status = 'retired') AS retired
        FROM public.quiz_questions q
        JOIN public.documents d ON d.id = q.document_id
        GROUP BY d.id, d.title
        ORDER BY COUNT(q.id) DESC
        LIMIT 100
      ) b
    )
  ) INTO result;

  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.quiz_bank_overview() TO authenticated;