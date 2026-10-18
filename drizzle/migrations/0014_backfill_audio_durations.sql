-- Measured narration durations for existing seeded audio (2026-10-18).
-- WAV (Gemini 24kHz 16-bit mono PCM): exact duration = (bytes - 44) / 48000, verified against ffprobe on 7 files.
UPDATE public.audio_assets a
SET duration_seconds = round((((o.metadata->>'size')::numeric - 44) / 48000.0), 3)
FROM storage.objects o
WHERE o.bucket_id = 'assets' AND o.name = a.storage_path
  AND a.storage_path LIKE '%.wav' AND a.duration_seconds IS NULL;

-- MP3 (ElevenLabs): ffprobe-measured durations from downloaded files.
UPDATE public.audio_assets a SET duration_seconds = v.dur FROM (VALUES
('7ff184f4-5105-401c-af66-05f48aec7635',146.100),('08b6b33e-afdd-4130-a1fe-a207b5decf21',144.707),
('97c8ff06-ef2d-4e90-a7be-ba6eddea1583',118.515),('5d6ba58b-f816-4a34-a7cb-10a7fd2783ff',49.598),
('7f3ed2c2-c543-4e87-b468-8e222e5197b7',91.115),('58b18c2d-092d-4062-9492-7f3cf201cfcf',116.750),
('61a00a26-9c87-48be-ab94-ba1dc63fc574',318.764),('82176069-26e1-4518-adab-4525124f409f',120.186),
('da98bbcb-3a69-4a4e-b9f6-2c304b2370d5',131.193),('0b0e7f92-2bd8-4ce9-94aa-ce49c5d934f9',136.998),
('986d3234-02ba-4b18-8209-59fbfbeadc02',137.323),('24002f93-c984-495d-9c98-d69958c85be2',122.183),
('3d03a43f-31c2-41fc-96b0-bed735fe5647',127.431),('0ffb6009-138b-45bd-b247-e4c3d83de696',118.236),
('e0a0e213-2c0d-43c2-8ca1-5bd8c3408a00',118.654),('98fa664a-0171-4410-bd9d-8f104cbc9d73',104.258),
('0f44dce0-ee0e-4065-8177-79dd16fbd792',53.081),('1ad776c0-85a8-4247-a7c5-56ce29487586',71.007),
('7bcae920-86d7-4f77-a852-2eae0e44f9e0',115.775),('4cb56864-e277-4778-898a-3ecd111abefa',121.487),
('c1698ba4-19e4-475d-8489-274ddf4f23f9',130.543),('3a425869-0f8c-4a93-8c23-39d32b6eb01d',114.985),
('486eae3d-71a0-45a4-a36d-008a7cce54d8',123.019),('8bbbf071-c5bb-4b48-b2f4-21db1f2e1760',120.976),
('214de649-03c4-4369-8953-1b084acc3d18',112.245),('3c9e8141-6443-42e1-921c-39418f1a1286',116.564),
('e3bcf503-ba94-4e9e-94d8-213e1f1045ca',121.858),('ae95763e-78b2-4f70-b06e-cd77aca44dd4',119.351)
) AS v(id, dur) WHERE a.id = v.id::uuid AND a.duration_seconds IS NULL;