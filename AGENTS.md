# Architecture rules

- Keep pure referral pricing, milestone eligibility and reserve forecast calculations in `supabase/functions/_shared/referral-rules.ts`; shared server rules allow concrete tests without making client calculations authoritative.
- Referral rule outputs are quotes/candidates only; persistent attribution, financial eligibility, idempotency, reservations and wallet changes require authenticated atomic database operations before activation.
- Reuse the existing profile wallet and payment/credit ledgers; separate monetary commission records from educational credit accounting to avoid duplicate currencies or competing balances.
- Keep pure credit-lot and operation-cost allocation rules in `supabase/functions/_shared/credit-source-rules.ts`; execute plans only inside locked wallet transactions and preserve provider cost totals with integer-unit allocation.
- Expose learner referral activity only through owner-scoped summary RPCs, never direct attribution reads; private attribution identifiers and referred-account data must not reach the learner client.
- Treat missing referral settings as disabled and keep the programme unavailable until reviewed activation gates are met; learner pages must report missing financial infrastructure rather than fabricate monetary balances.