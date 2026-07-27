GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingestion_jobs TO authenticated;
GRANT ALL ON public.ingestion_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingestion_stage_logs TO authenticated;
GRANT ALL ON public.ingestion_stage_logs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingestion_batch_jobs TO authenticated;
GRANT ALL ON public.ingestion_batch_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingestion_batch_items TO authenticated;
GRANT ALL ON public.ingestion_batch_items TO service_role;