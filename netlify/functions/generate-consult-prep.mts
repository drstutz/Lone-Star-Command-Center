import type { Context, Config } from "@netlify/functions";

const SYSTEM_PROMPT = `You are a clinical intake analyst for a chiropractic practice (Lone Star Chiro). You will be given a new patient's intake form (as an image, PDF, or text). Read it carefully and extract the patient's actual presentation — chief complaint, pain characteristics, mechanism/history, functional limitations, and any prior treatment/imaging mentioned.

Based on that specific content, produce a personalized consultation guide and exam priority list for the doctor's D1 (first visit) consultation. Do not use generic filler — every question and exam choice must be plausibly tailored to what's actually in this intake. If the intake is sparse or illegible in places, still do your best to personalize the parts you can, and keep the standard question categories for anything you can't infer.

Return ONLY a single valid JSON object (no markdown fences, no prose before or after) matching exactly this shape:

{
  "leadingDifferential": "one sentence naming the most likely clinical picture suggested by this intake",
  "questions": {
    "chiefComplaint": ["question", "question", "question", "question"],
    "painProfile": ["question", "question", "question", "question"],
    "functionalImpact": ["question", "question", "question"],
    "historyGoals": ["question", "question", "question", "question"]
  },
  "examPriority": [
    {"region": "REGION NAME IN CAPS", "tests": [["Test Name", "One-line rationale tied to this patient's presentation"], ["Test Name", "rationale"]]},
    {"region": "REGION NAME IN CAPS", "tests": [["Test Name", "rationale"]]}
  ],
  "functionalTests": [["Test Name", "rationale"], ["Test Name", "rationale"], ["Test Name", "rationale"]]
}

Rules for questions — HOW TO WRITE THEM: These are meant to be spoken out loud in a live conversation, not read off a form. Each question must be ONE simple, single-clause ask — never stack two questions together with a dash or "and" (e.g. NOT "Can you pinpoint what triggered this—and does it radiate into your leg?" — instead ask those as two separate short questions, or pick the single more useful one). Keep each question under ~15 words wherever possible. Write in plain, conversational spoken language, not survey/form language. Do not reference "the diagram," "the intake," or "what you noted" — just ask the question directly as if meeting the patient for the first time.

Rules for questions — CONTENT: each category should have 3-4 questions, tailored to reflect this patient's stated symptoms, body region, mechanism of injury, or goals where the intake gives you something specific to reference. Where the intake gives no specific detail for a category, fall back to a solid general version of that question rather than inventing facts.

CRITICAL — every question set MUST include at least one emotionally/fear-driven question, not just mechanical/clinical ones. Somewhere in chiefComplaint or functionalImpact, ask something that surfaces what the patient is afraid this turns into, or what they're afraid of losing if it isn't addressed (e.g. "What are you worried this turns into if it doesn't get better?" or "Is there anything this is stopping you from doing that really matters to you?" — tailor the specific fear/stakes to what THIS patient's intake suggests they'd be afraid of losing, such as a sport, their job, playing with their kids, etc). This is not optional — a purely mechanical, clinical question set without any emotional/stakes question is an incomplete result.

Rules for examPriority: choose 3-4 anatomical regions (e.g. CERVICAL / UPPER EXTREMITY, LUMBAR / LOWER EXTREMITY, THORACIC, SHOULDER / UPPER EXTREMITY, HIP / PELVIS, etc.) ordered with the most clinically relevant region FIRST based on the leading differential. Within each region pick 3-5 real, well-known orthopedic/orthopedic-adjacent chiropractic exam tests appropriate to that region and this patient, each with a short rationale connecting it to their presentation.

CRITICAL — NEVER include range-of-motion (ROM) assessment as an exam test in examPriority, in any region (no "Cervical ROM", "Lumbar ROM and forward flexion", "Cervical active range of motion", etc). ROM is already captured separately via the SHS (Spinal Health Score) and re-measured at re-exam, so recommending it here is redundant. Focus examPriority entirely on orthopedic/neurological provocation tests, palpation, and special tests — not ROM.

Rules for functionalTests: pick 3-5 functional benchmark tests to re-measure at re-exam, chosen ONLY from tests that are actually relevant to this patient's complaint region and differential — do not default to a generic head-to-toe battery. For example, a patient with an isolated cervical/upper-body complaint and no lower-body involvement should NOT get gait/balance/leg tests like heel walk, toe walk, or single-leg balance; a patient with lower back/lower extremity involvement should. Good options include (choose only what's relevant): grip strength, heel walk, toe walk, squat depth/pain, one-leg balance, or a relevant provocation/functional movement tied to their stated goals (e.g. a golf swing test, a specific lifting motion). Do NOT include generic ROM degree measurements here (no "Cx Flexion ___°" style items) — that's covered by the SHS.`;

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { patientName, fileName, fileType, fileDataUrl } = body || {};
  if (!fileDataUrl || typeof fileDataUrl !== "string") {
    return new Response(JSON.stringify({ error: "Missing fileDataUrl" }), { status: 400 });
  }

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Server not configured: missing ANTHROPIC_API_KEY" }), { status: 500 });
  }

  // fileDataUrl looks like: data:<mime>;base64,<data>
  const match = fileDataUrl.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) {
    return new Response(JSON.stringify({ error: "fileDataUrl is not a valid base64 data URL" }), { status: 400 });
  }
  const mimeType = (fileType || match[1] || "application/octet-stream").toLowerCase();
  const base64Data = match[2];

  const contentBlocks: any[] = [];

  if (mimeType.startsWith("image/")) {
    contentBlocks.push({
      type: "image",
      source: { type: "base64", media_type: mimeType, data: base64Data },
    });
  } else if (mimeType === "application/pdf") {
    contentBlocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64Data },
    });
  } else {
    // Treat as text (txt, csv, etc.)
    let text = "";
    try {
      text = Buffer.from(base64Data, "base64").toString("utf-8");
    } catch {
      text = "";
    }
    contentBlocks.push({
      type: "text",
      text: `Intake file contents (${fileName || "unnamed file"}):\n\n${text}`,
    });
  }

  contentBlocks.push({
    type: "text",
    text: `Patient name: ${patientName || "Unknown"}\n\nGenerate the personalized consultation guide and exam priority JSON as instructed.`,
  });

  let anthropicRes: Response;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: contentBlocks }],
      }),
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Failed to reach Anthropic API", detail: String(err) }), { status: 502 });
  }

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    return new Response(JSON.stringify({ error: "Anthropic API error", detail: errText }), { status: 502 });
  }

  const data = await anthropicRes.json();
  const textBlock = (data.content || []).find((b: any) => b.type === "text");
  const rawText = textBlock ? textBlock.text : "";

  // Strip markdown fences if present, then parse
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Could not parse model output as JSON", raw: rawText }),
      { status: 502 }
    );
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/generate-consult-prep",
};
