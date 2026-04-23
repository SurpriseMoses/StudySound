-- Queue of chunks to narrate
CREATE TABLE public.seed_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX idx_seed_queue_status_priority ON public.seed_queue (status, priority DESC, created_at ASC);
CREATE INDEX idx_seed_queue_document ON public.seed_queue (document_id);

ALTER TABLE public.seed_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage seed_queue"
  ON public.seed_queue
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_seed_queue_updated_at
  BEFORE UPDATE ON public.seed_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Single-row worker state. id is fixed so we always upsert the same row.
CREATE TABLE public.seed_worker_state (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_running boolean NOT NULL DEFAULT false,
  last_heartbeat timestamptz,
  current_queue_id uuid,
  current_document_id uuid,
  total_processed integer NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.seed_worker_state (id, is_running) VALUES (1, false);

ALTER TABLE public.seed_worker_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage seed_worker_state"
  ON public.seed_worker_state
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_seed_worker_state_updated_at
  BEFORE UPDATE ON public.seed_worker_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();