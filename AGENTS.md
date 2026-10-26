# Architecture rules

- Keep pure referral pricing, milestone eligibility and reserve forecast calculations in `supabase/functions/_shared/referral-rules.ts`; shared server rules allow concrete tests without making client calculations authoritative.
- Referral rule outputs are quotes/candidates only; persistent attribution, financial eligibility, idempotency, reservations and wallet changes require authenticated atomic database operations before activation.
- Reuse the existing profile wallet and payment/credit ledgers; separate monetary commission records from educational credit accounting to avoid duplicate currencies or competing balances.
- Post Paystack purchases through one service-only atomic database routine using provider-verified evidence and checkout-bound expectations; purchase/profile locks and unique payment/ledger links prevent partial or duplicate crediting, and unbound legacy checkouts require reconciliation.
- Keep pure credit-lot and operation-cost allocation rules in `supabase/functions/_shared/credit-source-rules.ts`; execute plans only inside locked wallet transactions and preserve provider cost totals with integer-unit allocation.
- Expose learner referral activity only through owner-scoped summary RPCs, never direct attribution reads; private attribution identifiers and referred-account data must not reach the learner client.
- Treat missing referral settings as disabled and keep the programme unavailable until reviewed activation gates are met; learner pages must report missing financial infrastructure rather than fabricate monetary balances.
- Configure referral conversion only through an admin-validated audited RPC; configuration is not activation, credit issuance, payout or provider funding.
- Route narration only to voices confirmed present in the provider's published voice list, and report a language as unsupported instead of silently substituting another accent; assumed locale support produces failed or accent-inaccurate lessons.
- Capture provider-returned usage with request-scoped passive observers in `_shared/ai-cost-audit.ts`; never infer actual costs from tokens, alter generation requests or add a second wallet, and keep missing transaction attribution explicit.
- Keep scenario calculations in `src/lib/reward-cost-model.ts` non-authoritative; database constraints and audited admin approval enforce the referral cost safety gate independently of conversion configuration.
- Record reserve funding through admin-authenticated atomic RPCs with stable transfer references; retain originals and linked reversals so corrections cannot duplicate funding or silently erase audit history.
- Keep monetary commissions private and separate from the credit wallet; withdrawal RPCs lock the profile, allocate existing eligible commissions, and retain rejected reservations and payout evidence for reconciliation.
- Treat processing payouts as unresolved until confirmed; never release a potentially transferred reservation through a generic rejection, and never connect commission accrual before atomic provider-verified payment posting exists.
- Run synthetic financial mutations only in a disposable local database bootstrapped with test dependencies and the actual migrations; keep hosted access checks read-only to prevent fabricated production earnings or funding.
- Capture invitations through a public code-only edge endpoint and bind opaque expiring claims centrally after authentication; browser storage is convenience only, while verified new-account eligibility, one-referrer identity and replay handling remain database-authoritative.
- Lesson videos: admins upload finished videos (e.g. MagicLight) per book; they play free in Story Mode for signed-in learners. Files are private and opened with short-lived signed links.
