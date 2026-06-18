
-- Add sync tracking columns to content_sources
ALTER TABLE public.content_sources
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS last_sync_hash text,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS docs_discovered integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS docs_imported integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS docs_mapped integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coverage_gained integer NOT NULL DEFAULT 0;

ALTER TABLE public.content_sources
  DROP CONSTRAINT IF EXISTS content_sources_sync_status_check;
ALTER TABLE public.content_sources
  ADD CONSTRAINT content_sources_sync_status_check
  CHECK (sync_status IN ('idle','pending','syncing','completed','failed'));

-- Sync log table
CREATE TABLE IF NOT EXISTS public.caps_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.content_sources(id) ON DELETE CASCADE,
  action text NOT NULL,
  status text NOT NULL,
  message text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caps_sync_logs_source ON public.caps_sync_logs(source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_caps_sync_logs_created ON public.caps_sync_logs(created_at DESC);

GRANT SELECT ON public.caps_sync_logs TO authenticated;
GRANT ALL ON public.caps_sync_logs TO service_role;

ALTER TABLE public.caps_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read caps_sync_logs"
  ON public.caps_sync_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
