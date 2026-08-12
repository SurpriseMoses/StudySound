# StudySound

StudySound is an AI learning companion for African high-school students. It turns curriculum textbooks and uploaded study material into audio lessons, translations, visual story scenes and quizzes — designed mobile-first for low-data, low-bandwidth conditions.

## What it does

- **Listen** — textbook sections narrated as audio lessons (ElevenLabs / Gemini TTS), cached and shared so repeat plays are free.
- **Translate** — lessons translated into South African languages, including isiZulu, isiXhosa, Sesotho, Setswana, Afrikaans, Xitsonga, **Tshivenda** and **isiNdebele**.
- **Visual scenes** — Gemini-generated illustrations with character consistency via per-book "Visual Bibles".
- **Quizzes** — AI-generated multiple-choice questions per lesson, cached per document.
- **Upload your own** — PDFs and notes are extracted, cleaned, chunked and made playable.
- **Progression** — XP, levels, streaks, daily rewards and credit-based usage limits.
- **Offline-friendly** — PWA caching with IndexedDB for studying without data.

## Curriculum library

A CAPS-aligned library is ingested from official public sources (DBE workbooks for Grades 8–9, Siyavula and DBE CAPS PDFs for Grades 10–12) covering Maths, Maths Literacy, Physical Sciences, Life Sciences, Languages, Life Orientation and more. Content is extracted, cleaned of site chrome/boilerplate, structured into chapters, chunked and embedded for semantic search.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, Vite 5, TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query |
| Backend | Lovable Cloud (Supabase): Postgres + RLS, Auth, Storage, Edge Functions |
| AI | Lovable AI Gateway (Gemini, OpenAI embeddings), Gemini Batch API, ElevenLabs TTS |
| Payments | Flutterwave |
| Search | pgvector embeddings (`text-embedding-3-small`) with HNSW index |

## Project structure

```text
src/
  pages/            App routes (Listen, Quiz, Subjects, Library, Plans, Profile…)
  pages/admin/      Admin console (ingestion, pipeline, economy, users, seeding)
  components/       UI + feature components (audio, translation, story mode, landing)
  contexts/         Auth, progression, daily rewards
  hooks/ lib/       Shared hooks, subjects, pricing and progression logic
  integrations/     Generated backend client and types
supabase/
  functions/        Edge functions (see below)
  functions/_shared/ Crawling, cleaning, Gemini batch and translation helpers
```

### Key edge functions

- **Ingestion** — `run-grade-ingestion`, `ingestion-orchestrator`, `ingestion-worker`, `batch-ingestion-submit`, `batch-ingestion-poll`, `batch-reclean-submit`, `backfill-pipeline`, `caps-source-sync`
- **Content generation** — `generate-audio`, `generate-translation`, `generate-visuals`, `generate-visual-prompts`, `generate-quiz`, `extract-document`
- **Search & indexing** — `embed-drain`, `seed-curriculum`
- **Seeding queues** — `seed-audio-assets`, `seed-queue-manager/worker`, `seed-translation-manager/worker`
- **Gamification & admin** — `award-xp`, `claim-daily-reward`, `unlock-scene`, `admin-api`

Translations and audio are **never auto-queued** — they are triggered manually from the admin console to control cost.

## Ingestion pipeline

```text
source URL → crawl/fetch (Firecrawl fallback, Gemini PDF OCR)
           → clean (strip nav, footers, licence boilerplate)
           → structure (chapters/sections via Gemini Batch)
           → chunk → embed (pgvector) → publish
```

Grade sweeps run one grade at a time from the admin **Grade Sweep** panel, with per-stage batch state, progress, reports and retry/stop controls.

## Local development

```sh
npm i
npm run dev      # http://localhost:8080
npm run build
npm run lint
npm run test
```

Backend environment variables are managed by Lovable Cloud and generated into `.env`; secrets for AI and payment providers live in backend secrets, never in client code.

## Design system

Mobile-first and low-data by default. Teal and coral palette, Space Grotesk headings with DM Sans body. All colours, gradients and shadows are semantic tokens in `src/index.css` and `tailwind.config.ts` — components never hardcode colour utilities.

## Admin console

Available to users with the `admin` role (roles are stored in a dedicated `user_roles` table and checked server-side via a security-definer function). Includes ingestion and pipeline monitoring, library health summary, document management, visuals, seeding queues, economy/pricing, abuse and error dashboards.
