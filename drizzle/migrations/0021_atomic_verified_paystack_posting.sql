ALTER TABLE public.credit_purchases
 ADD COLUMN IF NOT EXISTS expected_customer_email text,
 ADD COLUMN IF NOT EXISTS payment_environment text,
 ADD COLUMN IF NOT EXISTS expected_plan_code text,
 ADD COLUMN IF NOT EXISTS provider_payment_id text,
 ADD COLUMN IF NOT EXISTS credit_transaction_id uuid REFERENCES public.credit_transactions(id),
 ADD COLUMN IF NOT EXISTS verified_paid_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS credit_purchases_provider_payment_identity ON public.credit_purchases(provider,payment_environment,provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_purchases_wallet_transaction_identity ON public.credit_purchases(credit_transaction_id) WHERE credit_transaction_id IS NOT NULL;
COMMENT ON COLUMN public.credit_purchases.expected_customer_email IS 'Checkout-bound authenticated email; legacy NULL rows require reconciliation, never inferred from payment metadata.';
CREATE OR REPLACE FUNCTION public.payment_post_verified(_evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
 p public.credit_purchases%ROWTYPE; s public.subscriptions%ROWTYPE;
 mapping public.payment_plan_codes%ROWTYPE; total integer; balance integer; ledger uuid;
 ref text := _evidence->>'reference'; env text := _evidence->>'environment';
 email text := lower(trim(_evidence->>'customer_email')); customer text := _evidence->>'customer_code';
 v_plan_code text := _evidence->>'plan_code'; paid_at timestamptz; amount numeric;
BEGIN
 IF _evidence->>'status' IS DISTINCT FROM 'success' OR _evidence->>'currency' IS DISTINCT FROM 'ZAR'
 OR env IS NULL OR env NOT IN ('test','live') OR ref IS NULL OR ref !~ '^[a-zA-Z0-9_.-]{1,200}$'
 OR coalesce(_evidence->>'payment_id','') !~ '^[1-9][0-9]{0,30}$'
 OR coalesce(customer,'') !~ '^CUS_[a-zA-Z0-9]+$' OR coalesce(email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 OR coalesce(_evidence->>'amount_cents','') !~ '^[1-9][0-9]*$' THEN
 RAISE EXCEPTION 'Invalid verified payment evidence'; END IF;
 amount := (_evidence->>'amount_cents')::numeric;
 paid_at := (_evidence->>'paid_at')::timestamptz;
 IF paid_at IS NULL OR NOT isfinite(paid_at) OR paid_at > now()+interval '5 minutes' THEN RAISE EXCEPTION 'Invalid payment date'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('paystack:'||ref,0));
 SELECT * INTO p FROM public.credit_purchases WHERE reference=ref FOR UPDATE;
 IF NOT FOUND THEN
   SELECT * INTO mapping FROM public.payment_plan_codes WHERE plan_code=v_plan_code;
   IF NOT FOUND OR mapping.plan_id NOT IN ('essential','premium') THEN RETURN jsonb_build_object('credited',false,'credits',0,'status','unknown'); END IF;
   SELECT * INTO s FROM public.subscriptions WHERE paystack_customer_code=customer AND plan=mapping.plan_id;
   IF NOT FOUND THEN RETURN jsonb_build_object('credited',false,'credits',0,'status','unknown'); END IF;
   IF NOT EXISTS (SELECT 1 FROM public.credit_purchases prior WHERE prior.user_id=s.user_id AND prior.kind='subscription'
     AND prior.credited AND prior.payment_environment=env AND prior.expected_customer_email=email
     AND prior.paystack_payload->>'customer_code'=customer) THEN RAISE EXCEPTION 'Renewal customer binding unavailable'; END IF;
   IF amount<>mapping.amount_zar*100 OR mapping.amount_zar<>(CASE mapping.plan_id WHEN 'essential' THEN 79 ELSE 149 END) THEN RAISE EXCEPTION 'Renewal amount mismatch'; END IF;
   INSERT INTO public.credit_purchases(user_id,pack_id,kind,plan_id,credits,bonus_credits,amount_zar,reference,status,expected_customer_email,payment_environment,expected_plan_code)
    VALUES(s.user_id,'plan_'||mapping.plan_id,'subscription',mapping.plan_id,CASE mapping.plan_id WHEN 'essential' THEN 110 ELSE 220 END,0,mapping.amount_zar,ref,'pending',email,env,v_plan_code) RETURNING * INTO p;
 END IF;
 IF p.expected_customer_email IS NULL OR p.payment_environment IS NULL THEN RAISE EXCEPTION 'Legacy purchase requires payment reconciliation'; END IF;
 IF p.provider<>'paystack' OR p.currency<>'ZAR' OR p.amount_zar*100<>amount OR p.payment_environment<>env OR lower(trim(p.expected_customer_email))<>email
 OR p.expected_plan_code IS DISTINCT FROM v_plan_code THEN RAISE EXCEPTION 'Payment does not match checkout'; END IF;
 IF p.credited THEN
  IF p.provider_payment_id IS DISTINCT FROM _evidence->>'payment_id' OR p.credit_transaction_id IS NULL
    OR p.paystack_payload->>'customer_code' IS DISTINCT FROM customer THEN RAISE EXCEPTION 'Credited purchase requires reconciliation'; END IF;
  RETURN jsonb_build_object('credited',false,'credits',p.credits+p.bonus_credits,'status','already_credited','transaction_id',p.credit_transaction_id);
 END IF;
 IF p.status NOT IN ('pending','failed') THEN RAISE EXCEPTION 'Purchase is not eligible for posting'; END IF;
 total:=p.credits+p.bonus_credits;
 IF total<=0 THEN RAISE EXCEPTION 'Invalid purchase credits'; END IF;
 PERFORM 1 FROM public.profiles WHERE user_id=p.user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Wallet profile missing'; END IF;
 INSERT INTO public.credit_transactions(user_id,amount,source,request_id,metadata)
 VALUES(p.user_id,total,'purchase',ref,jsonb_build_object('provider','paystack','purchase_id',p.id,'payment_id',_evidence->>'payment_id','environment',env,'kind',p.kind,'pack_id',p.pack_id,'plan_id',p.plan_id,'amount_zar',p.amount_zar,'bonus_credits',p.bonus_credits)) RETURNING id INTO ledger;
 UPDATE public.profiles SET credits_balance=credits_balance+total,updated_at=now() WHERE user_id=p.user_id RETURNING credits_balance INTO balance;
 IF p.kind='subscription' THEN
  IF p.plan_id IS NULL OR p.plan_id NOT IN ('essential','premium') THEN RAISE EXCEPTION 'Invalid subscription plan'; END IF;
  INSERT INTO public.subscriptions(user_id,plan,status,paystack_customer_code,current_period_end,updated_at)
  VALUES(p.user_id,p.plan_id,'active',customer,paid_at+interval '1 month',now())
  ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan,status='active',paystack_customer_code=excluded.paystack_customer_code,
   current_period_end=greatest(subscriptions.current_period_end,excluded.current_period_end),updated_at=now()
  WHERE subscriptions.current_period_end IS NULL OR subscriptions.current_period_end<=excluded.current_period_end;
  SELECT * INTO s FROM public.subscriptions WHERE user_id=p.user_id;
  UPDATE public.profiles SET plan=s.plan::public.subscription_plan WHERE user_id=p.user_id;
 END IF;
 UPDATE public.credit_purchases SET status='success',credited=true,paystack_payload=_evidence,provider_payment_id=_evidence->>'payment_id',credit_transaction_id=ledger,verified_paid_at=paid_at,updated_at=now() WHERE id=p.id;
 RETURN jsonb_build_object('credited',true,'credits',total,'balance',balance,'status','success','transaction_id',ledger,'kind',p.kind,'plan_id',p.plan_id);
END; $$;
REVOKE ALL ON FUNCTION public.payment_post_verified(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.payment_post_verified(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.protect_wallet_payment_fields() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND (NEW.credits_balance IS DISTINCT FROM OLD.credits_balance OR NEW.plan IS DISTINCT FROM OLD.plan
 OR NEW.free_credits_remaining IS DISTINCT FROM OLD.free_credits_remaining OR NEW.free_credits_expires_at IS DISTINCT FROM OLD.free_credits_expires_at) THEN
 RAISE EXCEPTION 'Wallet and plan changes require a trusted server operation'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER protect_wallet_payment_fields BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_wallet_payment_fields();