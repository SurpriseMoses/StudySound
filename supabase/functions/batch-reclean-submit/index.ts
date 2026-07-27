// Re-clean already-ingested textbooks for a grade via Gemini Batch.
// Feeds each document's CURRENT clean_text back through the same
// clean_tag prompt used at ingestion. On poll success (stage='reclean'),
// batch-ingestion-poll overwrites documents.clean_text, bumps
// cleaning_version, purges chunks/audio/translations, and kicks
// backfill-pipeline to re-chunk + re-embed.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { submitBatch, type BatchRequestItem } from "../_shared/gemini-batch.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const GEMINI_KEY = Deno.env.get("Gemini_Secret_Key")!;
const MODEL = "gemini-2.5-flash";
const MAX_INPUT_CHARS = 180_000;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const SYSTEM_PROMPT =
  "You RE-CLEAN a South African CAPS textbook body that has already been extracted but still contains residual noise.\n" +
  "INPUT: previously-cleaned textbook text that may still contain page numbers, running headers/footers, TOC pollution, duplicated lines, OCR artefacts or navigation remnants.\n" +
  "TASK: return ONE JSON object with keys:\n" +
  "  clean_text: the pure textbook body. Remove page numbers, running headers/footers, repeated navigation, duplicated lines and OCR noise. Preserve chapter/section headings and worked examples verbatim. Do NOT summarise or paraphrase.\n" +
  "  grade: string like '8'..'12' or null\n" +
  "  subject: canonical CAPS subject or null\n" +
  "  topic: short topic string or null\n" +
  "  confidence: 0..1\n" +
  "Return ONLY the JSON, no markdown, no code fences.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const user = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user: u } } = await user.auth.getUser();
    if (!u) return j({ error: "unauthorized" }, 401);
    const { data: role } = await user.from("user_roles")
      .select("role").eq("user_id", u.id).eq("role", "admin").maybeSingle();
    if (!role) return j({ error: "forbidden" }, 403);

    const { grade, document_ids } = (await req.json()) as { grade?: string; document_ids?: string[] };
    if (!grade && !(document_ids && document_ids.length)) {
      return j({ error: "grade or document_ids required" }, 400);
    }

    // Resolve target document IDs
    let docIds: string[] = document_ids ?? [];
    if (!docIds.length && grade) {
      const { data: jobs } = await admin.from("ingestion_jobs")
        .select("document_id,grade,state")
        .eq("grade", grade)
        .eq("state", "completed")
        .not("document_id", "is", null)
        .limit(200);
      docIds = Array.from(new Set((jobs ?? []).map((r: any) => r.document_id).filter(Boolean)));
    }
    if (!docIds.length) return j({ error: "no completed documents for grade", grade }, 400);

    const { data: docs } = await admin.from("documents")
      .select("id,title,grade_level,clean_text,tags")
      .in("id", docIds);
    const ready = (docs ?? []).filter((d: any) => (d.clean_text ?? "").length > 500);
    if (!ready.length) return j({ error: "no documents have clean_text to re-clean" }, 400);

    const requests: BatchRequestItem[] = ready.map((d: any) => ({
      request: {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          role: "user",
          parts: [{ text:
            `Title: ${d.title ?? "unknown"}\nGrade: ${d.grade_level ?? grade ?? "?"}\n\n` +
            `--- CURRENT CLEAN TEXT ---\n${String(d.clean_text).slice(0, MAX_INPUT_CHARS)}` }],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: 32768,
        },
      },
    }));

    const submit = await submitBatch(
      MODEL, requests, GEMINI_KEY,
      `reclean-g${grade ?? "custom"}-${Date.now()}`,
    );

    const { data: batchRow, error: bErr } = await admin.from("ingestion_batch_jobs").insert({
      grade: grade ?? "custom",
      stage: "reclean",
      state: "submitted",
      gemini_batch_name: submit.name,
      item_count: ready.length,
      submitted_at: new Date().toISOString(),
      created_by: u.id,
    }).select("id").single();
    if (bErr) throw bErr;

    // Create shadow ingestion_jobs so ingestion_batch_items FK is satisfied
    // and we get per-doc traceability in the standard admin views.
    const shadowJobs = ready.map((d: any) => ({
      document_id: d.id,
      grade: grade ?? null,
      title_hint: `Re-clean: ${d.title ?? d.id}`,
      state: "batching" as const,
      batch_job_id: batchRow.id,
      batch_stage: "reclean",
      created_by: u.id,
    }));
    const { data: inserted, error: sjErr } = await admin.from("ingestion_jobs")
      .insert(shadowJobs).select("id,document_id");
    if (sjErr) throw sjErr;

    // Preserve order alignment with `ready`
    const byDoc = new Map<string, string>((inserted ?? []).map((r: any) => [r.document_id, r.id]));
    const items = ready.map((d: any, i: number) => ({
      batch_job_id: batchRow.id,
      ingestion_job_id: byDoc.get(d.id)!,
      position: i,
      status: "pending",
    }));
    await admin.from("ingestion_batch_items").insert(items);

    return j({
      batch_id: batchRow.id,
      gemini_batch: submit.name,
      item_count: ready.length,
      grade: grade ?? "custom",
      stage: "reclean",
    });
  } catch (e: any) {
    return j({ error: String(e?.message ?? e) }, 500);
  }
});

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
