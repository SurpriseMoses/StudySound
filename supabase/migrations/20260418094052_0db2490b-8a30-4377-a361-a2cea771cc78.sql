-- Purge previously cached non-English audio rows. They were generated from English source text
-- and so contain English narration (with the wrong accent). With the fixed generate-audio function,
-- the next request for each chunk will regenerate audio from the cached translation_assets text.
-- We keep user_chunk_access intact so users who already paid don't get re-charged.
DELETE FROM public.audio_assets
WHERE language IN ('zu','af','ts','nso','xh','fr');