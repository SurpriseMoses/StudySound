import { describe, it, expect } from "vitest";
import postgres from "postgres";

const databaseUrl = process.env.SUPABASE_DB_URL;
describe.skipIf(!databaseUrl)("private withdrawal database access", () => {
  it("denies direct learner writes and anonymous RPC access on all financial tables", async () => {
    if (!databaseUrl) return;
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      const rows = await sql`select c.relname, c.relrowsecurity,
        has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') learner_write,
        has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') anonymous_access
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('referral_commissions','referral_commission_reversals','referral_withdrawals','referral_withdrawal_allocations','referral_withdrawal_events','referral_payout_confirmations')`;
      expect(rows).toHaveLength(6);
      for (const row of rows) expect(row).toMatchObject({ relrowsecurity: true, learner_write: false, anonymous_access: false });
      const [access] = await sql`select
        has_function_privilege('anon','public.referral_request_withdrawal(integer,uuid)','EXECUTE') anon_request,
        has_function_privilege('authenticated','public.referral_financial_totals(uuid)','EXECUTE') arbitrary_account_read,
        has_function_privilege('authenticated','public.referral_my_financials()','EXECUTE') owner_read,
        has_function_privilege('anon','public.referral_admin_withdrawals()','EXECUTE') anon_admin`;
      expect(access).toEqual({ anon_request: false, arbitrary_account_read: false, owner_read: true, anon_admin: false });
    } finally { await sql.end(); }
  });
});

// No fixtures are written to production. Mutation/concurrency testing is an
// explicit activation blocker until a dedicated sandbox database is provided.
describe.skipIf(!process.env.REFERRAL_TEST_DB_URL)("withdrawal transaction rejection rules", () => {
  it("requires authentication and rejects below-R50 requests without creating financial rows", async () => {
    const url = process.env.REFERRAL_TEST_DB_URL;
    if (!url) return;
    const sql = postgres(url, { max: 1, prepare: false });
    const rollback = new Error("rollback-only");
    try {
      await sql.begin(async tx => {
        const [account] = await tx`select user_id from public.profiles order by user_id limit 1`;
        if (!account) throw new Error("Sandbox account required");
        const before = await tx`select count(*)::integer count from public.referral_withdrawals`;
        await tx`select set_config('request.jwt.claim.sub','',true)`;
        await expect(tx.savepoint(async s => s`select public.referral_request_withdrawal(5000,gen_random_uuid())`)).rejects.toThrow("Authentication required");
        await tx`select set_config('request.jwt.claim.sub',${account.user_id},true)`;
        await expect(tx.savepoint(async s => s`select public.referral_request_withdrawal(4999,gen_random_uuid())`)).rejects.toThrow("Minimum withdrawal is R50");
        expect(await tx`select count(*)::integer count from public.referral_withdrawals`).toEqual(before);
        throw rollback;
      });
    } catch (e) { if (e !== rollback) throw e; }
    finally { await sql.end(); }
  });
});