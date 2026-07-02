# Grade-by-Grade Batch Ingestion + New SA Languages

## Goal
Replace the slow one-stage-per-cron ingestion with a Gemini Batch API pipeline. Run one grade at a time (G8 → G12), covering every remaining DBE (G8–9) and Siyavula (G10–12) subject. Add Tshivenda and isiNdebele to translations everywhere.

## Part A — Batch ingestion pipeline

### New table: `ingestion_batch_jobs`
Tracks a Gemini Batch submission that covers many books at once.

Columns: `id`, `grade`, `stage` (`extract` | `structure` | `clean_tag`), `state` (`pending|submitted|polling|succeeded|failed`), `gemini_batch_name`, `item_count`, `submitted_at`, `finished_at`, `report jsonb`, `created_by`.

Companion `ingestion_batch_items` (job_id, ingestion_job_id, position, status `pending|ok|failed|review_required`, error, result_ref).

Grants + RLS admin-only via `has_role`.

### New edge functions
- `batch-ingestion-submit`  
  Input: `{ grade: "8", stage: "extract" }`. Picks all `ingestion_jobs` for that grade currently at the matching stage, downloads the source PDF/HTML (Firecrawl fallback), packages one Gemini Batch request per book (PDF → inlineData for extract; text → prompt for structure/clean_tag), calls `submitBatch` from `_shared/gemini-batch.ts`, records `gemini_batch_name`.
- `batch-ingestion-poll`  
  Cron every 60 s. For each `submitted`/`polling` row, calls `pollBatch`. On `SUCCEEDED`: writes results back into each `ingestion_jobs` row (raw_text, structure JSON, curriculum tags, clean_text), advances state to the next stage or `chunking`. Per-item failures set that ingestion_job's state to `review_required` without blocking siblings.
- `batch-ingestion-report`  
  Called at end of grade. Returns `{ books_processed, ok, failed, review_required, total_chars, total_chunks, embed_pct }`. Stored in `ingestion_batch_jobs.report`.

### Stage mapping (per book, inside one batch)
```text
extract     → gemini-2.5-pro w/ PDF inlineData → raw_text
structure   → gemini-2.5-flash on raw_text     → chapters/sections JSON
clean_tag   → gemini-2.5-flash                 → clean_text + curriculum tags
```
After `clean_tag` succeeds, existing local chunking + embedding pipeline runs (fast, no batching needed).

### Orchestrator: `run-grade-ingestion`
Admin-triggered per grade. Steps:
1. Enumerate DBE (G8–9) or Siyavula (G10–12) subjects still missing/broken for that grade → insert `ingestion_jobs` rows.
2. Submit `extract` batch → wait for poll to mark succeeded.
3. Submit `structure` batch → wait.
4. Submit `clean_tag` batch → wait.
5. Run chunk + embed for each finished doc.
6. Emit completion report; ONLY then unlock the next grade button in the UI.

Reuses existing `_shared/gemini-batch.ts` (already handles submit/poll and BATCH_STATE_ normalization).

## Part B — Admin UI (`AdminIngestion.tsx`)

New "Grade Sweep" panel above the existing job list:
- 5 grade tiles (G8 DBE, G9 DBE, G10 Siyavula, G11 Siyavula, G12 Siyavula).
- Each tile shows: subjects queued, batch state per stage, progress bar, "Start" button.
- Tiles are sequentially unlocked (G9 disabled until G8 report exists).
- Report drawer per grade showing the JSON metrics above + list of `review_required` books with a "Retry" action.

## Part C — Tshivenda & isiNdebele

1. **Language list** — add `{ code: "ve", name: "Tshivenda" }` and `{ code: "nr", name: "isiNdebele" }` to the shared languages array used by Listen/Translation UI and the admin seed queue.
2. **Translation pipeline** (`_shared/translation-pipeline.ts` + `generate-translation`) — both routes go through Gemini (already handles Xitsonga); add prompt-side glossary lines and language names so quality matches other SA languages.
3. **Admin seed queue** (`AdminSeedTranslations.tsx`) — add the two codes to the selectable target languages.
4. **Learner UI** (`TranslationSection.tsx`, language picker in `Listen.tsx`) — add the two options.

No DB migration needed for languages — targets are stored as free-form codes in `translation_assets.language`.

## Out of scope
- No changes to audio seeding or pricing.
- No new curriculum taxonomy rows beyond what AI tagging produces.
- Auto-discovery crawlers for non-DBE/non-Siyavula sources.

## Technical notes
- Batch item payload keeps PDFs ≤20 MB inline; larger PDFs fall back to per-book synchronous Gemini File API upload before batch submission.
- `pickJob` in existing `ingestion-worker` stays as safety net for one-offs but grade sweeps bypass it.
- All new edge functions: CORS, admin `has_role` check, structured JSON errors (no 5xx thrown to client).

## Rollout order
1. DB migration (batch tables) + shared helper wiring.
2. `batch-ingestion-submit` / `-poll` / `-report` functions.
3. `run-grade-ingestion` orchestrator + UI panel.
4. Language additions (small, ship alongside).
5. Kick G8 as the first live run; verify report before G9.
