CREATE OR REPLACE FUNCTION public.enforce_prelaunch_api_access()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$ BEGIN
 IF coalesce(auth.role(), '') = 'service_role' OR public.prelaunch_access_allowed() THEN RETURN; END IF;
 IF current_setting('request.path', true) = '/preview_videos'
    AND current_setting('request.method', true) IN ('GET', 'HEAD') THEN RETURN; END IF;
 RAISE EXCEPTION 'BrainGrasp is not launched yet. Administrator access only.' USING ERRCODE = '42501';
END; $$;
ALTER POLICY prelaunch_admin_only ON public.preview_videos USING (true) WITH CHECK (public.prelaunch_access_allowed());
CREATE POLICY prelaunch_preview_write_guard ON public.preview_videos AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (public.prelaunch_access_allowed());
CREATE POLICY prelaunch_preview_update_guard ON public.preview_videos AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (public.prelaunch_access_allowed()) WITH CHECK (public.prelaunch_access_allowed());
CREATE POLICY prelaunch_preview_delete_guard ON public.preview_videos AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (public.prelaunch_access_allowed());
ALTER POLICY prelaunch_admin_only ON storage.objects USING (public.prelaunch_access_allowed() OR (bucket_id = 'preview-videos' AND EXISTS (SELECT 1 FROM public.preview_videos v WHERE v.storage_path = objects.name AND v.document_id IS NOT NULL))) WITH CHECK (public.prelaunch_access_allowed());
CREATE POLICY prelaunch_storage_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (public.prelaunch_access_allowed());
CREATE POLICY prelaunch_storage_update_guard ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (public.prelaunch_access_allowed()) WITH CHECK (public.prelaunch_access_allowed());
CREATE POLICY prelaunch_storage_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (public.prelaunch_access_allowed());
GRANT SELECT ON public.preview_videos TO anon, authenticated;
COMMENT ON FUNCTION public.enforce_prelaunch_api_access() IS 'Prelaunch: only GET/HEAD preview_videos is public; every other Data API request requires administrator or service role.';
NOTIFY pgrst, 'reload config';