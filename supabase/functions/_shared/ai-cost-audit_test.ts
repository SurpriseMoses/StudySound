// Offline observer tests; no real provider requests, billing or database writes.
const rows: Record<string, unknown>[] = [];
let failPersistence = false;
let providerCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/rest/v1/ai_generation_cost_events")) {
    if (failPersistence) throw new Error("offline");
    rows.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 201 });
  }
  providerCalls++;
  return Response.json({ result: "unchanged", usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 24 } });
};
Deno.env.set("SUPABASE_URL", "http://audit-fixture.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "offline-test-fixture");
const { auditFetch, withCostAudit, setCostAuditIdentity, recordBatchEvidence } = await import("./ai-cost-audit.ts");
function assert(v: unknown, message: string) { if (!v) throw new Error(message); }
const req = () => new Request("http://fixture.invalid", { method: "POST", body: "{}" });
Deno.test("observer preserves parsed provider output and records returned units", async () => {
  rows.length = 0;
  const handler = withCostAudit(async () => {
    setCostAuditIdentity("00000000-0000-0000-0000-000000000001");
    const r = await auditFetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=never-store-me", { method: "POST", body: "{}" });
    return Response.json(await r.json());
  }, "translation");
  const r = await handler(req()); const body = await r.json();
  assert(body.result === "unchanged", "original output changed");
  assert(rows.some(r => r.input_tokens === 12 && r.output_tokens === 24), "returned units missing");
  assert(!JSON.stringify(rows).includes("never-store-me"), "query credential persisted");
  assert(rows.every(r => r.reported_cost === undefined), "invented provider cost");
});
Deno.test("failed accounting does not fail generation", async () => {
  failPersistence = true;
  const handler = withCostAudit(async () => Response.json(await (await auditFetch("https://ai.gateway.lovable.dev/v1/chat/completions", { body: JSON.stringify({ model: "fixture" }) })).json()), "quiz");
  assert((await (await handler(req())).json()).result === "unchanged", "accounting blocked result");
  failPersistence = false;
});
Deno.test("cache replay records no new provider request or cost", async () => {
  rows.length = 0; const before = providerCalls;
  await withCostAudit(async () => Response.json({ success: true, cached: true, credits_charged: 2 }), "translation")(req());
  assert(providerCalls === before, "cache called provider");
  assert(rows[0]?.cache_hit === true && rows[0]?.provider === "none", "cache attribution missing");
});
Deno.test("attempts are distinct; repeated batch results use the same idempotency key", async () => {
  rows.length = 0;
  await withCostAudit(async () => { for (let i = 0; i < 2; i++) await auditFetch("https://api.elevenlabs.io/v1/text-to-speech/test", {}); return Response.json({ success: true }); }, "audio")(req());
  assert(rows[0]?.event_key !== rows[1]?.event_key, "retry attempts collapsed");
  rows.length = 0;
  await recordBatchEvidence("batches/fixture", 0, "fixture", "quiz", null, {}, false);
  await recordBatchEvidence("batches/fixture", 0, "fixture", "quiz", null, {}, false);
  assert(rows[0]?.event_key === rows[1]?.event_key, "batch poll duplicated billable key");
});
Deno.test("request contexts do not mix documents across concurrent jobs", async () => {
  rows.length = 0;
  const run = (id: string) => withCostAudit(async () => { setCostAuditIdentity(id); await Promise.resolve(); await auditFetch("https://api.firecrawl.dev/v2/scrape", {}); return Response.json({}); }, "processing")(req());
  await Promise.all([run("doc-one"), run("doc-two")]);
  assert(new Set(rows.map(r => r.document_id)).size === 2, "request context leaked");
});
Deno.test("restore test fetch", () => { globalThis.fetch = originalFetch; });