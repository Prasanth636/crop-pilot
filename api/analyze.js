export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { image, crop, language, field } = req.body || {};

    if (!image) {
      return res.status(400).json({
        error: "No crop image received."
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured in Vercel."
      });
    }

    /*
      The browser sends:
      data:image/jpeg;base64,AAAA....

      Gemini needs:
      AAAA....

      Remove the data URL prefix.
    */

    let base64Image = image;
    let mimeType = "image/jpeg";

    if (image.startsWith("data:")) {
      const match = image.match(
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/
      );

      if (!match) {
        return res.status(400).json({
          error: "Invalid image data format."
        });
      }

      mimeType = match[1];
      base64Image = match[2];
    }

    // Remove accidental whitespace/newlines
    base64Image = base64Image
      .replace(/\s/g, "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    // Basic Base64 validation
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Image)) {
      return res.status(400).json({
        error: "Image Base64 data is invalid."
      });
    }

    const prompt = `
You are CropPilot, an agricultural field intelligence assistant.

Analyze the provided crop image carefully.

Crop selected:
${crop || "Unknown"}

Farmer language:
${language || "English"}

Field information:
Location: ${field?.place || "Unknown"}
Temperature: ${field?.temperature ?? "Unknown"} °C
Humidity: ${field?.humidity ?? "Unknown"} %
Rain probability: ${field?.rain ?? "Unknown"} %
Wind: ${field?.wind ?? "Unknown"} km/h

Return a practical agricultural diagnosis.

Include:

1. Crop health
2. Likely disease, pest, nutrient deficiency, or healthy condition
3. Confidence percentage
4. Visible symptoms
5. Recommended immediate action
6. Prevention advice
7. When to seek local agricultural expert help

Do not pretend to be certain when the image is unclear.

Give the answer in ${language || "English"}.

Return ONLY valid JSON in this format:

{
  "cropHealth": "Healthy / Warning / Diseased",
  "diagnosis": "short diagnosis",
  "confidence": 0,
  "symptoms": "visible symptoms",
  "immediateAction": "recommended action",
  "prevention": "prevention advice",
  "expertAdvice": "when to contact an agricultural expert"
}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
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
                    mime_type: mimeType,
                    data: base64Image
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
      console.error("Gemini API error:", data);

      return res.status(response.status).json({
        error:
          data?.error?.message ||
          "Gemini API request failed."
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!text) {
      return res.status(500).json({
        error: "Gemini returned an empty response."
      });
    }

    let result;

    try {
      result = JSON.parse(text);
    } catch (error) {
      console.error("Gemini JSON parse error:", text);

      return res.status(500).json({
        error: "Gemini returned invalid JSON.",
        raw: text
      });
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error("Server error:", error);

    return res.status(500).json({
      error:
        error?.message ||
        "Server error while analyzing crop."
    });
  }
}
