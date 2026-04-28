// Admin-only endpoints (single function, action-routed).
// Actions:
//   analytics            – legacy 30d cards (kept for back-compat with old Overview)
//   business_metrics     – aggregated revenue/cost/usage metrics
//   credit_timeseries    – daily credit-spend split by feature
//   top_documents        – revenue leaderboard
//   abuse_candidates     – users near or over abuse thresholds
//   regenerate_document  – wipe cached audio for a document
//   set_role             – grant/revoke admin
//   adjust_credits       – +/- credits on a profile (logs credit_transactions)
//   flag_user            – set is_flagged + reason
//   unflag_user          – clear flag + cooldown
//   apply_cooldown       – set cooldown_until = now() + N minutes
//   reset_user_counters  – delete today's translation_rate_log rows for a user
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { cleanRawText, isInvalidChunk, type DocKind } from "../_shared/clean-text.ts";

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
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: roleRow } = await admin
      .from("user_roles").select("id").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;
    const adminId = user.id;

    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // -------------------- READ ACTIONS --------------------

    if (action === "analytics") {
      // Legacy 30d cards used by current Overview page (kept for back-compat).
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [{ count: profileCount }, { data: lessonsRecent }, { data: usage }, { data: docs }] = await Promise.all([
        admin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since),
        admin.from("lessons").select("id, created_at").gte("created_at", since),
        admin.from("user_usage").select("credits_used, action_type, created_at").gte("created_at", since),
        admin.from("audio_assets").select("char_count, duration_seconds, created_at").gte("created_at", since),
      ]);

      const totalCredits = (usage ?? []).reduce((s, r) => s + (r.credits_used ?? 0), 0);
      const audioMinutes = (docs ?? []).reduce((s, r) => s + ((r.duration_seconds ?? 0) / 60), 0);

      const byDay = (rows: { created_at: string }[] | null | undefined) => {
        const map = new Map<string, number>();
        (rows ?? []).forEach((r) => {
          const d = r.created_at.slice(0, 10);
          map.set(d, (map.get(d) ?? 0) + 1);
        });
        return Array.from(map.entries()).sort().map(([date, count]) => ({ date, count }));
      };

      return json({
        success: true,
        new_signups: profileCount ?? 0,
        new_lessons: (lessonsRecent ?? []).length,
        credits_spent: totalCredits,
        audio_minutes_generated: Math.round(audioMinutes),
        signups_by_day: byDay(null),
        lessons_by_day: byDay(lessonsRecent),
      });
    }

    if (action === "business_metrics") {
      const days = Math.max(1, Math.min(365, Number(body?.days ?? 30)));
      const { data, error } = await admin.rpc("admin_business_metrics", { _days: days });
      if (error) throw error;
      return json({ success: true, metrics: data });
    }

    if (action === "credit_timeseries") {
      const days = Math.max(1, Math.min(90, Number(body?.days ?? 30)));
      const { data, error } = await admin.rpc("admin_credit_timeseries", { _days: days });
      if (error) throw error;
      return json({ success: true, series: data ?? [] });
    }

    if (action === "top_documents") {
      const limit = Math.max(1, Math.min(100, Number(body?.limit ?? 20)));
      const { data, error } = await admin.rpc("admin_top_documents", { _limit: limit });
      if (error) throw error;
      return json({ success: true, documents: data ?? [] });
    }

    if (action === "top_documents_v2") {
      const limit = Math.max(1, Math.min(200, Number(body?.limit ?? 100)));
      const { data, error } = await admin.rpc("admin_top_documents_v2", { _limit: limit });
      if (error) throw error;
      return json({ success: true, documents: data ?? [] });
    }

    if (action === "abuse_candidates") {
      const { data, error } = await admin.rpc("admin_abuse_candidates");
      if (error) throw error;
      return json({ success: true, candidates: data ?? [] });
    }

    // -------- INVESTOR DASHBOARD: full financial snapshot --------
    if (action === "investor_metrics") {
      const days = Math.max(1, Math.min(365, Number(body?.days ?? 30)));
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const since7 = new Date(Date.now() - 7 * 86400_000).toISOString();

      // 1) base business metrics (already aggregated)
      const { data: bm, error: bmErr } = await admin.rpc("admin_business_metrics", { _days: days });
      if (bmErr) throw bmErr;

      // 2) characters processed — split user-driven vs system-seeded
      //    Treat audio_assets/translation_assets created in window as the
      //    "generation" events; user-driven if a corresponding access row
      //    exists in same window, else system-seeded.
      const [audioGen, transGen, audioAccess, transAccess] = await Promise.all([
        admin.from("audio_assets").select("char_count, created_at").gte("created_at", since),
        admin.from("translation_assets").select("char_count, created_at").gte("created_at", since),
        admin.from("user_chunk_access").select("id, document_id, chunk_index, created_at").eq("asset_type", "audio").gte("created_at", since),
        admin.from("user_translation_access").select("id, document_id, chunk_index, target_language, created_at").gte("created_at", since),
      ]);

      const audioGenChars = (audioGen.data ?? []).reduce((s, r: any) => s + (r.char_count ?? 0), 0);
      const transGenChars = (transGen.data ?? []).reduce((s, r: any) => s + (r.char_count ?? 0), 0);

      // 3) plan distribution → MRR proxy
      const { data: planRows } = await admin.from("profiles").select("plan");
      const planCounts: Record<string, number> = {};
      (planRows ?? []).forEach((r: any) => {
        const p = (r.plan ?? "free") as string;
        planCounts[p] = (planCounts[p] ?? 0) + 1;
      });
      // configurable plan prices (ZAR/month)
      const PLAN_PRICE = { free: 0, essential: 49, premium: 149 } as Record<string, number>;
      const mrr = Object.entries(planCounts).reduce(
        (s, [plan, n]) => s + (PLAN_PRICE[plan] ?? 0) * n, 0,
      );

      // 4) content asset totals (lifetime — investor signal)
      const [{ count: docsCount }, { data: audioLifetime }, { count: transLifetime }] = await Promise.all([
        admin.from("documents").select("id", { count: "exact", head: true }),
        admin.from("audio_assets").select("duration_seconds, char_count"),
        admin.from("translation_assets").select("id", { count: "exact", head: true }),
      ]);
      const audioHoursLifetime =
        (audioLifetime ?? []).reduce((s: number, r: any) => s + (Number(r.duration_seconds) ?? 0), 0) / 3600;
      const audioCharsLifetime =
        (audioLifetime ?? []).reduce((s: number, r: any) => s + (r.char_count ?? 0), 0);
      const audioChunksLifetime = (audioLifetime ?? []).length;

      // 5) growth — daily credit spend last N days (reuse timeseries rpc)
      const { data: series } = await admin.rpc("admin_credit_timeseries", { _days: days });

      // 6) signups daily (last N)
      const { data: profilesRecent } = await admin
        .from("profiles").select("created_at").gte("created_at", since);
      const signupsByDay: Record<string, number> = {};
      (profilesRecent ?? []).forEach((r: any) => {
        const d = (r.created_at ?? "").slice(0, 10);
        if (d) signupsByDay[d] = (signupsByDay[d] ?? 0) + 1;
      });

      // 7) active 30d (distinct users with any access in window)
      const [{ data: a1 }, { data: a2 }, { data: a3 }] = await Promise.all([
        admin.from("user_chunk_access").select("user_id").gte("created_at", since),
        admin.from("user_translation_access").select("user_id").gte("created_at", since),
        admin.from("scene_unlocks").select("user_id").gte("created_at", since),
      ]);
      const activeSet = new Set<string>();
      [a1, a2, a3].forEach((arr) => (arr ?? []).forEach((r: any) => r.user_id && activeSet.add(r.user_id)));
      const active30d = activeSet.size;

      // 7b) active 7d
      const [{ data: b1 }, { data: b2 }] = await Promise.all([
        admin.from("user_chunk_access").select("user_id").gte("created_at", since7),
        admin.from("user_translation_access").select("user_id").gte("created_at", since7),
      ]);
      const active7Set = new Set<string>();
      [b1, b2].forEach((arr) => (arr ?? []).forEach((r: any) => r.user_id && activeSet.add(r.user_id)));
      [b1, b2].forEach((arr) => (arr ?? []).forEach((r: any) => r.user_id && active7Set.add(r.user_id)));

      // 8) seeded / system content cost = chars generated by seed workers
      //    (no corresponding user access in window) — approximate by:
      //    system_chars = generated_chars - user_unlocked_chars
      const userAudioUnlocks = (audioAccess.data ?? []).length;
      const userTransUnlocks = (transAccess.data ?? []).length;

      // assume avg chunk size to approximate user-served chars
      const avgAudioChunkChars = audioChunksLifetime > 0 ? audioCharsLifetime / audioChunksLifetime : 1800;
      const userAudioChars = userAudioUnlocks * avgAudioChunkChars;
      const userTransChars = userTransUnlocks * 1800;

      const systemAudioChars = Math.max(0, audioGenChars - userAudioChars);
      const systemTransChars = Math.max(0, transGenChars - userTransChars);

      return json({
        success: true,
        days,
        metrics: bm,                 // base
        chars: {
          audio_generated: audioGenChars,
          translation_generated: transGenChars,
          user_audio_estimated: Math.round(userAudioChars),
          user_translation_estimated: Math.round(userTransChars),
          system_audio_estimated: Math.round(systemAudioChars),
          system_translation_estimated: Math.round(systemTransChars),
          avg_audio_chunk: Math.round(avgAudioChunkChars),
        },
        mrr_zar: mrr,
        plan_counts: planCounts,
        content_assets: {
          documents: docsCount ?? 0,
          audio_chunks_lifetime: audioChunksLifetime,
          audio_hours_lifetime: audioHoursLifetime,
          audio_chars_lifetime: audioCharsLifetime,
          translations_lifetime: transLifetime ?? 0,
        },
        growth: {
          credit_series: series ?? [],
          signups_by_day: Object.entries(signupsByDay)
            .sort()
            .map(([day, count]) => ({ day, count })),
          active_30d: active30d,
          active_7d: active7Set.size,
        },
      });
    }

    // -------------------- WRITE ACTIONS --------------------

    // -------- PIPELINE MANAGER: per-document multi-stage status --------
    if (action === "pipeline_status") {
      const document_id = body?.document_id as string | undefined;
      const limit = Math.max(1, Math.min(200, Number(body?.limit ?? 100)));
      const langs = (body?.languages as string[] | undefined) ?? ["zu", "xh", "tn", "nso"];

      let docsQ = admin
        .from("documents")
        .select("id, title, subject_type, language, is_seeded, char_count, cleaning_version, invalid_chunks, seed_audio_status, seed_audio_progress, translation_status, last_error, seed_audio_error, updated_at")
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (document_id) docsQ = docsQ.eq("id", document_id);
      const { data: docs, error: docsErr } = await docsQ;
      if (docsErr) throw docsErr;
      const docList = docs ?? [];
      if (docList.length === 0) return json({ success: true, documents: [] });

      const ids = docList.map((d) => d.id);

      // Audio counts (cached chunks per doc)
      const { data: audioRows } = await admin
        .from("audio_assets").select("document_id").in("document_id", ids);
      const audioCount = new Map<string, number>();
      (audioRows ?? []).forEach((r: any) =>
        audioCount.set(r.document_id, (audioCount.get(r.document_id) ?? 0) + 1));

      // Translation counts per (doc, language)
      const { data: transRows } = await admin
        .from("translation_assets").select("document_id, target_language").in("document_id", ids);
      const transByDoc = new Map<string, Record<string, number>>();
      (transRows ?? []).forEach((r: any) => {
        const m = transByDoc.get(r.document_id) ?? {};
        m[r.target_language] = (m[r.target_language] ?? 0) + 1;
        transByDoc.set(r.document_id, m);
      });

      // Audio queue counts per doc
      const { data: audioQueue } = await admin
        .from("seed_queue").select("document_id, status").in("document_id", ids);
      const audioQueueByDoc = new Map<string, { pending: number; in_progress: number; failed: number; done: number }>();
      (audioQueue ?? []).forEach((r: any) => {
        const m = audioQueueByDoc.get(r.document_id) ?? { pending: 0, in_progress: 0, failed: 0, done: 0 };
        if (r.status === "pending") m.pending++;
        else if (r.status === "in_progress") m.in_progress++;
        else if (r.status === "failed") m.failed++;
        else if (r.status === "completed" || r.status === "done") m.done++;
        audioQueueByDoc.set(r.document_id, m);
      });

      // Translation queue counts per (doc, language)
      const { data: transQueue } = await admin
        .from("translation_seed_queue")
        .select("document_id, target_language, status").in("document_id", ids);
      const transQueueByDoc = new Map<string, Record<string, { pending: number; in_progress: number; failed: number }>>();
      (transQueue ?? []).forEach((r: any) => {
        const m = transQueueByDoc.get(r.document_id) ?? {};
        const lm = m[r.target_language] ?? { pending: 0, in_progress: 0, failed: 0 };
        if (r.status === "pending") lm.pending++;
        else if (r.status === "in_progress") lm.in_progress++;
        else if (r.status === "failed") lm.failed++;
        m[r.target_language] = lm;
        transQueueByDoc.set(r.document_id, m);
      });

      // Estimate total chunks from char_count (mirrors seeder TARGET=700)
      const estimateChunks = (chars: number) => Math.max(1, Math.round(chars / 700));

      const documents = docList.map((d) => {
        const totalChunks = estimateChunks(d.char_count ?? 0);
        const cached = audioCount.get(d.id) ?? 0;
        const audioQ = audioQueueByDoc.get(d.id) ?? { pending: 0, in_progress: 0, failed: 0, done: 0 };
        const tMap = transByDoc.get(d.id) ?? {};
        const tqMap = transQueueByDoc.get(d.id) ?? {};
        const translations = langs.map((lang) => {
          const done = tMap[lang] ?? 0;
          const q = tqMap[lang] ?? { pending: 0, in_progress: 0, failed: 0 };
          return {
            language: lang,
            done,
            total_estimate: totalChunks,
            pct: totalChunks > 0 ? Math.min(100, Math.round((done / totalChunks) * 100)) : 0,
            queue: q,
          };
        });
        return {
          id: d.id,
          title: d.title,
          subject_type: d.subject_type,
          language: d.language,
          is_seeded: d.is_seeded,
          char_count: d.char_count,
          cleaning_version: d.cleaning_version,
          invalid_chunks: Array.isArray(d.invalid_chunks) ? d.invalid_chunks : [],
          updated_at: d.updated_at,
          stages: {
            cleaning: {
              version: d.cleaning_version ?? 1,
              invalid: Array.isArray(d.invalid_chunks) ? (d.invalid_chunks as unknown[]).length : 0,
            },
            audio: {
              status: d.seed_audio_status ?? "pending",
              cached,
              total_estimate: totalChunks,
              pct: totalChunks > 0 ? Math.min(100, Math.round((cached / totalChunks) * 100)) : 0,
              queue: audioQ,
              error: d.seed_audio_error ?? d.last_error ?? null,
            },
            translation: {
              status: d.translation_status ?? "pending",
              languages: translations,
            },
          },
        };
      });

      return json({ success: true, documents, languages: langs });
    }

    if (action === "reclean_document") {
      const document_id = body?.document_id as string;
      if (!document_id) throw new Error("document_id required");
      const { data: doc, error: docErr } = await admin
        .from("documents")
        .select("id, title, raw_text, tags, subject_type")
        .eq("id", document_id)
        .maybeSingle();
      if (docErr) throw docErr;
      if (!doc) throw new Error("Document not found");
      if (!doc.raw_text) throw new Error("Document has no raw_text to re-clean");

      // Infer kind (play vs novel) from tags / known titles, mirroring the seeder.
      let kind: DocKind = "novel";
      if (Array.isArray(doc.tags)) {
        for (const t of doc.tags as Array<Record<string, unknown>>) {
          if (t && (t.kind === "play" || t.kind === "novel")) kind = t.kind as DocKind;
        }
      }
      const playTitles = ["macbeth","romeo and juliet","othello","hamlet","julius caesar","the merchant of venice"];
      if (kind === "novel" && playTitles.includes(doc.title.toLowerCase())) kind = "play";

      const cleaned = cleanRawText(doc.raw_text, kind);

      // Recompute invalid chunks against the same chunker the seeder uses.
      const TARGET = 700, MIN = 400;
      const sentences = cleaned.text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+|\S+$/g) ?? [];
      const chunks: string[] = [];
      let buf = "";
      for (const s of sentences) {
        const sent = s.trim();
        if (!sent) continue;
        if (!buf) { buf = sent; continue; }
        const cand = `${buf} ${sent}`;
        if (cand.length >= TARGET && buf.length >= MIN) { chunks.push(buf); buf = sent; }
        else { buf = cand; }
      }
      if (buf) chunks.push(buf);
      const invalid: number[] = [];
      chunks.forEach((c, i) => { if (isInvalidChunk(c)) invalid.push(i); });

      // Write — the bump_cleaning_version trigger will increment cleaning_version,
      // which invalidates stale audio_assets via the clean_text_hash check at play time.
      const { error: upErr } = await admin.from("documents").update({
        clean_text: cleaned.text,
        char_count: cleaned.charCount,
        invalid_chunks: invalid,
      }).eq("id", document_id);
      if (upErr) throw upErr;

      return json({
        success: true,
        document_id,
        char_count: cleaned.charCount,
        chunks: chunks.length,
        invalid_chunks: invalid,
        kind,
      });
    }

    if (action === "regenerate_document") {
      const document_id = body?.document_id as string;
      if (!document_id) throw new Error("document_id required");
      const { data: rows } = await admin
        .from("audio_assets").select("id, storage_path").eq("document_id", document_id);
      let removedFiles = 0;
      if (rows && rows.length > 0) {
        const paths = rows.map((r) => r.storage_path);
        const { error: rmErr } = await admin.storage.from("assets").remove(paths);
        if (!rmErr) removedFiles = paths.length;
        await admin.from("audio_assets").delete().in("id", rows.map((r) => r.id));
      }
      return json({ success: true, deleted_rows: rows?.length ?? 0, deleted_files: removedFiles });
    }

    if (action === "set_role") {
      const target_user_id = body?.user_id as string;
      const grant = !!body?.grant;
      if (!target_user_id) throw new Error("user_id required");
      if (grant) {
        await admin.from("user_roles").insert({ user_id: target_user_id, role: "admin" }).select();
      } else {
        await admin.from("user_roles").delete().eq("user_id", target_user_id).eq("role", "admin");
      }
      return json({ success: true });
    }

    if (action === "adjust_credits") {
      const target_user_id = body?.user_id as string;
      const delta = Number(body?.delta ?? 0);
      if (!target_user_id || !Number.isFinite(delta)) throw new Error("user_id + numeric delta required");
      const { data: profile } = await admin
        .from("profiles").select("credits_balance").eq("user_id", target_user_id).maybeSingle();
      const current = profile?.credits_balance ?? 0;
      const next = Math.max(0, current + delta);
      await admin.from("profiles").update({ credits_balance: next }).eq("user_id", target_user_id);
      // Ledger
      await admin.from("credit_transactions").insert({
        user_id: target_user_id,
        amount: delta,
        source: "admin_adjust",
        feature_type: null,
        metadata: { admin_id: adminId, prev: current, next },
      }).then(() => {}, () => {});
      return json({ success: true, balance: next });
    }

    if (action === "flag_user") {
      const target_user_id = body?.user_id as string;
      const reason = (body?.reason as string | undefined) ?? "Flagged by admin";
      if (!target_user_id) throw new Error("user_id required");
      await admin.from("profiles")
        .update({ is_flagged: true, flagged_reason: reason })
        .eq("user_id", target_user_id);
      return json({ success: true });
    }

    if (action === "unflag_user") {
      const target_user_id = body?.user_id as string;
      if (!target_user_id) throw new Error("user_id required");
      await admin.from("profiles")
        .update({ is_flagged: false, flagged_reason: null, cooldown_until: null })
        .eq("user_id", target_user_id);
      return json({ success: true });
    }

    if (action === "apply_cooldown") {
      const target_user_id = body?.user_id as string;
      const minutes = Math.max(1, Math.min(60 * 24 * 7, Number(body?.minutes ?? 60)));
      if (!target_user_id) throw new Error("user_id required");
      const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
      await admin.from("profiles")
        .update({ cooldown_until: until })
        .eq("user_id", target_user_id);
      return json({ success: true, cooldown_until: until });
    }

    if (action === "reset_user_counters") {
      const target_user_id = body?.user_id as string;
      if (!target_user_id) throw new Error("user_id required");
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      await admin.from("translation_rate_log")
        .delete()
        .eq("user_id", target_user_id)
        .gte("created_at", today.toISOString());
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("admin-api error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
