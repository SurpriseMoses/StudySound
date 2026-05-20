// seed-queue-manager — admin-only queue management for audio narration.
//
// Actions (POST { action: ... }):
//   "enqueue"        { document_id }       → expand a doc into per-chunk queue rows
//   "enqueue_all"                          → enqueue every seeded doc not yet done
//   "start"                                → flip worker_state.is_running = true
//   "pause"                                → flip worker_state.is_running = false
//   "reset_stuck"                          → reset rows stuck in 'processing' > 5min
//   "clear_failed"                         → delete failed rows so they can be re-added
//   "status"                               → return queue counts + worker state
//
// All actions require an admin caller.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { cleanRawText, type DocKind } from "../_shared/clean-text.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Must match generate-audio (player) chunking exactly so seeded audio aligns
// with what users see on screen.
const TARGET_CHUNK_SIZE = 1800;

function chunkText(text: string, size = TARGET_CHUNK_SIZE): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]+|\S+$/g) ?? [clean];
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + " " + s).length > size && buf.length > 0) {
      chunks.push(buf.trim());
      buf = s;
    } else {
      buf = buf ? buf + " " + s : s;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
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
async function enqueueDocument(admin: any, documentId: string): Promise<{ added: number; total_chunks: number; skipped: number }> {
  const { data: doc, error } = await admin
    .from("documents")
    .select("id, title, clean_text, raw_text, tags")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw error;
  if (!doc) throw new Error("Document not found");

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

  // Existing audio_assets => already done; skip those.
  const { data: existingAudio } = await admin
    .from("audio_assets")
    .select("chunk_index")
    .eq("document_id", doc.id)
    .eq("language", "en")
    .eq("voice_provider", "azure")
    .eq("voice_name", "en-GB-LibbyNeural")
    .eq("speaking_style", "general");
  const cachedSet = new Set((existingAudio ?? []).map((r: { chunk_index: number }) => r.chunk_index));

  // Existing queue rows => skip duplicates.
  const { data: existingQueue } = await admin
    .from("seed_queue")
    .select("chunk_index")
    .eq("document_id", doc.id);
  const queuedSet = new Set((existingQueue ?? []).map((r: { chunk_index: number }) => r.chunk_index));

  const rows: Array<{ document_id: string; chunk_index: number; status: string }> = [];
  let skipped = 0;
  for (let i = 0; i < total; i++) {
    if (cachedSet.has(i) || queuedSet.has(i)) { skipped++; continue; }
    rows.push({ document_id: doc.id, chunk_index: i, status: "pending" });
  }

  if (rows.length > 0) {
    // Batch inserts to stay under PostgREST limits.
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error: insErr } = await admin.from("seed_queue").insert(slice);
      if (insErr) throw insErr;
    }
  }

  // Mark doc processing if it was pending.
  await admin.from("documents")
    .update({ seed_audio_status: "processing", seed_audio_error: null })
    .eq("id", doc.id);

  return { added: rows.length, total_chunks: total, skipped };
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
        .eq("seed_audio", true)
        .neq("seed_audio_status", "done");
      if (error) throw error;
      const results: Array<{ document_id: string; title: string; added: number; total_chunks: number; skipped: number; error?: string }> = [];
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
      const totalAdded = results.reduce((s, r) => s + r.added, 0);
      return new Response(JSON.stringify({ ok: true, total_added: totalAdded, documents: results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "start") {
      await admin.from("seed_worker_state").update({
        is_running: true, last_heartbeat: new Date().toISOString(), last_error: null,
      }).eq("id", 1);
      return new Response(JSON.stringify({ ok: true, is_running: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "pause") {
      await admin.from("seed_worker_state").update({ is_running: false }).eq("id", 1);
      return new Response(JSON.stringify({ ok: true, is_running: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "reset_stuck") {
      const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data, error } = await admin.from("seed_queue")
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
      const { data, error } = await admin.from("seed_queue")
        .delete().eq("status", "failed").select("id");
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, deleted: data?.length ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // status
    const [pendingQ, processingQ, doneQ, failedQ, stateQ] = await Promise.all([
      admin.from("seed_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.from("seed_queue").select("id", { count: "exact", head: true }).eq("status", "processing"),
      admin.from("seed_queue").select("id", { count: "exact", head: true }).eq("status", "done"),
      admin.from("seed_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
      admin.from("seed_worker_state").select("*").eq("id", 1).maybeSingle(),
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
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seed-queue-manager]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
