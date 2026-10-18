import { describe, expect, it } from "vitest";
import postgres from "postgres";

const url = process.env.REFERRAL_SANDBOX_DB_URL;
describe.skipIf(!url)("isolated atomic payment posting", () => {
  it("binds evidence, serializes replays and competing purchases, and rolls back all failed writes", async () => {
    if (!url) return;
    const endpoint = new URL(url);
    if (endpoint.hostname !== "127.0.0.1" || endpoint.port !== "55439") throw new Error("Disposable local database required");
    const sql = postgres(url, { max: 5, prepare: false });
    const user = crypto.randomUUID();
    let id = 800000;
    const create = async (kind = "credits", plan: string | null = null) => {
      const reference = "sandbox_" + crypto.randomUUID();
      await sql`insert into public.credit_purchases(user_id,reference,expected_customer_email,payment_environment,expected_plan_code,kind,plan_id,credits,amount_zar)
        values(${user},${reference},'payer@example.test','test',${plan ? 'PLN_'+plan : null},${kind},${plan},${plan === 'essential' ? 110 : plan === 'premium' ? 220 : 40},${plan === 'essential' ? 79 : plan === 'premium' ? 149 : 50})`;
      return { reference, payment_id: String(++id), status: "success", amount_cents: plan === "essential" ? 7900 : plan === "premium" ? 14900 : 5000,
        currency: "ZAR", environment: "test", customer_email: "payer@example.test", customer_code: "CUS_sandbox"+user.replace(/-/g,''), plan_code: plan ? 'PLN_'+plan : null, paid_at: "2026-01-01T12:00:00Z" };
    };
    const post = async (evidence: Record<string, string | number | null>) => { const [row] = await sql`select public.payment_post_verified(${sql.json(evidence)}) result`; return row.result; };
    try {
      await sql`insert into public.profiles(user_id) values(${user})`;
      const first = await create();
      for (const change of [{ amount_cents: 4999 }, { currency: "USD" }, { environment: "live" }, { customer_email: "other@example.test" }, { plan_code: "PLN_wrong" }]) await expect(post({ ...first, ...change })).rejects.toThrow();
      const results = await Promise.all([post(first),post(first),post(first)]);
      expect(results.filter(r=>r.credited)).toHaveLength(1);
      expect(results.filter(r=>r.status==='already_credited')).toHaveLength(2);
      const a = await create(), b = await create();
      await Promise.all([post(a),post(b)]);
      const [wallet] = await sql`select credits_balance from public.profiles where user_id=${user}`;
      expect(wallet.credits_balance).toBe(140);
      await expect(post({ ...first, payment_id: "987654" })).rejects.toThrow('reconciliation');
      const reused = await create();
      await expect(post({ ...reused, payment_id: first.payment_id })).rejects.toThrow();
      const essential = await create("subscription", "essential");
      const paid = await post(essential);
      expect(paid).toMatchObject({ credited: true, credits: 110, balance: 250 });
      const [subscription] = await sql`select plan,status from public.subscriptions where user_id=${user}`;
      expect(subscription).toMatchObject({ plan: "essential", status: "active" });
      await sql`insert into public.payment_plan_codes values('essential','PLN_essential',79) on conflict(plan_id) do update set plan_code=excluded.plan_code,amount_zar=excluded.amount_zar`;
      const renewal = { ...essential, reference: "sandbox_renewal_"+crypto.randomUUID(), payment_id: String(++id), paid_at: "2026-02-01T12:00:00Z" };
      await expect(post({ ...renewal, amount_cents: 7110 })).rejects.toThrow('amount mismatch');
      const renewed = await Promise.all([post(renewal),post(renewal)]);
      expect(renewed.filter(r=>r.credited)).toHaveLength(1);
      const older = { ...essential, reference: "sandbox_old_"+crypto.randomUUID(), payment_id: String(++id) };
      await post(older);
      const [period] = await sql`select current_period_end from public.subscriptions where user_id=${user}`;
      expect(new Date(period.current_period_end).toISOString()).toBe("2026-03-01T12:00:00.000Z");
      const failure = await create("subscription", "invalid");
      const [before] = await sql`select credits_balance from public.profiles where user_id=${user}`;
      await expect(post(failure)).rejects.toThrow('Invalid subscription plan');
      const [after] = await sql`select credits_balance from public.profiles where user_id=${user}`;
      expect(after).toEqual(before);
      const [failedPurchase] = await sql`select credited,credit_transaction_id from public.credit_purchases where reference=${failure.reference}`;
      expect(failedPurchase).toEqual({ credited: false, credit_transaction_id: null });
      expect(await sql`select id from public.credit_transactions where request_id=${failure.reference}`).toHaveLength(0);
      await sql`update public.credit_purchases set expected_customer_email=null where reference=${reused.reference}`;
      await expect(post(reused)).rejects.toThrow('Legacy purchase');
      const [grants] = await sql`select has_function_privilege('authenticated','public.payment_post_verified(jsonb)','EXECUTE') learner,has_function_privilege('anon','public.payment_post_verified(jsonb)','EXECUTE') anonymous`;
      expect(grants).toEqual({ learner: false, anonymous: false });
      expect(await sql`select id from public.referral_commissions where purchase_id in (select id from public.credit_purchases where user_id=${user})`).toHaveLength(0);
    } finally { await sql.end(); }
  },30000);
});