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