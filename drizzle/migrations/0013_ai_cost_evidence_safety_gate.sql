CREATE TABLE public.ai_generation_cost_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_key text NOT NULL UNIQUE, job_id uuid NOT NULL, document_id uuid REFERENCES public.documents(id), credit_transaction_id uuid REFERENCES public.credit_transactions(id), user_id uuid, feature text NOT NULL, provider text NOT NULL, model text NOT NULL, endpoint text NOT NULL, billing_mode text NOT NULL, cache_hit boolean NOT NULL DEFAULT false, outcome text NOT NULL CHECK(outcome IN ('succeeded','failed','unknown','cached')), attempt integer NOT NULL DEFAULT 1 CHECK(attempt>0), http_status integer, input_tokens bigint CHECK(input_tokens>=0), output_tokens bigint CHECK(output_tokens>=0), cached_input_tokens bigint CHECK(cached_input_tokens>=0), usage_units jsonb NOT NULL DEFAULT '{}', reported_cost numeric CHECK(reported_cost>=0), estimated_cost numeric CHECK(estimated_cost>=0), currency text, pricing_reference text, provider_request_id text, refund_amount numeric CHECK(refund_amount>=0), occurred_at timestamptz NOT NULL DEFAULT now(), CHECK(reported_cost IS NULL OR currency IS NOT NULL), CHECK(estimated_cost IS NULL OR (currency IS NOT NULL AND pricing_reference IS NOT NULL)), CHECK(NOT cache_hit OR (coalesce(reported_cost,0)=0 AND coalesce(estimated_cost,0)=0))
);
GRANT SELECT ON public.ai_generation_cost_events TO authenticated; GRANT ALL ON public.ai_generation_cost_events TO service_role;
ALTER TABLE public.ai_generation_cost_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_cost_admin_read ON public.ai_generation_cost_events FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
CREATE INDEX ai_cost_observation_idx ON public.ai_generation_cost_events(occurred_at,feature,provider);
CREATE INDEX ai_cost_job_idx ON public.ai_generation_cost_events(job_id);
CREATE TABLE public.ai_reward_reserve_funding (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference text NOT NULL UNIQUE, amount_zar numeric NOT NULL CHECK(amount_zar>0), evidence_reference text NOT NULL, confirmed_by uuid NOT NULL, confirmed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_reward_reserve_funding TO authenticated; GRANT ALL ON public.ai_reward_reserve_funding TO service_role;
ALTER TABLE public.ai_reward_reserve_funding ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_reserve_admin_read ON public.ai_reward_reserve_funding FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
ALTER TABLE public.referral_programme_settings ADD COLUMN cost_model_approved boolean NOT NULL DEFAULT false, ADD COLUMN cost_model_approved_at timestamptz, ADD COLUMN cost_model_approved_by uuid, ADD COLUMN cost_model_evidence jsonb, ADD COLUMN safety_margin_basis_points integer NOT NULL DEFAULT 2500 CHECK(safety_margin_basis_points BETWEEN 0 AND 100000);
ALTER TABLE public.referral_programme_settings ADD CONSTRAINT referral_cost_safety_gate CHECK(NOT enabled OR cost_model_approved);
CREATE OR REPLACE FUNCTION public.referral_cost_conversion_invalidate() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN IF NEW.credits_per_rand IS DISTINCT FROM OLD.credits_per_rand OR NEW.safety_margin_basis_points IS DISTINCT FROM OLD.safety_margin_basis_points THEN NEW.cost_model_approved:=false; NEW.cost_model_approved_at:=NULL; NEW.cost_model_approved_by:=NULL; NEW.cost_model_evidence:=NULL; END IF; RETURN NEW; END; $$;
CREATE TRIGGER referral_cost_conversion_changed BEFORE UPDATE ON public.referral_programme_settings FOR EACH ROW EXECUTE FUNCTION public.referral_cost_conversion_invalidate();
CREATE OR REPLACE FUNCTION public.referral_admin_cost_evidence() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('retrieved_at',now(),'window_start',now()-interval '30 days','settings',(SELECT to_jsonb(s) FROM referral_programme_settings s WHERE id=true),'events',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT feature,provider,model,billing_mode,count(*) events,count(*) FILTER(WHERE cache_hit) cache_events,count(*) FILTER(WHERE reported_cost IS NOT NULL) reported_cost_events,count(*) FILTER(WHERE estimated_cost IS NOT NULL) estimated_cost_events,count(*) FILTER(WHERE credit_transaction_id IS NOT NULL) linked_events,count(*) FILTER(WHERE outcome='failed') failed_events,sum(input_tokens) input_tokens,sum(output_tokens) output_tokens,currency,sum(reported_cost) reported_cost,sum(estimated_cost) estimated_cost FROM ai_generation_cost_events WHERE occurred_at>=now()-interval '30 days' GROUP BY feature,provider,model,billing_mode,currency ORDER BY feature,provider LIMIT 100)x),'paid_subscription_records',(SELECT count(*) FROM credit_purchases WHERE kind='subscription' AND status='success' AND credited),'credit_ledger_records',(SELECT count(*) FROM credit_transactions),'funded_reserve_zar',(SELECT sum(amount_zar) FROM ai_reward_reserve_funding),'funding_records',(SELECT count(*) FROM ai_reward_reserve_funding),'reward_credits_issued',(SELECT sum(amount) FROM credit_transactions WHERE amount>0 AND source IN ('referral_milestone','ambassador')),'historical_usage',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT action_type,count(*) records,sum(credits_used) credits,min(created_at) first_at,max(created_at) last_at FROM user_usage GROUP BY action_type)x)) INTO v_result;
 RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.referral_admin_cost_evidence() FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.referral_admin_cost_evidence() TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_admin_approve_cost_model(_evidence jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 SELECT to_jsonb(s) INTO v_before FROM referral_programme_settings s WHERE id=true FOR UPDATE;
 IF v_before IS NULL OR v_before->>'credits_per_rand' IS NULL THEN RAISE EXCEPTION 'Confirmed conversion required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM ai_generation_cost_events WHERE reported_cost IS NOT NULL AND credit_transaction_id IS NOT NULL AND occurred_at>=now()-interval '30 days') THEN RAISE EXCEPTION 'Model not validated: reconciled provider costs linked to credit transactions required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM credit_purchases WHERE status='success' AND credited AND kind='subscription') THEN RAISE EXCEPTION 'Model not validated: collected subscription evidence required'; END IF;
 IF _evidence IS NULL OR length(coalesce(_evidence->>'review_reference',''))<10 OR coalesce(_evidence->>'source_expiry_verified','false')<>'true' OR coalesce(_evidence->>'representative_cohorts_verified','false')<>'true' OR coalesce(_evidence->>'fees_and_variable_costs_verified','false')<>'true' OR coalesce(_evidence->>'reserve_coverage_verified','false')<>'true' THEN RAISE EXCEPTION 'Documented cohort, source/expiry, fees and reserve review required'; END IF;
 UPDATE referral_programme_settings SET cost_model_approved=true,cost_model_approved_at=now(),cost_model_approved_by=auth.uid(),cost_model_evidence=_evidence,updated_at=now() WHERE id=true;
 SELECT to_jsonb(s) INTO v_after FROM referral_programme_settings s WHERE id=true;
 INSERT INTO referral_admin_audit(admin_user_id,action,record_id,before_values,after_values) VALUES(auth.uid(),'cost_model_approved','programme',v_before,v_after);
 RETURN v_after;
END; $$;
REVOKE ALL ON FUNCTION public.referral_admin_approve_cost_model(jsonb) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.referral_admin_approve_cost_model(jsonb) TO authenticated;