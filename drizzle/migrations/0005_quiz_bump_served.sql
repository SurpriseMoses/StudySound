CREATE OR REPLACE FUNCTION public.quiz_bump_served(_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.quiz_questions
  SET times_served = times_served + 1
  WHERE id = ANY(_ids);
$$;

REVOKE ALL ON FUNCTION public.quiz_bump_served(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quiz_bump_served(uuid[]) TO service_role;