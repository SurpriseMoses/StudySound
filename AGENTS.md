# Architecture rules

- Keep pure referral pricing, milestone eligibility and reserve forecast calculations in `supabase/functions/_shared/referral-rules.ts`; shared server rules allow concrete tests without making client calculations authoritative.
- Referral rule outputs are quotes/candidates only; persistent attribution, financial eligibility, idempotency, reservations and wallet changes require authenticated atomic database operations before activation.
- Reuse the existing profile wallet and payment/credit ledgers; separate monetary commission records from educational credit accounting to avoid duplicate currencies or competing balances.