// CAPS Source Sync — processes ONE source at a time and queues the rest.
// Bulk requests mark every selected source as `pending` (with a queue position)
// and only run the first one synchronously. When a source finishes, the function
// chains itself (background) to pick up the next pending source. This keeps the
// pipeline from thrashing on parallel downloads and gives predictable progress.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

interface Body {
  source_id?: string;
  source_ids?: string[];
  retry_failed?: boolean;
  force?: boolean;
  /** Internal: pick the next pending source from the queue. */
  next?: boolean;
  /** Internal: user id used when chaining. */
  chained_user?: string;
}

// @ts-ignore — Deno edge runtime global
const edge = (globalThis as any).EdgeRuntime;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Authorize: either an admin user, or a chained self-call using service role.
    let userId: string | null = null;
    const auth = req.headers.get("Authorization") ?? "";
    const isSelfChain = body.next && auth.includes(SERVICE_ROLE);
    if (isSelfChain) {
      userId = body.chained_user ?? null;
    } else {
      const userClient = createClient(SUPABASE_URL, ANON, {
        global: { headers: { Authorization: auth } },
      });
      const { data: { user }, error: uerr } = await userClient.auth.getUser();
      if (uerr || !user) return json({ error: "unauthorized" }, 401);
      const { data: roleRow } = await userClient.from("user_roles")
        .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      if (!roleRow) return json({ error: "forbidden" }, 403);
      userId = user.id;
    }

    // ── Mode A: chained "next" call — pick the oldest pending source.
    if (body.next) {
      const { data: pendingRows } = await admin.from("content_sources")
        .select("*")
        .eq("verification_status", "verified")
        .eq("sync_status", "pending")
        .order("updated_at", { ascending: true })
        .limit(1);
      const next = pendingRows?.[0];
      if (!next) return json({ done: true });
      const result = await processOne(admin, next, userId!, !!body.force);
      scheduleNext(userId!, !!body.force);
      return json({ results: [result] });
    }

    // ── Mode B: explicit request — resolve the source set.
    let q = admin.from("content_sources").select("*").eq("verification_status", "verified");
    if (body.source_id) q = q.eq("id", body.source_id);
    else if (body.source_ids?.length) q = q.in("id", body.source_ids);
    else if (body.retry_failed) q = q.eq("sync_status", "failed");
    const { data: sources, error: sErr } = await q;
    if (sErr) return json({ error: sErr.message }, 400);
    if (!sources || sources.length === 0) return json({ error: "no sources to sync" }, 400);

    // Single-source request: run immediately, no queue needed.
    if (sources.length === 1) {
      const result = await processOne(admin, sources[0], userId!, !!body.force);
      return json({ results: [result] });
    }

    // Multi-source request: mark all as pending (queued), then run the first
    // one now and chain the rest in the background.
    const now = new Date().toISOString();
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      await mark(admin, s.id, { sync_status: "pending", last_sync_error: null, updated_at: now });
      await log(admin, s.id, "queued", "info", `Queued (position ${i + 1} of ${sources.length})`);
    }

    const first = sources[0];
    const result = await processOne(admin, first, userId!, !!body.force);
    scheduleNext(userId!, !!body.force);

    return json({
      queued: sources.length,
      processed_first: result,
      message: `Processing 1 of ${sources.length}; remaining ${sources.length - 1} queued.`,
    });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

/** Fire-and-forget self-invocation to drain the queue one source at a time. */
function scheduleNext(userId: string, force: boolean) {
  const p = fetch(`${SUPABASE_URL}/functions/v1/caps-source-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": ANON,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify({ next: true, chained_user: userId, force }),
  }).catch(() => {});
  if (edge?.waitUntil) edge.waitUntil(p);
}

async function processOne(admin: any, s: any, userId: string, force: boolean) {
  await mark(admin, s.id, { sync_status: "syncing", last_sync_error: null });
  await log(admin, s.id, "sync_started", "info", `Sync started for ${s.name}`);

  try {
    if (!s.source_url) throw new Error("Source has no URL");

    await log(admin, s.id, "fetch", "info", `Fetching ${s.source_url}`);
    let html = "";
    try {
      const res = await fetch(s.source_url, {
        headers: { "User-Agent": "StudySoundBot/1.0 (+caps-sync)" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (e: any) {
      await log(admin, s.id, "fetch", "warn", `Pre-fetch failed: ${e?.message ?? e}`);
    }

    const hash = html ? await sha256(html) : null;
    const unchanged = !force && hash && hash === s.last_sync_hash;
    if (unchanged) {
      await mark(admin, s.id, { sync_status: "completed", last_sync_at: new Date().toISOString() });
      await log(admin, s.id, "no_change", "info", "No updates detected (hash match)");
      return { source_id: s.id, status: "no_change" };
    }

    await log(admin, s.id, "update_detected", "info",
      hash ? "Content hash changed — creating ingestion job" : "Creating ingestion job (no pre-fetch)");

    const beforeCovered = await countCovered(admin, s);

    const { data: job, error: jErr } = await admin.from("ingestion_jobs").insert({
      source_id: s.id,
      input_url: s.source_url,
      title_hint: s.name,
      grade: s.grade,
      subject: s.subject,
      curriculum: s.curriculum ?? "CAPS",
      country: s.country ?? "ZA",
      created_by: userId,
      state: "pending",
    }).select("id").single();
    if (jErr) throw new Error(jErr.message);

    await admin.from("ingestion_stage_logs").insert({
      job_id: job.id, stage: "pending", status: "info",
      message: `Created via CAPS sync (source=${s.name})`,
    });

    await mark(admin, s.id, { docs_discovered: (s.docs_discovered ?? 0) + 1 });
    await log(admin, s.id, "job_created", "info",
      `Ingestion job ${job.id} queued — running pipeline`, { job_id: job.id });

    const MAX_STEPS = 12;
    let finalState = "pending";
    let lastError: string | null = null;
    let documentId: string | null = null;

    for (let i = 0; i < MAX_STEPS; i++) {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/ingestion-worker`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": ANON,
          "Authorization": `Bearer ${SERVICE_ROLE}`,
        },
        body: JSON.stringify({ job_id: job.id }),
      });
      await resp.text().catch(() => "");

      const { data: jrow } = await admin.from("ingestion_jobs")
        .select("state,last_error,document_id")
        .eq("id", job.id).maybeSingle();
      finalState = jrow?.state ?? finalState;
      lastError = jrow?.last_error ?? null;
      documentId = jrow?.document_id ?? documentId;
      await log(admin, s.id, "pipeline_step",
        finalState === "failed" ? "error" : "info",
        `Step ${i + 1}: ${finalState}${lastError ? ` — ${lastError}` : ""}`,
        { job_id: job.id, state: finalState });

      if (["completed", "failed", "cancelled"].includes(finalState)) break;
    }

    const afterCovered = await countCovered(admin, s);
    const mappedRes = documentId
      ? await admin.from("content_topic_mapping")
          .select("id", { count: "exact", head: true })
          .eq("document_id", documentId)
      : { count: 0 };
    const mappedCount = (mappedRes as any).count ?? 0;
    const imported = documentId ? 1 : 0;
    const gain = Math.max(0, afterCovered - beforeCovered);

    if (finalState === "completed") {
      await mark(admin, s.id, {
        sync_status: "completed",
        last_sync_at: new Date().toISOString(),
        last_sync_hash: hash,
        last_sync_error: null,
        docs_imported: (s.docs_imported ?? 0) + imported,
        docs_mapped: (s.docs_mapped ?? 0) + mappedCount,
        coverage_gained: (s.coverage_gained ?? 0) + gain,
      });
      await log(admin, s.id, "import_complete", "success",
        `Imported document ${documentId ?? "?"} — ${mappedCount} CAPS mappings, +${gain} topics covered`,
        { job_id: job.id, document_id: documentId });
      return { source_id: s.id, status: "completed", job_id: job.id };
    } else if (finalState === "failed") {
      await mark(admin, s.id, {
        sync_status: "failed",
        last_sync_error: lastError ?? "pipeline failed",
        docs_imported: (s.docs_imported ?? 0) + imported,
        docs_mapped: (s.docs_mapped ?? 0) + mappedCount,
      });
      await log(admin, s.id, "import_failed", "error", lastError ?? "pipeline failed", { job_id: job.id });
      return { source_id: s.id, status: "failed", message: lastError ?? "pipeline failed", job_id: job.id };
    } else {
      await mark(admin, s.id, {
        sync_status: "syncing",
        last_sync_at: new Date().toISOString(),
        last_sync_hash: hash,
        docs_imported: (s.docs_imported ?? 0) + imported,
        docs_mapped: (s.docs_mapped ?? 0) + mappedCount,
      });
      await log(admin, s.id, "pipeline_pending", "warn",
        `Pipeline still at ${finalState} after ${MAX_STEPS} steps — will resume on next cron`,
        { job_id: job.id });
      return { source_id: s.id, status: finalState, job_id: job.id };
    }
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    await mark(admin, s.id, { sync_status: "failed", last_sync_error: msg });
    await log(admin, s.id, "sync_failed", "error", msg);
    return { source_id: s.id, status: "failed", message: msg };
  }
}

async function mark(admin: any, id: string, patch: Record<string, unknown>) {
  await admin.from("content_sources").update(patch).eq("id", id);
}

async function log(admin: any, source_id: string, action: string, status: string, message: string, meta: any = {}) {
  await admin.from("caps_sync_logs").insert({ source_id, action, status, message, meta });
}

async function countCovered(admin: any, s: any): Promise<number> {
  if (!s.grade || !s.subject) return 0;
  const { count } = await admin
    .from("content_topic_mapping")
    .select("id", { count: "exact", head: true })
    .eq("grade", s.grade)
    .eq("subject", s.subject);
  return count ?? 0;
}

async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
