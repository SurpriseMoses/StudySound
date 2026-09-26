-- lovable-cron-fallback-reviewed: these 4 per-minute jobs already exist and poll the Gemini Batch API; this migration only rewrites their auth headers so the newly locked-down worker functions still accept them. No new polling is introduced.
do $$
declare
  bearer text;
begin
  select substring(command from 'Authorization": "Bearer ([^"]+)') into bearer
  from cron.job where jobname = 'seed-translation-worker-tick' limit 1;
  if bearer is null then raise exception 'no bearer found on seed-translation-worker-tick'; end if;

  perform cron.schedule('batch-ingestion-poll-every-minute', '* * * * *', format(
    'select net.http_post(url:=''https://ctlibgmsgqdhwiheedpy.supabase.co/functions/v1/batch-ingestion-poll'', headers:=''{"Content-Type": "application/json", "apikey": "%s", "Authorization": "Bearer %s"}''::jsonb, body:=''{}''::jsonb) as request_id;',
    bearer, bearer));

  perform cron.schedule('drain-translation-blueprints', '* * * * *', format(
    'select net.http_post(url:=''https://ctlibgmsgqdhwiheedpy.supabase.co/functions/v1/generate-translation-blueprints?poll=true'', headers:=''{"Content-Type": "application/json", "apikey": "%s", "Authorization": "Bearer %s"}''::jsonb, body:=''{}''::jsonb);',
    bearer, bearer));

  perform cron.schedule('drain-visual-prompts', '* * * * *', format(
    'select net.http_post(url:=''https://ctlibgmsgqdhwiheedpy.supabase.co/functions/v1/generate-visual-prompts?poll=true'', headers:=''{"Content-Type": "application/json", "apikey": "%s", "Authorization": "Bearer %s"}''::jsonb, body:=''{}''::jsonb);',
    bearer, bearer));

  perform cron.schedule('ingestion-worker-every-minute', '* * * * *', format(
    'select net.http_post(url:=''https://ctlibgmsgqdhwiheedpy.supabase.co/functions/v1/ingestion-worker'', headers:=''{"Content-Type": "application/json", "apikey": "%s", "Authorization": "Bearer %s"}''::jsonb, body:=''{"cron":true}''::jsonb) as request_id;',
    bearer, bearer));
end $$;

-- Quiz configuration is admin-only; learner quiz flow goes through the
-- service-role quiz-play function, which bypasses RLS.
drop policy if exists "Authenticated read quiz settings" on public.quiz_settings;
create policy "Admins read quiz settings" on public.quiz_settings
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Authenticated read quiz templates" on public.quiz_templates;
create policy "Admins read quiz templates" on public.quiz_templates
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));