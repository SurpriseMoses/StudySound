# BrainGrasp Referral Rewards & AI Reserve

## Inspection findings

**Reuse existing systems:**
- Authentication and signup profile creation; existing admin roles and protected admin pages.
- `profiles.credits_balance` as the only study-credit wallet, with `credit_transactions` as its ledger.
- `credit_purchases`, `subscriptions`, `payment_plan_codes`, and the existing Paystack checkout, verification and webhook handlers.
- Shared audio/translation assets, learner unlock records, document library, quiz bank and Gemini Batch queues.
- Existing admin API, Economy reporting, alerts and design components.

**Safety gaps found in source:**
- Payment claiming, wallet updating, ledger writing and subscription activation are separate operations. Concurrent payments can overwrite balances, and a claimed payment can lack its ledger entry.
- Generation and administrative wallet updates are spread across handlers; there is no unified source-allocation routine.
- No referral attribution, discount redemption, commission, withdrawal or refund/chargeback workflow was found.
- Packs and plans have different rand-to-credit ratios. The admin cost model's R1-per-credit figure is not a reliable reward conversion rule.
- Current AI reports are estimates. Provider-reported per-job usage/cost persistence was not found; estimates must not be presented as actual expenditure.

**Live inspection is blocked:** Lovable Cloud confirms the hosted database is paused. Stored migrations and generated types were inspected, but deployed schema, grants, routines, balances, provider configuration and runtime activity remain unverified. Resume the database before any schema or payment changes. No app behaviour has been changed during this assessment.

## Smallest safe migration approach

Use additive changes only, through the database migration tool, after comparing the live schema with existing migrations. Keep all balances, existing transactions, cached material and identifiers intact.

1. Extend existing purchase and credit transaction records with immutable quote, eligibility, event and accounting references. Add transactional wallet operations rather than a second wallet.
2. Add only missing logical records: programme settings, private referral attribution/events, immutable monetary commission entries, withdrawal requests, milestone awards, credit-source lots/allocations, AI usage/cost events and confirmed reserve funding records. Reuse equivalent deployed records if discovered.
3. Derive monthly/yearly summaries from those records; do not maintain a competing financial balance or duplicate financial ledger.
4. Give every new public table explicit grants and RLS. Learners may read only their own safe reward/activity records; monetary mutations and financial administration are server-controlled. Restrict audit, payout and reserve information to authorised administrators.
5. Keep the programme disabled until payment, fraud, conversion, payout disclosures and legal-review checks are complete. Disabled or unavailable services must show honest unavailable states, not sample balances.

## Phase 1 — Transactional foundation and referral payments

- Verify deployed schema, wallet routines, payment mode and webhook handling while the database is active.
- Replace relevant split wallet/payment mutations with atomic, idempotent operations; update all spending/grant/refund paths that affect credit-source accounting, preserving feature prices and existing entitlements.
- Create random, non-guessable referral codes and same-origin `/ref/:code` links on the configured BrainGrasp domain—not the example `.com` domain.
- Preserve a server-verifiable, expiring referral claim through registration, email verification, login and checkout. Browser storage may carry the claim but cannot authorise attribution. Bind each new account to at most one referrer; never overwrite attribution from a later link.
- Default attribution window: 30 days. No visit tracking without consent. Exclude existing accounts, self-referrals and detected duplicates; flag uncertain fraud cases for review. Avoid claiming that email-only checks eliminate duplicate identities.
- Store a server-calculated checkout quote: Essential R79 → R71.10; Premium R149 → R134.10. Consume the promotion only on the first qualifying confirmed subscription payment, never renewals.
- Verify Paystack's documented first-charge/renewal behaviour before changing checkout. A plan amount must not override the introductory price or leave renewals discounted. If supported, take the discounted initial payment and securely schedule the regular-price subscription using verified authorisation; otherwise leave this checkout unavailable pending a supported flow.
- Validate provider-confirmed reference, amount, currency, successful status, customer binding and test/live mode before qualification. Record events idempotently and handle out-of-order delivery.
- Award one commission per eligible referred subscriber: 5% of normal pre-discount price by default, R3.95/R7.45. Keep it separate from study credits; configurable basis and disclosed calculation.
- Add refund/chargeback processing with immutable reversals or offsets, including disputes received before a success event. Never delete financial entries or duplicate commission on renewal.

## Phase 2 — Milestones, withdrawals and learner experience

- Count legitimate lifetime successes separately from annual successes and annual awards. Use `Africa/Johannesburg` for calendar-year boundaries.
- Award R79 worth of credits at each unique 50-referral lifetime threshold, up to seven standard awards/R553 per year. Retain capped, unclaimed thresholds for later eligibility without awarding them twice; process eligible backlog consistently when annual eligibility is next evaluated. Keep lifetime totals intact.
- At 300 successes, award the sixth standard milestone when eligible plus one lifetime R149 Ambassador bonus and permanent badge. Preserve the badge at rollover; reversals remain auditable without undisclosed badge forfeiture.
- Require an explicit, administrator-confirmed reward conversion rate before issuing credits. Preserve earned-but-unissued awards while conversion is missing; never silently assume R1 equals one credit.
- Lock milestone qualification and wallet issuance together, recording threshold, year, award source/value/credits/expiry and wallet reference. Handle multiple thresholds and simultaneous confirmations.
- Permit withdrawal requests only when at least R50 is available. Atomically reserve requested funds, prevent overlap, release on rejection, and prevent refund offsets from creating spendable money.
- Provide an admin-controlled requested → under review → approved → processing → paid/rejected workflow. Mark paid only after recorded payout confirmation. No automatic bank transfers.
- Store only necessary payout/identity information, encrypted server-side with restricted access and safe audit records. Keep requests disabled until identity requirements, payout method, processing time and fees are explicitly configured; do not invent these policies.
- Add **BrainGrasp Rewards** to the learner dashboard/navigation: referral link, copy/native sharing and supported social actions, masked activity, lifetime/year totals, milestone and Ambassador progress, annual allowance, commissions by state, withdrawals and reward-credit history.
- Use the requested “Learn together. Grow together. Earn rewards.” heading and invitation copy. Do not expose referred learners' subscription, payment or study details.
- Add accessible draft referral terms covering all requested rules, anti-fraud, reversals, changes and suspension without retroactive forfeiture. Require South African legal/privacy/tax/payment review, including participation and payout rules for minors, before activation.

## Phase 3 — Source accounting and AI reserve

- Extend the existing wallet ledger with subscription, top-up, milestone, Ambassador and other award sources. Allocate oldest eligible credits first unless the verified wallet already documents another rule. Configure and disclose the chosen rule.
- Reconcile legacy balances before source migration. Do not manufacture a historical source breakdown; preserve unknown legacy balances as explicitly unreconciled where provenance cannot be established.
- Link every debit/refund to source allocations and feature operations. Preserve expiry rules without allowing lazy free-credit expiry to erase unrelated purchased/referral credits.
- Capture provider/model, operation, document/job, cache status, retries, status, measured usage, reported cost and separately estimated cost. Reconcile batch-level usage without double-counting items or multiple funded operations.
- Cache reuse records no new provider cost unless a billable call really occurred. Keep failed/retried calls auditable; no silent extra learner deductions.
- Add **Referral Rewards & AI Reserve** to existing admin navigation/API with monthly/yearly reward issuance, commission liabilities, source spend, cache/generation mix, providers/features, outstanding credits, pending jobs and reserve shortfall.
- Calculate forecast reserve from attributed used costs, expected redemption of outstanding credits, seeded/unseeded mix, queued work and a configurable safety margin. Display assumption versions, rates, observation periods and missing data alongside estimates.
- Keep allocated reserve, confirmed provider funding, provider-reported expenditure and provider account balance distinct. Support manual reconciliation where authorised provider usage/balance APIs are unavailable. Confirming a manual funding entry does not itself transfer money.
- Add budgets, reserve targets, thresholds, quotas, upload/document limits, concurrency and bounded retry settings. Preserve existing providers/models and cache-first behaviour.
- Gate all applicable interactive, batch, scheduled and admin generation entry points with shared budget state. Pause or queue nonessential new work according to settings while keeping cached replay available. Explicit policy decisions are needed for freshness/queue changes.
- Surface insufficient funding, budget risk, unusual unseeded activity, abuse and unreconciled provider usage. Existing provider access denials remain terminal; do not retry blocked Gemini jobs to test reserve reporting.

## Phase 4 — Verification and delivery

Use test fixtures and Paystack test transactions only; never seed production referrals, commissions, costs or funding.

- Concrete tests for R71.10/R134.10 discounts and R3.95/R7.45 commissions; first payment vs renewal; duplicate/out-of-order webhooks and refund/chargeback offsets.
- Fraud/self-referral/duplicate-attribution and private-data access tests.
- Database concurrency tests for simultaneous payments, R50 minimum, overlapping withdrawals, rejection/release and administrator transitions.
- Milestone tests at 50/100/150/300/higher thresholds, seven-award cap, multi-threshold processing, January rollover, retained lifetime totals and once-only Ambassador issuance.
- Wallet source/expiry/refund reconciliation and cached/new-generation accounting tests; retries and failed jobs must not duplicate costs or charges.
- Reserve assumption, budget/shortfall alert and shared generation-pause tests.
- Signed-in learner and admin end-to-end flows, with real test-payment confirmation, read-back through the UI, and mobile/desktop layout checks.
- Deliver a phase-by-phase summary, applied migrations/security policies, secrets needed, verified payment/manual payout status, tests/results, external setup/legal requirements and unverified risks. Never label operational payment/payout/generation behaviour verified from source alone.

## External dependencies and activation gates

- **Now:** Resume Lovable Cloud for live inspection, migrations and signed-in verification.
- **Payments:** Confirm existing Paystack configuration and a supported discounted-first-charge/full-price-renewal flow using test payments; leave production keys and payment paths intact.
- **Credits:** Administrator approval of the reward conversion rule; existing pack/plan rates differ.
- **Payouts:** Approved payout/identity handling, disclosed fees/time and secure encryption configuration. Start with manual reviewed payouts, not automatic transfers.
- **AI:** Obtain authorised provider usage/pricing evidence or explicit manual reconciliation. Gemini billing/access restoration is needed for generation verification, not for cached access.
- **Launch:** Legal review and explicit administrator activation after financial and security tests pass.