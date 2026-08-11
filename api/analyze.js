export default async function handler(req, res) {

  // =====================================================
  // CROP PILOT - CROP IMAGE VALIDATION + AI ANALYSIS
  // =====================================================

  // -----------------------------------------------------
  // ONLY POST REQUESTS
  // -----------------------------------------------------

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }


  try {

    // ---------------------------------------------------
    // REQUEST DATA
    // ---------------------------------------------------

    const body = req.body || {};

    const image = body.image;

    const crop =
      body.crop ||
      "Unknown";

    const language =
      body.language ||
      "English";

    const field =
      body.field ||
      {};


    // ---------------------------------------------------
    // CHECK IMAGE
    // ---------------------------------------------------

    if (
      !image ||
      typeof image !== "string"
    ) {

      return res.status(400).json({
        error: "No crop image received."
      });

    }


    // ---------------------------------------------------
    // GEMINI API KEY
    // ---------------------------------------------------

    const apiKey =
      process.env.GEMINI_API_KEY;


    if (!apiKey) {

      return res.status(500).json({
        error:
          "GEMINI_API_KEY is not configured in Vercel."
      });

    }


    // ---------------------------------------------------
    // IMAGE DATA
    // ---------------------------------------------------

    let base64Image = image;

    let mimeType =
      "image/jpeg";


    if (
      image.startsWith("data:")
    ) {

      const match =
        image.match(
          /^data:([^;]+);base64,(.+)$/
        );


      if (!match) {

        return res.status(400).json({
          error:
            "Invalid image data format."
        });

      }


      mimeType =
        match[1];

      base64Image =
        match[2];

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
