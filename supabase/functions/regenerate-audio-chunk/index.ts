// Admin-only: delete cached audio_assets row + storage object for a (document, chunk, language).
// The next /listen request will re-render fresh audio with the current SSML settings.
// The user is NOT charged again — their user_chunk_access record persists.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Verify caller is admin
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { lesson_id, chunk_index, language } = await req.json();
    if (!lesson_id || chunk_index === undefined || !language) {
      return new Response(
        JSON.stringify({ error: "lesson_id, chunk_index, language required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve document_id from lesson
    const { data: lesson } = await admin
      .from("lessons")
      .select("document_id")
      .eq("id", lesson_id)
      .maybeSingle();
    if (!lesson?.document_id) throw new Error("Lesson or document not found");

    // Find cached row(s) matching this chunk/language across providers
    const { data: rows } = await admin
      .from("audio_assets")
      .select("id, storage_path")
      .eq("document_id", lesson.document_id)
      .eq("chunk_index", chunk_index)
      .eq("language", language);

    let removedFiles = 0;
    if (rows && rows.length > 0) {
      const paths = rows.map((r) => r.storage_path);
      const { error: rmErr } = await admin.storage.from("assets").remove(paths);
      if (!rmErr) removedFiles = paths.length;
      const ids = rows.map((r) => r.id);
      await admin.from("audio_assets").delete().in("id", ids);
    }

    return new Response(
      JSON.stringify({ success: true, deleted_rows: rows?.length ?? 0, deleted_files: removedFiles }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("regenerate-audio-chunk error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
