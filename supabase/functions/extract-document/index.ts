// extract-document edge function
// Receives a storage path to an uploaded file in the 'uploads' bucket,
// extracts text (PDF/DOCX/TXT), normalizes & hashes it (SHA-256),
// dedupes against the global `documents` table, and returns the document_id.
// Also creates a per-user `lessons` row linking to that shared document.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import * as pdfjs from "https://esm.sh/pdfjs-serverless@0.4.2";
import mammoth from "https://esm.sh/mammoth@1.8.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function cleanText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .toLowerCase();
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function inferSubjectType(subject: string): "novel" | "history" | "science" | "other" {
  const s = subject.toLowerCase();
  if (s.includes("novel") || s.includes("literature") || s.includes("english")) return "novel";
  if (s.includes("history")) return "history";
  if (
    s.includes("science") || s.includes("biology") || s.includes("chemistry") ||
    s.includes("physics") || s.includes("life")
  ) return "science";
  return "other";
}

async function extractPdf(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // deno-lint-ignore no-explicit-any
    const strings = content.items.map((it: any) => it.str ?? "").join(" ");
    out += strings + "\n\n";
  }
  return { text: out, pageCount: doc.numPages };
}

async function extractDocx(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  // mammoth expects a Buffer-like object; arrayBuffer works in Deno via the npm shim.
  const result = await mammoth.extractRawText({ arrayBuffer: bytes.buffer });
  return { text: result.value ?? "", pageCount: 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // AuthN: validate the caller using their JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const storagePath: string = body.storage_path;
    const fileName: string = body.file_name ?? "Untitled";
    const fileType: string = (body.file_type ?? "").toLowerCase();
    const subject: string = body.subject ?? "other";
    const language: string = body.language ?? "en";

    if (!storagePath || !fileType) {
      return new Response(JSON.stringify({ error: "storage_path and file_type are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for storage download + privileged writes
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Download the uploaded file
    const { data: fileBlob, error: dlErr } = await admin
      .storage.from("uploads").download(storagePath);
    if (dlErr || !fileBlob) {
      console.error("download error", dlErr);
      return new Response(JSON.stringify({ error: "Failed to download file" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());

    // Extract text
    let extracted = "";
    let pageCount = 0;
    try {
      if (fileType.includes("pdf")) {
        const r = await extractPdf(bytes);
        extracted = r.text; pageCount = r.pageCount;
      } else if (fileType.includes("word") || fileType.includes("docx") || fileType.includes("officedocument")) {
        const r = await extractDocx(bytes);
        extracted = r.text;
      } else if (fileType.includes("text") || fileType.includes("plain") || fileType.includes("txt")) {
        extracted = new TextDecoder().decode(bytes);
      } else {
        return new Response(JSON.stringify({ error: `Unsupported file type: ${fileType}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (e) {
      console.error("extraction error", e);
      return new Response(JSON.stringify({ error: "Failed to extract text from file" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleaned = cleanText(extracted);
    if (cleaned.length < 50) {
      return new Response(JSON.stringify({ error: "Document text is too short or empty" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const contentHash = await sha256Hex(cleaned);
    const subjectType = inferSubjectType(subject);

    // Dedupe: look up existing shared document
    let documentId: string;
    let reused = false;
    const { data: existing } = await admin
      .from("documents")
      .select("id")
      .eq("content_hash", contentHash)
      .maybeSingle();

    if (existing) {
      documentId = existing.id;
      reused = true;
    } else {
      const { data: inserted, error: insErr } = await admin
        .from("documents")
        .insert({
          content_hash: contentHash,
          title: fileName,
          clean_text: cleaned,
          subject_type: subjectType,
          language,
          char_count: cleaned.length,
          page_count: pageCount || null,
        })
        .select("id")
        .single();
      if (insErr || !inserted) {
        console.error("documents insert", insErr);
        return new Response(JSON.stringify({ error: "Failed to save document" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      documentId = inserted.id;
    }

    // Create the user's lesson entry pointing at the shared document.
    // We also need an upload row for the FK on lessons.upload_id.
    const { data: uploadRow, error: upErr } = await admin
      .from("uploads")
      .insert({
        user_id: userId,
        file_name: fileName,
        file_type: fileType,
        file_size_bytes: bytes.byteLength,
        storage_path: storagePath,
        subject,
        status: "processed",
        page_count: pageCount || null,
        extracted_text: null, // text lives in shared documents
      })
      .select("id")
      .single();
    if (upErr || !uploadRow) {
      console.error("uploads insert", upErr);
      return new Response(JSON.stringify({ error: "Failed to save upload record" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: lessonRow, error: lErr } = await admin
      .from("lessons")
      .insert({
        user_id: userId,
        upload_id: uploadRow.id,
        document_id: documentId,
        title: fileName,
        subject,
        content_text: cleaned.slice(0, 200), // small preview only
        language,
      })
      .select("id")
      .single();
    if (lErr) {
      console.error("lessons insert", lErr);
      return new Response(JSON.stringify({ error: "Failed to create lesson" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      reused,
      document_id: documentId,
      lesson_id: lessonRow?.id,
      char_count: cleaned.length,
      page_count: pageCount || null,
      subject_type: subjectType,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    console.error("extract-document error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
