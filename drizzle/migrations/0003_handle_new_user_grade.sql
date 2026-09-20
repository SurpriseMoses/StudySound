CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  subj text[];
BEGIN
  BEGIN
    SELECT COALESCE(array_agg(x.value), '{}'::text[])
      INTO subj
      FROM jsonb_array_elements_text(
        COALESCE(NEW.raw_user_meta_data->'selected_subjects', '[]'::jsonb)
      ) AS x(value);
  EXCEPTION WHEN others THEN
    subj := '{}'::text[];
  END;

  INSERT INTO public.profiles (user_id, display_name, grade, selected_subjects, onboarding_completed, free_credits_expires_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NULLIF(NEW.raw_user_meta_data->>'grade', ''),
    COALESCE(subj, '{}'::text[]),
    COALESCE(array_length(subj, 1), 0) > 0,
    now() + interval '7 days'
  );
  RETURN NEW;
END;
$function$;