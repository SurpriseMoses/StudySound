CREATE TABLE public.referral_commissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attribution_id uuid NOT NULL UNIQUE REFERENCES public.referral_attributions(id), purchase_id uuid NOT NULL UNIQUE REFERENCES public.credit_purchases(id), user_id uuid NOT NULL REFERENCES public.profiles(user_id), provider_reference text NOT NULL UNIQUE, currency text NOT NULL DEFAULT 'ZAR' CHECK(currency='ZAR'), normal_price_cents integer NOT NULL CHECK(normal_price_cents>0), paid_amount_cents integer NOT NULL CHECK(paid_amount_cents>0), basis_cents integer NOT NULL CHECK(basis_cents>0), rate_basis_points integer NOT NULL CHECK(rate_basis_points BETWEEN 0 AND 10000), amount_cents integer NOT NULL CHECK(amount_cents>0), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','available','rejected')), verified_at timestamptz NOT NULL, available_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), CHECK(status<>'available' OR available_at IS NOT NULL)
);
GRANT SELECT ON public.referral_commissions TO authenticated;
GRANT ALL ON public.referral_commissions TO service_role;
ALTER TABLE public.referral_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY referral_commissions_admin_read ON public.referral_commissions FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
COMMENT ON TABLE public.referral_commissions IS 'Private first-payment commission foundation. No accrual endpoint is connected until verified atomic payment posting is implemented.';
CREATE TABLE public.referral_commission_reversals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), commission_id uuid NOT NULL UNIQUE REFERENCES public.referral_commissions(id), reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 500), provider_event_reference text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.referral_commission_reversals TO authenticated;
GRANT ALL ON public.referral_commission_reversals TO service_role;
ALTER TABLE public.referral_commission_reversals ENABLE ROW LEVEL SECURITY;
CREATE POLICY referral_reversals_admin_read ON public.referral_commission_reversals FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
CREATE TABLE public.referral_withdrawals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(user_id), request_key uuid NOT NULL UNIQUE, amount_cents integer NOT NULL CHECK(amount_cents>=5000), status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','under_review','approved','processing','paid','rejected')), requested_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.referral_withdrawals TO authenticated;
GRANT ALL ON public.referral_withdrawals TO service_role;
ALTER TABLE public.referral_withdrawals ENABLE ROW LEVEL SECURITY;
CREATE POLICY referral_withdrawals_admin_read ON public.referral_withdrawals FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
CREATE UNIQUE INDEX referral_one_open_withdrawal ON public.referral_withdrawals(user_id) WHERE status IN ('requested','under_review','approved','processing');
CREATE TABLE public.referral_withdrawal_allocations (
 withdrawal_id uuid NOT NULL REFERENCES public.referral_withdrawals(id), commission_id uuid NOT NULL REFERENCES public.referral_commissions(id), amount_cents integer NOT NULL CHECK(amount_cents>0), PRIMARY KEY(withdrawal_id,commission_id)
);
GRANT SELECT ON public.referral_withdrawal_allocations TO authenticated;
GRANT ALL ON public.referral_withdrawal_allocations TO service_role;
ALTER TABLE public.referral_withdrawal_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY referral_allocations_admin_read ON public.referral_withdrawal_allocations FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
CREATE TABLE public.referral_withdrawal_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), withdrawal_id uuid NOT NULL REFERENCES public.referral_withdrawals(id), action_key uuid NOT NULL UNIQUE, admin_user_id uuid NOT NULL REFERENCES public.profiles(user_id), previous_status text NOT NULL, next_status text NOT NULL, reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 500), identity_verified boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.referral_withdrawal_events TO authenticated;
GRANT ALL ON public.referral_withdrawal_events TO service_role;
ALTER TABLE public.referral_withdrawal_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY referral_withdrawal_events_admin_read ON public.referral_withdrawal_events FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
CREATE TABLE public.referral_payout_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), withdrawal_id uuid NOT NULL UNIQUE REFERENCES public.referral_withdrawals(id), reference text NOT NULL UNIQUE CHECK(length(trim(reference)) BETWEEN 3 AND 120), amount_cents integer NOT NULL CHECK(amount_cents>=5000), paid_at timestamptz NOT NULL CHECK(paid_at<='infinity'::timestamptz), evidence_reference text NOT NULL CHECK(length(trim(evidence_reference)) BETWEEN 10 AND 500), admin_user_id uuid NOT NULL REFERENCES public.profiles(user_id), confirmed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.referral_payout_confirmations TO authenticated;
GRANT ALL ON public.referral_payout_confirmations TO service_role;
ALTER TABLE public.referral_payout_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY referral_payouts_admin_read ON public.referral_payout_confirmations FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
CREATE OR REPLACE FUNCTION public.referral_financial_totals(_user_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH earned AS (SELECT coalesce(sum(c.amount_cents) FILTER(WHERE c.status='available' AND r.id IS NULL),0) available, coalesce(sum(c.amount_cents) FILTER(WHERE c.status='pending' AND r.id IS NULL),0) pending, coalesce(sum(c.amount_cents) FILTER(WHERE r.id IS NOT NULL),0) reversed FROM referral_commissions c LEFT JOIN referral_commission_reversals r ON r.commission_id=c.id WHERE c.user_id=_user_id), spent AS (SELECT coalesce(sum(amount_cents) FILTER(WHERE status IN ('requested','under_review','approved','processing')),0) reserved, coalesce(sum(amount_cents) FILTER(WHERE status='paid'),0) paid FROM referral_withdrawals WHERE user_id=_user_id)
 SELECT jsonb_build_object('available_cents',greatest(0,earned.available-spent.reserved-spent.paid),'pending_cents',earned.pending,'reserved_cents',spent.reserved,'paid_cents',spent.paid,'reversed_cents',earned.reversed,'recovery_cents',greatest(0,spent.reserved+spent.paid-earned.available)) FROM earned,spent;
$$;
REVOKE ALL ON FUNCTION public.referral_financial_totals(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.referral_financial_totals(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.referral_my_financials() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 v_result:=public.referral_financial_totals(auth.uid());
 RETURN v_result || jsonb_build_object('withdrawals_enabled',coalesce((SELECT enabled AND withdrawals_enabled AND cost_model_approved AND legal_review_confirmed AND payment_flow_verified FROM referral_programme_settings WHERE id=true),false),'minimum_cents',5000,'withdrawals',(SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT id,amount_cents,status,requested_at,updated_at FROM referral_withdrawals WHERE user_id=auth.uid() ORDER BY requested_at DESC LIMIT 50)x));
END;
$$;
REVOKE ALL ON FUNCTION public.referral_my_financials() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_my_financials() TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_request_withdrawal(_amount_cents integer,_request_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old referral_withdrawals%ROWTYPE; v_id uuid; v_remaining integer; v_available bigint; v_row record; v_take integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM profiles WHERE user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Profile required'; END IF;
 IF _request_key IS NULL OR _amount_cents IS NULL OR _amount_cents<5000 THEN RAISE EXCEPTION 'Minimum withdrawal is R50'; END IF;
 SELECT * INTO v_old FROM referral_withdrawals WHERE request_key=_request_key;
 IF FOUND THEN
  IF v_old.user_id<>auth.uid() OR v_old.amount_cents<>_amount_cents THEN RAISE EXCEPTION 'Request reference conflicts with existing details'; END IF;
  RETURN jsonb_build_object('id',v_old.id,'status',v_old.status,'replayed',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM referral_programme_settings WHERE id=true AND enabled AND withdrawals_enabled AND cost_model_approved AND legal_review_confirmed AND payment_flow_verified) THEN RAISE EXCEPTION 'Withdrawals are not active'; END IF;
 IF EXISTS(SELECT 1 FROM referral_withdrawals WHERE user_id=auth.uid() AND status IN ('requested','under_review','approved','processing')) THEN RAISE EXCEPTION 'An existing withdrawal is still in review'; END IF;
 v_available:=(public.referral_financial_totals(auth.uid())->>'available_cents')::bigint;
 IF _amount_cents>v_available THEN RAISE EXCEPTION 'Insufficient available commission'; END IF;
 INSERT INTO referral_withdrawals(user_id,request_key,amount_cents) VALUES(auth.uid(),_request_key,_amount_cents) RETURNING id INTO v_id;
 v_remaining:=_amount_cents;
 FOR v_row IN SELECT c.id,c.amount_cents-coalesce((SELECT sum(a.amount_cents) FROM referral_withdrawal_allocations a JOIN referral_withdrawals w ON w.id=a.withdrawal_id WHERE a.commission_id=c.id AND w.status<>'rejected'),0) remaining FROM referral_commissions c WHERE c.user_id=auth.uid() AND c.status='available' AND NOT EXISTS(SELECT 1 FROM referral_commission_reversals r WHERE r.commission_id=c.id) ORDER BY c.available_at,c.id FOR UPDATE OF c LOOP
  v_take:=least(v_remaining,greatest(0,v_row.remaining))::integer;
  IF v_take>0 THEN INSERT INTO referral_withdrawal_allocations VALUES(v_id,v_row.id,v_take); v_remaining:=v_remaining-v_take; END IF;
  EXIT WHEN v_remaining=0;
 END LOOP;
 IF v_remaining<>0 THEN RAISE EXCEPTION 'Commission allocation could not be reconciled'; END IF;
 RETURN jsonb_build_object('id',v_id,'status','requested','replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.referral_request_withdrawal(integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_request_withdrawal(integer,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_admin_withdrawals() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('records',(SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT w.id,w.user_id,w.amount_cents,w.status,w.requested_at,w.updated_at,(SELECT coalesce(jsonb_agg(e ORDER BY e.created_at),'[]'::jsonb) FROM referral_withdrawal_events e WHERE e.withdrawal_id=w.id) events,(SELECT to_jsonb(p) FROM referral_payout_confirmations p WHERE p.withdrawal_id=w.id) payout FROM referral_withdrawals w ORDER BY w.requested_at DESC LIMIT 100)x),'withdrawals_enabled',coalesce((SELECT enabled AND withdrawals_enabled FROM referral_programme_settings WHERE id=true),false));
END;
$$;
REVOKE ALL ON FUNCTION public.referral_admin_withdrawals() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_withdrawals() TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_admin_review_withdrawal(_withdrawal_id uuid,_next_status text,_action_key uuid,_reason text,_identity_verified boolean DEFAULT false,_payout_reference text DEFAULT NULL,_paid_amount_cents integer DEFAULT NULL,_paid_at timestamptz DEFAULT NULL,_evidence_reference text DEFAULT NULL,_transfer_confirmed boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid; v_w referral_withdrawals%ROWTYPE; v_e referral_withdrawal_events%ROWTYPE; v_p referral_payout_confirmations%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 SELECT user_id INTO v_user FROM referral_withdrawals WHERE id=_withdrawal_id;
 IF v_user IS NULL THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;
 PERFORM 1 FROM profiles WHERE user_id=v_user FOR UPDATE;
 SELECT * INTO v_w FROM referral_withdrawals WHERE id=_withdrawal_id FOR UPDATE;
 IF _action_key IS NULL OR _reason IS NULL OR length(trim(_reason)) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Action reference and documented review reason required'; END IF;
 SELECT * INTO v_e FROM referral_withdrawal_events WHERE action_key=_action_key;
 IF FOUND THEN
  IF v_e.withdrawal_id<>v_w.id OR v_e.next_status IS DISTINCT FROM _next_status OR v_e.reason IS DISTINCT FROM trim(_reason) OR v_e.identity_verified IS DISTINCT FROM coalesce(_identity_verified,false) THEN RAISE EXCEPTION 'Action reference conflicts with existing details'; END IF;
  IF _next_status='paid' THEN
   SELECT * INTO v_p FROM referral_payout_confirmations WHERE withdrawal_id=v_w.id;
   IF NOT coalesce(_transfer_confirmed,false) OR v_p.reference IS DISTINCT FROM trim(_payout_reference) OR v_p.amount_cents IS DISTINCT FROM _paid_amount_cents OR v_p.paid_at IS DISTINCT FROM _paid_at OR v_p.evidence_reference IS DISTINCT FROM trim(_evidence_reference) THEN RAISE EXCEPTION 'Payout reference conflicts with existing details'; END IF;
  END IF;
  RETURN jsonb_build_object('id',v_w.id,'status',v_w.status,'replayed',true);
 END IF;
 IF NOT ((_next_status='rejected' AND v_w.status IN ('requested','under_review','approved')) OR (v_w.status='requested' AND _next_status='under_review') OR (v_w.status='under_review' AND _next_status='approved') OR (v_w.status='approved' AND _next_status='processing') OR (v_w.status='processing' AND _next_status='paid')) THEN RAISE EXCEPTION 'Invalid withdrawal transition; processing transfers must be reconciled before releasing funds'; END IF;
 IF _next_status<>'rejected' AND NOT EXISTS(SELECT 1 FROM referral_programme_settings WHERE id=true AND enabled AND withdrawals_enabled AND cost_model_approved AND legal_review_confirmed AND payment_flow_verified) THEN RAISE EXCEPTION 'Withdrawals are not active'; END IF;
 IF _next_status IN ('approved','processing','paid') THEN
  IF NOT coalesce(_identity_verified,false) THEN RAISE EXCEPTION 'Verified payout identity and destination required'; END IF;
  IF EXISTS(SELECT 1 FROM referral_withdrawal_allocations a JOIN referral_commission_reversals r ON r.commission_id=a.commission_id WHERE a.withdrawal_id=v_w.id) THEN RAISE EXCEPTION 'Reserved commission has been reversed; reconcile this request'; END IF;
 END IF;
 IF _next_status='paid' THEN
  IF NOT coalesce(_transfer_confirmed,false) OR _paid_amount_cents IS DISTINCT FROM v_w.amount_cents OR _paid_at IS NULL OR NOT isfinite(_paid_at) OR _paid_at>now() OR _payout_reference IS NULL OR length(trim(_payout_reference)) NOT BETWEEN 3 AND 120 OR _evidence_reference IS NULL OR length(trim(_evidence_reference)) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Confirm completed transfer with matching amount, date and evidence'; END IF;
  INSERT INTO referral_payout_confirmations(withdrawal_id,reference,amount_cents,paid_at,evidence_reference,admin_user_id) VALUES(v_w.id,trim(_payout_reference),_paid_amount_cents,_paid_at,trim(_evidence_reference),auth.uid());
 END IF;
 INSERT INTO referral_withdrawal_events(withdrawal_id,action_key,admin_user_id,previous_status,next_status,reason,identity_verified) VALUES(v_w.id,_action_key,auth.uid(),v_w.status,_next_status,trim(_reason),coalesce(_identity_verified,false));
 UPDATE referral_withdrawals SET status=_next_status,updated_at=now() WHERE id=v_w.id;
 INSERT INTO referral_admin_audit(admin_user_id,action,record_id,before_values,after_values) VALUES(auth.uid(),'withdrawal_'||_next_status,v_w.id::text,jsonb_build_object('status',v_w.status),jsonb_build_object('status',_next_status,'amount_cents',v_w.amount_cents,'reason',trim(_reason)));
 RETURN jsonb_build_object('id',v_w.id,'status',_next_status,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.referral_admin_review_withdrawal(uuid,text,uuid,text,boolean,text,integer,timestamptz,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_review_withdrawal(uuid,text,uuid,text,boolean,text,integer,timestamptz,text,boolean) TO authenticated;