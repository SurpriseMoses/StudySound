
ALTER TABLE public.content_sources
  ADD COLUMN IF NOT EXISTS grade text,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;

CREATE TABLE IF NOT EXISTS public.coverage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country text NOT NULL DEFAULT 'ZA',
  curriculum text NOT NULL DEFAULT 'CAPS',
  total_topics int NOT NULL,
  covered_topics int NOT NULL,
  resources int NOT NULL DEFAULT 0,
  source_id uuid REFERENCES public.content_sources(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.coverage_snapshots TO authenticated;
GRANT ALL ON public.coverage_snapshots TO service_role;

ALTER TABLE public.coverage_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read coverage snapshots"
  ON public.coverage_snapshots FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert coverage snapshots"
  ON public.coverage_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS coverage_snapshots_created_idx ON public.coverage_snapshots (created_at DESC);
