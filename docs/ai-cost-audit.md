# BrainGrasp — AI Cost Audit and Referral Safety Review

Observation: 18 October 2026 UTC. This is an audit and an initial measurement foundation, **not a validated profitability model**. Rewards and monetary payouts remain disabled. No paid generation, provider top-up, reward award, conversion confirmation or balance adjustment was performed for this audit.

## Decision

Do not approve referral credit issuance yet. There are no successful paid subscription records in the inspected payment ledger and no invoice-reconciled, credit-linked generation cost records. An affordable-looking reward illustration is not proof that the subscribers' own generation usage leaves a contribution margin to fund it.

The admin review now separates provider evidence, unknown amounts, hypothetical cohorts, promotional conversion, required reserve and confirmed funding. Missing costs never become zero. Its cost-model approval is separate from conversion and activation; the database blocks premature approval and activation without cost approval.

## Preserved credit economy

| Offer | Price | Credits | Effective ZAR per credit | Meaning |
|---|---:|---:|---:|---|
| Essential | R79/month | 110 | R0.7182 | Subscription bundle |
| Premium | R149/month | 220 | R0.6773 | Subscription bundle |
| Small top-up | R50 | 40 | R1.2500 | Standalone purchase |
| Medium top-up | R100 | 100 + 10 bonus | R0.9091 | Standalone purchase incl. bonus |
| Large top-up | R200 | 220 | R0.9091 | Standalone purchase |

There is **no authoritative promotional rand-to-credit conversion** configured. The legacy R1-per-credit accounting constant and R0.58 operating-cost constant are not measured costs or promotional policy. Subscription bundle pricing does not establish a retail conversion.

Sources: `src/lib/plans.ts`, `src/lib/credit-packs.ts`, `src/lib/admin-pricing.ts`, existing shared server offer files and live referral settings. Prices, 110/220 allowances, wallet values, expiry and deduction behaviour were not changed.

### Deduction and expiry risks

- Audio targets roughly 1,800 characters per credit; sentence boundaries and merging invalid chunks mean this is not a hard cost bound. A learner unlock can cost credits even when a global asset is reused. Already-unlocked replay is distinct from a first cached unlock.
- Translation charges two credits per unlocked chunk, including cached unlocks. The handler writes `action_type: audio` to historical usage, making feature-level historical attribution unreliable.
- Quiz bank presets: 5 questions/1 credit, 10/2, 20/4, 50/10, 100/20. Bank generation and learner bank use are separate operations.
- Free-credit expiry can reset a free learner's entire wallet, including potentially purchased/promotional credits after downgrade. Source-aware protected expiry is a prerequisite for awards, not implemented by this audit.
- Audio deduction can occur before upstream generation. Some writes and refunds are not one atomic operation. Provider failure does not prove a wallet refund or a provider refund. These behaviours were left unchanged as requested and remain launch risks.
- Existing `credit_transactions` is the intended accounting ledger, not a new wallet. No rows existed at the baseline. `user_usage` cannot be treated as a reconciled financial ledger.

## Production source inventory

URLs below describe providers, not customer backend credentials; query strings and keys are never saved in evidence.

| Operation | Provider and exact model / service | Endpoint and billing route | Units and reuse |
|---|---|---|---|
| Interactive audio | Google `gemini-2.5-flash-preview-tts` | `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent` online | Text input and audio output tokens; selected English literature; global `audio_assets` reuse |
| Interactive audio | Azure Speech configured neural voice names | `https://southafricanorth.tts.speech.microsoft.com/cognitiveservices/v1` (configured region) | Billable characters depend on provider/account rules; SSML submitted; MP3 storage |
| Interactive/fallback audio | ElevenLabs `eleven_multilingual_v2` | `https://api.elevenlabs.io/v1/text-to-speech/{voice}` online | Account/model-specific character credits; MP3 output; same global assets |
| Live translation | Google `gemini-2.5-flash` | Google `:generateContent` online | Input/output/thinking/cache units; optional one-hour context cache; source/version/global translation asset reuse |
| Translation fallback | Lovable `google/gemini-3-flash-preview` | `https://ai.gateway.lovable.dev/v1/chat/completions` | Gateway units/charges are distinct from Google's direct API price |
| Translation fallback | Azure Translator text service | `https://api.cognitive.microsofttranslator.com/translate` | Characters; exact subscription/region quote unverified |
| Legacy generated quiz | Lovable `google/gemini-3-flash-preview` | Gateway `/v1/chat/completions` | Six questions from up to 8,000 source characters; per-document/difficulty `quiz_assets` cache |
| Quiz bank seeding | Job/settings-selected model, fallback `gemini-2.5-flash` | Google `:batchGenerateContent`, batch poll | Per-section structured outputs; drafts, not automatically published; global bank reuse |
| Image scene planning | Lovable `google/gemini-3-flash-preview` | Gateway `/v1/chat/completions` | Text units; 10–12 scene plans |
| Image generation | Lovable `google/gemini-3.1-flash-image-preview` | Gateway `/v1/chat/completions` | Image/text modality units; global `image_assets`; image resolution affects cost |
| Visual prompts / translation blueprints | Google `gemini-2.5-flash` | Google Batch | Blueprint source sample up to 60,000 chars; output target 5,000–7,000 chars, cap 8,192 output tokens; global reuse |
| Uploaded document extraction | Local `unpdf`, `mammoth`, text decoding | No external model in `extract-document` | File bytes/page count/local compute; content-hash document deduplication; dedup does not avoid initial extraction |
| Library PDF/OCR | Google `gemini-2.5-flash` | Google Files upload then `:generateContent` | PDF modality units; page slices where needed; file upload/control is not a generation cost itself |
| Library fallback scraping | Firecrawl scrape, no model specified | `https://api.firecrawl.dev/v2/scrape` | Page/provider credits; PDF parser rules may add units |
| Ingestion classification/cleaning | Lovable `google/gemini-2.5-flash` and local heuristics | Gateway `/v1/chat/completions` where used | Text tokens; tagging sample 4,000 chars; local stages have no model bill |
| Batch ingestion/reclean | Google `gemini-2.5-flash` | Google Batch | Per-result units; reclean invalidates assets and may cause later regeneration |
| Embeddings | Lovable `openai/text-embedding-3-small` | Gateway `/v1/embeddings` | Input tokens; ingestion chunks 1,200 chars/150 overlap/batch 32; backfill 1,800 chars; drain batches 8, parallel 4 |
| Audio seeding | Google TTS above / Azure `en-GB-LibbyNeural`, `en-GB-RyanNeural` as configured | Online, not TTS Batch | Legacy seed target 700 chars; queue target 1,800; global storage reuse |
| Translation seeding | Google `gemini-2.5-flash` | Batch | 700-char target, up to 200 requests/batch and 8 in-flight batches |

Inspecting code establishes configured paths, not which provider served every historical asset. Some comments claim Gemini narration is free under a Lovable key; the actual seed call is Google-direct with the configured Google key. Such comments are not billing evidence. Voice fallback risks also remain; this audit did not change narration routing.

### Retry and failure exposure

- Live Gemini TTS: up to three attempts with existing delays of 0, 1.5 and 4 seconds for retryable responses. ElevenLabs concurrency 429s can lead to up to four attempts. Azure fallback voice/provider calls can multiply attempts.
- Queue audio: capped three attempts per chunk, Azure concurrency four / Gemini one; existing 90-second Gemini and 45-second Azure timeouts. Legacy Azure seed allows four attempts on 429/5xx.
- Translation: context-cache errors can cause a noncached repeat; English-residue detection can cause line-by-line calls. Token limits alone do not cap the number of calls.
- Translation Batch: up to six row attempts, stale reclaim at roughly 26 hours. A re-submission is a distinct potentially billable generation, not a duplicate record of the old batch.
- Embedding drain: three attempts and existing 25-second timeout; current catch-and-retry logic is broader than transient statuses.
- Concurrent cache misses, force-regeneration, recleaning, unusable responses and storage failures after provider success can consume paid work without a usable result.
- Timeout/abort or HTTP failure **does not establish zero provider cost**. Usage and cost remain unknown until returned or reconciled. Retry policies were preserved, not endorsed as safe.

## Current official pricing evidence

Checked 18 October 2026. USD list prices, **not account invoices, measured cost per generation, FX-confirmed ZAR charges or Lovable Gateway prices**.

| Direct Google model / modality | Online input / output per million tokens | Batch input / output |
|---|---|---|
| `gemini-2.5-flash-preview-tts`: text / audio | $0.50 / $10.00 | $0.25 / $5.00 |
| `gemini-2.5-flash`: text/image/video input, output incl. thinking | $0.30 / $2.50 | $0.15 / $1.25 |
| `gemini-2.5-flash`: audio input | $1.00 input | $0.50 input |
| `gemini-3-flash-preview`: text/image/video input, output incl. thinking | $0.50 / $3.00 | $0.25 / $1.50 |

2.5 Flash context caching: $0.03 per million cached text/image/video input tokens, $0.10 audio, plus $1 per million stored tokens per hour. These must not be omitted when a context cache is used. The official image page has resolution-dependent rows and preview/stable identifiers; applicability to BrainGrasp's exact gateway preview ID must be verified rather than inferred from a stable model row.

Google audio calls in BrainGrasp are online: the existence of a discounted Batch price does not give those calls a discount. No model or endpoint was switched.

Other prices remain **unverified for the configured customer account**:

- Azure Speech: region/voice/agreement dependent; do not use the legacy $16-per-million constant as a reconciled account charge.
- Azure Translator: Microsoft sample S1 $10/million chars and F0 two-million-char monthly allowance are published examples, not proof of this account's tier or remaining coverage.
- ElevenLabs: current API catalogue rates for newer models are not a valid quote for the configured `eleven_multilingual_v2` plan; need actual plan/invoice and returned usage.
- Firecrawl basic scraping uses provider credits per page; PDF parsing and account-plan pricing/overages require confirmation.
- OpenAI embeddings are routed through Lovable. A direct OpenAI unit price cannot establish a Gateway charge.
- South African Paystack merchant fees, fixed charges, settlement/tax treatment and actual discounted-first-payment/renewal behaviour need verified merchant evidence. No Nigeria fee rates were substituted.

References: [Google](https://ai.google.dev/gemini-api/docs/pricing), [Azure Speech](https://azure.microsoft.com/en-us/pricing/details/speech/), [Azure Translator](https://azure.microsoft.com/en-us/pricing/details/translator/), [Microsoft sample](https://learn.microsoft.com/en-us/samples/azure/azure-quickstart-templates/cognitive-services-translate/), [ElevenLabs](https://elevenlabs.io/pricing/api), [Firecrawl](https://www.firecrawl.dev/pricing), [OpenAI](https://openai.com/api/pricing/).

## Actual evidence available

At baseline: three free profiles; five pending purchase records (four top-ups quoting R400 total and one R79 subscription); zero successfully credited paid subscriptions; zero credit-transaction rows; no referral settings row; no cost or confirmed reserve-funding records. Pending quoted payments are not collected revenue.

Historical `user_usage`: 602 rows labelled audio and 173 credits, from 23 April to 21 September 2026. These are not a paid subscriber sample; translation writes share the label, cache/new-generation status is missing, and costs are absent. No defensible average cost per audio credit can be calculated from them.

33 documents: clean-text lengths 97,619 to 1,096,508 characters, median 337,494. These are existing library/source sizes, **not representative newly uploaded paid subscriber documents**. TTS targets and quiz excerpts above are configured workload sizes, not empirical percentile estimates.

The project billing snapshot recorded 185.509503226 requested Lovable credits over its 30-day lookup, largely building/database usage. It cannot supply Google/Azure/ElevenLabs per-job spend, cash paid or per-subscriber variable hosting cost. Allocated database capacity is not automatically marginal cost per learner. Storage/egress bytes, cache rate and provider billing allocations were not measured per successful generation.

Verification then replayed one **existing cached audio asset as an administrator**: success, source `cached`, zero credits charged, no new provider call. One genuine cache-observation row was read back in the admin evidence RPC. It is a technical observation, not paid-cohort cost evidence.

## Instrumentation shipped and its boundaries

- Migration `0013_ai_cost_evidence_safety_gate.sql`: `ai_generation_cost_events`, confirmed reserve-funding evidence, cost-review settings, approval invalidation on conversion/safety-margin change, guarded admin evidence/approval RPCs. Explicit grants and admin-only read policies; service role writes; no learner ledger exposure.
- Passive request-scoped observer captures provider/model/sanitised endpoint, document/user where resolved, unique job/attempt key, response outcome, HTTP status, request ID when returned and returned token/modality usage. Costs/refunds stay null when providers do not report them; it does not turn usage into an invented actual price.
- Hooked live audio, translation, quizzes, images, ingestion/deep crawl, backfill, embedding drain and audio seed paths. Selected batch pollers capture item results: translations, quiz bank, translation blueprints, visual prompts and ingestion/reclean. Stable provider batch + result position prevents repeated-poll cost duplication.
- Separate retry/fallback attempts have distinct keys so potentially billable attempts are not incorrectly collapsed. Upsert enriches the same response observation with returned usage. Accounting failure never replaces generation output.
- Cached live feature observations are separate from provider attempts and never receive invented generation costs. Context-cached input tokens are not equivalent to a full asset cache hit.
- No prompts, generated text/audio/image payloads, authentication headers or query keys are stored. No AI model, retry timing, output cap, expiry or wallet behaviour changed.

**Incomplete:** existing debit paths do not consistently write the credit ledger; automatic credit-transaction linkage therefore remains missing. No authoritative reward-source redemption allocation exists yet. Batch item outcomes describe the provider response, not final learner usability/storage success. Missing batch slots/top-level batch failures can still hide usage; legacy/nonhooked paths and HTTP bodies parsed as text may need further coverage. Exact cost, refund, invoice and reserve-funding reconciliation are not an automated provider-account integration or an admin funding-entry workflow. The new evidence schema supports these fields but does not fabricate them.

## Cohort contribution model

Admin tables show Essential, Premium and 50/50 mix for 50, 100 and 1,000 subscribers. They are **hypothetical first-payment scenarios**, not real collected revenue or net profit.

For premium share p and cohort N:

```
Normal subscription value = N × [79 × (1-p) + 149 × p]
Discounted collection scenario = normal value × 90%
One-time commission scenario = normal value × 5%
Included credits = N × [110 × (1-p) + 220 × p]
AI estimate = redeemed credits × [new share × new cost/credit
                                  + cached share × cached delivery cost/credit]
Fees = collection × entered percentage + N × entered fixed fee
Contribution = collection - commission - fees - AI estimate
               - entered other variable costs - estimated reward reserve
```

Unknown fees/costs/FX/conversion leave contribution unknown. Taxes and fixed costs are unmeasured and excluded; contribution is not net profit. Expected and 100%-new-generation stress scenarios use all included credits; unused-credit behaviour needs an observed redemption rate. Reward reserve is conservatively budgeted as a full new-generation liability, not just expected immediate spend.

First payments before any AI, fees or operating costs:

| N | Essential collection / commission | Premium collection / commission | 50/50 collection / commission |
|---:|---:|---:|---:|
| 50 | R3,555 / R197.50 | R6,705 / R372.50 | R5,130 / R285 |
| 100 | R7,110 / R395 | R13,410 / R745 | R10,260 / R570 |
| 1,000 | R71,100 / R3,950 | R134,100 / R7,450 | R102,600 / R5,700 |

These are calculated scenarios, not receipts. Assuming every cohort member is a new eligible referral is explicit. Renewals receive no referral discount/commission in this model. The safe discounted-first-payment plus normal-price-renewal flow remains unverified.

## Reward liability and reserve

Let c be **administrator-confirmed promotional credits per rand**, k the reviewed marginal new-generation ZAR cost per credit, and m the safety margin.

```
Standard award credits = 79c
Ambassador credits = 149c once per lifetime
Max standard annual credits = 7 × 79c = 553c
Maximum in an Ambassador award year = 702c
Stress annual marginal generation estimate = 702c × k
Stress reserve = 702c × k × (1+m)
```

No c or measured k has been approved. The admin calculator accepts an unsaved proposed c strictly for comparison; it is not conversion confirmation. At 50/100/1,000 referrals the scenario uses one referrer in one year, caps standard awards at 7, and includes the Ambassador at 300+. Distributing referrals across referrers can change aggregate awards; per-referrer caps must not be mistaken for a programme-wide cap.

Existing pure rules also model used attributable cost + estimated outstanding-credit redemption + queued jobs + safety margin, separately from funded reserve. Operational outstanding liability, source consumption, expected generation mix and pending-job cost are not yet reconciled. The admin annual scenario is a ceiling illustration using an entered cost assumption, **not an enforceable API maximum**: current retries, size variability and provider pricing prevent a guaranteed bound.

There are no confirmed funding records. Funded reserve is displayed Unknown rather than a provider balance of R0. Shortfall is unknown without funding evidence. A reserve record never proves a transfer to Google or a provider account balance. Do not average annual exposure over 12 months as a liquidity guarantee; credits can be redeemed in a single month.

## Safety gate and verification

Cost approval requires an authenticated server-validated administrator, confirmed conversion, recent provider-reported costs linked to credit transactions, successful credited subscription evidence and documented reviews of representative cohorts, source/expiry protection, fees/variable costs and reserve coverage. Conversion or saved safety-margin changes invalidate approval. Approval itself neither enables the programme nor issues credits/funds/payouts. Missing settings mean disabled.

Tests: **57 Vitest rules/offer/scenario/unit-extraction tests passed**, plus **6 offline Deno observer tests passed**: returned usage, unchanged outputs, failure isolation, cache/no-provider call, distinct retry keys, deterministic repeated-batch keys, concurrent request isolation and no query credential persistence. Test numbers are synthetic fixtures, never production costs.

Live checks: authenticated admin screen loaded; calculator accepted synthetic assumptions without saving; premature server approval rejected with `Confirmed conversion required`; signed-out admin route redirected to sign-in; existing cached audio returned success/zero charge and its observation read back; new tables' admin read policies and activation constraints inspected; latest application build passed. Fresh paid generation/provider invoice reconciliation was not exercised; authenticated ordinary paid-learner flow and nonadmin data access were not end-to-end tested because no representative paid cohort exists. No real rewards or monetary transactions were performed.

## Required next evidence before approval

1. Protect source-aware debits/expiry and attach every cost attempt/unlock to the existing ledger without changing prices. Correct unreliable feature attribution in a separately reviewed wallet change.
2. Observe a representative period (initial rolling 30 days, extend across billing cycles/peaks) with genuine Essential/Premium usage. Include upload size bands, languages/providers, cache/new mix, retries, failed jobs and unusually costly documents. Until enough samples exist, label distributions preliminary.
3. Reconcile returned units with exact model/route pricing and provider invoices or usage exports, FX/fees/taxes, merchant processing fees and measured variable delivery costs. Keep reported and estimated values separate. Resolve absent units/refunds instead of assuming zero.
4. Confirm actual first-payment/renewal collection with sandbox test payments, not quoted pending purchases. Assess per-plan expected and stress contribution before choosing c. No specific conversion is sustainable based on present evidence alone.
5. Configure audited reserve funding and liability/source reconciliation; reserve against issuance rather than anticipated future profits; include queued jobs and redemptions.
6. Review operation limits, repeated upload/cache-miss races and terminal failure retry chains in a separate authorised behaviour change. This audit deliberately did not change generation behaviour.
7. Obtain administrator conversion/cost approval and legal/payment/payout reviews; perform transactional concurrency/idempotency/access testing before any activation.

No new provider key is required for passive measurement: it reuses existing integrations and managed server credentials. Provider account reports/merchant settlement evidence and legal review remain external inputs. Approval is blocked until they and wallet/source reconciliation establish a defensible model.

## Measured narration durations (2026-10-18)

First real duration measurements of the seeded library; `audio_assets.duration_seconds` was previously NULL for every row and is now backfilled (migration `0014_backfill_audio_durations`).

Method: all 28 ElevenLabs MP3s were downloaded through short-lived admin-signed URLs (new admin-only `sign-audio-urls` function; signs only paths that exist in `audio_assets`, never generates audio or charges credits) and measured with ffprobe. All 263 Gemini WAVs are 24 kHz 16-bit mono PCM, so duration = (bytes − 44) / 48,000 exactly; this byte rate was verified against 7 independent ffprobe measurements (match to 0.001 s).

Results:

| Provider | Chunks | Avg chars | Avg duration | Range | Chars/sec | Sec per 1,000 chars | Total audio |
|---|---|---|---|---|---|---|---|
| Gemini (WAV) | 263 | 1,729 | 107.7 s | 55.9–154.7 s | 16.06 | 62.3 s | 7.87 h |
| ElevenLabs (MP3) | 28 | 1,777 | 122.2 s | 49.6–318.8 s | 14.21 | 70.4 s | 0.95 h |
| All | 291 | — | 109.1 s | — | 15.86 | 63.1 s | 8.82 h |

Standard chunk size confirmed at ~1,700–1,800 characters (one 4,089-char ElevenLabs outlier at 318.8 s). The earlier planning unit of "1 credit ≈ 1,000 characters" is conservative: a real chunk carries ~1,700+ characters per credit.

Cost implication (still an estimate from published prices, not provider-reported): at Gemini 2.5 Flash TTS $10/1M audio tokens (~25 tokens/sec) plus $0.50/1M text input, a measured 102 s / ~1,700-char chunk costs ~2,550 audio tokens ≈ $0.0255 + ~$0.0002 input ≈ **$0.026 ≈ R0.48 per chunk**, i.e. **~R0.28 per 1,000 characters** at R18.50/USD. This is ~4× lower than the earlier conservative planning figure (R1.12/chunk), which had assumed 6,000 audio tokens per 1,000 characters versus the measured ~1,530. ElevenLabs bills per character and was not cost-estimated here. These figures remain labelled estimates until provider-reported usage flows through the cost-events instrumentation; sample is English-only.