-- Track when a free user's one-time credits expire
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS free_credits_expires_at TIMESTAMP WITH TIME ZONE;

-- Update handle_new_user trigger to stamp 7-day expiry on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, free_credits_expires_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    now() + interval '7 days'
  );
  RETURN NEW;
END;
$$;

-- Lazy expiry: zero free-tier balance when expiry has passed.
-- Idempotent — safe to call before every credit-affecting operation.
CREATE OR REPLACE FUNCTION public.expire_free_credits(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.profiles
  SET credits_balance = 0,
      free_credits_expires_at = NULL
  WHERE user_id = _user_id
    AND (plan IS NULL OR plan = 'free')
    AND free_credits_expires_at IS NOT NULL
    AND free_credits_expires_at <= now()
    AND credits_balance > 0;
END;
$$;

-- Backfill existing free-plan users without an expiry: give them 7 days from now.
-- (You're the only existing user — this gives you a fresh 7-day window.)
UPDATE public.profiles
SET free_credits_expires_at = now() + interval '7 days'
WHERE (plan IS NULL OR plan = 'free')
  AND free_credits_expires_at IS NULL;