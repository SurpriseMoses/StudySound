CREATE TABLE public.referral_admin_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 admin_user_id uuid NOT NULL,
 action text NOT NULL,
 record_id text NOT NULL,
 before_values jsonb,
 after_values jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.referral_admin_audit TO authenticated;
GRANT ALL ON public.referral_admin_audit TO service_role;
REVOKE ALL ON public.referral_admin_audit FROM anon, authenticated;
GRANT SELECT ON public.referral_admin_audit TO authenticated;
ALTER TABLE public.referral_admin_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY referral_audit_admin_read ON public.referral_admin_audit FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.referral_admin_settings() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_settings jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 SELECT to_jsonb(s) INTO v_settings FROM public.referral_programme_settings s WHERE id=true;
 RETURN coalesce(v_settings,jsonb_build_object('enabled',false,'attribution_days',30,'discount_basis_points',1000,'commission_basis_points',500,'commission_basis','normal_price','credits_per_rand',null,'timezone','Africa/Johannesburg','legal_review_confirmed',false,'payment_flow_verified',false,'withdrawals_enabled',false));
END;
$$;
REVOKE ALL ON FUNCTION public.referral_admin_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.referral_admin_set_conversion(_credits_per_rand numeric) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 IF _credits_per_rand IS NULL OR _credits_per_rand<=0 OR _credits_per_rand>1000 OR _credits_per_rand::text IN ('NaN','Infinity','-Infinity') OR trunc(79*_credits_per_rand)<>79*_credits_per_rand OR trunc(149*_credits_per_rand)<>149*_credits_per_rand THEN RAISE EXCEPTION 'Configure a positive rate yielding whole credits for both R79 and R149 rewards'; END IF;
 INSERT INTO public.referral_programme_settings(id) VALUES(true) ON CONFLICT(id) DO NOTHING;
 SELECT to_jsonb(s) INTO v_before FROM public.referral_programme_settings s WHERE id=true FOR UPDATE;
 IF (v_before->>'enabled')::boolean THEN RAISE EXCEPTION 'Active programme changes require reviewed prospective terms'; END IF;
 UPDATE public.referral_programme_settings SET credits_per_rand=_credits_per_rand,updated_at=now() WHERE id=true;
 SELECT to_jsonb(s) INTO v_after FROM public.referral_programme_settings s WHERE id=true;
 INSERT INTO public.referral_admin_audit(admin_user_id,action,record_id,before_values,after_values) VALUES(auth.uid(),'conversion_configured','programme',v_before,v_after);
 RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION public.referral_admin_set_conversion(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_set_conversion(numeric) TO authenticated;