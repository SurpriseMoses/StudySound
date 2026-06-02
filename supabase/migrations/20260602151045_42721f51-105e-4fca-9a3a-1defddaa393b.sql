-- Batch API plumbing for translation/blueprint/visual-prompt seeding

-- 1) translation_seed_queue: add batch tracking columns
ALTER TABLE public.translation_seed_queue
  ADD COLUMN IF NOT EXISTS batch_job_name text,
  ADD COLUMN IF NOT EXISTS batch_index integer,
  ADD COLUMN IF NOT EXISTS batch_submitted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tsq_batch_job ON public.translation_seed_queue(batch_job_name) WHERE batch_job_name IS NOT NULL;

-- 2) translation_blueprints: add batch tracking columns
ALTER TABLE public.translation_blueprints
  ADD COLUMN IF NOT EXISTS batch_job_name text,
  ADD COLUMN IF NOT EXISTS batch_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS batch_status text;

CREATE INDEX IF NOT EXISTS idx_tb_batch_status ON public.translation_blueprints(batch_status) WHERE batch_status IS NOT NULL;

-- 3) Visual prompts batch jobs (one in-flight job per document)
CREATE TABLE IF NOT EXISTS public.visual_prompts_batch_jobs (
  document_id uuid PRIMARY KEY,
  batch_job_name text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'running',
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.visual_prompts_batch_jobs TO authenticated;
GRANT ALL ON public.visual_prompts_batch_jobs TO service_role;

ALTER TABLE public.visual_prompts_batch_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage visual_prompts_batch_jobs"
ON public.visual_prompts_batch_jobs
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
