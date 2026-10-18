import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

const url = process.env.REFERRAL_SANDBOX_DB_URL;
describe.skipIf(!url).sequential("isolated verified referral attribution", () => {
  let sql: ReturnType<typeof postgres>;
  let owner: string;
  let code: string;
  beforeAll(async () => {
    if (!url) throw new Error("Local database required");
    const endpoint = new URL(url);
    if (endpoint.hostname !== "127.0.0.1" || endpoint.port !== "55439") throw new Error("Disposable local database required");
    sql = postgres(url, { max: 4, prepare: false });
    owner = crypto.randomUUID();
    await sql`insert into auth.users(id,created_at,email_confirmed_at) values(${owner},now()-interval '1 day',now())`;
    await sql`insert into public.profiles(user_id) values(${owner})`;
    const [row] = await sql`insert into public.referral_codes(user_id) values(${owner}) returning code`;
    code = row.code;
  });
  beforeEach(async () => {
    await sql`insert into public.referral_programme_settings(id,enabled,credits_per_rand,cost_model_approved,legal_review_confirmed,payment_flow_verified) values(true,true,1,true,true,true) on conflict(id) do update set enabled=true,credits_per_rand=1,cost_model_approved=true,legal_review_confirmed=true,payment_flow_verified=true`;
  });
  afterAll(async () => {
    if (!sql) return;
    await sql`update public.referral_programme_settings set enabled=false,withdrawals_enabled=false,cost_model_approved=false where id=true`;
    await sql.end();
  });
  const claim = async () => {
    const [row] = await sql`select public.referral_create_claim(${code}) result`;
    return row.result;
  };
  const account = async (verified = true, old = false) => {
    const id = crypto.randomUUID();
    await sql`insert into auth.users(id,created_at,email_confirmed_at) values(${id},${old ? '2020-01-01T00:00:00Z' : new Date().toISOString()}::timestamptz,${verified ? new Date().toISOString() : null}::timestamptz)`;
    await sql`insert into public.profiles(user_id) values(${id})`;
    return id;
  };
  const bind = async (id: string, token: string) => sql.begin(async tx => {
    await tx`select set_config('request.jwt.claim.sub',${id},true)`;
    const [row] = await tx`select public.referral_bind_claim(${token}::uuid) result`;
    return row.result;
  });
  it("leaves disabled invitations and attribution unavailable", async () => {
    await sql`update public.referral_programme_settings set enabled=false where id=true`;
    expect((await claim()).status).toBe("disabled");
    expect((await bind(owner,crypto.randomUUID())).status).toBe("disabled");
  });
  it("creates opaque claims with the configured 30-day window", async () => {
    const result = await claim();
    const [row] = await sql`select extract(epoch from expires_at-created_at)::integer seconds from public.referral_claims where token=${result.token}`;
    expect(row.seconds).toBe(30 * 86400);
    expect(Object.keys(result).sort()).toEqual(["expires_at", "status", "token"]);
  });
  it("requires email verification before binding", async () => {
    const invitation = await claim();
    const id = await account(false);
    expect((await bind(id,invitation.token)).status).toBe("verification_pending");
    await sql`update auth.users set email_confirmed_at=now() where id=${id}`;
    expect((await bind(id,invitation.token)).status).toBe("attributed");
  });
  it("prevents self referrals", async () => {
    const invitation = await claim();
    expect((await bind(owner,invitation.token)).status).toBe("ineligible");
  });
  it("rejects accounts created before the invitation", async () => {
    const invitation = await claim();
    expect((await bind(await account(true,true),invitation.token)).status).toBe("existing_account");
  });
  it("rejects existing successful customers", async () => {
    const invitation = await claim();
    const id = await account();
    await sql`insert into public.credit_purchases(user_id,reference,kind,status,credited) values(${id},${crypto.randomUUID()},'subscription','success',true)`;
    expect((await bind(id,invitation.token)).status).toBe("existing_customer");
  });
  it("rejects expired claims", async () => {
    const invitation = await claim();
    await sql`update public.referral_claims set expires_at=now()-interval '1 second' where token=${invitation.token}`;
    expect((await bind(await account(),invitation.token)).status).toBe("expired_or_used");
  });
  it("serialises concurrent consumption of a single claim", async () => {
    const invitation = await claim();
    const ids = [await account(),await account()];
    const results = await Promise.all(ids.map(id => bind(id,invitation.token)));
    expect(results.map(x => x.status).sort()).toEqual(["attributed","expired_or_used"]);
  });
  it("replays the same claim once and prevents competing attribution", async () => {
    const first = await claim();
    const second = await claim();
    const id = await account();
    const results = await Promise.all([bind(id,first.token),bind(id,first.token)]);
    expect(results.map(x=>x.replayed).sort()).toEqual([false,true]);
    expect((await bind(id,second.token)).status).toBe("already_attributed");
    const [row] = await sql`select count(*)::integer count from public.referral_attributions where referred_user_id=${id}`;
    expect(row.count).toBe(1);
  });
  it("does not issue credits or commissions and hides private activity identifiers", async () => {
    const invitation = await claim();
    const id = await account();
    await bind(id,invitation.token);
    const [wallet] = await sql`select credits_balance from public.profiles where user_id=${id}`;
    expect(wallet.credits_balance).toBe(20);
    const [counts] = await sql`select (select count(*)::integer from public.referral_commissions where user_id=${owner}) commissions,(select count(*)::integer from public.credit_transactions where user_id=${id}) credits`;
    expect(counts).toMatchObject({commissions:0,credits:0});
    const summary = await sql.begin(async tx => {
      await tx`select set_config('request.jwt.claim.sub',${owner},true)`;
      const [row] = await tx`select public.referral_my_summary() result`;
      return row.result;
    });
    expect(JSON.stringify(summary)).not.toContain(id);
    expect(summary.activity.every((x: object) => Object.keys(x).sort().join(',') === 'attributed_at,identifier,status')).toBe(true);
  });
  it("denies direct attribution reads and anonymous claim binding", async () => {
    const [row] = await sql`select has_table_privilege('authenticated','public.referral_attributions','SELECT') reads,has_function_privilege('anon','public.referral_bind_claim(uuid)','EXECUTE') binds,has_function_privilege('authenticated','public.referral_create_claim(text)','EXECUTE') creates`;
    expect(row).toMatchObject({reads:false,binds:false,creates:false});
  });
});