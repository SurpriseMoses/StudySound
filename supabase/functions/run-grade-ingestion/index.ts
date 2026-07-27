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
// Senior Phase CAPS PDFs cover Grades 7–9 collectively, so G9 reuses the same
// direct PDFs as G8. Worker hashes are scoped by grade|subject|text, so this
// won't collide with the existing G8 documents.
const DBE_GRADE_8_CAPS_URLS: Record<string, string> = {
  "Mathematics": "https://www.education.gov.za/LinkClick.aspx?fileticket=uCNqOwfGbmc%3d&tabid=573&portalid=0&mid=1629",
  "Natural Sciences": "https://www.education.gov.za/LinkClick.aspx?fileticket=zhaFloMyZTs%3d&tabid=573&portalid=0&mid=1629",
  "Technology": "https://www.education.gov.za/LinkClick.aspx?fileticket=41Ak4eHaKt4%3d&tabid=573&portalid=0&mid=1629",
  "Social Sciences": "https://www.education.gov.za/LinkClick.aspx?fileticket=6jpCz5DCZ08%3d&tabid=573&portalid=0&mid=1629",
  "English": "https://www.education.gov.za/LinkClick.aspx?fileticket=5xCztldu-Kw%3d&tabid=573&portalid=0&mid=1569",
  "Afrikaans": "https://www.education.gov.za/LinkClick.aspx?fileticket=slLbge-bPMk%3d&tabid=573&portalid=0&mid=1569",
  "Life Orientation": "https://www.education.gov.za/LinkClick.aspx?fileticket=ANFLxkl-Hgk%3d&tabid=573&portalid=0&mid=1629",
  "Economic and Management Sciences": "https://www.education.gov.za/LinkClick.aspx?fileticket=YEgQQlsQNCw%3d&tabid=573&portalid=0&mid=1629",
  "Creative Arts": "https://www.education.gov.za/LinkClick.aspx?fileticket=EqlGbEbaejU%3d&tabid=573&portalid=0&mid=1629",
};
const DBE_GRADE_9_CAPS_URLS: Record<string, string> = { ...DBE_GRADE_8_CAPS_URLS };
const DBE_SUBJECTS = Object.keys(DBE_GRADE_8_CAPS_URLS);

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
      const map = grade === "8" ? DBE_GRADE_8_CAPS_URLS : DBE_GRADE_9_CAPS_URLS;
      for (const s of DBE_SUBJECTS) plan.push({ subject: s, url: map[s] });
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
        .not("state", "in", "(completed,failed,cancelled)")
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (existRow) { existing.push(existRow.id); continue; }
      // Make shared index URLs unique per subject so active-url de-dupe doesn't
      // collide. Subject-specific DBE CAPS URLs are already unique and should
      // stay unmodified so the worker downloads the PDF directly.
      const uniqueUrl = item.url === DBE_INDEX && !item.url.includes("#")
        ? `${item.url}#g${grade}-${encodeURIComponent(item.subject)}`
        : item.url;
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
