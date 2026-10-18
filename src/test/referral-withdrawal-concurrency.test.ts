import { describe, expect, it } from "vitest";
import postgres from "postgres";

const url = process.env.REFERRAL_SANDBOX_DB_URL;
// Destructive fixture cleanup is permitted ONLY in the disposable localhost
// cluster. Never run these fixtures using the hosted database connection.
describe.skipIf(!url)("isolated withdrawal concurrency and audit", () => {
  it("reserves only once, releases rejected funds, confirms paid exactly once and excludes reversed earnings", async () => {
    if (!url) return;
    const endpoint = new URL(url);
    if (endpoint.hostname !== "127.0.0.1" || endpoint.port !== "55439") throw new Error("Disposable local test database required");
    const sql = postgres(url, { max: 4, prepare: false });
    const admin = "11111111-1111-4111-8111-111111111111";
    const owner = crypto.randomUUID();
    const payer = crypto.randomUUID();
    const invoke = async (amount: number, key: string) => sql.begin(async tx => {
      await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
      const [row] = await tx`select public.referral_request_withdrawal(${amount},${key}::uuid) result`;
      return row.result;
    });
    const review = async (id: string, status: string, key: string, reason = "sandbox documented review", paid = false) => sql.begin(async tx => {
      await tx`select set_config('request.jwt.claim.sub',${admin},true)`;
      const [row] = await tx`select public.referral_admin_review_withdrawal(${id}::uuid,${status},${key}::uuid,${reason},true,${paid ? 'sandbox-payout-'+id : null},${paid ? 5000 : null},${paid ? '2026-01-01T12:00:00Z' : null}::timestamptz,${paid ? 'sandbox completed receipt' : null},${paid}) result`;
      return row.result;
    });
    try {
      await sql`insert into public.profiles(user_id) values(${owner}),(${payer})`;
      const [code] = await sql`insert into public.referral_codes(user_id) values(${owner}) returning id`;
      const [claim] = await sql`insert into public.referral_claims(code_id,expires_at) values(${code.id},now()+interval '30 days') returning id`;
      const [attribution] = await sql`insert into public.referral_attributions(referred_user_id,referrer_user_id,claim_id,code_id) values(${payer},${owner},${claim.id},${code.id}) returning id`;
      const [purchase] = await sql`insert into public.credit_purchases(user_id,reference,kind,status,credited) values(${payer},${crypto.randomUUID()},'subscription','success',true) returning id`;
      const [commission] = await sql`insert into public.referral_commissions(attribution_id,purchase_id,user_id,provider_reference,normal_price_cents,paid_amount_cents,basis_cents,rate_basis_points,amount_cents,status,verified_at,available_at) values(${attribution.id},${purchase.id},${owner},${crypto.randomUUID()},100000,90000,100000,500,5000,'available',now(),now()) returning id`;
      await sql`insert into public.referral_programme_settings(id,enabled,withdrawals_enabled,credits_per_rand,cost_model_approved,legal_review_confirmed,payment_flow_verified) values(true,true,true,1,true,true,true) on conflict(id) do update set enabled=true,withdrawals_enabled=true,credits_per_rand=1,cost_model_approved=true,legal_review_confirmed=true,payment_flow_verified=true`;
      const outcomes = await Promise.allSettled([invoke(5000,crypto.randomUUID()),invoke(5000,crypto.randomUUID())]);
      expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(x => x.status === 'rejected')).toHaveLength(1);
      const successful = outcomes.find(x => x.status === 'fulfilled');
      if (!successful || successful.status !== 'fulfilled') throw new Error("No successful reservation");
      const firstId = successful.value.id;
      const [reserved] = await sql`select public.referral_financial_totals(${owner}::uuid) result`;
      expect(reserved.result).toMatchObject({ available_cents: 0, reserved_cents: 5000 });
      await review(firstId,'rejected',crypto.randomUUID());
      const [released] = await sql`select public.referral_financial_totals(${owner}::uuid) result`;
      expect(released.result).toMatchObject({ available_cents: 5000, reserved_cents: 0 });
      const key=crypto.randomUUID();
      const concurrentReplay=await Promise.all([invoke(5000,key),invoke(5000,key)]);
      expect(concurrentReplay[0].id).toBe(concurrentReplay[1].id);
      expect(concurrentReplay.map(x=>x.replayed).sort()).toEqual([false,true]);
      const id=concurrentReplay[0].id;
      await expect(invoke(5001,key)).rejects.toThrow('conflicts');
      await expect(review(id,'paid',crypto.randomUUID())).rejects.toThrow('Invalid withdrawal transition');
      await review(id,'under_review',crypto.randomUUID());
      await review(id,'approved',crypto.randomUUID());
      await review(id,'processing',crypto.randomUUID());
      await expect(review(id,'rejected',crypto.randomUUID())).rejects.toThrow('processing transfers must be reconciled');
      await expect(review(id,'paid',crypto.randomUUID())).rejects.toThrow('Confirm completed transfer');
      const paidKey=crypto.randomUUID();
      const paid = await review(id,'paid',paidKey,"sandbox documented review",true);
      expect(paid.replayed).toBe(false);
      expect((await review(id,'paid',paidKey,"sandbox documented review",true)).replayed).toBe(true);
      await expect(review(id,'paid',paidKey,"changed sandbox review",true)).rejects.toThrow('conflicts');
      const [paymentCount] = await sql`select count(*)::integer count from public.referral_payout_confirmations where withdrawal_id=${id}`;
      expect(paymentCount.count).toBe(1);
      const [totals] = await sql`select public.referral_financial_totals(${owner}::uuid) result`;
      expect(totals.result).toMatchObject({ available_cents: 0, reserved_cents: 0, paid_cents: 5000 });
      await sql`insert into public.referral_commission_reversals(commission_id,reason,provider_event_reference) values(${commission.id},'sandbox chargeback reversal',${crypto.randomUUID()})`;
      const [reversed] = await sql`select public.referral_financial_totals(${owner}::uuid) result`;
      expect(reversed.result).toMatchObject({ available_cents: 0, reversed_cents: 5000, recovery_cents: 5000 });
      const [wallet] = await sql`select credits_balance from public.profiles where user_id=${owner}`;
      expect(wallet.credits_balance).toBe(20);
    } finally {
      await sql`update public.referral_programme_settings set enabled=false,withdrawals_enabled=false,cost_model_approved=false where id=true`;
      await sql.end();
    }
  },30000);
});