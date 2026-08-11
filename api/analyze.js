const MODEL = "gemini-3.1-flash-lite";

const MAX_IMAGE_BYTES = 7500000;
const MAX_REQUESTS_PER_MINUTE = 8;
const RATE_LOG_MAX_ENTRIES = 500;
const FETCH_TIMEOUT_MS = 15000;

const requestLog = new Map();

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

function sendJSON(res, status, data) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(data));
}

/* =========================
   RATE LIMIT
========================= */

function checkRateLimit(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "");
  const ip = forwarded.split(",")[0].trim() || "unknown";
  const now = Date.now();

  const old = requestLog.get(ip) || [];
  const active = old.filter(time => now - time < 60000);

  if (active.length >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }

  active.push(now);
  requestLog.set(ip, active);

  // Prevent unbounded memory growth: prune IPs with no recent activity
  // once the map gets large, instead of letting it grow forever.
  if (requestLog.size > RATE_LOG_MAX_ENTRIES) {
    for (const [key, times] of requestLog) {
      if (times.every(t => now - t >= 60000)) {
        requestLog.delete(key);
      }
    }
  }

  return true;
}

/* =========================
   IMAGE VALIDATION
========================= */

export function parseImage(value) {
  if (typeof value !== "string") {
    throw new Error("Image is required.");
  }

  if (value.length > MAX_IMAGE_BYTES * 1.4) {
    throw new Error("Image is too large.");
  }

  const match = value.match(
    /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i
  );

  if (!match) {
    throw new Error("Please upload a JPG, PNG or WebP image.");
  }

  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, "");
  const estimatedBytes = Math.floor(base64.length * 0.75);

  if (!ALLOWED_MIME.has(mimeType)) {
    throw new Error("Unsupported image type.");
  }

  if (estimatedBytes > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large.");
  }

  return {
    mime_type: mimeType,
    data: base64
  };
}

/* =========================
   CONFIDENCE
========================= */

export function clampConfidence(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
}

/* =========================
   GEMINI SCHEMA
========================= */

function responseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      is_crop: { type: "boolean" },
      crop_match: { type: "boolean" },
      title: { type: "string" },
      summary: { type: "string" },
      reason: { type: "string" },
      severity: {
        type: "string",
        enum: ["Healthy", "Watch", "Concern", "Unknown"]
      },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      action: { type: "string" },
      prevention: { type: "string" }
    },
    required: [
      "is_crop",
      "crop_match",
      "title",
      "summary",
      "reason",
      "severity",
      "confidence",
      "action",
      "prevention"
    ]
  };
}

/* =========================
   CLEAN INPUT
========================= */

function clean(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

/* =========================
   AI PROMPT
========================= */

function buildPrompt({ crop, language, field }) {
  return `

You are CropPilot, a cautious agricultural visual triage assistant.

Your job is to analyze the uploaded image and provide a practical farmer advisory.

IMPORTANT DECISION RULES:

1. FIRST determine whether the image actually contains:
   - crop
   - plant
   - leaf
   - fruit
   - stem
   - agricultural vegetation

2. If the image is NOT a crop or plant image:
   is_crop=false
   severity="Unknown"
   confidence must be 15 or lower.
   Do NOT invent a crop diagnosis.

3. Compare the image with the selected crop:
   ${crop}

4. If the selected crop does not reasonably match the image:
   crop_match=false.
   Explain that the farmer should verify the selected crop.

5. Never invent symptoms.

6. Only describe visual evidence that can reasonably be observed.

7. If the image quality is poor or evidence is insufficient:
   use severity="Unknown" or "Watch".

8. Weather conditions are supporting context only.
   They are NOT proof of disease.

9. Do NOT prescribe pesticide brands, chemical mixtures or unsafe dosage instructions.

10. Give simple, practical farmer-friendly advice.

11. Write the answer in:
   ${language}

12. Return ONLY valid JSON matching the supplied schema.

SELECTED CROP:
${crop}

LOCATION:
${clean(field.place, 100) || "Unknown"}

TEMPERATURE:
${field.temperature ?? "Unknown"} °C

HUMIDITY:
${field.humidity ?? "Unknown"} %

RAIN RISK:
${field.rain ?? "Unknown"} %

WIND:
${field.wind ?? "Unknown"} km/h

The response must contain:

- whether this is a crop image
- whether selected crop matches
- short title
- farmer-friendly summary
- reason
- severity
- confidence
- recommended action
- prevention

`;
}

/* =========================
   GEMINI REQUEST
   (fetchImpl is injectable so tests can mock the network call)
========================= */

export async function analyzeWithGemini({
  apiKey,
  image,
  crop,
  language,
  field,
  fetchImpl = fetch
}) {
  const prompt = buildPrompt({ crop, language, field });

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inline_data: image }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema(),
      temperature: 0.2
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;

  try {
    response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      }
    );
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Analysis timed out. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();

  let data = null;

  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini request failed.");
  }

  const text = data
    ?.candidates
    ?.[0]
    ?.content
    ?.parts
    ?.find(part => typeof part.text === "string")
    ?.text;

  if (!text) {
    throw new Error("Gemini returned no analysis.");
  }

  let result;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("AI returned invalid structured data.");
  }

  result.confidence = clampConfidence(result.confidence);

  /*
     HARD SAFETY RULE:
     RANDOM IMAGE = LOW CONFIDENCE
  */

  if (result.is_crop === false) {
    result.confidence = Math.min(result.confidence, 15);
    result.severity = "Unknown";
  }

  return result;
}

/* =========================
   MAIN VERCEL FUNCTION
========================= */

export default async function handler(req, res) {
  /* METHOD */

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJSON(res, 405, { error: "Method not allowed" });
  }

  /* RATE LIMIT */

  if (!checkRateLimit(req)) {
    return sendJSON(res, 429, {
      error: "Too many requests. Please wait a minute and try again."
    });
  }

  /* API KEY */

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return sendJSON(res, 500, {
      error: "GEMINI_API_KEY is not configured in Vercel."
    });
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};

    /* IMAGE */

    const image = parseImage(body.image);

    /* CROP */

    const crop = clean(body.crop || "Other", 40);

    /* LANGUAGE */

    const language = clean(body.language || "English", 30);

    const allowedLanguages = [
      "English",
      "Telugu",
      "Hindi",
      "Tamil",
      "Kannada"
    ];

    if (!allowedLanguages.includes(language)) {
      return sendJSON(res, 400, { error: "Unsupported farmer language." });
    }

    /* FIELD */

    const field = body.field && typeof body.field === "object" ? body.field : {};

    const cleanField = {
      place: clean(field.place, 100),
      temperature: Number.isFinite(Number(field.temperature))
        ? Number(field.temperature)
        : null,
      humidity: Number.isFinite(Number(field.humidity))
        ? Number(field.humidity)
        : null,
      rain: Number.isFinite(Number(field.rain))
        ? Number(field.rain)
        : null,
      wind: Number.isFinite(Number(field.wind))
        ? Number(field.wind)
        : null
    };

    /* AI */

    const result = await analyzeWithGemini({
      apiKey,
      image,
      crop,
      language,
      field: cleanField
    });

    return sendJSON(res, 200, result);
  } catch (error) {
    console.error("CropPilot API error:", error.message);

    return sendJSON(res, 400, {
      error: error.message || "Analysis failed."
    });
  }
}
    }


    // Remove spaces/newlines
    base64Image =
      base64Image.replace(
        /\s/g,
        ""
      );


    // ---------------------------------------------------
    // ALLOWED IMAGE TYPES
    // ---------------------------------------------------

    const allowedTypes = [

      "image/jpeg",

      "image/png",

      "image/webp",

      "image/heic",

      "image/heif"

    ];


    if (
      !allowedTypes.includes(
        mimeType
      )
    ) {

      return res.status(400).json({
        error:
          "Unsupported image type: " +
          mimeType
      });

    }


    // ---------------------------------------------------
    // FIELD DATA
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


    // ===================================================
    // IMPORTANT:
    // FIRST VALIDATE WHETHER IMAGE IS A CROP PHOTO
    // ===================================================

    const validationPrompt = `

You are the image validation system for CropPilot,
an agricultural crop-health application.

Your ONLY job is to determine whether the supplied
image is suitable for crop or plant health analysis.

The image MUST visibly contain:

- a crop plant
- a leaf
- stem
- fruit
- vegetable plant
- agricultural field
- crop disease symptoms
- crop pest damage
- or another clearly agricultural plant subject

A valid image can be:

- close-up leaf photo
- whole crop plant
- agricultural field
- damaged leaf
- diseased plant
- fruit or vegetable growing on a plant

An INVALID image includes:

- people
- faces
- clothing
- beds
- furniture
- rooms
- buildings
- vehicles
- animals that are not part of crop context
- screenshots
- documents
- food dishes
- random objects
- scenery without crops
- completely unrelated photographs

Do NOT assume that an image is a crop just because
the farmer selected a crop name.

Selected crop:
${crop}

Return EXACTLY one line:

VALID_CROP: YES

or

VALID_CROP: NO

Do not return anything else.
`;


    // ---------------------------------------------------
    // VALIDATION REQUEST
    // ---------------------------------------------------

    const validationUrl =
      "https://generativelanguage.googleapis.com/v1beta/" +
      "models/gemini-3.6-flash:generateContent";


    const validationResponse =
      await fetch(
        validationUrl,
        {

          method: "POST",

          headers: {

            "Content-Type":
              "application/json",

            "x-goog-api-key":
              apiKey

          },

          body: JSON.stringify({

            contents: [

              {

                role: "user",

                parts: [

                  {
                    inline_data: {
                      mime_type:
                        mimeType,

                      data:
                        base64Image
                    }
                  },

                  {
                    text:
                      validationPrompt
                  }

                ]

              }

            ]

          })

        }
      );


    const validationText =
      await validationResponse.text();


    let validationData;


    try {

      validationData =
        JSON.parse(
          validationText
        );

    } catch {

      return res.status(502).json({
        error:
          "Gemini returned an invalid validation response."
      });

    }


    // ---------------------------------------------------
    // GEMINI VALIDATION ERROR
    // ---------------------------------------------------

    if (
      !validationResponse.ok
    ) {

      console.error(
        "Gemini validation error:",
        validationData
      );


      return res.status(502).json({

        error:
          validationData?.error?.message ||
          "Image validation failed."

      });

    }


    // ---------------------------------------------------
    // GET VALIDATION TEXT
    // ---------------------------------------------------

    const validationParts =
      validationData
        ?.candidates?.[0]
        ?.content?.parts ||
      [];


    const validationResult =
      validationParts
        .map(
          part =>
            part?.text || ""
        )
        .join(" ")
        .trim();


    console.log(
      "Crop validation:",
      validationResult
    );


    // ===================================================
    // REJECT RANDOM IMAGE
    // ===================================================

    if (
      !validationResult
        .toUpperCase()
        .includes(
          "VALID_CROP: YES"
        )
    ) {

      return res.status(200).json({

        success: true,

        isCropImage: false,

        analysis:

          "This image does not appear to contain a crop or plant suitable for agricultural analysis.",

        confidence: 0,

        diagnosis:
          "Invalid crop image",

        action:
          "Please upload a clear photo of your crop, leaf, stem, fruit, or agricultural field.",

        prevention:
          "Take the photo in good lighting and make sure the crop occupies most of the image.",

        crop:
          crop,

        language:
          language

      });

    }


    // ===================================================
    // IMAGE IS A CROP
    // NOW PERFORM AGRICULTURAL ANALYSIS
    // ===================================================

    const analysisPrompt = `

You are CropPilot, an agricultural crop-health
analysis assistant.

The image has already passed the CropPilot
crop-image validation system.

Analyze ONLY the agricultural subject visible
in the image.

Selected crop:
${crop}

Farm location:
${place}

Current field conditions:

Temperature:
${temperature} °C

Humidity:
${humidity} %

Rain probability:
${rain} %

Wind:
${wind} km/h


LANGUAGE:

Return the complete farmer advisory in:

${language}


IMPORTANT:

Use simple language suitable for farmers.

Do not claim a disease with certainty unless
the image clearly supports it.

If the image is a healthy plant, say that it
appears healthy.

If symptoms are visible, identify the most
likely condition.

If the image quality is insufficient, clearly
say that a reliable diagnosis cannot be made.


Return EXACTLY these sections:

DIAGNOSIS:
Give the likely crop health condition.

CONFIDENCE:
Give a percentage from 0 to 100.

SYMPTOMS:
Describe the visible symptoms.

LIKELY CAUSE:
Explain the most likely cause.

RECOMMENDED ACTION:
Give practical next steps.

PREVENTION:
Give practical prevention advice.

CAUTION:
Mention uncertainty or the need for local
agricultural confirmation when appropriate.


IMPORTANT SAFETY:

Do not recommend dangerous chemicals.

If pesticide or fungicide treatment could be
appropriate, tell the farmer to follow the
locally registered product label and local
agricultural guidance.

Do not invent symptoms that are not visible.
`;


    // ---------------------------------------------------
    // ANALYSIS REQUEST
    // ---------------------------------------------------

    const analysisResponse =
      await fetch(
        validationUrl,
        {

          method: "POST",

          headers: {

            "Content-Type":
              "application/json",

            "x-goog-api-key":
              apiKey

          },

          body: JSON.stringify({

            contents: [

              {

                role: "user",

                parts: [

                  {
                    inline_data: {
                      mime_type:
                        mimeType,

                      data:
                        base64Image
                    }
                  },

                  {
                    text:
                      analysisPrompt
                  }

                ]

              }

            ]

          })

        }
      );


    const analysisText =
      await analysisResponse.text();


    let analysisData;


    try {

      analysisData =
        JSON.parse(
          analysisText
        );

    } catch {

      return res.status(502).json({

        error:
          "Gemini returned an invalid analysis response."

      });

    }


    // ---------------------------------------------------
    // ANALYSIS ERROR
    // ---------------------------------------------------

    if (
      !analysisResponse.ok
    ) {

      console.error(
        "Gemini analysis error:",
        analysisData
      );


      return res.status(502).json({

        error:
          analysisData?.error?.message ||
          "Crop analysis failed."

      });

    }


    // ---------------------------------------------------
    // EXTRACT ANALYSIS
    // ---------------------------------------------------

    const analysisParts =
      analysisData
        ?.candidates?.[0]
        ?.content?.parts ||
      [];


    const text =
      analysisParts
        .map(
          part =>
            part?.text || ""
        )
        .join("\n")
        .trim();


    if (!text) {

      return res.status(502).json({

        error:
          "Gemini returned an empty crop analysis."

      });

    }


    // ---------------------------------------------------
    // CONFIDENCE
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

            Number(
              confidenceMatch[1]
            )

          )

        );

    }


    // ---------------------------------------------------
    // RETURN RESULT
    // ---------------------------------------------------

    return res.status(200).json({

      success: true,

      isCropImage: true,

      analysis: text,

      confidence:
        confidence,

      crop:
        crop,

      language:
        language,

      model:
        "gemini-3.6-flash"

    });


  } catch (error) {

    console.error(
      "CropPilot server error:",
      error
    );


    return res.status(500).json({

      error:
        error?.message ||
        "Unexpected server error."

    });

  }

}
