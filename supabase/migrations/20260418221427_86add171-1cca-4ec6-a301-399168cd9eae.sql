-- Add XP & level columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS xp integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1;

-- XP event log (audit + idempotency via source_key)
CREATE TABLE IF NOT EXISTS public.xp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source text NOT NULL,            -- 'section_complete' | 'lesson_complete' | 'daily_reward' | 'quiz_bonus'
  source_key text,                 -- e.g. lesson_id:section_index or quiz attempt id (for idempotency)
  xp_awarded integer NOT NULL,
  credits_awarded integer NOT NULL DEFAULT 0,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS xp_events_user_source_key_unique
  ON public.xp_events (user_id, source, source_key)
  WHERE source_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS xp_events_user_created_idx
  ON public.xp_events (user_id, created_at DESC);

ALTER TABLE public.xp_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own xp events"
  ON public.xp_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
