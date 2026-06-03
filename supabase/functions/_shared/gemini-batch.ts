// Shared helpers for Gemini Batch API.
//
// Submit:  POST https://generativelanguage.googleapis.com/v1beta/models/{model}:batchGenerateContent?key=…
//          { batch: { displayName, inputConfig: { requests: { requests: [...] } } } }
// Poll:    GET  https://generativelanguage.googleapis.com/v1beta/{batchName}?key=…
// On SUCCESS, results live at `response.inlinedResponses.inlinedResponses[i]`
// in the same order as submitted requests. Each entry is either
// `{ response: <generateContentResponse> }` or `{ error: { code, message } }`.
//
// Pricing: 50% of standard generateContent. SLA ≤24h (usually minutes).

export interface BatchRequestItem {
  // Free-form per-request payload — mirrors the body you'd send to
  // generateContent (contents, systemInstruction, generationConfig, etc.).
  request: Record<string, unknown>;
}

export interface BatchSubmitResult {
  /** Full operation name returned by Google, e.g. "batches/abc-123". */
  name: string;
}

export type BatchState =
  | "JOB_STATE_UNSPECIFIED"
  | "JOB_STATE_QUEUED"
  | "JOB_STATE_PENDING"
  | "JOB_STATE_RUNNING"
  | "JOB_STATE_SUCCEEDED"
  | "JOB_STATE_FAILED"
  | "JOB_STATE_CANCELLED"
  | "JOB_STATE_EXPIRED";

export interface BatchStatus {
  name: string;
  state: BatchState;
  /** Per-request results, present when state === SUCCEEDED. */
  inlinedResponses?: Array<
    | { response: any; error?: undefined }
    | { error: { code?: number; message?: string }; response?: undefined }
  >;
  /** Top-level error when state === FAILED. */
  error?: { code?: number; message?: string };
}

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export async function submitBatch(
  model: string,
  requests: BatchRequestItem[],
  apiKey: string,
  displayName = `batch-${Date.now()}`,
): Promise<BatchSubmitResult> {
  if (requests.length === 0) throw new Error("submitBatch: empty requests array");

  const url = `${BASE}/models/${model}:batchGenerateContent?key=${apiKey}`;
  const body = JSON.stringify({
    batch: {
      displayName,
      inputConfig: { requests: { requests } },
    },
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini batch submit ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = JSON.parse(text);
  const name = json?.name as string | undefined;
  if (!name) throw new Error(`Gemini batch submit: no operation name in response: ${text.slice(0, 200)}`);
  return { name };
}

export async function pollBatch(name: string, apiKey: string): Promise<BatchStatus> {
  const url = `${BASE}/${name}?key=${apiKey}`;
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini batch poll ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = JSON.parse(text);
  // Shape: { name, metadata: { state, ... }, done, response: { inlinedResponses: { inlinedResponses: [...] } }, error }
  // NOTE: Gemini Batch API returns states prefixed with BATCH_STATE_ (not JOB_STATE_).
  // Normalize both prefixes to JOB_STATE_* for consistent downstream handling.
  const meta = json?.metadata ?? {};
  const rawState: string = (meta?.state ?? json?.response?.metadata?.state ?? "JOB_STATE_UNSPECIFIED") as string;
  const state: BatchState = rawState.replace(/^BATCH_STATE_/, "JOB_STATE_") as BatchState;
  const inlined = json?.response?.inlinedResponses?.inlinedResponses
    ?? json?.response?.inlinedResponses
    ?? json?.response?.responses?.responses
    ?? json?.response?.responses
    ?? undefined;
  return {
    name,
    state,
    inlinedResponses: Array.isArray(inlined) ? inlined : undefined,
    error: json?.error,
  };
}

/** Extract the concatenated text from a single generateContent response. */
export function extractText(resp: any): string {
  const cand = resp?.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  return parts.map((p: any) => p?.text ?? "").join("").trim();
}
