CREATE TABLE public.referral_programme_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 enabled boolean NOT NULL DEFAULT false,
 attribution_days integer NOT NULL DEFAULT 30 CHECK (attribution_days BETWEEN 1 AND 365),
 discount_basis_points integer NOT NULL DEFAULT 1000 CHECK (discount_basis_points BETWEEN 0 AND 10000),
 commission_basis_points integer NOT NULL DEFAULT 500 CHECK (commission_basis_points BETWEEN 0 AND 10000),
 commission_basis text NOT NULL DEFAULT 'normal_price' CHECK (commission_basis IN ('normal_price','paid_price')),
 credits_per_rand numeric,
 timezone text NOT NULL DEFAULT 'Africa/Johannesburg',
 legal_review_confirmed boolean NOT NULL DEFAULT false,
 payment_flow_verified boolean NOT NULL DEFAULT false,
 withdrawals_enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (credits_per_rand IS NULL OR credits_per_rand > 0),
 CHECK (NOT enabled OR (legal_review_confirmed AND payment_flow_verified AND credits_per_rand IS NOT NULL)),
 CHECK (NOT withdrawals_enabled OR enabled)
);
GRANT SELECT ON public.referral_programme_settings TO authenticated;
GRANT ALL ON public.referral_programme_settings TO service_role;
ALTER TABLE public.referral_programme_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY referral_settings_admin_read ON public.referral_programme_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.referral_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL UNIQUE,
 code text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text,'-',''),
 created_at timestamptz NOT NULL DEFAULT now(),
 disabled_at timestamptz,
 CHECK (code ~ '^[a-f0-9]{32}$')
);
GRANT SELECT ON public.referral_codes TO authenticated;
GRANT ALL ON public.referral_codes TO service_role;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY referral_codes_owner_read ON public.referral_codes FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.referral_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code_id uuid NOT NULL REFERENCES public.referral_codes(id),
 token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 consumed_by uuid UNIQUE,
 consumed_at timestamptz
);
GRANT ALL ON public.referral_claims TO service_role;
ALTER TABLE public.referral_claims ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.referral_attributions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 referred_user_id uuid NOT NULL UNIQUE,
 referrer_user_id uuid NOT NULL,
 claim_id uuid NOT NULL UNIQUE REFERENCES public.referral_claims(id),
 code_id uuid NOT NULL REFERENCES public.referral_codes(id),
 attributed_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'awaiting_first_payment' CHECK (status IN ('awaiting_first_payment','successful','ineligible','reversed')),
 qualified_at timestamptz,
 reason_code text,
 CHECK (referred_user_id <> referrer_user_id)
);
GRANT ALL ON public.referral_attributions TO service_role;
ALTER TABLE public.referral_attributions ENABLE ROW LEVEL SECURITY;
CREATE INDEX referral_attributions_referrer_idx ON public.referral_attributions(referrer_user_id,attributed_at);

CREATE OR REPLACE FUNCTION public.referral_my_code() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
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

CREATE OR REPLACE FUNCTION public.referral_create_claim(_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_settings public.referral_programme_settings%ROWTYPE; v_code public.referral_codes%ROWTYPE; v_claim public.referral_claims%ROWTYPE;
BEGIN
 SELECT * INTO v_settings FROM public.referral_programme_settings WHERE id=true;
 IF NOT FOUND OR NOT v_settings.enabled THEN RETURN jsonb_build_object('status','disabled'); END IF;
 IF _code IS NULL OR _code !~ '^[a-f0-9]{32}$' THEN RETURN jsonb_build_object('status','invalid'); END IF;
 SELECT * INTO v_code FROM public.referral_codes WHERE code=_code AND disabled_at IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid'); END IF;
 INSERT INTO public.referral_claims(code_id,expires_at) VALUES(v_code.id,now()+make_interval(days=>v_settings.attribution_days)) RETURNING * INTO v_claim;
 RETURN jsonb_build_object('status','valid','token',v_claim.token,'expires_at',v_claim.expires_at);
END;
$$;
REVOKE ALL ON FUNCTION public.referral_create_claim(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_create_claim(text) TO service_role;

CREATE OR REPLACE FUNCTION public.referral_bind_claim(_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claim public.referral_claims%ROWTYPE; v_owner uuid; v_created timestamptz;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.referral_programme_settings WHERE id=true AND enabled) THEN RETURN jsonb_build_object('status','disabled'); END IF;
 PERFORM 1 FROM public.profiles WHERE user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','profile_pending'); END IF;
 IF EXISTS(SELECT 1 FROM public.referral_attributions WHERE referred_user_id=auth.uid()) THEN RETURN jsonb_build_object('status','already_attributed'); END IF;
 SELECT * INTO v_claim FROM public.referral_claims WHERE token=_token FOR UPDATE;
 IF NOT FOUND OR v_claim.expires_at<=now() OR v_claim.consumed_by IS NOT NULL THEN RETURN jsonb_build_object('status','expired_or_used'); END IF;
 SELECT user_id INTO v_owner FROM public.referral_codes WHERE id=v_claim.code_id AND disabled_at IS NULL;
 IF v_owner IS NULL OR v_owner=auth.uid() THEN RETURN jsonb_build_object('status','ineligible'); END IF;
 SELECT created_at INTO v_created FROM auth.users WHERE id=auth.uid();
 IF v_created IS NULL OR v_created<v_claim.created_at THEN RETURN jsonb_build_object('status','existing_account'); END IF;
 IF EXISTS(SELECT 1 FROM public.credit_purchases WHERE user_id=auth.uid() AND (credited OR status='success')) THEN RETURN jsonb_build_object('status','existing_customer'); END IF;
 INSERT INTO public.referral_attributions(referred_user_id,referrer_user_id,claim_id,code_id) VALUES(auth.uid(),v_owner,v_claim.id,v_claim.code_id);
 UPDATE public.referral_claims SET consumed_by=auth.uid(),consumed_at=now() WHERE id=v_claim.id;
 RETURN jsonb_build_object('status','attributed');
END;
$$;
REVOKE ALL ON FUNCTION public.referral_bind_claim(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_bind_claim(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.referral_my_summary() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_enabled boolean; v_activities jsonb; v_lifetime integer; v_annual integer; v_timezone text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 SELECT enabled,timezone INTO v_enabled,v_timezone FROM public.referral_programme_settings WHERE id=true;
 SELECT count(*) FILTER(WHERE status='successful'),count(*) FILTER(WHERE status='successful' AND date_part('year',qualified_at AT TIME ZONE coalesce(v_timezone,'Africa/Johannesburg'))=date_part('year',now() AT TIME ZONE coalesce(v_timezone,'Africa/Johannesburg'))) INTO v_lifetime,v_annual FROM public.referral_attributions WHERE referrer_user_id=auth.uid();
 SELECT coalesce(jsonb_agg(jsonb_build_object('identifier','Learner '||left(id::text,6),'status',status,'attributed_at',attributed_at,'reason_code',reason_code) ORDER BY attributed_at DESC),'[]'::jsonb) INTO v_activities FROM (SELECT id,status,attributed_at,reason_code FROM public.referral_attributions WHERE referrer_user_id=auth.uid() ORDER BY attributed_at DESC LIMIT 50) a;
 RETURN jsonb_build_object('enabled',coalesce(v_enabled,false),'lifetime_successful',v_lifetime,'annual_successful',v_annual,'activity',v_activities,'financials_available',false);
END;
$$;
REVOKE ALL ON FUNCTION public.referral_my_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_my_summary() TO authenticated;