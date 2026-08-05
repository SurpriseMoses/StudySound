// Fast embedding drain. Embeds document_chunks that have no embedding yet,
// using parallel gateway calls + parallel row updates. Designed to be invoked
// many times concurrently (one or more per document).
//
// POST { document_id?: string, grade?: string, budget_ms?: number }
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const EMBED_MODEL = "openai/text-embedding-3-small";
// Keep gateway throughput high without overwhelming Postgres with concurrent
// vector writes. The previous 6 x 12 fan-out caused statement timeouts once
// several documents were drained at the same time.
const BATCH = 24;
const PARALLEL = 3;
const UPDATE_PARALLEL = 4;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  try {
    if (!LOVABLE_API_KEY) return j({ error: "no LOVABLE_API_KEY" }, 500);
    let body: { document_id?: string; grade?: string; budget_ms?: number } = {};
    try { body = await req.json(); } catch { /* empty ok */ }
    const budget = Math.min(Math.max(Number(body.budget_ms ?? 100_000) || 100_000, 10_000), 110_000);

    let docIds: string[] = [];
    if (body.document_id) docIds = [body.document_id];
    else if (body.grade) {
      const { data } = await admin.from("ingestion_jobs")
        .select("document_id").eq("grade", body.grade).not("document_id", "is", null).limit(50);
      docIds = Array.from(new Set((data ?? []).map((r: any) => r.document_id).filter(Boolean)));
    } else return j({ error: "document_id or grade required" }, 400);

    let embedded = 0;
    const errors: string[] = [];

    outer:
    for (const docId of docIds) {
      while (Date.now() - startedAt < budget) {
        const { data: rows, error } = await admin.from("document_chunks")
          .select("id,text").eq("document_id", docId).is("embedding", null)
          .order("chunk_index", { ascending: true }).limit(BATCH * PARALLEL);
        if (error) { errors.push(error.message); continue outer; }
        if (!rows || rows.length === 0) break;

        const groups: { id: string; text: string }[][] = [];
        for (let i = 0; i < rows.length; i += BATCH) groups.push(rows.slice(i, i + BATCH) as any);

        const results = await Promise.allSettled(groups.map(async (g) => {
          const vectors = await embedBatch(g.map((r) => (r.text ?? "").slice(0, 8000)));
          const queue = g.map((r, i) => ({ id: r.id, v: vectors[i] }));
          let cursor = 0;
          await Promise.all(Array.from({ length: UPDATE_PARALLEL }, async () => {
            while (cursor < queue.length) {
              const item = queue[cursor++];
              if (!item?.v) continue;
              const { error: updateError } = await admin.from("document_chunks")
                .update({ embedding: item.v as any, embedding_model: EMBED_MODEL })
                .eq("id", item.id);
              if (updateError) throw new Error(updateError.message);
            }
          }));
          return g.length;
        }));

        let progressed = 0;
        for (const r of results) {
          if (r.status === "fulfilled") { embedded += r.value; progressed += r.value; }
          else errors.push(String(r.reason).slice(0, 200));
        }
        if (progressed === 0) continue outer; // all failed for this doc — move on
      }
    }

    // Publish any doc that is now fully embedded
    const published: string[] = [];
    for (const docId of docIds) {
      const { count } = await admin.from("document_chunks")
        .select("id", { count: "exact", head: true }).eq("document_id", docId).is("embedding", null);
      if ((count ?? 1) === 0) {
        await admin.from("documents").update({
          published_at: new Date().toISOString(), embeddings_status: "complete",
        }).eq("id", docId);
        await admin.from("ingestion_jobs").update({
          state: "completed", progress: 100, finished_at: new Date().toISOString(), last_error: null,
        }).eq("document_id", docId).not("state", "in", "(completed,failed,cancelled)");
        published.push(docId);
      }
    }

    return j({ ok: true, embedded, published, errors: errors.slice(0, 5), ms: Date.now() - startedAt });
  } catch (e: any) {
    return j({ error: String(e?.message ?? e) }, 500);
  }
});

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`embedding failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const jn = await res.json();
  return (jn.data ?? []).map((d: any) => d.embedding as number[]);
}

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
