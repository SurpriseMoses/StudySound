
-- 1. Watermark mapping (for traceability of leaked content)
CREATE TABLE public.translation_watermarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  target_language text NOT NULL,
  watermark_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_id, chunk_index, target_language)
);

CREATE INDEX idx_translation_watermarks_hash ON public.translation_watermarks(watermark_hash);

ALTER TABLE public.translation_watermarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all watermarks"
  ON public.translation_watermarks
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can insert own watermarks"
  ON public.translation_watermarks
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 2. Rate-limit log (lightweight; rolling cleanup not needed at this scale)
CREATE TABLE public.translation_rate_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_id uuid,
  chunk_index integer,
  target_language text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_translation_rate_log_user_time
  ON public.translation_rate_log(user_id, created_at DESC);

ALTER TABLE public.translation_rate_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own rate log"
  ON public.translation_rate_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own rate log"
  ON public.translation_rate_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 3. Helper: count today's translations (UTC day)
CREATE OR REPLACE FUNCTION public.count_translations_today(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.translation_rate_log
  WHERE user_id = _user_id
    AND created_at >= (now() AT TIME ZONE 'UTC')::date;
$$;

-- 4. Helper: count last 60 seconds
CREATE OR REPLACE FUNCTION public.count_translations_last_minute(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.translation_rate_log
  WHERE user_id = _user_id
    AND created_at >= now() - interval '60 seconds';
$$;
