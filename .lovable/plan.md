## Goal

Use the uploaded `studysound_translation_pipeline_fix` spec as the source of truth and bring the seed translation pipeline fully in line with it. The recent issues (stuck %, "done" while still 76–77%, languages dropping out of the UI) are all symptoms of the same root cause the spec calls out: **we sometimes treat "translation row exists" as "done" instead of using `status + hash + version`**.

Most of the spec is already implemented (hashing, `CURRENT_TRANSLATION_VERSION`, English-leak detection, preprocessing, batch tracking, blueprint caching). This plan closes the remaining gaps.

## Scope of changes

### 1. State model — make `status` authoritative
- `translation_seed_queue.status` stays the single source of truth per (chunk × language). No code path may infer completion from row existence alone.
- Add an explicit `stale` status path: when `source_text_hash` or `translation_version` no longer matches, the row is flipped to `stale` and re-queued instead of silently reused.

### 2. Doc-level completion (fix "Great Expectations says done at 77%")
- The trigger fix from last turn (`pending|processing|failed|batched` all count as outstanding) stays.
- Add a second guard in `seed-translation-worker`: before any `documents.translation_status='done'` write, re-check the queue counts in the same statement (`WHERE NOT EXISTS (... outstanding ...)`). No "optimistic done".
- Backfill: re-open any doc currently marked `done` that still has outstanding rows.

### 3. Progress calculation (fix stuck %)
- `AdminSeedTranslations` reads progress as `completed / total` per language directly from `translation_seed_queue` (no cached aggregate). Confirm the query already does this; if it falls back to `translation_assets` counts anywhere, switch it to the queue.
- "Processing now" badge: keep the `current_document_id` write added last turn, plus also clear it when the doc flips to `done`.

### 4. Gemini batch result mapping (fix silent partials)
- In `seed-translation-worker` batch-drain path: for every returned result, require a `chunk_id` match. Unmapped/empty results → mark row `failed` with `last_error='batch_unmapped'` and increment `attempts`, instead of leaving it `batched` forever (which is what made counts hang).
- After draining a batch, assert `completed + failed == batch_size`; if not, log + re-queue the missing chunk_ids.

### 5. Cache validation on read
- `generate-translation` (on-demand) and the seed worker both check: `status='completed' AND source_text_hash = <new hash> AND translation_version = CURRENT_TRANSLATION_VERSION`. Anything else → recompute. Confirm both paths; tighten the seed worker which currently shortcuts on row presence in one branch.

### 6. English-leak handling
- Already implemented in `translation-pipeline.ts`. Add: when leak is detected during batch result handling, mark `failed` (not `completed`), so the retry loop picks it up. Today some batched results bypass the leak check.

### 7. Job control
- `seed-translation-manager` already prevents duplicate runs via `translation_worker_state.is_running`. Add: per-document/per-language guard so a manual "translate this book" can't double-queue rows that are already `pending|processing|batched`.

### 8. UI subscriptions
- `AdminSeedTranslations` already polls. Switch the per-language progress tiles to read directly from `translation_seed_queue` aggregates (it mostly does — verify Afrikaans/Xhosa/Zulu tiles aren't reading a stale `translation_assets` count, which is the most likely cause of "no translation showing when toggling languages").

### 9. Backfill / cleanup migration
One migration to:
- Reset rows stuck in `batched` for >2h with no `batch_job_id` resolution → back to `pending`.
- Reopen documents wrongly marked `done` while outstanding rows exist.
- Mark rows whose `source_text_hash` ≠ current chunk hash as `stale` then `pending`.

## Files touched
- `supabase/functions/seed-translation-worker/index.ts` — batch result mapping, doc-done guard, leak-on-batch, stale detection.
- `supabase/functions/seed-translation-manager/index.ts` — per-doc/lang dedupe.
- `supabase/functions/generate-translation/index.ts` — strict cache validation.
- `src/pages/admin/AdminSeedTranslations.tsx` — ensure all per-language tiles read from `translation_seed_queue`.
- One new migration for backfill + the `tsq_maybe_mark_doc_done` tightening.

## Out of scope
- Re-architecting the audio/TTS pipeline (spec mentions it but only as downstream consumer).
- Changing the UI design of the admin page beyond the data source it reads from.
- Changing chunking logic — `clean_text → chunks` stays as-is.

## Validation
After deploy:
1. Pick a doc currently at 77% Afrikaans → confirm queue counts match UI %.
2. Force a chunk's `clean_text` to change → confirm its translations flip to `stale` and re-translate.
3. Submit a Gemini batch and kill one result → confirm the missing chunk becomes `failed` then retries, not stuck `batched`.
4. Confirm `documents.translation_status='done'` only appears when `SELECT COUNT(*) FROM translation_seed_queue WHERE document_id=X AND status<>'completed'` returns 0.

Approve and I'll implement in the order above (migration first, then worker, then manager, then UI verification).