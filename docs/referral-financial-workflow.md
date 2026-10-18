# Referral financial workflow — 18 October 2026

## Delivered, not activated

Migrations 0018–0019 add private first-payment commission records, linked full reversals, withdrawal requests, commission allocations, review events and completed-payout confirmations. Every table has explicit grants and admin-only row-level read access; direct learner and anonymous writes are denied. Learners receive only their own aggregate balances and withdrawal status through authenticated summary operations.

The commission table is a foundation, not an active payment integration. No accrual operation is connected, and no production commissions, referrals, withdrawals, payouts or funding fixtures were created. Existing study-credit balances and generation/payment behaviour are unchanged.

## Withdrawal controls

- R50 minimum, integer cents, sufficient available commission, no overlapping open requests.
- Profile lock serialises requests and review operations; eligible commission allocations use oldest available first. Reusing the same request key returns the original result; changed details are rejected.
- Requested → under review → approved → processing → paid. Rejection before processing releases unreversed reserved earnings without deleting allocations or history.
- Processing requests cannot be generically rejected: a transfer may already have happened. A securely verified failed-transfer reconciliation path is still needed before releasing such funds.
- Approval/processing/payment require administrator confirmation of securely verified identity and payout destination. No bank details are collected in this log. Secure identity collection, retention and payout-provider workflows are external setup, not implemented here.
- Paid requires matching amount, past finite transfer date, unique transfer reference, evidence and confirmation that the transfer already completed. It records a manual outcome; it does not move money.
- Reversal after payout creates a visible recovery liability offset by later earnings, never a negative spendable balance. Refund/chargeback ingestion and partial reversal handling are not connected yet.
- Programme/payment/legal/cost approval gates remain enforced. Rejection remains possible while disabled to avoid trapping pre-processing reservations.

## Verification

Complete project test suite: **77 passed**, including isolated financial transaction and concurrency tests; preview build clean with no observed browser runtime errors.

All migrations applied to a disposable localhost database with minimal test dependencies. Synthetic data stayed there. Actual withdrawal operations verified concurrent competing requests, concurrent duplicate-key retries, conflicting retries, R50 validation, invalid/skipped transitions, rejection restoring available earnings, confirmed payout replay, immutable payout count, paid commission reversal and unchanged study wallet.

The existing reserve-funding transaction test also passed in this isolated database: confirmation/replay/conflicting references/reversal/net-funded reconciliation/audit count and unchanged wallet. This verifies database behaviour, not a real provider transfer or funded provider account.

Hosted checks verify financial-table grants/RLS, no direct learner writes, no anonymous financial access, no arbitrary-account totals operation, R49.99 rejection, disabled R50 rejection, zero financial records and zero active programme settings. Browser checks cover signed-in learner balances, admin review, phone overflow and signed-out admin redirection. Successful production payout/payment flow is deliberately not claimed.

## Remaining activation blockers

1. Atomic provider-verified payment posting, exact amount/currency/reference/customer/environment binding, discounted first charge and consented regular-price renewal flow; sandbox tests before commission accrual.
2. Refund/chargeback reconciliation and duplicate-account/fraud qualification; no manual creation of fictitious commissions.
3. Explicit administrator reward conversion and evidence-based cost approval; verified provider costs, source-linked debits, real paid cohorts, outstanding liability and reserve coverage remain missing.
4. Atomic milestone/Ambassador award records and wallet/source integration, annual caps, rollover and expiry validation.
5. Operational budget/usage limits, pending-job/retry reconciliation and cached-content preservation.
6. Legal/privacy/tax/payment review, secure payout identity workflow, fees/timings and genuine confirmed reserve funding.

No new secrets are required for the installed private workflow. Existing payment/provider secrets are unchanged. Rewards, payouts and referral invitations stay disabled.

## Invitation phase — 18 October 2026

Migration 0020 strengthens authenticated claim binding: email verification is required, profile and claim locks prevent competing attribution, the same consumed claim replays idempotently, and existing accounts/customers, self-referrals and expired/used claims remain ineligible. Owner summaries now return a non-identifying activity label rather than a fragment of a private attribution ID; private reason codes are omitted.

`/ref/:code` now opens a genuine invitation page. The code-only public `referral-invitation` function delegates claim creation to the existing service-only routine and returns only status, opaque token and server expiry. It cannot qualify a referral, create a commission or issue credits. Missing/disabled settings return disabled without creating claims. Strict request validation, a small accepted body and no-store responses are enforced; gateway abuse protection and an explicit claim-creation rate policy still require review before public activation.

The first valid invitation is stored locally with the server's unchanged expiry. Reloading cannot extend the window. A central authenticated binder covers signup, verification returns and later sign-in, including the separate onboarding signup path, without editing auth lifecycle triggers. Pending profile/verification checks retain the claim with bounded retries; terminal outcomes clear it. Email and Google returns from the Auth page now use its public same-origin sign-in URL. Storage is never treated as authoritative eligibility. Cross-device verification does not carry the browser's stored claim; returning to the original browser within the window is required. Signup/provider settings and an active hosted signup-to-attribution flow were not verified in this phase.

Verification: **91 project tests passed**, none skipped, including eleven new isolated database tests and three invitation-storage tests. Synthetic referrals stayed in a disposable local database; no hosted referrals, earnings, funding or wallet changes were created. Browser checks verified inactive anonymous links, invalid links, create-account tab selection, existing-account rejection, disabled sharing and phone layout without overflow; no runtime errors observed and preview build clean. The active capture/bind transaction was tested locally, not by enabling the hosted programme.

Remaining work is unchanged: verified sandbox payment posting and renewal consent, refund/fraud reconciliation, approved conversion and measured cost model, atomic milestone/source-ledger integration, generation budget controls, genuine reserve evidence and legal/payout review. No additional secrets or prices/allowances changes were introduced.

## Live activation request — 18 October 2026

Live activation was requested, but it has not been performed. The hosted programme settings query returned no rows: no reward conversion, payment-flow verification, legal confirmation or cost-model approval is recorded. A request to activate does not supply these missing facts or choose a credit conversion.

The existing Paystack integration and its legacy-named secret are present. Secret presence does not establish whether the provider account is in test or live mode, whether its credentials work, or whether checkout and callbacks have been verified. No new provider was connected and no charge was initiated.

Source inspection identified concrete payment blockers:

- Callback and webhook success handling do not compare provider-confirmed amount, currency, customer, reference and environment with the expected purchase before granting credits.
- The purchase is marked credited before separate wallet, subscription and ledger writes finish. Partial failure can leave a payment marked credited without its credits, and concurrent purchases can overwrite balance updates. A locked, atomic posting operation is required.
- Subscription-event handling has an unsafe latest-successful-purchase fallback that does not bind that purchase to the incoming customer. It must not be used to select an account.
- No payment-specific tests or verified test-provider end-to-end evidence were found. Discounted first payment, full-price renewal consent, refunds and chargebacks remain unverified.
- Commission qualification and atomic milestone/source-ledger awards are not connected. Enabling a setting cannot create these missing operations.

Next implementation priority is atomic verified payment posting shared by the callback and webhook, with mismatch, duplicate, concurrency and rollback tests in a disposable database, followed by provider test checkout. Live testing must follow—not replace—these checks and the outstanding reward conversion, cost/reserve and legal approvals. Existing prices, balances, settings and credentials were not changed during this review.

## Payment-crediting fix — 18 October 2026

Migration 0021 adds checkout-bound email, credential environment and plan expectations, unique provider-payment identity, and a link to the existing credit transaction. `payment_post_verified` is executable only by the trusted server. Both the checkout return and signed webhook verify with Paystack, validate its returned identity/amount/currency/customer/environment/date, and call this one routine. The purchase and wallet are locked; ledger, additive wallet update, paid subscription and successful purchase commit together or roll back together. No new wallet or accounting currency is introduced.

New checkouts store authenticated email and server-selected expectations, and restrict returns to the requesting app's `/payment/callback`. Existing unbound pending purchases are deliberately not guessed or backfilled: they require reconciliation. Provider payloads retained by the posting routine are minimal verified evidence, not payment authorization data. Direct learner updates to wallet, plan and free-credit expiry fields are blocked while existing editable profile fields remain available.

Known-customer renewals use a previously posted payment, its matching email/environment and the server plan mapping, not client metadata or a latest-unrelated-payment fallback. Fresh renewal creation and posting share a reference lock; full-price checks remain R79/110 and R149/220. Older paid events cannot move a subscription's paid-through date backwards. Subscription lifecycle notifications alone do not activate plans or grant credits. Discounted first-charge checkout, explicit regular-price renewal consent, refund/chargeback ingestion and lifecycle-event reconciliation remain separate unfinished work.

Verification: **108 tests passed**, none skipped, with financial test files run sequentially because they share the disposable database's singleton programme settings. New tests cover provider-evidence failures, preserved prices/allowances, checkout origin, duplicate callbacks, competing purchases, duplicate provider identity, invalid subscription rollback across wallet/ledger/purchase, trusted-customer renewal/full-price enforcement, older-event period protection, legacy rejection, posting permissions and zero referral commission creation. Production financial access tests are read-only; all payment mutations used localhost fixtures and the actual migration.

All four updated Paystack functions were deployed. The authenticated top-up page loaded, and an unknown payment reference returned “Payment not confirmed” with a warning not to pay again; no browser runtime errors were observed. A successful Paystack test checkout and UI balance readback have **not** been verified. No real charge was initiated, no hosted wallet/purchase fixture was created, and no referral settings or approvals were enabled. No additional secret is required. Genuine test-provider verification, discounted renewal consent, refund reconciliation, milestone/source accounting and the existing financial/legal approvals remain launch blockers.