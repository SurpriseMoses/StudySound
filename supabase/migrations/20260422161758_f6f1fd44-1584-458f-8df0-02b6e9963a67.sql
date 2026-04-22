DO $$
DECLARE
  doc_id uuid := 'de000937-7d82-49a1-a3c1-9a102d6e68ef';
BEGIN
  DELETE FROM audio_assets       WHERE document_id = doc_id;
  DELETE FROM translation_assets WHERE document_id = doc_id;
  DELETE FROM image_assets       WHERE document_id = doc_id;
  DELETE FROM quiz_assets        WHERE document_id = doc_id;

  DELETE FROM user_chunk_access        WHERE document_id = doc_id;
  DELETE FROM user_translation_access  WHERE document_id = doc_id;
  DELETE FROM user_asset_access        WHERE document_id = doc_id;
  DELETE FROM scene_unlocks            WHERE document_id = doc_id;
  DELETE FROM user_activity            WHERE document_id = doc_id;
  DELETE FROM user_usage               WHERE document_id = doc_id;
  DELETE FROM translation_rate_log     WHERE document_id = doc_id;
  DELETE FROM translation_watermarks   WHERE document_id = doc_id;

  DELETE FROM lesson_progress
  WHERE lesson_id IN (SELECT id FROM lessons WHERE document_id = doc_id);
  DELETE FROM quiz_attempts
  WHERE quiz_id IN (
    SELECT q.id FROM quizzes q
    JOIN lessons l ON l.id = q.lesson_id
    WHERE l.document_id = doc_id
  );
  DELETE FROM quizzes          WHERE lesson_id IN (SELECT id FROM lessons WHERE document_id = doc_id);
  DELETE FROM visual_scenes    WHERE lesson_id IN (SELECT id FROM lessons WHERE document_id = doc_id);
  DELETE FROM character_sheets WHERE lesson_id IN (SELECT id FROM lessons WHERE document_id = doc_id);
  DELETE FROM lessons          WHERE document_id = doc_id;

  DELETE FROM uploads
  WHERE file_name ILIKE '%mabeth%' OR file_name ILIKE '%macbeth%';

  DELETE FROM documents WHERE id = doc_id;
END $$;