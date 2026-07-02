
CREATE TABLE public.ingestion_batch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grade TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('extract','structure','clean_tag')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','submitted','polling','succeeded','failed','cancelled')),
  gemini_batch_name TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  last_error TEXT,
  report JSONB,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingestion_batch_jobs TO authenticated;
GRANT ALL ON public.ingestion_batch_jobs TO service_role;
ALTER TABLE public.ingestion_batch_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage ingestion_batch_jobs" ON public.ingestion_batch_jobs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_ibj_state ON public.ingestion_batch_jobs(state);
CREATE INDEX idx_ibj_grade_stage ON public.ingestion_batch_jobs(grade, stage);

CREATE TABLE public.ingestion_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_job_id UUID NOT NULL REFERENCES public.ingestion_batch_jobs(id) ON DELETE CASCADE,
  ingestion_job_id UUID NOT NULL REFERENCES public.ingestion_jobs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','failed','review_required')),
  error TEXT,
  result_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(batch_job_id, position)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingestion_batch_items TO authenticated;
GRANT ALL ON public.ingestion_batch_items TO service_role;
ALTER TABLE public.ingestion_batch_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage ingestion_batch_items" ON public.ingestion_batch_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_ibi_batch ON public.ingestion_batch_items(batch_job_id);
CREATE INDEX idx_ibi_ingestion ON public.ingestion_batch_items(ingestion_job_id);

CREATE TRIGGER trg_ibj_updated_at BEFORE UPDATE ON public.ingestion_batch_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add batch-tracking columns to ingestion_jobs
ALTER TABLE public.ingestion_jobs
  ADD COLUMN IF NOT EXISTS batch_job_id UUID REFERENCES public.ingestion_batch_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_stage TEXT;
