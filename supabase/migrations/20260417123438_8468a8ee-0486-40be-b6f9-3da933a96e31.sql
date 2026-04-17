
-- 1. Subject type enum
CREATE TYPE public.subject_type AS ENUM ('novel', 'history', 'science', 'other');
CREATE TYPE public.asset_type AS ENUM ('audio', 'image', 'quiz');
CREATE TYPE public.voice_provider AS ENUM ('azure', 'elevenlabs');

-- 2. Shared documents table (global, hash-keyed)
CREATE TABLE public.documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  clean_text TEXT NOT NULL,
  subject_type public.subject_type NOT NULL DEFAULT 'other',
  language TEXT NOT NULL DEFAULT 'en',
  char_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_hash ON public.documents(content_hash);

-- 3. Audio assets (chunked)
CREATE TABLE public.audio_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  voice_provider public.voice_provider NOT NULL,
  language TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  duration_seconds NUMERIC,
  char_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, language, chunk_index)
);
CREATE INDEX idx_audio_assets_doc ON public.audio_assets(document_id, language, chunk_index);

-- 4. Image assets
CREATE TABLE public.image_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  scene_index INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, scene_index)
);
CREATE INDEX idx_image_assets_doc ON public.image_assets(document_id, scene_index);

-- 5. Quiz assets
CREATE TABLE public.quiz_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  quiz_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, difficulty)
);
CREATE INDEX idx_quiz_assets_doc ON public.quiz_assets(document_id, difficulty);

-- 6. User asset access (replay-free tracking)
CREATE TABLE public.user_asset_access (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  asset_type public.asset_type NOT NULL,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_id, asset_type)
);
CREATE INDEX idx_user_asset_access_user ON public.user_asset_access(user_id);

-- 7. Usage log (per action, with idempotency)
CREATE TABLE public.user_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  action_type public.asset_type NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id)
);
CREATE INDEX idx_user_usage_user ON public.user_usage(user_id, created_at DESC);

-- 8. Add credits_balance to profiles
ALTER TABLE public.profiles ADD COLUMN credits_balance INTEGER NOT NULL DEFAULT 100;

-- 9. Link user lessons to shared documents
ALTER TABLE public.lessons ADD COLUMN document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL;
CREATE INDEX idx_lessons_document ON public.lessons(document_id);

-- 10. Enable RLS on all new tables
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audio_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_asset_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_usage ENABLE ROW LEVEL SECURITY;

-- 11. RLS: shared content is readable by authenticated users only (no anon), writes via service role
CREATE POLICY "Authenticated users can read documents"
  ON public.documents FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read audio_assets"
  ON public.audio_assets FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read image_assets"
  ON public.image_assets FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read quiz_assets"
  ON public.quiz_assets FOR SELECT TO authenticated USING (true);

-- 12. RLS: user_asset_access — own rows only, insert via own user_id
CREATE POLICY "Users can view own asset access"
  ON public.user_asset_access FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own asset access"
  ON public.user_asset_access FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 13. RLS: user_usage — own rows only
CREATE POLICY "Users can view own usage"
  ON public.user_usage FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own usage"
  ON public.user_usage FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 14. Trigger to keep documents.updated_at fresh
CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 15. Private storage bucket for generated assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('assets', 'assets', false)
ON CONFLICT (id) DO NOTHING;

-- 16. Storage policies — authenticated users can READ via signed URLs only;
-- direct object SELECT is blocked (no policy), forcing edge functions to
-- mint signed URLs with service role.
-- (No SELECT/INSERT/UPDATE/DELETE policies on storage.objects for 'assets'
-- means only service_role can access — exactly what we want.)
