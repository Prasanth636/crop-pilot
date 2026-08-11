const MODEL = "gemini-2.5-flash";

module.exports = async function handler(req, res) {

  if (req.method !== "POST") {

    return res.status(405).json({
      error: "POST method required."
    });

  }


  const apiKey =
    process.env.GEMINI_API_KEY;


  if (!apiKey) {

    return res.status(500).json({

      error:
        "Gemini API key is not configured yet. Add GEMINI_API_KEY in Vercel Environment Variables."

    });

  }


  try {

    const body =
      req.body || {};


    const image =
      body.image;

    const crop =
      body.crop || "Unknown";

    const language =
      body.language || "English";

    const location =
      body.location || "Unknown";

    const weather =
      body.weather || {};


    if (!image) {

      return res.status(400).json({

        error:
          "No crop image was received."

      });

    }


    const match =
      image.match(
        /^data:(image\/[^;]+);base64,(.+)$/
      );


    if (!match) {

      return res.status(400).json({

        error:
          "Invalid image format."

      });

    }


    const mimeType =
      match[1];

    const base64 =
      match[2];


    const prompt = `

You are CropPilot,
an agricultural field-assistance AI.

Analyze the crop image.

Crop:
${crop}

Farmer language:
${language}

Location:
${location}

Temperature:
${weather.temperature ?? "unknown"} °C

Humidity:
${weather.humidity ?? "unknown"} %

Rain risk:
${weather.rainRisk ?? "unknown"} %

Wind:
${weather.wind ?? "unknown"} km/h


Rules:

- Be conservative.
- Do not claim certainty from an image alone.
- If the image is unclear, say so.
- Do not invent pesticide names.
- Do not invent pesticide dosages.
- Consider rain before recommending spraying.
- Encourage locally approved agricultural guidance.
- Return ONLY JSON.


Return exactly:

{
  "diagnosis": "short diagnosis",
  "severity": "healthy|low|moderate|high|severe|uncertain",
  "confidence": 0,
  "summary": "short explanation",
  "reason": "visual evidence",
  "action": "what farmer should do now",
  "treatment": "treatment or caution guidance",
  "spray_now": true,
  "action_window": "recommended timing",
  "disclaimer": "short safety note"
}

`;


    const endpoint =
      "https://generativelanguage.googleapis.com/" +
      "v1beta/models/" +
      MODEL +
      ":generateContent";


    const response =
      await fetch(
        endpoint,
        {

          method: "POST",

          headers: {

            "Content-Type":
              "application/json",

            "x-goog-api-key":
              apiKey

          },

          body:
            JSON.stringify({

              contents: [

                {

                  role: "user",

                  parts: [

                    {
                      text: prompt
                    },

                    {

                      inline_data: {

                        mime_type:
                          mimeType,

                        data:
                          base64

                      }

                    }

                  ]

                }

              ],

              generationConfig: {

                temperature: 0.2,

                maxOutputTokens: 1200,

                responseMimeType:
                  "application/json"

              }

            })

        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      return res.status(
        response.status
      ).json({

        error:
          data?.error?.message ||
          "Gemini request failed."

      });

    }


    const parts =
      data
        ?.candidates?.[0]
        ?.content?.parts || [];


    const text =
      parts
        .map(
          part =>
            part.text || ""
        )
        .join("")
        .trim();


    if (!text) {

      return res.status(502).json({

        error:
          "Gemini returned an empty response."

      });

    }


    let result;


    try {

      result =
        JSON.parse(text);

    }

    catch {

      const cleaned =
        text
          .replace(
            /^```json\s*/i,
            ""
          )
          .replace(
            /```\s*$/i,
            ""
          )
          .trim();


      result =
        JSON.parse(cleaned);

    }


    return res.status(200).json(
      result
    );

  }

  catch (error) {

    console.error(
      "CropPilot API error:",
      error
    );


    return res.status(500).json({

      error:
        "Server error while analyzing the crop."

    });

  }

};
