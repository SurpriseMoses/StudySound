## StudySound Content Ingestion System

A scalable ingestion engine that imports, validates, cleans, structures, chunks, translates and seeds educational content at curriculum scale. Existing pieces (translation seed queue/worker, audio seeding, documents table) are reused — this plan adds the upstream layers (sources, licenses, pipeline orchestration, QC, curriculum tags) and an admin UI to drive everything.

### Pipeline
```text
SOURCE → LICENSE VALIDATION → DOWNLOAD/IMPORT → TEXT EXTRACTION →
STRUCTURE DETECTION → CURRICULUM TAGGING → CLEANING → CHUNKING →
TRANSLATION → AUDIO GENERATION → LIBRARY
```

States: `pending → downloading → parsing → cleaning → structuring → chunking → translating → audio_seeding → completed | failed`.

### Database (new tables, all with GRANTs + RLS, admin-only via `has_role`)
- `content_sources` — name, type, url, license_type, verification_status (`unverified|verified|blocked`), notes, import counts, last_import_at.
- `ingestion_jobs` — source_id, input (url/upload path/raw text), state, current_stage, progress %, error, attempts, document_id (once created), curriculum hints (grade/subject/curriculum/country), created_by, timestamps.
- `ingestion_stage_logs` — job_id, stage, status, started/finished, message (for live progress + QC).
- `curriculum_tags` — document_id, grade, subject, topic, subtopic, curriculum, country (unique per doc+tag).
- `content_quality_metrics` — document_id, ocr_score, cleaning_success_rate, duplicate_score, translation_health, english_leakage_pct, missing_chunks, computed_at.
- Extend `documents` with: `source_id`, `license_type`, `curriculum`, `country`, `grade`, `import_job_id`, `content_hash` (sha256 of normalized text — duplicate detection).

License rule enforced at DB level: trigger blocks an `ingestion_jobs` insert if the source's license isn't in the allowed set (`public_domain|creative_commons|government_educational|educational_use`) or status is `blocked`/`unverified`.

Duplicate prevention: unique index on `documents.content_hash`; unique `(source_id, source_url)` on `ingestion_jobs` for in-flight rows; unique `(document_id, chunk_index, kind)` already exists for assets.

### Edge functions
- `ingestion-orchestrator` — public admin entrypoint. Accepts `{source_id, url|upload_path|raw_text, hints}`, validates license, creates `ingestion_jobs` row, enqueues stage 1.
- `ingestion-worker` — cron-triggered (every minute via `pg_cron`+`pg_net`). Picks one `pending`/in-progress job, advances exactly one stage, writes a `ingestion_stage_logs` row, updates progress, returns. Stages:
  1. **download/import** — fetch URL (PDF/HTML/EPUB/TXT) or load uploaded file; store raw bytes in `uploads` bucket.
  2. **text extraction** — reuses `extract-document` for PDFs; HTML→text via Readability-like strip; EPUB via JSZip.
  3. **structure detection** — Gemini call to return JSON {chapters[], sections[], toc, exercises[]}.
  4. **curriculum tagging** — Gemini classifies grade/subject/topic/subtopic against a CAPS taxonomy seed; writes `curriculum_tags`.
  5. **cleaning** — applies TOC removal, dup chapter/scene removal, OCR/underscore/exeunt/dot-leader/header-footer cleanup (reuses `_shared/clean-text.ts`, extended with the new passes).
  6. **chunking** — creates `documents` row (if not yet), splits into chunks (≈900 chars, sentence-aware), computes `content_hash`, dedupes.
  7. **translation seeding** — enqueues into existing `translation_seed_queue` (flips `seed_translation=true`).
  8. **audio seeding** — enqueues into existing audio seed pipeline.
  9. **completed** — computes `content_quality_metrics` and marks job done.
- `compute-quality-metrics` — callable per document, used at stage 9 and from admin UI.

### Curriculum taxonomy seed
A `curriculum_taxonomy` table seeded with: South Africa CAPS — Mathematics G10-12, Physical Sciences G10-12, Mathematical Literacy G10-12, plus generic OpenStax/Wikibooks/Gutenberg subject buckets. Used to constrain the Gemini classifier output.

### Admin UI (`/admin/ingestion`)
Single page with three tabs, mobile-first, teal/coral, Space Grotesk/DM Sans:
1. **Sources** — list + add/edit `content_sources`, set license + verification status, "Block" / "Verify" actions.
2. **Jobs** — table of `ingestion_jobs` with live stage badges, progress bar, per-stage log drawer, "Retry" / "Cancel" / "Reprocess from stage X". New-job dialog: pick source, paste URL or upload file, set grade/subject hints.
3. **Analytics** — totals (sources / documents / chunks / audio assets / translations / storage), top sources by yield, QC dashboard (OCR score, cleaning rate, duplicates, translation health, English leakage, missing chunks).

Admin-only — gated by existing `useIsAdmin` + `AdminRoute`. Linked from `AdminLayout` sidebar between "Documents" and "Seed Translations".

### Initial seed
Insert SA priority sources into `content_sources`:
- Siyavula Mathematics G10/G11/G12 (CC-BY)
- Siyavula Physical Sciences G10/G11/G12 (CC-BY)
- Siyavula Mathematical Literacy G10-12 (CC-BY)
- DBE workbooks index (Government Educational)
- OpenStax (CC-BY), Gutenberg (Public Domain), OER Commons, Wikibooks (CC-BY-SA).

Verification status starts `verified` for these well-known licenses; others land as `unverified` and are blocked until an admin verifies.

### Out-of-scope for this PR (call out explicitly)
- Actual large-scale crawl of Siyavula/DBE catalogs (we wire the source records + per-URL ingestion; bulk crawler is a follow-up).
- Multi-country curriculum taxonomies beyond CAPS seed.
- Per-country pricing/locale changes.

### Questions before I start
1. **Scope confirmation**: Should I build the full UI + orchestrator + worker + all 9 stages in one go, or ship in phases (Phase 1: sources/jobs/UI + stages 1-2; Phase 2: 3-6; Phase 3: 7-9 wiring to existing seed pipelines)?
2. **License default**: For brand-new sources added in the admin UI, default to `unverified` (blocked) or `verified` (admin must downgrade)? Spec says unknown licenses must be blocked — I'll default to `unverified` unless you say otherwise.
3. **Bulk crawler**: Do you want a "Crawl Siyavula catalog" button now, or per-URL ingestion only for v1?
