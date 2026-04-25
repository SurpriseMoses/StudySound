-- 1. Document-level flags
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS seed_translation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS translation_status text NOT NULL DEFAULT 'pending';

-- 2. Per-chunk-per-language queue
CREATE TABLE IF NOT EXISTS public.translation_seed_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  target_language text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  priority integer NOT NULL DEFAULT 0,
  delayed_until timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index, target_language)
);

CREATE INDEX IF NOT EXISTS idx_translation_seed_queue_status
  ON public.translation_seed_queue (status, delayed_until);
CREATE INDEX IF NOT EXISTS idx_translation_seed_queue_doc
  ON public.translation_seed_queue (document_id);

ALTER TABLE public.translation_seed_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage translation_seed_queue"
  ON public.translation_seed_queue
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Per-chunk audit logs
CREATE TABLE IF NOT EXISTS public.translation_seed_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  target_language text NOT NULL,
  status text NOT NULL,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_translation_seed_logs_doc
  ON public.translation_seed_logs (document_id, created_at DESC);

ALTER TABLE public.translation_seed_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage translation_seed_logs"
  ON public.translation_seed_logs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. Singleton worker state
CREATE TABLE IF NOT EXISTS public.translation_worker_state (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_running boolean NOT NULL DEFAULT false,
  last_heartbeat timestamptz,
  current_queue_id uuid,
  current_document_id uuid,
  current_language text,
  total_processed integer NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.translation_worker_state (id, is_running)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.translation_worker_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage translation_worker_state"
  ON public.translation_worker_state
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));