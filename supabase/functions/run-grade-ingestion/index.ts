// Orchestrator: enumerate subjects for a grade, create ingestion_jobs for each
// missing one, and kick the ingestion-worker so they progress through
// download+parse. Once workers finish parsing, admin calls
// batch-ingestion-submit to collapse the AI-heavy stages via Gemini Batch.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// DBE for G8-9 (workbooks index), Siyavula for G10-12 (subject-specific URLs).
const SIYAVULA_URLS: Record<string, Record<string, string>> = {
  "10": {
    "Mathematics": "https://www.siyavula.com/read/za/mathematics/grade-10",
    "Physical Sciences": "https://www.siyavula.com/read/za/physical-sciences/grade-10",
    "Life Sciences": "https://www.siyavula.com/read/za/life-sciences/grade-10",
    "Mathematical Literacy": "https://www.siyavula.com/read/za/mathematical-literacy/grade-10",
  },
  "11": {
    "Mathematics": "https://www.siyavula.com/read/za/mathematics/grade-11",
    "Physical Sciences": "https://www.siyavula.com/read/za/physical-sciences/grade-11",
    "Life Sciences": "https://www.siyavula.com/read/za/life-sciences/grade-11",
    "Mathematical Literacy": "https://www.siyavula.com/read/za/mathematical-literacy/grade-11",
  },
  "12": {
    "Mathematics": "https://www.siyavula.com/read/za/mathematics/grade-12",
    "Physical Sciences": "https://www.siyavula.com/read/za/physical-sciences/grade-12",
    "Mathematical Literacy": "https://www.siyavula.com/read/za/mathematical-literacy/grade-12",
  },
};

const DBE_INDEX = "https://www.education.gov.za/Curriculum/LearningandTeachingSupportMaterials(LTSM)/2026Workbooks1.aspx";
const DBE_SUBJECTS = [
  "Mathematics","Natural Sciences","Technology","Social Sciences",
  "English","Afrikaans","Life Orientation","Economic and Management Sciences","Creative Arts",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return j({ error: "unauthorized" }, 401);
    const { data: role } = await userClient.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!role) return j({ error: "forbidden" }, 403);

    const body = (await req.json()) as { grade: string };
    const grade = String(body.grade);
    const isDbe = grade === "8" || grade === "9";

    // Pick a source for this provider
    const sourceName = isDbe ? "DBE Workbooks" : "Siyavula";
    const { data: sources } = await admin.from("content_sources")
      .select("id,name,source_url").ilike("name", `%${sourceName}%`)
      .eq("verification_status", "verified").limit(1);
    const source = sources?.[0];
    if (!source) return j({ error: `no verified source matching ${sourceName}` }, 400);

    const plan: { subject: string; url: string }[] = [];
    if (isDbe) {
      for (const s of DBE_SUBJECTS) plan.push({ subject: s, url: DBE_INDEX });
    } else {
      const grd = SIYAVULA_URLS[grade] ?? {};
      for (const [subject, url] of Object.entries(grd)) plan.push({ subject, url });
    }

    const created: string[] = [];
    const existing: string[] = [];
    const errors: { subject: string; error: string }[] = [];
    for (const item of plan) {
      const { data: existRow } = await admin.from("ingestion_jobs")
        .select("id,state")
        .eq("grade", grade).eq("subject", item.subject)
        .not("state", "in", "(failed,cancelled)")
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (existRow) { existing.push(existRow.id); continue; }
      // Make URL unique per subject so uq_ingestion_jobs_active_url doesn't collide
      // when many subjects share the same index page (DBE case).
      const uniqueUrl = item.url.includes("#")
        ? item.url
        : `${item.url}#g${grade}-${encodeURIComponent(item.subject)}`;
      const { data: newJob, error } = await admin.from("ingestion_jobs").insert({
        source_id: source.id, input_url: uniqueUrl,
        title_hint: `${item.subject} — Grade ${grade}`,
        grade, subject: item.subject, curriculum: "CAPS", country: "ZA",
        created_by: user.id, state: "pending",
      }).select("id").maybeSingle();
      if (error) { errors.push({ subject: item.subject, error: error.message }); continue; }
      if (newJob) created.push(newJob.id);
    }

    // Kick worker to start download+parse on new jobs
    for (const jobId of [...created, ...existing]) {
      fetch(`${SUPABASE_URL}/functions/v1/ingestion-worker`, {
        method: "POST", headers: { "Content-Type": "application/json", apikey: ANON },
        body: JSON.stringify({ job_id: jobId }),
      }).catch(() => {});
    }

    return j({ grade, created: created.length, existing: existing.length, errors, subjects: plan.map((p) => p.subject) });
  } catch (e: any) {
    return j({ error: String(e?.message ?? e) }, 500);
  }
});

function j(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
