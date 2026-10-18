REVOKE ALL ON public.ai_reward_reserve_funding, public.ai_reward_reserve_reversals FROM anon, authenticated;
GRANT SELECT ON public.ai_reward_reserve_funding, public.ai_reward_reserve_reversals TO authenticated;
GRANT ALL ON public.ai_reward_reserve_funding, public.ai_reward_reserve_reversals TO service_role;