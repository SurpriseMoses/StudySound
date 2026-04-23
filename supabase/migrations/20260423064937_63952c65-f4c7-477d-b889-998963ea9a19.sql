ALTER TABLE public.seed_queue ADD COLUMN IF NOT EXISTS delayed_until timestamptz;
CREATE INDEX IF NOT EXISTS seed_queue_pickup_idx ON public.seed_queue (status, delayed_until, priority, created_at);