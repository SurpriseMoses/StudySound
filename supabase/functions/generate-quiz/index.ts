// Generates 6 multiple-choice quiz questions per document using Lovable AI.
// Globally cached per document_id in quiz_assets — all users share & reuse for free.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface QuizQuestion {
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
}

async function generateQuestions(
  apiKey: string,
  title: string,
  text: string,
  difficulty: string,
): Promise<QuizQuestion[]> {
  const excerpt = text.slice(0, 8000);
  const sys = `You are an expert quiz writer for African high-school students. Generate fair, unambiguous multiple-choice questions that test understanding (not trivia). Each question must have exactly 4 options with only one clearly correct answer. Difficulty: ${difficulty}.`;
  const user = `Lesson: "${title}"\n\nText:\n${excerpt}\n\nGenerate 6 multiple-choice questions covering the most important ideas in this text.`;

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
            name: "emit_quiz",
            description: "Emit multiple-choice quiz questions",
            parameters: {
              type: "object",
              properties: {
                questions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      question: { type: "string" },
                      options: {
                        type: "array",
                        items: { type: "string" },
                        minItems: 4,
                        maxItems: 4,
                      },
                      correct_answer: { type: "string", description: "Must exactly match one of the options" },
                      explanation: { type: "string", description: "1-2 sentence explanation" },
                    },
                    required: ["question", "options", "correct_answer", "explanation"],
                  },
                },
              },
              required: ["questions"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "emit_quiz" } },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`AI gateway error ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  const tc = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) throw new Error("No tool call in AI response");
  const args = JSON.parse(tc.function.arguments);
  const questions: QuizQuestion[] = args.questions ?? [];
  // Validate: ensure correct_answer is in options
  return questions
    .filter((q) => q.options?.length === 4 && q.options.includes(q.correct_answer))
    .slice(0, 6);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { document_id, difficulty = "medium" } = await req.json();
    if (!document_id) {
      return new Response(JSON.stringify({ error: "document_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check cache
    const { data: cached } = await admin
      .from("quiz_assets")
      .select("id, quiz_json, difficulty")
      .eq("document_id", document_id)
      .eq("difficulty", difficulty)
      .maybeSingle();

    if (cached) {
      return new Response(
        JSON.stringify({ success: true, reused: true, questions: cached.quiz_json }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load document text
    const { data: doc, error: docErr } = await admin
      .from("documents")
      .select("title, clean_text")
      .eq("id", document_id)
      .maybeSingle();
    if (docErr || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const questions = await generateQuestions(apiKey, doc.title, doc.clean_text, difficulty);
    if (questions.length === 0) {
      return new Response(JSON.stringify({ error: "Failed to generate valid questions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache
    await admin.from("quiz_assets").insert({
      document_id,
      difficulty,
      quiz_json: questions,
    });

    return new Response(
      JSON.stringify({ success: true, reused: false, questions }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[generate-quiz] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
