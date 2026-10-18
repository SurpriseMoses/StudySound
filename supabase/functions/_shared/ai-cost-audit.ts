// Passive accounting only: never changes a provider request, retries or wallet.
import { AsyncLocalStorage } from "node:async_hooks";
import { extractProviderUsage } from "./ai-cost-usage.ts";

type Context = { jobId: string; documentId: string | null; feature: string; attempt: number; userId?: string; calls: number };
const contexts = new AsyncLocalStorage<Context>();
const nativeFetch = globalThis.fetch.bind(globalThis);

async function persist(row: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    const response = await nativeFetch(`${url}/rest/v1/ai_generation_cost_events?on_conflict=event_key`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(row),
    });
    if (!response.ok) console.warn("[cost-audit] evidence write unavailable", response.status);
  } catch { console.warn("[cost-audit] evidence write unavailable"); }
}

export function withCostAudit(handler: (req: Request) => Promise<Response>, feature: string) {
  return async (req: Request) => {
    return contexts.run({ jobId: crypto.randomUUID(), documentId: null, feature, attempt: 0, calls: 0 }, async () => {
      const response = await handler(req);
      const ctx = contexts.getStore();
      if (!ctx || req.method === "OPTIONS") return response;
      try {
        const result = await response.clone().json();
        const cacheHit = ctx.calls === 0 && result.success === true && (result.reused === true || result.cached === true || result.source === "cached");
        if (cacheHit) await persist({ event_key: `${ctx.jobId}:cache`, job_id: ctx.jobId, document_id: ctx.documentId, user_id: ctx.userId ?? null, feature, provider: "none", model: "cached-asset", endpoint: "internal:cache", billing_mode: "cached-replay", cache_hit: true, outcome: "cached", usage_units: { observed_credits_charged: typeof result.credits_charged === "number" ? result.credits_charged : null } });
      } catch { /* Accounting cannot replace the original result. */ }
      return response;
    });
  };
}

export function setCostAuditIdentity(documentId: string | null, userId?: string) {
  const ctx = contexts.getStore();
  if (ctx) { ctx.documentId = documentId; ctx.userId = userId; }
}

export async function auditFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ctx = contexts.getStore();
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const provider = url.hostname === "generativelanguage.googleapis.com" ? "google" : url.hostname === "ai.gateway.lovable.dev" ? "lovable_gateway" : url.hostname === "api.elevenlabs.io" ? "elevenlabs" : url.hostname.endsWith("speech.microsoft.com") ? "azure_speech" : url.hostname === "api.cognitive.microsofttranslator.com" ? "azure_translator" : url.hostname === "api.firecrawl.dev" ? "firecrawl" : null;
  if (!ctx || !provider) return nativeFetch(input, init);
  ctx.calls++;
  let payload: Record<string, unknown> = {};
  try { if (typeof init?.body === "string") payload = JSON.parse(init.body); } catch { /* SSML is not JSON. */ }
  const voice = typeof init?.body === "string" ? init.body.match(/<voice\s+name=["']([^"']+)/)?.[1] : undefined;
  const model = typeof payload.model === "string" ? payload.model : typeof payload.model_id === "string" ? payload.model_id : url.pathname.match(/models\/([^:]+)/)?.[1] ?? voice ?? (provider.startsWith("azure") ? "configured-service" : "unknown");
  const attempt = ++ctx.attempt;
  const row = { event_key: `${ctx.jobId}:${attempt}`, job_id: ctx.jobId, document_id: ctx.documentId, user_id: ctx.userId ?? null, feature: ctx.feature, provider, model, endpoint: `${url.origin}${url.pathname}`, billing_mode: url.pathname.includes("batch") ? "batch-control-unreconciled" : url.pathname.includes("cachedContents") ? "context-cache-storage" : "online", attempt, cache_hit: false };
  let response: Response;
  try { response = await nativeFetch(input, init); }
  catch (error) { await persist({ ...row, outcome: "unknown" }); throw error; }
  const base = { ...row, http_status: response.status, outcome: response.ok ? "succeeded" : "failed", provider_request_id: response.headers.get("request-id") ?? response.headers.get("x-request-id") };
  await persist(base);
  if (response.headers.get("content-type")?.includes("json")) {
    // Observe the caller's existing parse: no duplicated image/audio payload.
    const parse = response.json.bind(response);
    response.json = async () => {
      try { const data = await parse(); await persist({ ...base, ...extractProviderUsage(data) }); return data; }
      catch (error) { await persist(base); throw error; }
    };
  } else {
    await persist({ ...base, usage_units: { provider_reported_characters: response.headers.get("x-character-count") ? Number(response.headers.get("x-character-count")) : null, content_length_bytes: response.headers.get("content-length") ? Number(response.headers.get("content-length")) : null } });
  }
  return response;
}