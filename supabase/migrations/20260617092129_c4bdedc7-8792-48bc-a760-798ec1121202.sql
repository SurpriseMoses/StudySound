
-- =====================================================
-- ENUMS
-- =====================================================
DO $$ BEGIN
  CREATE TYPE public.license_type AS ENUM (
    'public_domain','creative_commons','government_educational','educational_use','unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.source_verification AS ENUM ('unverified','verified','blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ingestion_state AS ENUM (
    'pending','downloading','parsing','structuring','tagging',
    'cleaning','chunking','translating','audio_seeding','completed','failed','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================
-- CONTENT SOURCES
-- =====================================================
CREATE TABLE IF NOT EXISTS public.content_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  source_type text NOT NULL DEFAULT 'web',
  source_url text,
  license_type public.license_type NOT NULL DEFAULT 'unknown',
  verification_status public.source_verification NOT NULL DEFAULT 'unverified',
  country text,
  curriculum text,
  notes text,
  import_count integer NOT NULL DEFAULT 0,
  last_import_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_sources TO authenticated;
GRANT ALL ON public.content_sources TO service_role;
ALTER TABLE public.content_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage content_sources" ON public.content_sources
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER trg_content_sources_updated_at
  BEFORE UPDATE ON public.content_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- INGESTION JOBS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.content_sources(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  input_url text,
  input_upload_path text,
  input_raw_text text,
  title_hint text,
  grade text,
  subject text,
  curriculum text,
  country text,
  state public.ingestion_state NOT NULL DEFAULT 'pending',
  progress integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_state ON public.ingestion_jobs (state, updated_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_source ON public.ingestion_jobs (source_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ingestion_jobs_active_url
  ON public.ingestion_jobs (source_id, input_url)
  WHERE input_url IS NOT NULL AND state NOT IN ('completed','failed','cancelled');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingestion_jobs TO authenticated;
GRANT ALL ON public.ingestion_jobs TO service_role;
ALTER TABLE public.ingestion_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage ingestion_jobs" ON public.ingestion_jobs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER trg_ingestion_jobs_updated_at
  BEFORE UPDATE ON public.ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- License gate trigger: block jobs from sources that aren't verified with an allowed license.
CREATE OR REPLACE FUNCTION public.enforce_ingestion_license()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lic public.license_type;
  _ver public.source_verification;
BEGIN
  IF NEW.source_id IS NULL THEN
    RAISE EXCEPTION 'ingestion_jobs.source_id is required';
  END IF;
  SELECT license_type, verification_status INTO _lic, _ver
  FROM public.content_sources WHERE id = NEW.source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown source_id %', NEW.source_id;
  END IF;
  IF _ver = 'blocked' THEN
    RAISE EXCEPTION 'source is blocked';
  END IF;
  IF _ver <> 'verified' THEN
    RAISE EXCEPTION 'source is not verified — manual review required';
  END IF;
  IF _lic NOT IN ('public_domain','creative_commons','government_educational','educational_use') THEN
    RAISE EXCEPTION 'license % is not permitted for ingestion', _lic;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ingestion_jobs_license ON public.ingestion_jobs;
CREATE TRIGGER trg_ingestion_jobs_license
  BEFORE INSERT ON public.ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ingestion_license();

-- =====================================================
-- STAGE LOGS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.ingestion_stage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.ingestion_jobs(id) ON DELETE CASCADE,
  stage public.ingestion_state NOT NULL,
  status text NOT NULL DEFAULT 'info',
  message text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ingestion_stage_logs_job ON public.ingestion_stage_logs (job_id, created_at DESC);

GRANT SELECT, INSERT ON public.ingestion_stage_logs TO authenticated;
GRANT ALL ON public.ingestion_stage_logs TO service_role;
ALTER TABLE public.ingestion_stage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read ingestion_stage_logs" ON public.ingestion_stage_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Admins insert ingestion_stage_logs" ON public.ingestion_stage_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- =====================================================
-- CURRICULUM TAXONOMY + TAGS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.curriculum_taxonomy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country text NOT NULL,
  curriculum text NOT NULL,
  grade text NOT NULL,
  subject text NOT NULL,
  topic text,
  subtopic text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, curriculum, grade, subject, topic, subtopic)
);
GRANT SELECT ON public.curriculum_taxonomy TO authenticated, anon;
GRANT ALL ON public.curriculum_taxonomy TO service_role;
ALTER TABLE public.curriculum_taxonomy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads taxonomy" ON public.curriculum_taxonomy
  FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "Admins manage taxonomy" ON public.curriculum_taxonomy
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.curriculum_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  country text,
  curriculum text,
  grade text,
  subject text,
  topic text,
  subtopic text,
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_curriculum_tags_doc ON public.curriculum_tags (document_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.curriculum_tags TO authenticated;
GRANT ALL ON public.curriculum_tags TO service_role;
ALTER TABLE public.curriculum_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read curriculum_tags" ON public.curriculum_tags
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage curriculum_tags" ON public.curriculum_tags
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- =====================================================
-- QUALITY METRICS
-- =====================================================
CREATE TABLE IF NOT EXISTS public.content_quality_metrics (
  document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  ocr_score numeric,
  cleaning_success_rate numeric,
  duplicate_score numeric,
  translation_health numeric,
  english_leakage_pct numeric,
  missing_chunks integer,
  computed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_quality_metrics TO authenticated;
GRANT ALL ON public.content_quality_metrics TO service_role;
ALTER TABLE public.content_quality_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage quality_metrics" ON public.content_quality_metrics
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- =====================================================
-- EXTEND documents
-- =====================================================
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES public.content_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS license_type public.license_type,
  ADD COLUMN IF NOT EXISTS curriculum text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS import_job_id uuid REFERENCES public.ingestion_jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_source ON public.documents (source_id);

-- =====================================================
-- CRON: ingestion-worker every minute
-- =====================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
