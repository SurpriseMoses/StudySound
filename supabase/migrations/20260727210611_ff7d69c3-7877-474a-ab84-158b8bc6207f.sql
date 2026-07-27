
CREATE OR REPLACE FUNCTION public.admin_investor_metrics(_days integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _since timestamptz := now() - (_days || ' days')::interval;
  _since7 timestamptz := now() - interval '7 days';
  _audio_gen_chars bigint;
  _trans_gen_chars bigint;
  _audio_lifetime_secs numeric;
  _audio_lifetime_chars bigint;
  _audio_lifetime_chunks bigint;
  _docs_count bigint;
  _trans_lifetime bigint;
  _user_audio_unlocks bigint;
  _user_trans_unlocks bigint;
  _active30 bigint;
  _active7 bigint;
  _plan_counts jsonb;
  _signups_by_day jsonb;
BEGIN
  SELECT COALESCE(sum(char_count),0) INTO _audio_gen_chars
    FROM audio_assets WHERE created_at >= _since;
  SELECT COALESCE(sum(char_count),0) INTO _trans_gen_chars
    FROM translation_assets WHERE created_at >= _since;

  SELECT COALESCE(sum(duration_seconds),0), COALESCE(sum(char_count),0), count(*)
    INTO _audio_lifetime_secs, _audio_lifetime_chars, _audio_lifetime_chunks
    FROM audio_assets;

  SELECT count(*) INTO _docs_count FROM documents;
  SELECT count(*) INTO _trans_lifetime FROM translation_assets;

  SELECT count(*) INTO _user_audio_unlocks
    FROM user_chunk_access WHERE asset_type='audio' AND created_at >= _since;
  SELECT count(*) INTO _user_trans_unlocks
    FROM user_translation_access WHERE created_at >= _since;

  SELECT count(DISTINCT user_id) INTO _active30 FROM (
    SELECT user_id FROM user_chunk_access WHERE created_at >= _since
    UNION ALL
    SELECT user_id FROM user_translation_access WHERE created_at >= _since
    UNION ALL
    SELECT user_id FROM scene_unlocks WHERE created_at >= _since
  ) u WHERE user_id IS NOT NULL;

  SELECT count(DISTINCT user_id) INTO _active7 FROM (
    SELECT user_id FROM user_chunk_access WHERE created_at >= _since7
    UNION ALL
    SELECT user_id FROM user_translation_access WHERE created_at >= _since7
  ) u WHERE user_id IS NOT NULL;

  SELECT COALESCE(jsonb_object_agg(plan, n), '{}'::jsonb) INTO _plan_counts FROM (
    SELECT COALESCE(plan::text,'free') AS plan, count(*) AS n
    FROM profiles GROUP BY 1
  ) p;

  SELECT COALESCE(jsonb_object_agg(day, n), '{}'::jsonb) INTO _signups_by_day FROM (
    SELECT to_char(created_at::date,'YYYY-MM-DD') AS day, count(*) AS n
    FROM profiles WHERE created_at >= _since GROUP BY 1
  ) s;

  RETURN jsonb_build_object(
    'audio_gen_chars', _audio_gen_chars,
    'trans_gen_chars', _trans_gen_chars,
    'audio_lifetime_seconds', _audio_lifetime_secs,
    'audio_lifetime_chars', _audio_lifetime_chars,
    'audio_lifetime_chunks', _audio_lifetime_chunks,
    'docs_count', _docs_count,
    'trans_lifetime', _trans_lifetime,
    'user_audio_unlocks', _user_audio_unlocks,
    'user_trans_unlocks', _user_trans_unlocks,
    'active_30d', _active30,
    'active_7d', _active7,
    'plan_counts', _plan_counts,
    'signups_by_day', _signups_by_day
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_investor_metrics(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_investor_metrics(integer) TO service_role;

CREATE INDEX IF NOT EXISTS idx_audio_assets_created_at ON public.audio_assets (created_at);
CREATE INDEX IF NOT EXISTS idx_translation_assets_created_at ON public.translation_assets (created_at);
CREATE INDEX IF NOT EXISTS idx_user_chunk_access_created_at ON public.user_chunk_access (created_at);
CREATE INDEX IF NOT EXISTS idx_user_translation_access_created_at ON public.user_translation_access (created_at);
CREATE INDEX IF NOT EXISTS idx_scene_unlocks_created_at ON public.scene_unlocks (created_at);
CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON public.profiles (created_at);
