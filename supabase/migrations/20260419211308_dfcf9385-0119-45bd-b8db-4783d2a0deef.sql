-- Sentinel: scene_index = -1 represents the full-story bundle unlock
CREATE TABLE public.scene_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  scene_index integer NOT NULL,
  credits_charged integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_id, scene_index)
);

CREATE INDEX idx_scene_unlocks_user_doc ON public.scene_unlocks (user_id, document_id);

ALTER TABLE public.scene_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scene unlocks"
  ON public.scene_unlocks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scene unlocks"
  ON public.scene_unlocks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);