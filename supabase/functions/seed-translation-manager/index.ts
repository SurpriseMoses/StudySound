// seed-translation-manager — admin queue for pre-translating seeded books
// into Zulu, Xhosa, Setswana, Sepedi.
//
// Actions:
//   "enqueue"      { document_id }  → expand doc × 4 langs into queue rows
//   "enqueue_all"                   → enqueue every doc with seed_translation=true
//   "start"                         → flip worker on
//   "pause"                         → flip worker off
//   "reset_stuck"                   → reset processing > 5min back to pending
//   "clear_failed"                  → delete failed rows
//   "status"                        → counts + worker state

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { cleanRawText, type DocKind } from "../_shared/clean-text.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TARGET_LANGUAGES = ["zu", "xh", "tn", "nso"];
const TARGET_CHUNK_SIZE = 700;
const HARD_MIN = 400;
const MUTATION_BATCH_SIZE = 500;

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S+$/g) ?? [clean];
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    const sentence = s.trim();
    if (!sentence) continue;
    if (buf.length === 0) { buf = sentence; continue; }
    const candidate = `${buf} ${sentence}`;
    if (candidate.length >= TARGET_CHUNK_SIZE && buf.length >= HARD_MIN) {
      chunks.push(buf); buf = sentence;
    } else { buf = candidate; }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function inferKind(doc: { title: string; tags: unknown }): DocKind {
  if (Array.isArray(doc.tags)) {
    for (const t of doc.tags as Array<Record<string, unknown>>) {
      if (t && typeof t.kind === "string" && (t.kind === "play" || t.kind === "novel")) {
        return t.kind as DocKind;
      }
    }
  }
  const playTitles = ["macbeth", "romeo and juliet", "othello", "hamlet", "julius caesar", "the merchant of venice"];
  if (playTitles.includes(doc.title.toLowerCase())) return "play";
  return "novel";
}

// deno-lint-ignore no-explicit-any
async function enqueueDocument(admin: any, documentId: string) {
  const { data: doc, error } = await admin
    .from("documents")
    .select("id, title, clean_text, raw_text, tags, language")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw error;
  if (!doc) throw new Error("Document not found");

  // Ensure clean_text exists (run cleaning pipeline if needed)
  let cleanText = doc.clean_text;
  if (!cleanText || cleanText.length < 1000) {
    if (!doc.raw_text) throw new Error("Document has no raw_text to clean");
    const cleaned = cleanRawText(doc.raw_text, inferKind(doc));
    cleanText = cleaned.text;
    await admin.from("documents").update({
      clean_text: cleanText, char_count: cleaned.charCount,
    }).eq("id", doc.id);
  }

  const chunks = chunkText(cleanText!);
  const total = chunks.length;
  if (total === 0) throw new Error("Cleaned text produced 0 chunks");

  const sourceLang = (doc.language ?? "en").toLowerCase();
  const langs = TARGET_LANGUAGES.filter((l) => l !== sourceLang);

  // Existing translations → skip
  const { data: existingT } = await admin
    .from("translation_assets")
    .select("chunk_index, target_language")
    .eq("document_id", doc.id)
    .in("target_language", langs);
  const cachedSet = new Set(
    (existingT ?? []).map((r: { chunk_index: number; target_language: string }) =>
      `${r.chunk_index}:${r.target_language}`),
  );

  // Existing queue rows → skip
  const { data: existingQ } = await admin
    .from("translation_seed_queue")
    .select("chunk_index, target_language")
    .eq("document_id", doc.id);
  const queuedSet = new Set(
    (existingQ ?? []).map((r: { chunk_index: number; target_language: string }) =>
      `${r.chunk_index}:${r.target_language}`),
  );

  const rows: Array<{ document_id: string; chunk_index: number; target_language: string; status: string }> = [];
  let skipped = 0;
  for (let i = 0; i < total; i++) {
    for (const lang of langs) {
      const key = `${i}:${lang}`;
      if (cachedSet.has(key) || queuedSet.has(key)) { skipped++; continue; }
      rows.push({ document_id: doc.id, chunk_index: i, target_language: lang, status: "pending" });
    }
  }

  if (rows.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error: insErr } = await admin
        .from("translation_seed_queue")
        .upsert(slice, { onConflict: "document_id,chunk_index,target_language", ignoreDuplicates: true });
      if (insErr) throw insErr;
    }
  }

  await admin.from("documents")
    .update({ translation_status: "processing" })
    .eq("id", doc.id);

  return { added: rows.length, total_chunks: total, languages: langs.length, skipped };
}

// deno-lint-ignore no-explicit-any
function applyRetryFilters(q: any, filters: { documentId?: string | null; lang?: string | null; category?: string }) {
  let next = q.eq("status", "failed");
  if (filters.documentId) next = next.eq("document_id", filters.documentId);
  if (filters.lang) next = next.eq("target_language", filters.lang);
  if (filters.category === "rate_limited") next = next.ilike("last_error", "rate-limited%");
  if (filters.category === "failed") next = next.not("last_error", "ilike", "rate-limited%");
  return next;
}

// deno-lint-ignore no-explicit-any
async function retryFailedRows(admin: any, filters: { documentId?: string | null; lang?: string | null; category?: string }) {
  let total = 0;
  while (true) {
    const { data: rows, error: selectErr } = await applyRetryFilters(
      admin.from("translation_seed_queue").select("id").order("id", { ascending: true }).limit(MUTATION_BATCH_SIZE),
      filters,
    );
    if (selectErr) throw selectErr;
    const ids = (rows ?? []).map((row: { id: string }) => row.id);
    if (ids.length === 0) break;

    const { error: updateErr } = await admin.from("translation_seed_queue")
      .update({ status: "pending", started_at: null, delayed_until: null, attempts: 0, last_error: null })
      .in("id", ids);
    if (updateErr) throw updateErr;
    total += ids.length;
    if (ids.length < MUTATION_BATCH_SIZE) break;
  }
  return total;
}

// deno-lint-ignore no-explicit-any
async function deleteFailedRows(admin: any) {
  let total = 0;
  while (true) {
    const { data: rows, error: selectErr } = await admin.from("translation_seed_queue")
      .select("id")
      .eq("status", "failed")
      .order("id", { ascending: true })
      .limit(MUTATION_BATCH_SIZE);
    if (selectErr) throw selectErr;
    const ids = (rows ?? []).map((row: { id: string }) => row.id);
    if (ids.length === 0) break;

    const { error: deleteErr } = await admin.from("translation_seed_queue").delete().in("id", ids);
    if (deleteErr) throw deleteErr;
    total += ids.length;
    if (ids.length < MUTATION_BATCH_SIZE) break;
  }
  return total;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from("user_roles")
      .select("id").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "status");

    if (action === "set_seed") {
      const docId = String(body?.document_id ?? "");
      const value = Boolean(body?.value);
      if (!docId) throw new Error("document_id required");
      const { error: updErr } = await admin.from("documents")
        .update({ seed_translation: value })
        .eq("id", docId);
      if (updErr) throw updErr;
      return new Response(JSON.stringify({ ok: true, seed_translation: value }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "enqueue") {
      const docId = String(body?.document_id ?? "");
      if (!docId) throw new Error("document_id required");
      const res = await enqueueDocument(admin, docId);
      return new Response(JSON.stringify({ ok: true, ...res }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "enqueue_all") {
      const { data: docs, error } = await admin
        .from("documents")
        .select("id, title")
        .eq("seed_translation", true)
        .neq("translation_status", "done");
      if (error) throw error;
      const results: Array<Record<string, unknown>> = [];
      for (const d of docs ?? []) {
        try {
          const r = await enqueueDocument(admin, d.id);
          results.push({ document_id: d.id, title: d.title, ...r });
        } catch (e) {
          results.push({
            document_id: d.id, title: d.title, added: 0, total_chunks: 0, skipped: 0,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      const totalAdded = results.reduce((s, r) => s + ((r.added as number) ?? 0), 0);
      return new Response(JSON.stringify({ ok: true, total_added: totalAdded, documents: results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "start") {
      await admin.from("translation_worker_state").update({
        is_running: true, last_heartbeat: new Date().toISOString(), last_error: null,
      }).eq("id", 1);
      return new Response(JSON.stringify({ ok: true, is_running: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "pause") {
      await admin.from("translation_worker_state").update({ is_running: false }).eq("id", 1);
      return new Response(JSON.stringify({ ok: true, is_running: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "reset_stuck") {
      const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data, error } = await admin.from("translation_seed_queue")
        .update({ status: "pending", started_at: null })
        .eq("status", "processing")
        .lt("started_at", cutoff)
        .select("id");
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, reset: data?.length ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "clear_failed") {
      const deleted = await deleteFailedRows(admin);
      return new Response(JSON.stringify({ ok: true, deleted }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "breakdown") {
      // Return an aggregated retry/error breakdown of the queue.
      // Categories are derived from `last_error` + `status`:
      //   - rate_limited   : last_error starts with "rate-limited"
      //   - skipped        : last_error starts with "skipped" OR equals "cached"
      //   - failed         : status = failed (and not rate-limited/skipped above)
      //   - other_pending  : pending/processing rows with a last_error (transient)
      const PAGE = 1000;
      type Row = {
        id: string; document_id: string; chunk_index: number;
        target_language: string; attempts: number; status: string;
        last_error: string | null; delayed_until: string | null; updated_at: string;
      };
      const rows: Row[] = [];
      let from = 0;
      // Pull anything with last_error OR status in (failed, processing) — keeps payload small.
      // deno-lint-ignore no-constant-condition
      while (true) {
        const { data, error } = await admin
          .from("translation_seed_queue")
          .select("id, document_id, chunk_index, target_language, attempts, status, last_error, delayed_until, updated_at")
          .or("status.eq.failed,last_error.not.is.null")
          .order("updated_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = (data ?? []) as Row[];
        rows.push(...batch);
        if (batch.length < PAGE) break;
        from += PAGE;
        if (rows.length >= 10000) break; // safety
      }

      const docIds = Array.from(new Set(rows.map((r) => r.document_id)));
      const titleById = new Map<string, string>();
      if (docIds.length > 0) {
        const { data: titles } = await admin
          .from("documents").select("id, title").in("id", docIds);
        (titles ?? []).forEach((t: { id: string; title: string }) => titleById.set(t.id, t.title));
      }

      function categoryOf(r: Row): "rate_limited" | "skipped" | "failed" | "other_pending" {
        const e = (r.last_error ?? "").toLowerCase();
        if (e.startsWith("rate-limited")) return "rate_limited";
        if (e.startsWith("skipped") || e === "cached") return "skipped";
        if (r.status === "failed") return "failed";
        return "other_pending";
      }

      // Per-language × per-category counts
      const byLang: Record<string, Record<string, number>> = {};
      // Per-attempts × per-category counts
      const byAttempts: Record<string, Record<string, number>> = {};
      // Per-document × per-category counts
      const byDoc = new Map<string, {
        document_id: string; title: string;
        rate_limited: number; skipped: number; failed: number; other_pending: number;
        max_attempts: number; sample_error: string | null;
      }>();
      // Top error messages
      const errorTally = new Map<string, number>();

      for (const r of rows) {
        const cat = categoryOf(r);
        byLang[r.target_language] ??= { rate_limited: 0, skipped: 0, failed: 0, other_pending: 0 };
        byLang[r.target_language][cat]++;
        const aKey = String(r.attempts ?? 0);
        byAttempts[aKey] ??= { rate_limited: 0, skipped: 0, failed: 0, other_pending: 0 };
        byAttempts[aKey][cat]++;
        const dEntry = byDoc.get(r.document_id) ?? {
          document_id: r.document_id,
          title: titleById.get(r.document_id) ?? "(unknown)",
          rate_limited: 0, skipped: 0, failed: 0, other_pending: 0,
          max_attempts: 0, sample_error: null,
        };
        dEntry[cat]++;
        dEntry.max_attempts = Math.max(dEntry.max_attempts, r.attempts ?? 0);
        if (!dEntry.sample_error && r.last_error) dEntry.sample_error = r.last_error;
        byDoc.set(r.document_id, dEntry);
        if (r.last_error) {
          // Normalise: drop trailing chunk-specific identifiers / numbers
          const key = r.last_error.replace(/\b\d+\b/g, "N").slice(0, 160);
          errorTally.set(key, (errorTally.get(key) ?? 0) + 1);
        }
      }

      const documents = Array.from(byDoc.values())
        .sort((a, b) => (b.failed + b.rate_limited) - (a.failed + a.rate_limited))
        .slice(0, 50);
      const top_errors = Array.from(errorTally.entries())
        .map(([message, count]) => ({ message, count }))
        .sort((a, b) => b.count - a.count).slice(0, 10);

      return new Response(JSON.stringify({
        ok: true,
        total_rows: rows.length,
        by_language: byLang,
        by_attempts: byAttempts,
        documents,
        top_errors,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "retry") {
      // Reset matching rows back to `pending` so the worker picks them up again.
      // Optional filters: document_id, target_language, category ("rate_limited"|"failed"|"all_failed")
      const docId = body?.document_id ? String(body.document_id) : null;
      const lang = body?.target_language ? String(body.target_language) : null;
      const category = String(body?.category ?? "all_failed");

      const retried = await retryFailedRows(admin, { documentId: docId, lang, category });
      return new Response(JSON.stringify({ ok: true, retried }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // status
    const [pendingQ, processingQ, doneQ, failedQ, stateQ] = await Promise.all([
      admin.from("translation_seed_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("translation_seed_queue").select("id", { count: "exact", head: true }).eq("status", "processing"),
      admin.from("translation_seed_queue").select("id", { count: "exact", head: true }).eq("status", "done"),
      admin.from("translation_seed_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
      admin.from("translation_worker_state").select("*").eq("id", 1).maybeSingle(),
    ]);
    return new Response(JSON.stringify({
      ok: true,
      counts: {
        pending: pendingQ.count ?? 0,
        processing: processingQ.count ?? 0,
        done: doneQ.count ?? 0,
        failed: failedQ.count ?? 0,
      },
      worker: stateQ.data,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    let msg: string;
    if (e instanceof Error) msg = e.message;
    else if (e && typeof e === "object") {
      const obj = e as Record<string, unknown>;
      msg = (obj.message as string) ?? (obj.error as string) ?? (obj.hint as string) ?? JSON.stringify(obj);
    } else msg = String(e);
    console.error("[seed-translation-manager]", msg, e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
