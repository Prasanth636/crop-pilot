export default async function handler(req, res) {
  // =====================================================
  // CROP PILOT - GEMINI CROP ANALYSIS API
  // =====================================================

  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // ---------------------------------------------------
    // READ REQUEST
    // ---------------------------------------------------

    const body = req.body || {};

    const image = body.image;
    const crop = body.crop || "Unknown";
    const language = body.language || "English";
    const field = body.field || {};

    // ---------------------------------------------------
    // CHECK IMAGE
    // ---------------------------------------------------

    if (!image || typeof image !== "string") {
      return res.status(400).json({
        error: "No crop image received."
      });
    }

    // ---------------------------------------------------
    // CHECK API KEY
    // ---------------------------------------------------

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured in Vercel."
      });
    }

    // ---------------------------------------------------
    // CONVERT DATA URL TO BASE64
    // ---------------------------------------------------

    let base64Image = image;
    let mimeType = "image/jpeg";

    if (image.startsWith("data:")) {
      const match = image.match(
        /^data:([^;]+);base64,(.+)$/
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
    base64Image = base64Image.replace(/\s/g, "");

    // ---------------------------------------------------
    // VALIDATE MIME TYPE
    // ---------------------------------------------------

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif"
    ];

    if (!allowedTypes.includes(mimeType)) {
      return res.status(400).json({
        error: "Unsupported image type: " + mimeType
      });
    }

    // ---------------------------------------------------
    // BUILD FIELD INFORMATION
    // ---------------------------------------------------

    const place =
      field.place ||
      "Unknown location";

    const temperature =
      field.temperature ??
      "Unknown";

    const humidity =
      field.humidity ??
      "Unknown";

    const rain =
      field.rain ??
      "Unknown";

    const wind =
      field.wind ??
      "Unknown";

    // ---------------------------------------------------
    // LANGUAGE INSTRUCTION
    // ---------------------------------------------------

    const languageInstruction = `
Return the final farmer advisory in ${language}.

Use simple language that an ordinary farmer can understand.

Do not answer in English unless the selected language is English.

Do not translate crop names unnecessarily.

Keep the advice practical and safe.
`;

    // ---------------------------------------------------
    // GEMINI PROMPT
    // ---------------------------------------------------

    const prompt = `
You are CropPilot, an agricultural crop-health assistant.

Analyze the supplied crop image carefully.

Crop selected by farmer:
${crop}

Farm location:
${place}

Current field conditions:
Temperature: ${temperature} °C
Humidity: ${humidity} %
Rain probability: ${rain} %
Wind: ${wind} km/h

${languageInstruction}

Give a concise but useful crop-health diagnosis.

Return the answer using exactly these sections:

DIAGNOSIS:
Identify the likely crop health condition visible in the image.

CONFIDENCE:
Give a confidence percentage from 0 to 100.

SYMPTOMS:
List the important visible symptoms.

LIKELY CAUSE:
Explain the most likely cause.

ACTION:
Give practical immediate actions the farmer can take.

PREVENTION:
Give practical prevention advice.

CAUTION:
If the image is unclear or the diagnosis cannot be determined reliably,
say so clearly. Do not invent a disease.

Important:
- Do not claim certainty when the image does not support it.
- Do not recommend dangerous chemicals.
- If pesticide/fungicide treatment may be appropriate, advise the farmer
  to follow the locally registered product label and local agricultural
  guidance.
- Keep the response farmer-friendly.
`;

    // ---------------------------------------------------
    // GEMINI API REQUEST
    // ---------------------------------------------------

    const geminiUrl =
      "https://generativelanguage.googleapis.com/v1beta/" +
      "models/gemini-3.6-flash:generateContent";

    const geminiResponse = await fetch(
      geminiUrl,
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
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Image
                  }
                },

                {
                  text: prompt
                }
              ]
            }
          ]
        })
      }
    );

    // ---------------------------------------------------
    // READ GEMINI RESPONSE
    // ---------------------------------------------------

    const responseText =
      await geminiResponse.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      return res.status(502).json({
        error: "Gemini returned an invalid response.",
        details: responseText.substring(0, 500)
      });
    }

    // ---------------------------------------------------
    // GEMINI ERROR
    // ---------------------------------------------------

    if (!geminiResponse.ok) {
      console.error(
        "Gemini API error:",
        data
      );

      const message =
        data?.error?.message ||
        "Gemini analysis failed.";

      return res.status(502).json({
        error: message
      });
    }

    // ---------------------------------------------------
    // EXTRACT TEXT
    // ---------------------------------------------------

    const candidates =
      data?.candidates || [];

    if (!candidates.length) {
      return res.status(502).json({
        error: "Gemini returned no analysis."
      });
    }

    const parts =
      candidates[0]?.content?.parts || [];

    const text =
      parts
        .map(part => part?.text || "")
        .join("\n")
        .trim();

    if (!text) {
      return res.status(502).json({
        error: "Gemini returned an empty analysis."
      });
    }

    // ---------------------------------------------------
    // EXTRACT CONFIDENCE
    // ---------------------------------------------------

    let confidence = null;

    const confidenceMatch =
      text.match(
        /CONFIDENCE\s*:\s*(\d{1,3})\s*%/i
      );

    if (confidenceMatch) {
      confidence =
        Math.min(
          100,
          Math.max(
            0,
            Number(confidenceMatch[1])
          )
        );
    }

    // ---------------------------------------------------
    // RETURN SUCCESS
    // ---------------------------------------------------

    return res.status(200).json({
      success: true,

      analysis: text,

      confidence: confidence,

      crop: crop,

      language: language,

      model: "gemini-3.6-flash"
    });

  } catch (error) {

    console.error(
      "CropPilot API error:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Unexpected server error."
    });
  }
}
