-- 1. documents: tags + doc_type
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS doc_type text;

UPDATE public.documents SET doc_type = subject_type::text WHERE doc_type IS NULL;

-- 2. credit_transactions: cost & cache fields
ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS api_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unlocks integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS generations integer NOT NULL DEFAULT 0;

-- 3. user_activity table
CREATE TABLE IF NOT EXISTS public.user_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_id uuid NOT NULL,
  activity_type text NOT NULL DEFAULT 'view',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_doc ON public.user_activity(document_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_user ON public.user_activity(user_id);

ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own activity" ON public.user_activity;
CREATE POLICY "Users insert own activity"
  ON public.user_activity FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own activity" ON public.user_activity;
CREATE POLICY "Users view own activity"
  ON public.user_activity FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all activity" ON public.user_activity;
CREATE POLICY "Admins view all activity"
  ON public.user_activity FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 4. Profit RPC. Backfills cost from cached assets when api_cost is absent.
-- Cost model (ZAR): translation chars * 0.0000005 USD * 18.5; audio chars * 0.000015 USD * 18.5; visual unlock = 0.05 USD * 18.5
CREATE OR REPLACE FUNCTION public.admin_top_documents_v2(_limit integer DEFAULT 50)
RETURNS TABLE(
  document_id uuid,
  title text,
  doc_type text,
  tags jsonb,
  users bigint,
  unlocks bigint,
  generations bigint,
  revenue numeric,
  cost numeric,
  profit numeric,
  margin numeric,
  cache_hit numeric,
  last_activity timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH
  audio AS (
    SELECT uca.document_id,
      COUNT(*)::bigint AS unlocks,
      SUM(uca.credits_charged)::numeric AS credits,
      MAX(uca.created_at) AS last_at
    FROM public.user_chunk_access uca
    WHERE uca.asset_type = 'audio'
    GROUP BY uca.document_id
  ),
  trans AS (
    SELECT uta.document_id,
      COUNT(*)::bigint AS unlocks,
      SUM(uta.credits_charged)::numeric AS credits,
      MAX(uta.created_at) AS last_at
    FROM public.user_translation_access uta
    GROUP BY uta.document_id
  ),
  vis AS (
    SELECT su.document_id,
      COUNT(*)::bigint AS unlocks,
      SUM(su.credits_charged)::numeric AS credits,
      MAX(su.created_at) AS last_at
    FROM public.scene_unlocks su
    GROUP BY su.document_id
  ),
  audio_gen AS (
    SELECT document_id, COUNT(*)::bigint AS n,
      SUM(char_count)::numeric AS chars
    FROM public.audio_assets GROUP BY document_id
  ),
  trans_gen AS (
    SELECT document_id, COUNT(*)::bigint AS n,
      SUM(char_count)::numeric AS chars
    FROM public.translation_assets GROUP BY document_id
  ),
  vis_gen AS (
    SELECT document_id, COUNT(*)::bigint AS n
    FROM public.image_assets GROUP BY document_id
  ),
  users_per_doc AS (
    SELECT document_id, COUNT(DISTINCT user_id)::bigint AS u
    FROM (
      SELECT document_id, user_id FROM public.user_chunk_access
      UNION
      SELECT document_id, user_id FROM public.user_translation_access
      UNION
      SELECT document_id, user_id FROM public.scene_unlocks
    ) x
    GROUP BY document_id
  )
  SELECT
    d.id AS document_id,
    d.title,
    COALESCE(d.doc_type, d.subject_type::text) AS doc_type,
    d.tags,
    COALESCE(u.u, 0) AS users,
    COALESCE(audio.unlocks,0) + COALESCE(trans.unlocks,0) + COALESCE(vis.unlocks,0) AS unlocks,
    COALESCE(audio_gen.n,0) + COALESCE(trans_gen.n,0) + COALESCE(vis_gen.n,0) AS generations,
    -- revenue (R1 per credit)
    (COALESCE(audio.credits,0) + COALESCE(trans.credits,0) + COALESCE(vis.credits,0))::numeric AS revenue,
    -- cost (ZAR)
    (
      COALESCE(audio_gen.chars,0) * 0.000015 * 18.5 +
      COALESCE(trans_gen.chars,0) * 0.0000005 * 18.5 +
      COALESCE(vis_gen.n,0) * 0.05 * 18.5
    )::numeric AS cost,
    -- profit
    (
      (COALESCE(audio.credits,0) + COALESCE(trans.credits,0) + COALESCE(vis.credits,0))
      -
      (COALESCE(audio_gen.chars,0) * 0.000015 * 18.5 +
       COALESCE(trans_gen.chars,0) * 0.0000005 * 18.5 +
       COALESCE(vis_gen.n,0) * 0.05 * 18.5)
    )::numeric AS profit,
    -- margin
    CASE WHEN (COALESCE(audio.credits,0) + COALESCE(trans.credits,0) + COALESCE(vis.credits,0)) > 0
      THEN (
        ((COALESCE(audio.credits,0) + COALESCE(trans.credits,0) + COALESCE(vis.credits,0))
         - (COALESCE(audio_gen.chars,0) * 0.000015 * 18.5
            + COALESCE(trans_gen.chars,0) * 0.0000005 * 18.5
            + COALESCE(vis_gen.n,0) * 0.05 * 18.5))
        / (COALESCE(audio.credits,0) + COALESCE(trans.credits,0) + COALESCE(vis.credits,0))
      )::numeric
      ELSE 0
    END AS margin,
    -- cache hit = (unlocks - generations) / unlocks
    CASE WHEN (COALESCE(audio.unlocks,0) + COALESCE(trans.unlocks,0) + COALESCE(vis.unlocks,0)) > 0
      THEN GREATEST(0, (
        (COALESCE(audio.unlocks,0) + COALESCE(trans.unlocks,0) + COALESCE(vis.unlocks,0))
        - (COALESCE(audio_gen.n,0) + COALESCE(trans_gen.n,0) + COALESCE(vis_gen.n,0))
      ))::numeric / (COALESCE(audio.unlocks,0) + COALESCE(trans.unlocks,0) + COALESCE(vis.unlocks,0))
      ELSE 0
    END AS cache_hit,
    GREATEST(
      COALESCE(audio.last_at, '1970-01-01'::timestamptz),
      COALESCE(trans.last_at, '1970-01-01'::timestamptz),
      COALESCE(vis.last_at,   '1970-01-01'::timestamptz)
    ) AS last_activity
  FROM public.documents d
  LEFT JOIN audio       ON audio.document_id     = d.id
  LEFT JOIN trans       ON trans.document_id     = d.id
  LEFT JOIN vis         ON vis.document_id       = d.id
  LEFT JOIN audio_gen   ON audio_gen.document_id = d.id
  LEFT JOIN trans_gen   ON trans_gen.document_id = d.id
  LEFT JOIN vis_gen     ON vis_gen.document_id   = d.id
  LEFT JOIN users_per_doc u ON u.document_id     = d.id
  ORDER BY profit DESC NULLS LAST
  LIMIT _limit;
$$;