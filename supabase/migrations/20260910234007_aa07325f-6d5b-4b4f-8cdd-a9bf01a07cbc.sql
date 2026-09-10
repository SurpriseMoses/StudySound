CREATE TABLE public.credit_purchases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack_id text NOT NULL,
  credits integer NOT NULL,
  bonus_credits integer NOT NULL DEFAULT 0,
  amount_zar numeric NOT NULL,
  currency text NOT NULL DEFAULT 'ZAR',
  provider text NOT NULL DEFAULT 'paystack',
  reference text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  credited boolean NOT NULL DEFAULT false,
  paystack_payload jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX credit_purchases_user_idx ON public.credit_purchases (user_id, created_at DESC);

GRANT SELECT ON public.credit_purchases TO authenticated;
GRANT ALL ON public.credit_purchases TO service_role;

ALTER TABLE public.credit_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own purchases"
ON public.credit_purchases FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER credit_purchases_set_updated_at
BEFORE UPDATE ON public.credit_purchases
FOR EACH ROW EXECUTE FUNCTION public.set_last_updated_at();