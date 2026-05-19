// Generates 4 visual scenes per document using Lovable AI (Gemini 3.1 Flash Image).
// Globally cached: scenes are keyed by document_id, so all users share & reuse them for free.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MIN_SCENES = 10;
const MAX_SCENES = 12;
const HUMANITIES_TYPES = new Set(["novel", "history"]);

// Scale scene count to book length: ~10 for shorter books, up to 12 for long ones.
function targetSceneCount(charCount: number): number {
  if (charCount >= 400_000) return 12;
  if (charCount >= 200_000) return 11;
  return MIN_SCENES;
}

interface ScenePlan {
  scene_index: number;
  paragraph: string;
  prompt: string;
}

function chunkText(text: string, n: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const size = Math.max(200, Math.ceil(clean.length / n));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const slice = clean.slice(i * size, (i + 1) * size).trim();
    if (slice) out.push(slice);
  }
  return out;
}

async function planScenes(
  apiKey: string,
  title: string,
  subjectType: string,
  excerpts: string[],
  sceneCount: number,
): Promise<ScenePlan[]> {
  const sys = `You write vivid, concrete image prompts for an illustrator. Subject type: ${subjectType}. Style: warm, cinematic, painterly digital illustration suitable for African high-school students. No text in image, no watermarks. Keep characters consistent across scenes (describe them the same way each time).`;
  const user = `Book/Lesson: "${title}"

Produce exactly ${sceneCount} image scenes covering the work in chronological order. For each numbered excerpt below, write ONE image prompt (1-2 sentences, max 60 words) that captures the most striking visual moment. Also include the exact short paragraph (max 220 chars) that the image illustrates.

${excerpts.map((e, i) => `EXCERPT ${i + 1}:\n${e.slice(0, 1200)}`).join("\n\n")}`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "emit_scenes",
            description: "Emit illustrated scenes for the lesson",
            parameters: {
              type: "object",
              properties: {
                scenes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      scene_index: { type: "integer" },
                      paragraph: { type: "string" },
                      prompt: { type: "string" },
                    },
                    required: ["scene_index", "paragraph", "prompt"],
                  },
                },
              },
              required: ["scenes"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "emit_scenes" } },
    }),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Scene planning failed [${resp.status}]: ${t}`);
  }
  const data = await resp.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("No scene plan returned");
  const parsed = JSON.parse(args);
  return (parsed.scenes as ScenePlan[]);
}

async function generateImage(apiKey: string, prompt: string): Promise<Uint8Array> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.1-flash-image-preview",
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Image gen failed [${resp.status}]: ${t}`);
  }
  const data = await resp.json();
  const url: string | undefined = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url || !url.startsWith("data:")) throw new Error("No image returned");
  const base64 = url.split(",")[1];
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { lesson_id } = await req.json();
    if (!lesson_id) throw new Error("lesson_id required");

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Get lesson + document
    const { data: lesson, error: lessonErr } = await admin
      .from("lessons")
      .select("id, title, content_text, document_id, documents(id, title, subject_type, clean_text)")
      .eq("id", lesson_id)
      .maybeSingle();
    if (lessonErr || !lesson) throw new Error("Lesson not found");

    const doc: any = (lesson as any).documents;
    if (!doc) throw new Error("Lesson has no source document");

    const subjectType = doc.subject_type ?? "other";
    if (!HUMANITIES_TYPES.has(subjectType)) {
      return new Response(
        JSON.stringify({ error: "Visual scenes are available for humanities subjects only (novels, history)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check cache (global, by document_id)
    const { data: existing } = await admin
      .from("image_assets")
      .select("id, scene_index, prompt_text, storage_path")
      .eq("document_id", doc.id)
      .order("scene_index", { ascending: true });

    const sourceText: string = doc.clean_text || lesson.content_text || "";
    const sceneCount = targetSceneCount((sourceText || "").length);

    if (existing && existing.length >= sceneCount) {
      return new Response(JSON.stringify({ success: true, reused: true, scenes: existing }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Plan scenes for the FULL target (so chronology stays coherent), then skip already-generated indices.
    const excerpts = chunkText(sourceText, sceneCount);
    if (excerpts.length === 0) throw new Error("No text to illustrate");

    const allPlans = await planScenes(LOVABLE_API_KEY, lesson.title, subjectType, excerpts, sceneCount);
    const existingIdx = new Set((existing ?? []).map((r: any) => r.scene_index));
    const plans = allPlans.filter((p) => !existingIdx.has(p.scene_index)).slice(0, sceneCount);

    // Generate + upload each scene (sequentially, verify upload before DB insert)
    const created: any[] = [];
    for (const plan of plans) {
      try {
        const bytes = await generateImage(LOVABLE_API_KEY, plan.prompt);
        console.log(`Scene ${plan.scene_index}: generated ${bytes.length} bytes`);
        if (bytes.length === 0) throw new Error("Empty image bytes");

        const storagePath = `visuals/${doc.id}/scene-${plan.scene_index}.png`;

        // Upload as Blob (more reliable in Deno than raw Uint8Array)
        const blob = new Blob([bytes as BlobPart], { type: "image/png" });
        const { error: upErr } = await admin.storage
          .from("assets")
          .upload(storagePath, blob, { contentType: "image/png", upsert: true });
        if (upErr) {
          console.error(`Scene ${plan.scene_index}: upload error`, upErr);
          throw upErr;
        }

        // Verify the file actually exists by listing it
        const { data: listData, error: listErr } = await admin.storage
          .from("assets")
          .list(`visuals/${doc.id}`, { search: `scene-${plan.scene_index}.png` });
        if (listErr || !listData || listData.length === 0) {
          throw new Error(`Upload verification failed for scene ${plan.scene_index}`);
        }
        console.log(`Scene ${plan.scene_index}: verified at ${storagePath}`);

        const { data: row, error: insErr } = await admin
          .from("image_assets")
          .insert({
            document_id: doc.id,
            scene_index: plan.scene_index,
            prompt_text: plan.prompt,
            storage_path: storagePath,
          })
          .select()
          .single();
        if (insErr) throw insErr;
        created.push({ ...row, paragraph: plan.paragraph });
      } catch (e) {
        console.error(`Scene ${plan.scene_index} failed:`, e instanceof Error ? e.message : e);
      }
    }

    if (created.length === 0 && (!existing || existing.length === 0)) {
      throw new Error("All scenes failed to generate. Check function logs.");
    }

    const allScenes = [...(existing ?? []), ...created].sort(
      (a: any, b: any) => a.scene_index - b.scene_index,
    );
    return new Response(JSON.stringify({ success: true, reused: false, scenes: allScenes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("generate-visuals error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
