-- Free tier: 20 credits expire after 7 days; if expired, refill on next action and start a fresh 7-day window.
-- Update new-user trigger to grant a 7-day window.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, free_credits_expires_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    now() + interval '7 days'
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_free_credits(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _plan text;
  _expires timestamptz;
  _now timestamptz := now();
BEGIN
  SELECT plan::text, free_credits_expires_at
    INTO _plan, _expires
  FROM public.profiles
  WHERE user_id = _user_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF _plan IS NOT NULL AND _plan <> 'free' THEN RETURN; END IF;

  -- If no expiry set, or window has passed → refill 20 credits, start fresh 7-day window.
  IF _expires IS NULL OR _expires <= _now THEN
    UPDATE public.profiles
    SET credits_balance = 20,
        free_credits_expires_at = _now + interval '7 days'
    WHERE user_id = _user_id;
  END IF;
END;
$function$;

-- Backfill: any current free user whose expiry is more than 7 days out (from prior 30-day grant) → clamp to 7 days from now.
UPDATE public.profiles
SET free_credits_expires_at = now() + interval '7 days'
WHERE (plan IS NULL OR plan::text = 'free')
  AND free_credits_expires_at IS NOT NULL
  AND free_credits_expires_at > now() + interval '7 days';