// Admin entrypoint to create a new ingestion job.
// Validates license via the DB trigger and returns the job id.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

interface Body {
  source_id: string;
  input_url?: string;
  input_upload_path?: string;
  input_raw_text?: string;
  title_hint?: string;
  grade?: string;
  subject?: string;
  curriculum?: string;
  country?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user }, error: uerr } = await userClient.auth.getUser();
    if (uerr || !user) {
      return json({ error: "unauthorized" }, 401);
    }

    const { data: roleRow } = await userClient
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "forbidden" }, 403);

    const body = (await req.json()) as Body;
    if (!body?.source_id) return json({ error: "source_id required" }, 400);
    if (!body.input_url && !body.input_upload_path && !body.input_raw_text) {
      return json({ error: "one of input_url, input_upload_path, input_raw_text required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: job, error } = await admin.from("ingestion_jobs").insert({
      source_id: body.source_id,
      input_url: body.input_url ?? null,
      input_upload_path: body.input_upload_path ?? null,
      input_raw_text: body.input_raw_text ?? null,
      title_hint: body.title_hint ?? null,
      grade: body.grade ?? null,
      subject: body.subject ?? null,
      curriculum: body.curriculum ?? null,
      country: body.country ?? null,
      created_by: user.id,
      state: "pending",
    }).select("id").single();

    if (error) return json({ error: error.message }, 400);

    await admin.from("ingestion_stage_logs").insert({
      job_id: job.id, stage: "pending", status: "info", message: "Job created",
    });

    // Fire-and-forget kick of the worker so the user sees movement immediately.
    fetch(`${SUPABASE_URL}/functions/v1/ingestion-worker`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": ANON },
      body: JSON.stringify({ job_id: job.id }),
    }).catch(() => {});

    return json({ job_id: job.id });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
