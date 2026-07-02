// Submit a Gemini Batch that collapses the structuring→tagging→cleaning
// stages for many ingestion_jobs at once. One batch = one grade.
//
// Input: { grade: "10" } — picks all ingestion_jobs for that grade currently
// at state='parsing' (raw text ready) and submits ONE batch containing one
// request per book. Results are written back by batch-ingestion-poll.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { submitBatch, type BatchRequestItem } from "../_shared/gemini-batch.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const GEMINI_KEY = Deno.env.get("Gemini_Secret_Key")!;
const MODEL = "gemini-2.5-flash";
const MAX_INPUT_CHARS = 180_000; // keep each request under Gemini input limits

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const SYSTEM_PROMPT =
  "You process one South African CAPS textbook or chapter at a time.\n" +
  "INPUT: raw extracted text (may contain navigation, headers, footers, page numbers, OCR noise).\n" +
  "TASK: return ONE JSON object with keys:\n" +
  "  clean_text: the pure textbook body with website chrome, TOC pollution, page numbers, headers/footers and duplicated lines removed. Preserve chapter/section headings.\n" +
  "  grade: string like '8','9','10','11','12' or null\n" +
  "  subject: string like 'Mathematics','Physical Sciences','Life Sciences','Mathematical Literacy','Afrikaans','English','Geography','History','Life Orientation','Natural Sciences','Technology','Economic and Management Sciences','Creative Arts' or null\n" +
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
    const { data: role } = await user.from("user_roles").select("role").eq("user_id", u.id).eq("role", "admin").maybeSingle();
    if (!role) return j({ error: "forbidden" }, 403);

    const { grade } = (await req.json()) as { grade?: string };
    if (!grade) return j({ error: "grade required" }, 400);

    // Pick all jobs for this grade currently at parsing (raw_text ready)
    const { data: jobs } = await admin.from("ingestion_jobs")
      .select("id,grade,subject,title_hint,input_raw_text")
      .eq("grade", grade)
      .eq("state", "parsing")
      .is("batch_job_id", null)
      .limit(100);

    const ready = (jobs ?? []).filter((r) => (r.input_raw_text ?? "").length > 300);
    if (ready.length === 0) return j({ error: "no parsing jobs with raw text ready", grade }, 400);

    const requests: BatchRequestItem[] = ready.map((r) => ({
      request: {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          role: "user",
          parts: [{ text:
            `Title hint: ${r.title_hint ?? "unknown"}\nGrade hint: ${r.grade ?? "?"}\nSubject hint: ${r.subject ?? "?"}\n\n` +
            `--- RAW TEXT ---\n${String(r.input_raw_text).slice(0, MAX_INPUT_CHARS)}` }],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: 32768,
        },
      },
    }));

    const submit = await submitBatch(MODEL, requests, GEMINI_KEY, `ingest-g${grade}-${Date.now()}`);

    const { data: batchRow, error: bErr } = await admin.from("ingestion_batch_jobs").insert({
      grade, stage: "clean_tag", state: "submitted",
      gemini_batch_name: submit.name, item_count: ready.length,
      submitted_at: new Date().toISOString(), created_by: u.id,
    }).select("id").single();
    if (bErr) throw bErr;

    // Link items + jobs
    const items = ready.map((r, i) => ({
      batch_job_id: batchRow.id, ingestion_job_id: r.id, position: i, status: "pending",
    }));
    await admin.from("ingestion_batch_items").insert(items);
    await admin.from("ingestion_jobs")
      .update({ batch_job_id: batchRow.id, batch_stage: "clean_tag", state: "structuring" })
      .in("id", ready.map((r) => r.id));

    return j({ batch_id: batchRow.id, gemini_batch: submit.name, item_count: ready.length, grade });
  } catch (e: any) {
    return j({ error: String(e?.message ?? e) }, 500);
  }
});

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
