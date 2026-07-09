import type { Context, Config } from "@netlify/functions";

const SYSTEM_PROMPT = `You are a senior clinical reasoning assistant for a chiropractic practice (Lone Star Chiro, Dr. Jacob Stutz). You will be given a full D1 (first visit) case file for a new patient: their intake form, the consultation transcript, the exam form, their SHS (Spinal Health Score) report, and possibly x-rays. Read all of it carefully and produce a complete D1 Recon Report.

CRITICAL INSTRUCTION ON THE CARE PLAN SECTION: base your recommended care plan ONLY on clinical severity, exam findings, imaging, SHS results, and functional limitation. Do NOT factor in or reference the patient's job, insurance type, age-based assumptions about ability to pay, or any perceived financial situation — those are not clinical criteria and must play no role in your recommendation. If the transcript or intake mentions financial/insurance details, ignore them for the purposes of the care plan; they are not relevant to what the patient clinically needs.

CRITICAL INSTRUCTION ON THE COACHING FLAGS SECTION: review the actual consultation transcript for whether the doctor did each of the following, and flag ONLY what's actually missing or present in this specific transcript (don't invent generic feedback):
1. Did the doctor ask a fear-of-progression question (what happens if this isn't addressed / gets worse)?
2. Did the doctor invite a support person/partner to the Day 2 visit?
3. Did the doctor hold clinical urgency/certainty appropriately, or did they visibly soften or hedge when the patient seemed skeptical or price-sensitive?
If a pattern is missing, name it plainly and suggest the specific alternate phrasing that would have covered it. If it's present, say so briefly — don't manufacture a problem.

Return ONLY a single valid JSON object (no markdown fences, no prose before or after) matching exactly this shape. Each value should be plain text (you may use "- " at the start of a line for bullet-style points, and \\n for line breaks within a section), written for a busy doctor to read in under a minute per section:

{
  "differentialDiagnosis": "Ranked list of the most likely diagnoses with the clinical reasoning tying each to specific findings from the intake/exam/SHS/imaging.",
  "severity": "Objective severity rating (mild/moderate/severe) with the specific findings that justify it.",
  "prognosis": "Expected recovery trajectory and realistic timeline given the severity and findings.",
  "carePlan": "Recommended visit frequency, duration, and modalities — justified ONLY by clinical findings per the instruction above.",
  "day2Story": "A short suggested narrative the doctor can use on Day 2 to explain the diagnosis and plan back to this specific patient, grounded in their own words/findings from the transcript.",
  "reExamStrategy": "What to specifically re-test at re-exam and on what timeline, tied to this patient's key findings.",
  "coachingFlags": "Direct, specific feedback per the instruction above — only what's actually observed in this transcript.",
  "keyTakeaways": "3-5 bullet points a doctor could glance at in 10 seconds before walking into Day 2.",
  "caseSummary": "One tight paragraph suitable for chart documentation summarizing the whole case."
}`;

function decodeDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

async function setStatus(supaUrl: string, supaKey: string, caseId: string, fields: Record<string, any>) {
  await fetch(`${supaUrl}/rest/v1/d1_cases?id=eq.${caseId}`, {
    method: "PATCH",
    headers: {
      apikey: supaKey,
      Authorization: `Bearer ${supaKey}`,
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(fields),
  });
}

export default async (req: Request, context: Context) => {
  const supaUrl = Netlify.env.get("SUPABASE_URL");
  const supaKey = Netlify.env.get("SUPABASE_ANON_KEY");
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return;
  }
  const { caseId } = body || {};
  if (!caseId || !supaUrl || !supaKey || !apiKey) {
    console.error("Missing caseId or server config", { hasCaseId: !!caseId, hasSupaUrl: !!supaUrl, hasSupaKey: !!supaKey, hasApiKey: !!apiKey });
    return;
  }

  try {
    // Fetch case + files
    const [caseRes, filesRes] = await Promise.all([
      fetch(`${supaUrl}/rest/v1/d1_cases?id=eq.${caseId}&select=*`, {
        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
      }),
      fetch(`${supaUrl}/rest/v1/d1_files?case_id=eq.${caseId}&select=*`, {
        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
      }),
    ]);
    const caseRows = await caseRes.json();
    const files = await filesRes.json();
    const caseRow = Array.isArray(caseRows) ? caseRows[0] : null;
    if (!caseRow) throw new Error("Case not found");

    const bySlot: Record<string, any> = {};
    (files || []).forEach((f: any) => { bySlot[f.slot_key] = f; });

    const relevantSlots = ["intake", "consult", "exam", "shs", "xrays1", "xrays2", "xrays3", "xrays4"];
    const contentBlocks: any[] = [];

    for (const slot of relevantSlots) {
      const f = bySlot[slot];
      if (!f || !f.file_data) continue;
      const decoded = decodeDataUrl(f.file_data);
      if (!decoded) continue;
      const label = { intake: "INTAKE FORM", consult: "CONSULTATION TRANSCRIPT", exam: "EXAM FORM", shs: "SHS (SPINAL HEALTH SCORE)", xrays1: "X-RAY 1", xrays2: "X-RAY 2", xrays3: "X-RAY 3", xrays4: "X-RAY 4" }[slot];

      if (decoded.mimeType.startsWith("image/")) {
        contentBlocks.push({ type: "text", text: `--- ${label} (image) ---` });
        contentBlocks.push({ type: "image", source: { type: "base64", media_type: decoded.mimeType, data: decoded.base64 } });
      } else if (decoded.mimeType === "application/pdf") {
        contentBlocks.push({ type: "text", text: `--- ${label} (PDF) ---` });
        contentBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: decoded.base64 } });
      } else {
        let text = "";
        try { text = Buffer.from(decoded.base64, "base64").toString("utf-8"); } catch { text = ""; }
        contentBlocks.push({ type: "text", text: `--- ${label} (text) ---\n${text}` });
      }
    }

    contentBlocks.push({
      type: "text",
      text: `Patient: ${caseRow.patient_name || "Unknown"}. Generate the full D1 Recon Report JSON as instructed.`,
    });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: contentBlocks }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      throw new Error(`Anthropic API error: ${errText}`);
    }

    const data = await anthropicRes.json();
    const textBlock = (data.content || []).find((b: any) => b.type === "text");
    const rawText = textBlock ? textBlock.text : "";
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new Error("Could not parse model output as JSON: " + rawText.slice(0, 500));
    }

    await setStatus(supaUrl, supaKey, caseId, {
      report_status: "ready",
      report_json: parsed,
      report_error: null,
      report_generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("D1 report generation failed:", err);
    await setStatus(supaUrl, supaKey, caseId, {
      report_status: "error",
      report_error: String(err && err.message ? err.message : err),
    });
  }
};

export const config: Config = {
  path: "/api/generate-d1-report",
};
