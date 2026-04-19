-- Dedicated per-user lesson progress table
CREATE TABLE public.lesson_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  lesson_id UUID NOT NULL,
  audio_progress_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  audio_listened_seconds INTEGER NOT NULL DEFAULT 0,
  sections_completed INTEGER NOT NULL DEFAULT 0,
  sections_total INTEGER NOT NULL DEFAULT 0,
  last_position_seconds INTEGER NOT NULL DEFAULT 0,
  reward_eligible BOOLEAN NOT NULL DEFAULT false,
  reward_claimed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT lesson_progress_user_lesson_unique UNIQUE (user_id, lesson_id),
  CONSTRAINT lesson_progress_pct_range CHECK (audio_progress_pct >= 0 AND audio_progress_pct <= 100),
  CONSTRAINT lesson_progress_listened_nonneg CHECK (audio_listened_seconds >= 0),
  CONSTRAINT lesson_progress_sections_nonneg CHECK (sections_completed >= 0 AND sections_total >= 0)
);

CREATE INDEX idx_lesson_progress_user ON public.lesson_progress(user_id);
CREATE INDEX idx_lesson_progress_lesson ON public.lesson_progress(lesson_id);

ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own lesson progress"
  ON public.lesson_progress FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own lesson progress"
  ON public.lesson_progress FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own lesson progress"
  ON public.lesson_progress FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Auto-update last_updated_at
CREATE TRIGGER update_lesson_progress_last_updated
  BEFORE UPDATE ON public.lesson_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
-- Note: update_updated_at_column sets NEW.updated_at; lesson_progress uses last_updated_at instead.
-- Replace with explicit trigger function:
DROP TRIGGER update_lesson_progress_last_updated ON public.lesson_progress;

CREATE OR REPLACE FUNCTION public.set_last_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.last_updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lesson_progress_last_updated
  BEFORE UPDATE ON public.lesson_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.set_last_updated_at();