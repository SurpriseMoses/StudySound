CREATE OR REPLACE FUNCTION public.referral_bind_claim(_token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claim public.referral_claims%ROWTYPE; v_owner uuid; v_created timestamptz; v_verified timestamptz; v_existing uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.referral_programme_settings WHERE id=true AND enabled) THEN RETURN jsonb_build_object('status','disabled'); END IF;
 PERFORM 1 FROM public.profiles WHERE user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','profile_pending'); END IF;
 SELECT created_at,email_confirmed_at INTO v_created,v_verified FROM auth.users WHERE id=auth.uid();
 IF v_verified IS NULL THEN RETURN jsonb_build_object('status','verification_pending'); END IF;
 SELECT claim_id INTO v_existing FROM public.referral_attributions WHERE referred_user_id=auth.uid();
 SELECT * INTO v_claim FROM public.referral_claims WHERE token=_token FOR UPDATE;
 IF v_existing IS NOT NULL THEN
  IF v_claim.id=v_existing AND v_claim.consumed_by=auth.uid() THEN RETURN jsonb_build_object('status','attributed','replayed',true); END IF;
  RETURN jsonb_build_object('status','already_attributed');
 END IF;
 IF NOT FOUND OR v_claim.expires_at<=now() OR v_claim.consumed_by IS NOT NULL THEN RETURN jsonb_build_object('status','expired_or_used'); END IF;
 SELECT user_id INTO v_owner FROM public.referral_codes WHERE id=v_claim.code_id AND disabled_at IS NULL FOR SHARE;
 IF v_owner IS NULL OR v_owner=auth.uid() THEN RETURN jsonb_build_object('status','ineligible'); END IF;
 IF v_created IS NULL OR v_created<v_claim.created_at THEN RETURN jsonb_build_object('status','existing_account'); END IF;
 IF EXISTS(SELECT 1 FROM public.credit_purchases WHERE user_id=auth.uid() AND (credited OR status='success')) THEN RETURN jsonb_build_object('status','existing_customer'); END IF;
 INSERT INTO public.referral_attributions(referred_user_id,referrer_user_id,claim_id,code_id) VALUES(auth.uid(),v_owner,v_claim.id,v_claim.code_id);
 UPDATE public.referral_claims SET consumed_by=auth.uid(),consumed_at=now() WHERE id=v_claim.id;
 RETURN jsonb_build_object('status','attributed','replayed',false);
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
 SELECT coalesce(jsonb_agg(jsonb_build_object('identifier','Learner '||left(md5(auth.uid()::text||id::text),12),'status',status,'attributed_at',attributed_at) ORDER BY attributed_at DESC),'[]'::jsonb) INTO v_activities FROM (SELECT id,status,attributed_at FROM public.referral_attributions WHERE referrer_user_id=auth.uid() ORDER BY attributed_at DESC LIMIT 50) a;
 RETURN jsonb_build_object('enabled',coalesce(v_enabled,false),'lifetime_successful',v_lifetime,'annual_successful',v_annual,'activity',v_activities,'financials_available',false);
END;
$$;
REVOKE ALL ON FUNCTION public.referral_my_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_my_summary() TO authenticated;