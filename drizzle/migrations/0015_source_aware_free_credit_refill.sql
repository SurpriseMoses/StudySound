ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS free_credits_remaining integer NOT NULL DEFAULT 0 CHECK (free_credits_remaining >= 0);
COMMENT ON COLUMN public.profiles.free_credits_remaining IS 'Upper bound of the weekly free grant still inside credits_balance; spending consumes free credits first. Only this portion may expire.';
UPDATE public.profiles SET free_credits_remaining = LEAST(GREATEST(credits_balance,0), 20)
WHERE (plan IS NULL OR plan::text = 'free') AND free_credits_expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.expire_free_credits(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _plan text; _expires timestamptz; _balance integer; _free integer; _kept integer;
  _now timestamptz := now();
BEGIN
  SELECT plan::text, free_credits_expires_at, COALESCE(credits_balance,0), free_credits_remaining
    INTO _plan, _expires, _balance, _free
  FROM public.profiles WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF _plan IS NOT NULL AND _plan <> 'free' THEN RETURN; END IF;
  IF _expires IS NULL OR _expires <= _now THEN
    -- Only the unspent free grant expires; purchased, subscription and reward credits are kept.
    _kept := GREATEST(_balance, 0) - LEAST(_free, GREATEST(_balance, 0));
    UPDATE public.profiles
    SET credits_balance = _kept + 20,
        free_credits_remaining = 20,
        free_credits_expires_at = _now + interval '7 days'
    WHERE user_id = _user_id;
  END IF;
END;
$function$;