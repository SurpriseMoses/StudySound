// Admin-only: scan a document's cached audio assets and delete rows whose
// recorded clean_text_hash no longer matches the current cleaned text. This
// is the "selective regeneration" sweep — it does NOT generate new audio, it
// just invalidates stale rows so the next on-demand request (or the existing
// seed-audio worker) regenerates them. Clean rows are left untouched.
//
// Body:
//   { document_id: string, language?: string, dry_run?: boolean }
//
// Returns per-language counts of total / clean / dirty / deleted chunks.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE = 1800;

function chunkText(text: string, size = CHUNK_SIZE): string[] {
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

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Admin-only auth check
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("id")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const documentId = body?.document_id as string | undefined;
    const onlyLang = (body?.language as string | undefined)?.toLowerCase();
    const dryRun = body?.dry_run === true;

    if (!documentId) {
      return new Response(JSON.stringify({ error: "document_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: doc } = await admin
      .from("documents")
      .select("id, clean_text, language, cleaning_version")
      .eq("id", documentId)
      .maybeSingle();
    if (!doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sourceChunks = chunkText(doc.clean_text ?? "");
    const sourceLang = (doc.language ?? "en").toLowerCase();

    // For non-source languages we hash the cached translation_assets row. If
    // a translation is missing we treat the audio as dirty (no source of truth).
    let assetsQuery = admin
      .from("audio_assets")
      .select("id, chunk_index, language, clean_text_hash, cleaning_version")
      .eq("document_id", documentId);
    if (onlyLang) assetsQuery = assetsQuery.eq("language", onlyLang);
    const { data: assets, error: aErr } = await assetsQuery;
    if (aErr) throw aErr;

    // Pre-load translations we'll need (only for non-source languages present).
    const langsNeedingTrans = new Set<string>();
    for (const row of assets ?? []) {
      const l = (row.language ?? "").toLowerCase();
      if (l && l !== sourceLang) langsNeedingTrans.add(l);
    }
    const transByKey = new Map<string, string>(); // `${lang}|${chunk}` -> text
    if (langsNeedingTrans.size > 0) {
      const { data: trans } = await admin
        .from("translation_assets")
        .select("chunk_index, target_language, translated_text")
        .eq("document_id", documentId)
        .in("target_language", Array.from(langsNeedingTrans));
      for (const t of trans ?? []) {
        transByKey.set(`${t.target_language.toLowerCase()}|${t.chunk_index}`, t.translated_text);
      }
    }

    // Per-language summary
    type Summary = { total: number; clean: number; dirty: number; deleted: number; missing_text: number };
    const summary: Record<string, Summary> = {};
    const dirtyIds: string[] = [];
    const dirtyDetails: Array<{ id: string; chunk_index: number; language: string; reason: string }> = [];

    for (const row of assets ?? []) {
      const lang = (row.language ?? "").toLowerCase();
      summary[lang] ??= { total: 0, clean: 0, dirty: 0, deleted: 0, missing_text: 0 };
      summary[lang].total += 1;

      // Resolve the text we WOULD speak today for this chunk in this language.
      let ttsText: string | undefined;
      if (lang === sourceLang) {
        ttsText = sourceChunks[row.chunk_index];
      } else {
        // Native voice languages speak the translation; non-native fall back
        // to the source text. We mirror generate-audio's NATIVE_VOICE_LANGS.
        const nativeVoiceLangs = new Set(["en", "af", "zu", "fr", "xh", "nso", "tn"]);
        if (nativeVoiceLangs.has(lang)) {
          ttsText = transByKey.get(`${lang}|${row.chunk_index}`);
          if (!ttsText) {
            // Translation not yet generated → we can't decide; skip (don't delete).
            summary[lang].missing_text += 1;
            continue;
          }
        } else {
          ttsText = sourceChunks[row.chunk_index];
        }
      }

      if (ttsText === undefined) {
        // Chunk index out of range (text was shortened) → audio is orphaned.
        summary[lang].dirty += 1;
        dirtyIds.push(row.id);
        dirtyDetails.push({ id: row.id, chunk_index: row.chunk_index, language: lang, reason: "chunk_out_of_range" });
        continue;
      }

      const expected = await sha256Hex(ttsText);
      if (row.clean_text_hash && row.clean_text_hash === expected) {
        summary[lang].clean += 1;
      } else {
        summary[lang].dirty += 1;
        dirtyIds.push(row.id);
        dirtyDetails.push({
          id: row.id,
          chunk_index: row.chunk_index,
          language: lang,
          reason: row.clean_text_hash ? "hash_mismatch" : "no_hash_recorded",
        });
      }
    }

    if (!dryRun && dirtyIds.length > 0) {
      // Delete in batches of 500 to stay well under PostgREST limits.
      for (let i = 0; i < dirtyIds.length; i += 500) {
        const slice = dirtyIds.slice(i, i + 500);
        const { error: dErr } = await admin.from("audio_assets").delete().in("id", slice);
        if (dErr) throw dErr;
      }
      for (const d of dirtyDetails) {
        summary[d.language].deleted += 1;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        document_id: documentId,
        cleaning_version: doc.cleaning_version,
        total_chunks: sourceChunks.length,
        per_language: summary,
        dirty_count: dirtyIds.length,
        sample_dirty: dirtyDetails.slice(0, 20),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("audit-audio-cache error:", e?.message ?? e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
