export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { image, mimeType, crop } = req.body || {};

    if (!image) {
      return res.status(400).json({
        error: "No crop image received"
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "AI service is not configured"
      });
    }

    const prompt = `
You are CropPilot, an agricultural decision-support assistant.

Analyze the uploaded crop/leaf image.

Selected crop:
${crop || "Unknown"}

Your job is to identify the most likely visible crop health issue.

IMPORTANT:
- Do not pretend certainty.
- If the image is unclear, say that the image is insufficient.
- Do not invent a disease.
- Give a confidence score from 0 to 100.
- Explain the visible evidence.
- Give practical, conservative next steps.
- Do not recommend dangerous pesticide use or unsupported chemical dosages.
- Encourage following local agricultural extension or label guidance for treatment.
- This is decision support, not a replacement for an agronomist.

Return ONLY valid JSON in this exact structure:

{
  "crop": "string",
  "diagnosis": "string",
  "confidence": 0,
  "severity": "Low | Moderate | High | Unclear",
  "evidence": [
    "string",
    "string",
    "string"
  ],
  "immediate_actions": [
    "string",
    "string",
    "string"
  ],
  "avoid": [
    "string",
    "string"
  ],
  "needs_expert_review": true
}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=" +
        encodeURIComponent(process.env.GEMINI_API_KEY),
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType || "image/jpeg",
                    data: image
                  }
                },
                {
                  text: prompt
                }
              ]
            }
          ],

          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error("Gemini error:", errorText);

      return res.status(502).json({
        error: "AI analysis failed"
      });
    }

    const data = await response.json();

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(502).json({
        error: "AI returned no analysis"
      });
    }

    let result;

    try {
      result = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "AI returned invalid analysis"
      });
    }

    return res.status(200).json(result);

  } catch (error) {

    console.error("Server error:", error);

    return res.status(500).json({
      error: "Unexpected server error"
    });
  }
}
