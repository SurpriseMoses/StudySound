-- Add streak tracking to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reward_date date,
  ADD COLUMN IF NOT EXISTS streak_grace_used boolean NOT NULL DEFAULT false;

-- Daily rewards ledger (one row per user per day, enforced)
CREATE TABLE IF NOT EXISTS public.daily_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reward_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  streak_count integer NOT NULL,
  credits_awarded integer NOT NULL,
  trigger_action text NOT NULL CHECK (trigger_action IN ('listen','quiz','reading')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reward_date)
);

ALTER TABLE public.daily_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own daily rewards"
  ON public.daily_rewards FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_daily_rewards_user_date
  ON public.daily_rewards (user_id, reward_date DESC);