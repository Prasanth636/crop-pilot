const MODEL = "gemini-2.5-flash";

module.exports = async function handler(req, res) {

  if (req.method !== "POST") {

    return res.status(405).json({
      error: "POST only"
    });

  }


  const apiKey =
    process.env.GEMINI_API_KEY;


  if (!apiKey) {

    return res.status(500).json({

      error:
        "GEMINI_API_KEY is not configured in Vercel."

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


    if (
      !image ||
      !image.startsWith("data:image/")
    ) {

      return res.status(400).json({

        error:
          "A crop image is required."

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


    if (
      base64.length >
      12000000
    ) {

      return res.status(413).json({

        error:
          "Image is too large. Please choose a smaller photo."

      });

    }


    const prompt = `

You are CropPilot,
an agricultural field-assistance AI.

Analyze the supplied crop/leaf image
together with crop type and field conditions.

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


IMPORTANT:

1. Do not claim certainty from an image alone.

2. If the image is unclear or not a crop,
say that a clearer crop photo is needed.

3. Give practical and conservative advice.

4. Do not invent pesticide products.

5. Do not invent pesticide dosages.

6. Treatment advice must follow
locally approved agricultural guidance.

7. Consider rain conditions before recommending spraying.

8. Return ONLY valid JSON.

Use this exact structure:

{
  "diagnosis": "short diagnosis",
  "severity": "healthy|low|moderate|high|severe|uncertain",
  "confidence": 0,
  "summary": "one or two sentences",
  "reason": "main visual evidence",
  "action": "what the farmer should do now",
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
          "Gemini API request failed."

      });

    }


    const text =
      data
        ?.candidates?.[0]
        ?.content?.parts
        ?.map(
          part => part.text || ""
        )
        .join("")
        .trim();


    if (!text) {

      return res.status(502).json({

        error:
          "Gemini returned no analysis."

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
            /```$/i,
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

    console.error(error);


    return res.status(500).json({

      error:
        "Server error while analyzing the crop."

    });

  }

};
