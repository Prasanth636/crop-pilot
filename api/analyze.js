export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { image, crop, language } = req.body || {};

    if (!image) {
      return res.status(400).json({
        error: "No image received."
      });
    }

    if (!crop) {
      return res.status(400).json({
        error: "Crop type is required."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured in Vercel."
      });
    }

    const match = image.match(
      /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
    );

    if (!match) {
      return res.status(400).json({
        error: "Invalid image format."
      });
    }

    const mimeType = match[1];
    const base64Data = match[2];

    const prompt = `
You are CropPilot, an agricultural crop-health assistant.

Analyze the supplied crop image.

Crop selected by farmer:
${crop}

Respond in ${language || "English"}.

Important:
- Identify the most likely visible crop disease, pest, stress, or healthy condition.
- Do NOT pretend certainty when the image is unclear.
- Give a confidence percentage.
- Give visible evidence.
- Give practical immediate guidance.
- Give a safety/timing warning.
- Do not recommend dangerous pesticide quantities or unsupported chemical dosages.
- If the image is not actually a crop/leaf image, clearly say so.

Return ONLY valid JSON using exactly this structure:

{
  "diagnosis": "string",
  "confidence": 0,
  "description": "string",
  "evidence": ["string", "string", "string"],
  "action": "string",
  "warning": "string",
  "action_window": "string"
}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },

        body: JSON.stringify({
          contents: [
            {
              role: "user",

              parts: [
                {
                  text: prompt
                },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data
                  }
                }
              ]
            }
          ],

          generationConfig: {
            responseMimeType: "application/json",

            responseSchema: {
              type: "OBJECT",

              properties: {
                diagnosis: {
                  type: "STRING"
                },

                confidence: {
                  type: "NUMBER"
                },

                description: {
                  type: "STRING"
                },

                evidence: {
                  type: "ARRAY",
                  items: {
                    type: "STRING"
                  }
                },

                action: {
                  type: "STRING"
                },

                warning: {
                  type: "STRING"
                },

                action_window: {
                  type: "STRING"
                }
              },

              required: [
                "diagnosis",
                "confidence",
                "description",
                "evidence",
                "action",
                "warning",
                "action_window"
              ]
            },

            temperature: 0.2,
            maxOutputTokens: 1000
          }
        })
      }
    );


    const result = await response.json();


    if (!response.ok) {

      console.error(
        "Gemini error:",
        JSON.stringify(result)
      );

      return res.status(502).json({
        error:
          result?.error?.message ||
          "Gemini API request failed."
      });
    }


    const text =
      result?.candidates?.[0]?.content?.parts?.[0]?.text;


    if (!text) {

      return res.status(502).json({
        error: "Gemini returned an empty response."
      });
    }


    let parsed;

    try {

      parsed = JSON.parse(text);

    } catch (error) {

      console.error(
        "JSON parse error:",
        text
      );

      return res.status(502).json({
        error: "Gemini returned invalid JSON."
      });
    }


    return res.status(200).json(parsed);

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error:
        error?.message ||
        "Unexpected server error."
    });
  }
}
