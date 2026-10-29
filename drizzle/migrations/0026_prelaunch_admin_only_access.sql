CREATE OR REPLACE FUNCTION public.prelaunch_access_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'::public.app_role); $$;
REVOKE ALL ON FUNCTION public.prelaunch_access_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prelaunch_access_allowed() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_prelaunch_api_access()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$ BEGIN
 IF coalesce(auth.role(), '') = 'service_role' THEN RETURN; END IF;
 IF NOT public.prelaunch_access_allowed() THEN
  RAISE EXCEPTION 'BrainGrasp is not launched yet. Administrator access only.' USING ERRCODE = '42501';
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.enforce_prelaunch_api_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_prelaunch_api_access() TO anon, authenticated, service_role;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.enforce_prelaunch_api_access';
NOTIFY pgrst, 'reload config';

DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity LOOP
  EXECUTE format('CREATE POLICY prelaunch_admin_only ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (public.prelaunch_access_allowed()) WITH CHECK (public.prelaunch_access_allowed())', t.relname);
 END LOOP;
END $$;
CREATE POLICY prelaunch_admin_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (public.prelaunch_access_allowed()) WITH CHECK (public.prelaunch_access_allowed());

CREATE OR REPLACE FUNCTION public.block_prelaunch_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
 RAISE EXCEPTION 'BrainGrasp registrations are closed until launch.' USING ERRCODE = '42501';
END; $$;
REVOKE ALL ON FUNCTION public.block_prelaunch_registration() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER braingrasp_prelaunch_registration BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.block_prelaunch_registration();
COMMENT ON FUNCTION public.block_prelaunch_registration() IS 'Temporary pre-launch signup block; remove this app-owned trigger only when the owner explicitly opens registration.';
COMMENT ON FUNCTION public.prelaunch_access_allowed() IS 'Temporary administrator-only launch gate, based exclusively on protected user_roles; no account or wallet data is changed.';