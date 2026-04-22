-- Extend audio cache + per-user access with voice_name + speaking_style
ALTER TABLE public.audio_assets
  ADD COLUMN IF NOT EXISTS voice_name text NOT NULL DEFAULT 'en-GB-LibbyNeural',
  ADD COLUMN IF NOT EXISTS speaking_style text NOT NULL DEFAULT 'general';

ALTER TABLE public.user_chunk_access
  ADD COLUMN IF NOT EXISTS voice_name text,
  ADD COLUMN IF NOT EXISTS speaking_style text;

-- Replace old uniqueness with voice-aware uniqueness on the cache
DROP INDEX IF EXISTS audio_assets_doc_chunk_lang_provider_uq;
CREATE UNIQUE INDEX IF NOT EXISTS audio_assets_cache_uq
  ON public.audio_assets (document_id, chunk_index, language, voice_provider, voice_name, speaking_style);

-- Per-user uniqueness scoped to voice combo (audio rows only)
CREATE UNIQUE INDEX IF NOT EXISTS user_chunk_access_audio_voice_uq
  ON public.user_chunk_access (user_id, document_id, chunk_index, language, voice_name, speaking_style)
  WHERE asset_type = 'audio';

-- Backfill existing rows with the historical default voice so old caches keep working
UPDATE public.audio_assets
   SET voice_name = COALESCE(voice_name, 'en-GB-LibbyNeural'),
       speaking_style = COALESCE(speaking_style, 'general')
 WHERE voice_name IS NULL OR speaking_style IS NULL;

UPDATE public.user_chunk_access
   SET voice_name = 'en-GB-LibbyNeural',
       speaking_style = 'general'
 WHERE asset_type = 'audio' AND voice_name IS NULL;