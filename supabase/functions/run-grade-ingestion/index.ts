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
    "Mathematical Literacy": "https://www.education.gov.za/LinkClick.aspx?fileticket=q8-SkGy43rw%3d&tabid=570&portalid=0&mid=1558#g10-mathlit",
  },
  "11": {
    "Mathematics": "https://www.siyavula.com/read/za/mathematics/grade-11",
    "Physical Sciences": "https://www.siyavula.com/read/za/physical-sciences/grade-11",
    "Life Sciences": "https://www.siyavula.com/read/za/life-sciences/grade-11",
    // Siyavula does not publish Mathematical Literacy — use the DBE CAPS PDF
    // (covers Grades 10-12; grade-scoped hash keeps the URL unique per job).
    "Mathematical Literacy": "https://www.education.gov.za/LinkClick.aspx?fileticket=q8-SkGy43rw%3d&tabid=570&portalid=0&mid=1558#g11-mathlit",
  },
  "12": {
    "Mathematics": "https://www.siyavula.com/read/za/mathematics/grade-12",
    "Physical Sciences": "https://www.siyavula.com/read/za/physical-sciences/grade-12",
    "Mathematical Literacy": "https://www.education.gov.za/LinkClick.aspx?fileticket=q8-SkGy43rw%3d&tabid=570&portalid=0&mid=1558#g12-mathlit",
  },
};

// Senior Phase (Gr 8-9): Sasol Inzalo Foundation / Ukuqonda + Siyavula learner
// textbooks (CC-BY). These replaced the DBE CAPS curriculum statements, which
// are policy documents rather than teachable learner content.
// Multi-volume books are ingested as separate passes (book 1 then book 2) —
// the active grade+subject unique index only allows one in flight at a time.
const SENIOR_PHASE_BOOKS: Record<string, Record<string, string[]>> = {
  "8": {
    "Mathematics": [
      "https://www.siyavula.com/downloads/books/maths/Gr8A_Mathematics_Learner_Eng.pdf",
      "https://www.siyavula.com/downloads/books/maths/Gr8B_Mathematics_Learner_Eng.pdf",
    ],
    "Natural Sciences": [
      "https://www.siyavula.com/downloads/books/science/Gr8_A_learner_eng.pdf",
      "https://www.siyavula.com/downloads/books/science/Gr8_B_learner_eng.pdf",
    ],
    "Technology": [
      "https://www.stanmorephysics.com/wp-content/uploads/2020/05/Tech1_Gr8_LB.pdf",
      "https://www.stanmorephysics.com/wp-content/uploads/2020/05/Tech2_Gr8_LB.pdf",
    ],
  },
  "9": {
    "Mathematics": [
      "https://www.siyavula.com/downloads/books/maths/Gr9A_Mathematics_Learner_Eng.pdf",
      "https://www.siyavula.com/downloads/books/maths/Gr9B_Mathematics_Learner_Eng.pdf",
    ],
    "Natural Sciences": [
      "https://www.siyavula.com/downloads/books/science/Gr9_A_learner_eng.pdf",
      "https://www.siyavula.com/downloads/books/science/Gr9_B_learner_eng.pdf",
    ],
    "Technology": [
      "https://www.stanmorephysics.com/wp-content/uploads/2020/05/Tech1_Gr9_LB.pdf",
      "https://www.stanmorephysics.com/wp-content/uploads/2020/05/Tech2_Gr9_LB.pdf",
    ],
  },
};


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

    const plan: { subject: string; url: string; volume?: number }[] = [];
    if (isDbe) {
      const books = SENIOR_PHASE_BOOKS[grade] ?? {};
      for (const [subject, urls] of Object.entries(books)) {
        urls.forEach((url, i) => plan.push({ subject, url, volume: i + 1 }));
      }
    } else {
      const grd = SIYAVULA_URLS[grade] ?? {};
      for (const [subject, url] of Object.entries(grd)) plan.push({ subject, url });
    }

    // Free up scopes blocked by dead workers before planning new jobs.
    await admin.rpc("reclaim_stale_ingestion_jobs", { _stale_minutes: 30 });

    const created: string[] = [];
    const existing: string[] = [];
    const errors: { subject: string; error: string }[] = [];
    const skippedSubjects = new Set<string>();
    for (const item of plan) {
      // Only one job per grade+subject may be active (unique index). Multi-volume
      // books queue volume by volume: skip later volumes whose sibling is active
      // or already completed.
      if (skippedSubjects.has(item.subject)) continue;
      const idempotencyKey = item.volume
        ? `caps|ZA|g${grade}|${item.subject}|v${item.volume}`
        : `caps|ZA|g${grade}|${item.subject}`;

      const { data: doneRow } = await admin.from("ingestion_jobs")
        .select("id").eq("idempotency_key", idempotencyKey).eq("state", "completed")
        .limit(1).maybeSingle();
      if (doneRow) continue; // this volume already ingested, try the next one

      const { data: existRow } = await admin.from("ingestion_jobs")
        .select("id,state")
        .eq("grade", grade).eq("subject", item.subject)
        .not("state", "in", "(completed,failed,cancelled)")
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (existRow) { existing.push(existRow.id); skippedSubjects.add(item.subject); continue; }

      const uniqueUrl = item.url.includes("#")
        ? item.url
        : `${item.url}#g${grade}-${encodeURIComponent(item.subject)}`;
      const { data: newJob, error } = await admin.from("ingestion_jobs").insert({
        source_id: source.id, input_url: uniqueUrl,
        title_hint: item.volume && item.volume > 1
          ? `${item.subject} — Grade ${grade} (Book ${item.volume})`
          : `${item.subject} — Grade ${grade}`,
        grade, subject: item.subject, curriculum: "CAPS", country: "ZA",
        created_by: user.id, state: "pending",
        idempotency_key: idempotencyKey,
      }).select("id").maybeSingle();
      if (error) {
        // Unique-index races (idempotency key / scope / active url) mean another
        // kick already created this job — reuse it instead of piling up.
        const msg = String(error.message ?? "");
        if (error.code === "23505" || msg.includes("uq_ingestion_jobs_active")) {
          const { data: dupe } = await admin.from("ingestion_jobs")
            .select("id")
            .eq("grade", grade).eq("subject", item.subject)
            .not("state", "in", "(completed,failed,cancelled)")
            .order("created_at", { ascending: false })
            .limit(1).maybeSingle();
          if (dupe?.id) { existing.push(dupe.id); skippedSubjects.add(item.subject); continue; }
        }
        errors.push({ subject: item.subject, error: msg });
        continue;
      }
      if (newJob) { created.push(newJob.id); skippedSubjects.add(item.subject); }
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
