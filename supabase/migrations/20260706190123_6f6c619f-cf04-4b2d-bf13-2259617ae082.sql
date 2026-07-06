
DELETE FROM document_chunks WHERE document_id = '3abb7d5c-7d25-4768-a7c8-4bb3239a840a';
DELETE FROM content_topic_mapping WHERE document_id = '3abb7d5c-7d25-4768-a7c8-4bb3239a840a';
DELETE FROM curriculum_tags WHERE document_id = '3abb7d5c-7d25-4768-a7c8-4bb3239a840a';
DELETE FROM documents WHERE id = '3abb7d5c-7d25-4768-a7c8-4bb3239a840a';
UPDATE ingestion_jobs
SET document_id = NULL, state = 'cleaning', attempts = 0, last_error = NULL, updated_at = now()
WHERE id IN ('48da7fba-4090-45ad-b069-80b977e95646','4bdb4d52-12da-47b2-b1fc-0551c4b3bf68');
