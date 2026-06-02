## Goal

Move three text/prompt seeding flows to the **Gemini Batch API** (50% cheaper, no per-minute caps), and pause the audio/TTS seed worker so it stops burning Tier-1 quota.

### Scope
1. `seed-translation-worker` → batch translations of all chunks × 6 languages.
2. `generate-translation-blueprints` → batch blueprint generation per book.
3. `generate-visual-prompts` → batch visual-prompt generation, with a hardened "Visual Bible" character-consistency prompt.
4. `seed-queue-worker` (audio) → paused (early exit + worker flag off).

### How Gemini Batch API works (used in all 3 functions)
- Submit: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:batchGenerateContent?key=…` with `{requests:[{request:{contents,…}}, …]}`. Returns an operation name like `batches/abc-123`.
- Poll: `GET https://generativelanguage.googleapis.com/v1beta/{operation_name}?key=…`. Returns `metadata.state` ∈ `JOB_STATE_PENDING|RUNNING|SUCCEEDED|FAILED|CANCELLED`. When `SUCCEEDED`, `response.inlinedResponses[i]` aligns with submitted `requests[i]`.
- Pricing: 50% of standard generateContent. SLA: ≤24h, usually minutes for small jobs.
- Each function will: (a) on tick — poll any in-flight batch and persist results; (b) if no in-flight batch — submit a new one from pending work.

---

### 1. Schema migration (one migration)
- `translation_seed_queue`: add `batch_job_name text`, `batch_index int`, `batch_submitted_at timestamptz`. New status value `batched`.
- `translation_blueprints`: add `batch_job_name text`, `batch_submitted_at timestamptz`, `batch_status text` (for in-flight blueprint generation).
- New table `visual_prompts_batch_jobs(document_id uuid pk, batch_job_name text, submitted_at timestamptz, status text, last_error text)` — visuals don't have a queue table, so store one in-flight job per book here.
- Standard GRANTs + admin-only RLS on the new table.

### 2. `seed-translation-worker` refactor
Each tick:
1. **Poll phase** — find distinct `batch_job_name` from rows where `status='batched'`. For each job: GET status.
   - `SUCCEEDED` → for each `inlinedResponses[i]`, find the queue row by `(batch_job_name, batch_index)`, run `detectEnglishLeak`, insert into `translation_assets`, mark row `done`. Row-level errors → back to `pending` with attempts++ and exp-backoff.
   - `RUNNING/PENDING` → leave as-is.
   - `FAILED/CANCELLED` → mark all member rows `pending` with last_error.
2. **Submit phase** — if fewer than N (e.g. 2) in-flight jobs, claim up to ~200 pending rows for the oldest doc, build one batch request per row (system = base prompt + per-book blueprint; user = source chunk text), POST batch, write back `batch_job_name`, `batch_index`, `status='batched'`.

Keeps existing per-row idempotency check (skip rows already cached with matching hash + version). Removes the per-language sleep & per-chunk retry loop (the batch absorbs that).

### 3. `generate-translation-blueprints` refactor
- On call, build a batch of N blueprint requests (one per qualifying doc), POST batch, store `batch_job_name` on each `translation_blueprints` row with `batch_status='running'`.
- Add a `?poll=true` mode (and call from cron) that polls outstanding `batch_status='running'` rows, writes `blueprint_text` + invalidates `gemini_context_caches` on success.

### 4. `generate-visual-prompts` refactor — Visual Bible
- Replace the system prompt with a two-part deliverable: model must return `{ character_bible: [{name, physical_description, attire, distinguishing_marks}], scenes: [10–12 entries each referencing only character names from `character_bible`] }`. The `leonardo_prompt` for each scene is constructed server-side as `"<scene action with [Character Name]>. CHARACTERS: <full bible descriptions for every character mentioned in this scene>. <style keywords>"` — so character descriptions are byte-identical across scenes, guaranteeing consistency.
- Submit one batch covering all qualifying docs; persist `batch_job_name` to `visual_prompts_batch_jobs`. Add `?poll=true` to drain; on success, write to `translation_blueprints.visual_prompts` exactly as today (downstream `unlock-scene` etc. unchanged).

### 5. Audio seeding pause
- `seed-queue-worker`: at top of handler, if `Deno.env.get('AUDIO_SEEDING_PAUSED') !== 'false'` (defaults to paused) → flip `seed_worker_state.is_running=false` and return `{ok:true, paused:true}`. No batch claims, no Gemini calls, no Azure calls.
- One-time DB update: `update seed_worker_state set is_running=false` (via insert tool, not migration).
- Admin UI's start button on `AdminSeedAudio` still works once we set the env var to `false` later (no code change needed to resume).

### 6. Cron
- Reuse existing `seed-translation-worker` cron tick — now also polls. Frequency stays.
- Add a new cron (every 2 min) hitting `generate-translation-blueprints?poll=true` and `generate-visual-prompts?poll=true` so submitted batches drain without manual prompting. Done via `supabase--insert` (cron schema), not a migration.

### Out of scope
- Live (user-triggered) translation/quiz/visual unlock endpoints — they must stay synchronous.
- ElevenLabs / Tier-2 upgrade for audio — deferred per user.
- No DB schema migration that touches `auth`/`storage`/`realtime`.

### Verification
After ship: trigger blueprint batch on 1 doc → poll → confirm blueprint written. Then trigger translation worker on a small backlog → confirm `batched` rows transition to `done` with non-leaked translations. Then trigger visuals → confirm 10-12 prompts with identical character descriptions across scenes. Confirm audio worker returns `paused:true`.
