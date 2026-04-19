-- Switch free tier from one-time 7-day grant to monthly renewal of 20 credits.
-- expire_free_credits() now refills (rather than zeros) the balance when the
-- window has passed, and rolls the next expiry forward by 30 days.

CREATE OR REPLACE FUNCTION public.expire_free_credits(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _plan text;
  _expires timestamptz;
  _now timestamptz := now();
  _new_expiry timestamptz;
BEGIN
  SELECT plan::text, free_credits_expires_at
    INTO _plan, _expires
  FROM public.profiles
  WHERE user_id = _user_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF _plan IS NOT NULL AND _plan <> 'free' THEN RETURN; END IF;

  -- No expiry yet (legacy) or window passed → refill to 20 and set next 30-day window.
  IF _expires IS NULL OR _expires <= _now THEN
    -- Roll forward from the previous expiry to keep cadence stable; if far in the past, anchor to now.
    IF _expires IS NULL OR _expires < _now - interval '30 days' THEN
      _new_expiry := _now + interval '30 days';
    ELSE
      _new_expiry := _expires + interval '30 days';
      WHILE _new_expiry <= _now LOOP
        _new_expiry := _new_expiry + interval '30 days';
      END LOOP;
    END IF;

    UPDATE public.profiles
    SET credits_balance = 20,
        free_credits_expires_at = _new_expiry
    WHERE user_id = _user_id;
  END IF;
END;
$$;

-- Update signup trigger comment alignment: 30-day window for the first cycle.
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
    now() + interval '30 days'
  );
  RETURN NEW;
END;
$$;