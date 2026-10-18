import { describe, it, expect } from "vitest";
import postgres from "postgres";

// Every mutation is inside a transaction deliberately rolled back; never create
// fictitious funding in production. Full mutation tests require a dedicated
// test database whose connection has EXECUTE privileges for these RPCs.
const databaseUrl = process.env.SUPABASE_DB_URL;
describe.skipIf(!databaseUrl)("reserve funding access rules", () => {
  it("allows signed-in RPC access but forbids direct funding writes and anonymous access", async () => {
    if (!databaseUrl) return;
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      const [access] = await sql`select
        has_function_privilege('anon','public.referral_admin_record_funding(text,numeric,text,boolean)','EXECUTE') anon_write,
        has_function_privilege('authenticated','public.referral_admin_record_funding(text,numeric,text,boolean)','EXECUTE') auth_rpc,
        has_table_privilege('authenticated','public.ai_reward_reserve_funding','INSERT') direct_write,
        has_table_privilege('authenticated','public.ai_reward_reserve_reversals','DELETE') direct_delete`;
      expect(access).toEqual({ anon_write: false, auth_rpc: true, direct_write: false, direct_delete: false });
      const rows = await sql`select relrowsecurity from pg_class where oid in ('public.ai_reward_reserve_funding'::regclass,'public.ai_reward_reserve_reversals'::regclass)`;
      expect(rows).toHaveLength(2);
      expect(rows.every(row => row.relrowsecurity)).toBe(true);
    } finally { await sql.end(); }
  });
});
describe.skipIf(!process.env.REFERRAL_TEST_DB_URL)("reserve funding database rules", () => {
  it("requires admin confirmation, prevents duplicate funding and retains reversals without issuing rewards", async () => {
    const testUrl = process.env.REFERRAL_TEST_DB_URL;
    if (!testUrl) return;
    const sql = postgres(testUrl, { max: 1, prepare: false });
    const rollback = new Error("deliberate rollback");
    try {
      await sql.begin(async tx => {
        const [admin] = await tx`select user_id from public.user_roles where role='admin' order by user_id limit 1`;
        if (!admin) throw new Error("An admin account is required for database verification");
        const before = await tx`select id,credits_balance from public.profiles order by id`;
        const initial = await tx`select count(*)::int count from public.ai_reward_reserve_funding`;
        const denied = async (action: () => Promise<unknown>, message: string) => {
          let rejected = false;
          try { await tx.savepoint(async () => { await action(); }); }
          catch (error) { rejected = true; expect(String(error)).toContain(message); }
          expect(rejected).toBe(true);
        };
        await tx`select set_config('request.jwt.claim.sub','',true)`;
        await denied(() => tx`select public.referral_admin_funding_summary()`, "Administrator required");
        await tx`select set_config('request.jwt.claim.sub',${admin.user_id},true)`;
        await denied(() => tx`select public.referral_admin_record_funding('sandbox-unconfirmed',50,'sandbox receipt',false)`, "already completed");
        await denied(() => tx`select public.referral_admin_record_funding('sandbox-invalid',0,'sandbox receipt',true)`, "Positive ZAR");
        await denied(() => tx`select public.referral_admin_record_funding('sandbox-invalid',50.001,'sandbox receipt',true)`, "Positive ZAR");
        const reference = `rollback-only-${crypto.randomUUID()}`;
        const [created] = await tx`select public.referral_admin_record_funding(${reference},50,'rollback-only receipt',true) result`;
        expect(created.result.amount_zar).toBe(50);
        expect(created.result.replayed).toBe(false);
        const [replay] = await tx`select public.referral_admin_record_funding(${reference},50,'rollback-only receipt',true) result`;
        expect(replay.result.id).toBe(created.result.id);
        expect(replay.result.replayed).toBe(true);
        await denied(() => tx`select public.referral_admin_record_funding(${reference},100,'rollback-only receipt',true)`, "different details");
        const [funding] = await tx`select public.referral_admin_funding_summary() result`;
        const [evidence] = await tx`select public.referral_admin_cost_evidence() result`;
        expect(evidence.result.funded_reserve_zar).toBe(funding.result.net_funded_zar);
        const [reversed] = await tx`select public.referral_admin_reverse_funding(${created.result.id},'rollback-only correction') result`;
        expect(reversed.result.funding_id).toBe(created.result.id);
        const [second] = await tx`select public.referral_admin_reverse_funding(${created.result.id},'rollback-only correction') result`;
        expect(second.result.replayed).toBe(true);
        const [net] = await tx`select public.referral_admin_funding_summary() result`;
        expect(net.result.net_funded_zar).toBe(funding.result.net_funded_zar - 50);
        const [original] = await tx`select amount_zar::float8 amount from public.ai_reward_reserve_funding where id=${created.result.id}`;
        expect(original.amount).toBe(50);
        const [audit] = await tx`select count(*)::int count from public.referral_admin_audit where record_id=${created.result.id}`;
        expect(audit.count).toBe(2);
        expect(await tx`select id,credits_balance from public.profiles order by id`).toEqual(before);
        const [active] = await tx`select count(*)::int count from public.referral_programme_settings where enabled or withdrawals_enabled or cost_model_approved`;
        expect(active.count).toBe(0);
        const [count] = await tx`select count(*)::int count from public.ai_reward_reserve_funding`;
        expect(count.count).toBe(initial[0].count + 1);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    finally { await sql.end(); }
  }, 30000);
});