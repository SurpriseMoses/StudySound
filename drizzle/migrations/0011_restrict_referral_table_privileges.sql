REVOKE ALL ON public.referral_programme_settings, public.referral_codes, public.referral_claims, public.referral_attributions FROM anon, authenticated;
GRANT SELECT ON public.referral_programme_settings, public.referral_codes TO authenticated;
GRANT ALL ON public.referral_programme_settings, public.referral_codes, public.referral_claims, public.referral_attributions TO service_role;
CREATE OR REPLACE FUNCTION public.referral_my_code() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.referral_programme_settings WHERE id=true AND enabled) THEN RETURN NULL; END IF;
 SELECT code INTO v_code FROM public.referral_codes WHERE user_id=auth.uid() AND disabled_at IS NULL;
 IF v_code IS NULL THEN
  INSERT INTO public.referral_codes(user_id) VALUES(auth.uid()) ON CONFLICT(user_id) DO NOTHING;
  SELECT code INTO v_code FROM public.referral_codes WHERE user_id=auth.uid() AND disabled_at IS NULL;
 END IF;
 RETURN v_code;
END;
$$;
REVOKE ALL ON FUNCTION public.referral_my_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_my_code() TO authenticated;