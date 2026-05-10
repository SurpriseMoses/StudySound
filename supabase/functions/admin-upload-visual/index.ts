// Admin-only: upload a visual scene image for a document.
// Stores file in `assets` bucket at visuals/{doc}/scene-{n}.{ext} and upserts image_assets row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const document_id: string = body.document_id;
    const scene_index: number = Number(body.scene_index);
    const prompt_text: string = (body.prompt_text || "").toString().slice(0, 500);
    const image_base64: string = body.image_base64;
    const content_type: string = body.content_type || "image/png";

    if (!document_id || !Number.isInteger(scene_index) || scene_index < 0 || scene_index > 9) {
      throw new Error("document_id and valid scene_index (0-9) required");
    }
    if (!image_base64 || typeof image_base64 !== "string") throw new Error("image_base64 required");

    const ext = content_type.includes("jpeg") || content_type.includes("jpg")
      ? "jpg"
      : content_type.includes("webp") ? "webp" : "png";
    const storagePath = `visuals/${document_id}/scene-${scene_index}.${ext}`;

    const bytes = b64ToBytes(image_base64);
    if (bytes.length === 0) throw new Error("Empty image");
    if (bytes.length > 8 * 1024 * 1024) throw new Error("Image too large (max 8MB)");

    const blob = new Blob([bytes as BlobPart], { type: content_type });
    const { error: upErr } = await admin.storage
      .from("assets")
      .upload(storagePath, blob, { contentType: content_type, upsert: true });
    if (upErr) throw upErr;

    // Remove any existing rows for this scene (different ext or stale prompt) then insert.
    await admin.from("image_assets")
      .delete()
      .eq("document_id", document_id)
      .eq("scene_index", scene_index);

    const { data: row, error: insErr } = await admin
      .from("image_assets")
      .insert({
        document_id,
        scene_index,
        prompt_text: prompt_text || `Manual upload scene ${scene_index}`,
        storage_path: storagePath,
      })
      .select()
      .single();
    if (insErr) throw insErr;

    return new Response(JSON.stringify({ success: true, asset: row }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("admin-upload-visual error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
