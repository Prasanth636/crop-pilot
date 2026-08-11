const MODEL = "gemini-2.5-flash";


module.exports = async function handler(req, res) {

  /* ONLY POST */

  if (req.method !== "POST") {

    return res.status(405).json({
      error: "POST method required."
    });

  }


  /* API KEY */

  const apiKey =
    process.env.GEMINI_API_KEY;


  if (!apiKey) {

    return res.status(500).json({

      error:
        "GEMINI_API_KEY is not configured in Vercel yet."

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


    /* IMAGE REQUIRED */

    if(
      typeof image !== "string" ||
      !image.startsWith("data:image/")
    ){

      return res.status(400).json({

        error:
          "No valid crop image was received."

      });

    }


    /* EXTRACT IMAGE */

    const match =
      image.match(
        /^data:(image\/[^;]+);base64,(.+)$/
      );


    if(!match){

      return res.status(400).json({

        error:
          "Invalid crop image."

      });

    }


    const mimeType =
      match[1];

    const base64 =
      match[2];


    /* PROMPT */

    const prompt = `

You are CropPilot,
an agricultural field-assistance AI.

Your job is to analyze a farmer's
crop or leaf photograph and provide
a clear, conservative field advisory.

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

Rain probability:
${weather.rainRisk ?? "unknown"} %

Wind:
${weather.wind ?? "unknown"} km/h


IMPORTANT RULES:

1. Analyze the image carefully.

2. Do not claim 100% certainty.

3. If the image is unclear,
say that a clearer photograph is required.

4. Do not invent pesticide products.

5. Do not invent pesticide dosages.

6. Do not recommend unsafe chemical use.

7. Consider rain and wind conditions
when deciding whether spraying now
makes sense.

8. Give practical actions a farmer
can understand.

9. The answer must be valid JSON.

10. Return ONLY JSON.


Use exactly this structure:

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


    /* GEMINI REQUEST */

    const endpoint =
      "https://generativelanguage.googleapis.com/" +
      "v1beta/models/" +
      MODEL +
      ":generateContent";


    const response =
      await fetch(
        endpoint,
        {

          method:"POST",

          headers:{

            "Content-Type":
              "application/json",

            "x-goog-api-key":
              apiKey

          },

          body:
            JSON.stringify({

              contents:[

                {

                  role:"user",

                  parts:[

                    {
                      text:prompt
                    },

                    {

                      inline_data:{

                        mime_type:
                          mimeType,

                        data:
                          base64

                      }

                    }

                  ]

                }

              ],

              generationConfig:{

                temperature:.2,

                maxOutputTokens:1200,

                responseMimeType:
                  "application/json"

              }

            })

        }
      );


    const data =
      await response.json();


    /* GEMINI ERROR */

    if(!response.ok){

      return res.status(
        response.status
      ).json({

        error:
          data?.error?.message ||
          "Gemini API request failed."

      });

    }


    /* GET TEXT */

    const text =
      data
      ?.candidates?.[0]
      ?.content?.parts
      ?.map(
        part =>
          part.text || ""
      )
      .join("")
      .trim();


    if(!text){

      return res.status(502).json({

        error:
          "Gemini returned no analysis."

      });

    }


    /* PARSE JSON */

    let result;


    try{

      result =
        JSON.parse(text);

    }

    catch(error){

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


      try{

        result =
          JSON.parse(cleaned);

      }

      catch{

        return res.status(502).json({

          error:
            "Gemini returned an invalid response."

        });

      }

    }


    return res.status(200).json(
      result
    );

  }


  catch(error){

    console.error(
      "CropPilot error:",
      error
    );


    return res.status(500).json({

      error:
        "Server error while analyzing crop."

    });

  }

};
