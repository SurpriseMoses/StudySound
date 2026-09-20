ALTER TABLE public.credit_purchases
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'credits',
  ADD COLUMN IF NOT EXISTS plan_id text;

CREATE TABLE IF NOT EXISTS public.payment_plan_codes (
  plan_id text PRIMARY KEY,
  plan_code text NOT NULL,
  amount_zar integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.payment_plan_codes TO service_role;
ALTER TABLE public.payment_plan_codes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  paystack_subscription_code text,
  paystack_customer_code text,
  paystack_email_token text,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_key ON public.subscriptions(user_id);

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription"
ON public.subscriptions FOR SELECT TO authenticated
USING (auth.uid() = user_id);