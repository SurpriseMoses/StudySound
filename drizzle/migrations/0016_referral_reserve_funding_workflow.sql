CREATE TABLE public.ai_reward_reserve_reversals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 funding_id uuid NOT NULL UNIQUE REFERENCES public.ai_reward_reserve_funding(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 reversed_by uuid NOT NULL,
 reversed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_reward_reserve_reversals TO authenticated;
GRANT ALL ON public.ai_reward_reserve_reversals TO service_role;
ALTER TABLE public.ai_reward_reserve_reversals ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_reserve_reversals_admin_read ON public.ai_reward_reserve_reversals FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
CREATE OR REPLACE FUNCTION public.referral_admin_record_funding(_reference text, _amount_zar numeric, _evidence_reference text, _transfer_confirmed boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row public.ai_reward_reserve_funding; v_inserted boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 _reference:=btrim(_reference); _evidence_reference:=btrim(_evidence_reference);
 IF _transfer_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Confirm an already completed transfer or provider top-up'; END IF;
 IF _reference IS NULL OR length(_reference) NOT BETWEEN 3 AND 120 OR _evidence_reference IS NULL OR length(_evidence_reference) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Transfer and evidence references required'; END IF;
 IF _amount_zar IS NULL OR _amount_zar::text IN ('NaN','Infinity','-Infinity') OR _amount_zar<=0 OR _amount_zar>999999999.99 OR trunc(_amount_zar*100)<>_amount_zar*100 THEN RAISE EXCEPTION 'Positive ZAR amount with at most two decimals required'; END IF;
 INSERT INTO public.ai_reward_reserve_funding(reference,amount_zar,evidence_reference,confirmed_by) VALUES(_reference,_amount_zar,_evidence_reference,auth.uid()) ON CONFLICT(reference) DO NOTHING RETURNING * INTO v_row;
 v_inserted:=FOUND;
 IF NOT v_inserted THEN
  SELECT * INTO v_row FROM public.ai_reward_reserve_funding WHERE reference=_reference;
  IF v_row.amount_zar IS DISTINCT FROM _amount_zar OR v_row.evidence_reference IS DISTINCT FROM _evidence_reference THEN RAISE EXCEPTION 'Reference already used with different details'; END IF;
  IF EXISTS(SELECT 1 FROM public.ai_reward_reserve_reversals WHERE funding_id=v_row.id) THEN RAISE EXCEPTION 'Confirmation was reversed; use a new transfer reference'; END IF;
 ELSE
  INSERT INTO public.referral_admin_audit(admin_user_id,action,record_id,after_values) VALUES(auth.uid(),'reserve_funding_confirmed',v_row.id::text,to_jsonb(v_row));
 END IF;
 RETURN to_jsonb(v_row)||jsonb_build_object('replayed',NOT v_inserted);
END; $$;
REVOKE ALL ON FUNCTION public.referral_admin_record_funding(text,numeric,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_record_funding(text,numeric,text,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_admin_reverse_funding(_funding_id uuid, _reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_funding public.ai_reward_reserve_funding; v_reversal public.ai_reward_reserve_reversals;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 _reason:=btrim(_reason);
 IF _reason IS NULL OR length(_reason) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'Documented correction reason required'; END IF;
 SELECT * INTO v_funding FROM public.ai_reward_reserve_funding WHERE id=_funding_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Funding confirmation not found'; END IF;
 SELECT * INTO v_reversal FROM public.ai_reward_reserve_reversals WHERE funding_id=_funding_id;
 IF FOUND THEN
  IF v_reversal.reason IS DISTINCT FROM _reason THEN RAISE EXCEPTION 'Already reversed with a different reason'; END IF;
  RETURN to_jsonb(v_reversal)||jsonb_build_object('replayed',true);
 END IF;
 INSERT INTO public.ai_reward_reserve_reversals(funding_id,reason,reversed_by) VALUES(_funding_id,_reason,auth.uid()) RETURNING * INTO v_reversal;
 INSERT INTO public.referral_admin_audit(admin_user_id,action,record_id,before_values,after_values) VALUES(auth.uid(),'reserve_funding_reversed',_funding_id::text,to_jsonb(v_funding),to_jsonb(v_reversal));
 UPDATE public.referral_programme_settings SET enabled=false,withdrawals_enabled=false,cost_model_approved=false,cost_model_approved_at=NULL,cost_model_approved_by=NULL,cost_model_evidence=NULL,updated_at=now() WHERE id=true;
 RETURN to_jsonb(v_reversal)||jsonb_build_object('replayed',false);
END; $$;
REVOKE ALL ON FUNCTION public.referral_admin_reverse_funding(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_reverse_funding(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_admin_funding_summary() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('net_funded_zar',(SELECT coalesce(sum(f.amount_zar),0) FROM public.ai_reward_reserve_funding f WHERE NOT EXISTS(SELECT 1 FROM public.ai_reward_reserve_reversals r WHERE r.funding_id=f.id)), 'records',(SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT f.*,r.reversed_at,r.reason reversal_reason FROM public.ai_reward_reserve_funding f LEFT JOIN public.ai_reward_reserve_reversals r ON r.funding_id=f.id ORDER BY f.confirmed_at DESC,f.id LIMIT 100)x));
END; $$;
REVOKE ALL ON FUNCTION public.referral_admin_funding_summary() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_funding_summary() TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_admin_cost_evidence() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('retrieved_at',now(),'window_start',now()-interval '30 days','settings',(SELECT to_jsonb(s) FROM referral_programme_settings s WHERE id=true),'events',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT feature,provider,model,billing_mode,count(*) events,count(*) FILTER(WHERE cache_hit) cache_events,count(*) FILTER(WHERE reported_cost IS NOT NULL) reported_cost_events,count(*) FILTER(WHERE estimated_cost IS NOT NULL) estimated_cost_events,count(*) FILTER(WHERE credit_transaction_id IS NOT NULL) linked_events,count(*) FILTER(WHERE outcome='failed') failed_events,sum(input_tokens) input_tokens,sum(output_tokens) output_tokens,currency,sum(reported_cost) reported_cost,sum(estimated_cost) estimated_cost FROM ai_generation_cost_events WHERE occurred_at>=now()-interval '30 days' GROUP BY feature,provider,model,billing_mode,currency ORDER BY feature,provider LIMIT 100)x),'paid_subscription_records',(SELECT count(*) FROM credit_purchases WHERE kind='subscription' AND status='success' AND credited),'credit_ledger_records',(SELECT count(*) FROM credit_transactions),'funded_reserve_zar',(SELECT coalesce(sum(f.amount_zar),0) FROM ai_reward_reserve_funding f WHERE NOT EXISTS(SELECT 1 FROM ai_reward_reserve_reversals r WHERE r.funding_id=f.id)),'funding_records',(SELECT count(*) FROM ai_reward_reserve_funding f WHERE NOT EXISTS(SELECT 1 FROM ai_reward_reserve_reversals r WHERE r.funding_id=f.id)),'reward_credits_issued',(SELECT sum(amount) FROM credit_transactions WHERE amount>0 AND source IN ('referral_milestone','ambassador')),'historical_usage',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT action_type,count(*) records,sum(credits_used) credits,min(created_at) first_at,max(created_at) last_at FROM user_usage GROUP BY action_type)x)) INTO v_result;
 RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.referral_admin_cost_evidence() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_cost_evidence() TO authenticated;