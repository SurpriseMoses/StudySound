// Passive accounting only: never changes a provider request, retries or wallet.
import { AsyncLocalStorage } from "node:async_hooks";
import { extractProviderUsage } from "./ai-cost-usage.ts";

type Context = { jobId: string; documentId: string | null; feature: string; attempt: number };
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
    let body: Record<string, unknown> = {};
    try { if (req.method !== "OPTIONS") body = await req.clone().json(); } catch { /* Preserve original validation. */ }
    let documentId = typeof body.document_id === "string" ? body.document_id : null;
    if (!documentId && typeof body.lesson_id === "string") {
      const url = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (url && key && /^[0-9a-f-]{36}$/i.test(body.lesson_id)) {
        try {
          const r = await nativeFetch(`${url}/rest/v1/lessons?id=eq.${body.lesson_id}&select=document_id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
          if (r.ok) documentId = (await r.json())?.[0]?.document_id ?? null;
        } catch { /* Unresolved identifiers stay unknown. */ }
      }
    }
    return contexts.run({ jobId: crypto.randomUUID(), documentId, feature, attempt: 0 }, () => handler(req));
  };
}

export async function auditFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ctx = contexts.getStore();
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const provider = url.hostname === "generativelanguage.googleapis.com" ? "google" : url.hostname === "ai.gateway.lovable.dev" ? "lovable_gateway" : url.hostname === "api.elevenlabs.io" ? "elevenlabs" : url.hostname.endsWith("speech.microsoft.com") ? "azure_speech" : url.hostname === "api.cognitive.microsofttranslator.com" ? "azure_translator" : url.hostname === "api.firecrawl.dev" ? "firecrawl" : null;
  if (!ctx || !provider) return nativeFetch(input, init);
  let payload: Record<string, unknown> = {};
  try { if (typeof init?.body === "string") payload = JSON.parse(init.body); } catch { /* SSML is not JSON. */ }
  const model = typeof payload.model === "string" ? payload.model : typeof payload.model_id === "string" ? payload.model_id : url.pathname.match(/models\/([^:]+)/)?.[1] ?? (provider.startsWith("azure") ? "configured-service" : "unknown");
  const attempt = ++ctx.attempt;
  const row = { event_key: `${ctx.jobId}:${attempt}`, job_id: ctx.jobId, document_id: ctx.documentId, feature: ctx.feature, provider, model, endpoint: `${url.origin}${url.pathname}`, billing_mode: url.pathname.includes("batch") ? "batch-control-unreconciled" : url.pathname.includes("cachedContents") ? "context-cache-storage" : "online", attempt, cache_hit: false };
  let response: Response;
  try { response = await nativeFetch(input, init); }
  catch (error) { await persist({ ...row, outcome: "unknown" }); throw error; }
  const base = { ...row, http_status: response.status, outcome: response.ok ? "succeeded" : "failed", provider_request_id: response.headers.get("request-id") ?? response.headers.get("x-request-id") };
  if (response.headers.get("content-type")?.includes("json")) {
    // Observe the caller's existing parse: no duplicated image/audio payload.
    const parse = response.json.bind(response);
    response.json = async () => {
      try { const data = await parse(); await persist({ ...base, ...extractProviderUsage(data) }); return data; }
      catch (error) { await persist(base); throw error; }
    };
    if (!response.ok) await persist(base);
  } else {
    await persist({ ...base, usage_units: { provider_reported_characters: response.headers.get("x-character-count") ? Number(response.headers.get("x-character-count")) : null, content_length_bytes: response.headers.get("content-length") ? Number(response.headers.get("content-length")) : null } });
  }
  return response;
}