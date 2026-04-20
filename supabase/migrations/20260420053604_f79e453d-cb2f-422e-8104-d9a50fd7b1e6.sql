-- 1. credit_transactions table
CREATE TABLE public.credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount integer NOT NULL,
  source text NOT NULL,
  feature_type text,
  document_id uuid,
  request_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_credit_tx_user_created ON public.credit_transactions(user_id, created_at DESC);
CREATE INDEX idx_credit_tx_source_created ON public.credit_transactions(source, created_at DESC);
CREATE INDEX idx_credit_tx_feature_created ON public.credit_transactions(feature_type, created_at DESC);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own transactions"
  ON public.credit_transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all transactions"
  ON public.credit_transactions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. Profile flag/cooldown columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cooldown_until timestamptz,
  ADD COLUMN IF NOT EXISTS flagged_reason text;

CREATE POLICY "Admins view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. Aggregated business metrics
-- NOTE: translation credits derived from user_translation_access (asset_type enum lacks 'translation').
CREATE OR REPLACE FUNCTION public.admin_business_metrics(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _since timestamptz := now() - (_days || ' days')::interval;
  _result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH
  audio_spend AS (
    SELECT COALESCE(SUM(credits_charged),0)::int AS credits, COUNT(*)::int AS unlocks
    FROM public.user_chunk_access
    WHERE created_at >= _since AND asset_type = 'audio'
  ),
  trans_spend AS (
    SELECT COALESCE(SUM(credits_charged),0)::int AS credits, COUNT(*)::int AS unlocks
    FROM public.user_translation_access
    WHERE created_at >= _since
  ),
  visual_spend AS (
    SELECT COALESCE(SUM(credits_charged),0)::int AS credits, COUNT(*)::int AS unlocks
    FROM public.scene_unlocks
    WHERE created_at >= _since
  ),
  audio_generated AS (
    SELECT COUNT(*)::int AS n FROM public.audio_assets WHERE created_at >= _since
  ),
  trans_generated AS (
    SELECT COUNT(*)::int AS n FROM public.translation_assets WHERE created_at >= _since
  ),
  visual_generated AS (
    SELECT COUNT(*)::int AS n FROM public.image_assets WHERE created_at >= _since
  ),
  signups AS (
    SELECT COUNT(*)::int AS n FROM public.profiles WHERE created_at >= _since
  ),
  active AS (
    SELECT COUNT(DISTINCT user_id)::int AS n FROM public.user_usage
    WHERE created_at >= now() - interval '7 days'
  ),
  paying AS (
    SELECT COUNT(*)::int AS n FROM public.profiles WHERE plan IN ('essential','premium')
  ),
  total_users AS (
    SELECT COUNT(*)::int AS n FROM public.profiles
  )
  SELECT jsonb_build_object(
    'days', _days,
    'audio_credits',         (SELECT credits FROM audio_spend),
    'translation_credits',   (SELECT credits FROM trans_spend),
    'visual_credits',        (SELECT credits FROM visual_spend),
    'audio_unlocks',         (SELECT unlocks FROM audio_spend),
    'translation_unlocks',   (SELECT unlocks FROM trans_spend),
    'visual_unlocks',        (SELECT unlocks FROM visual_spend),
    'audio_generated',       (SELECT n FROM audio_generated),
    'translation_generated', (SELECT n FROM trans_generated),
    'visual_generated',      (SELECT n FROM visual_generated),
    'new_signups',           (SELECT n FROM signups),
    'active_users_7d',       (SELECT n FROM active),
    'paying_users',          (SELECT n FROM paying),
    'total_users',           (SELECT n FROM total_users)
  ) INTO _result;

  RETURN _result;
END;
$$;

-- 4. Top documents by revenue
CREATE OR REPLACE FUNCTION public.admin_top_documents(_limit integer DEFAULT 20)
RETURNS TABLE(
  document_id uuid,
  title text,
  audio_unlocks bigint,
  translation_unlocks bigint,
  visual_unlocks bigint,
  total_unlocks bigint,
  credits_generated bigint,
  audio_cached bigint,
  last_activity timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id AS document_id,
    d.title,
    COALESCE(au.n, 0) AS audio_unlocks,
    COALESCE(tu.n, 0) AS translation_unlocks,
    COALESCE(vu.n, 0) AS visual_unlocks,
    COALESCE(au.n,0) + COALESCE(tu.n,0) + COALESCE(vu.n,0) AS total_unlocks,
    COALESCE(au.credits, 0) + COALESCE(tu.credits, 0) + COALESCE(vu.credits, 0) AS credits_generated,
    COALESCE(ac.n, 0) AS audio_cached,
    GREATEST(
      COALESCE(au.last_at, '1970-01-01'::timestamptz),
      COALESCE(tu.last_at, '1970-01-01'::timestamptz),
      COALESCE(vu.last_at, '1970-01-01'::timestamptz)
    ) AS last_activity
  FROM public.documents d
  LEFT JOIN (
    SELECT document_id, COUNT(*)::bigint AS n, SUM(credits_charged)::bigint AS credits, MAX(created_at) AS last_at
    FROM public.user_chunk_access WHERE asset_type = 'audio' GROUP BY document_id
  ) au ON au.document_id = d.id
  LEFT JOIN (
    SELECT document_id, COUNT(*)::bigint AS n, SUM(credits_charged)::bigint AS credits, MAX(created_at) AS last_at
    FROM public.user_translation_access GROUP BY document_id
  ) tu ON tu.document_id = d.id
  LEFT JOIN (
    SELECT document_id, COUNT(*)::bigint AS n, SUM(credits_charged)::bigint AS credits, MAX(created_at) AS last_at
    FROM public.scene_unlocks GROUP BY document_id
  ) vu ON vu.document_id = d.id
  LEFT JOIN (
    SELECT document_id, COUNT(*)::bigint AS n FROM public.audio_assets GROUP BY document_id
  ) ac ON ac.document_id = d.id
  WHERE public.has_role(auth.uid(), 'admin')
  ORDER BY credits_generated DESC NULLS LAST, total_unlocks DESC
  LIMIT _limit;
$$;

-- 5. Abuse candidates
CREATE OR REPLACE FUNCTION public.admin_abuse_candidates()
RETURNS TABLE(
  user_id uuid,
  display_name text,
  plan text,
  is_flagged boolean,
  cooldown_until timestamptz,
  translations_today bigint,
  translations_last_minute bigint,
  audio_today bigint,
  daily_cap integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.user_id,
    p.display_name,
    p.plan::text,
    p.is_flagged,
    p.cooldown_until,
    COALESCE(t.today, 0) AS translations_today,
    COALESCE(t.last_min, 0) AS translations_last_minute,
    COALESCE(a.today, 0) AS audio_today,
    CASE WHEN p.plan IN ('essential','premium') THEN 100 ELSE 20 END AS daily_cap
  FROM public.profiles p
  LEFT JOIN (
    SELECT user_id,
      COUNT(*) FILTER (WHERE created_at >= (now() AT TIME ZONE 'UTC')::date) AS today,
      COUNT(*) FILTER (WHERE created_at >= now() - interval '60 seconds') AS last_min
    FROM public.translation_rate_log
    WHERE created_at >= now() - interval '24 hours'
    GROUP BY user_id
  ) t ON t.user_id = p.user_id
  LEFT JOIN (
    SELECT user_id, COUNT(*) AS today
    FROM public.user_chunk_access
    WHERE asset_type = 'audio' AND created_at >= (now() AT TIME ZONE 'UTC')::date
    GROUP BY user_id
  ) a ON a.user_id = p.user_id
  WHERE public.has_role(auth.uid(), 'admin')
    AND (
      p.is_flagged
      OR p.cooldown_until > now()
      OR COALESCE(t.today, 0) > CASE WHEN p.plan IN ('essential','premium') THEN 80 ELSE 16 END
      OR COALESCE(t.last_min, 0) > 5
      OR COALESCE(a.today, 0) > CASE WHEN p.plan IN ('essential','premium') THEN 160 ELSE 32 END
    )
  ORDER BY translations_today DESC, audio_today DESC;
$$;

-- 6. Daily credit timeseries (joins three access tables)
CREATE OR REPLACE FUNCTION public.admin_credit_timeseries(_days integer DEFAULT 30)
RETURNS TABLE(day date, audio_credits bigint, translation_credits bigint, visual_credits bigint, total bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH days AS (
    SELECT generate_series(
      (now() AT TIME ZONE 'UTC')::date - (_days - 1),
      (now() AT TIME ZONE 'UTC')::date,
      interval '1 day'
    )::date AS day
  ),
  audio AS (
    SELECT (created_at AT TIME ZONE 'UTC')::date AS day, SUM(credits_charged)::bigint AS c
    FROM public.user_chunk_access
    WHERE asset_type = 'audio' AND created_at >= now() - (_days || ' days')::interval
    GROUP BY 1
  ),
  trans AS (
    SELECT (created_at AT TIME ZONE 'UTC')::date AS day, SUM(credits_charged)::bigint AS c
    FROM public.user_translation_access
    WHERE created_at >= now() - (_days || ' days')::interval
    GROUP BY 1
  ),
  vis AS (
    SELECT (created_at AT TIME ZONE 'UTC')::date AS day, SUM(credits_charged)::bigint AS c
    FROM public.scene_unlocks
    WHERE created_at >= now() - (_days || ' days')::interval
    GROUP BY 1
  )
  SELECT
    d.day,
    COALESCE(audio.c, 0) AS audio_credits,
    COALESCE(trans.c, 0) AS translation_credits,
    COALESCE(vis.c, 0)   AS visual_credits,
    COALESCE(audio.c, 0) + COALESCE(trans.c, 0) + COALESCE(vis.c, 0) AS total
  FROM days d
  LEFT JOIN audio ON audio.day = d.day
  LEFT JOIN trans ON trans.day = d.day
  LEFT JOIN vis   ON vis.day = d.day
  WHERE public.has_role(auth.uid(), 'admin')
  ORDER BY d.day;
$$;