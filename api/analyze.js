export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { image, mimeType, crop, language, field } = req.body;

    if (!image) {
      return res.status(400).json({
        error: "No crop image received"
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured in Vercel"
      });
    }

    const prompt = `
You are CropPilot, an agricultural crop-health assistant.

Analyze the supplied crop image.

Crop:
${crop || "Unknown"}

Language:
${language || "English"}

Field conditions:
Temperature: ${field?.temperature ?? "Unknown"}
Humidity: ${field?.humidity ?? "Unknown"}
Rain risk: ${field?.rain ?? "Unknown"}
Wind: ${field?.wind ?? "Unknown"}

Return ONLY valid JSON.
Do not use markdown.
Do not put the JSON inside code fences.

Use exactly this structure:

{
  "diagnosis": "short disease or health diagnosis",
  "description": "brief explanation",
  "confidence": 0,
  "why": [
    "observation 1",
    "observation 2",
    "observation 3"
  ],
  "whatToDo": "practical action for the farmer",
  "dontDo": "important action to avoid",
  "actionWindow": "recommended timing",
  "severity": "low"
}

The confidence must be a number from 0 to 100.

Severity must be one of:
low
medium
high

Give practical agricultural guidance, but do not claim certainty when the image is unclear.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
        encodeURIComponent(apiKey),
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
                  text: prompt
                },
                {
                  inline_data: {
                    mime_type: mimeType || "image/jpeg",
                    data: image
                  }
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

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini error:", data);

      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "Gemini request failed"
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(500).json({
        error: "Gemini returned no analysis"
      });
    }

    let result;

    try {
      result = JSON.parse(text);
    } catch {
      console.error("Invalid Gemini JSON:", text);

      return res.status(500).json({
        error: "Gemini returned invalid JSON"
      });
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error("Server error:", error);

    return res.status(500).json({
      error: "AI analysis failed"
    });
  }
}
