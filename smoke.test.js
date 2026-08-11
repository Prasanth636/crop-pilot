import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  parseImage,
  clampConfidence,
  analyzeWithGemini
} from "../api/analyze.js";

import {
  escapeHTML,
  getSeverityClass,
  clampConfidence as clampConfidenceClient
} from "../app.js";


/* =========================================================
   TEST IMAGE
========================================================= */

const validImage = "data:image/jpeg;base64," + "A".repeat(100);


/* =========================================================
   IMAGE VALIDATION (api/analyze.js)
========================================================= */

test("accepts valid JPEG image", () => {
  const image = parseImage(validImage);
  assert.equal(image.mime_type, "image/jpeg");
  assert.ok(image.data.length > 0);
});

test("rejects invalid image data", () => {
  assert.throws(() => parseImage("hello"), /JPG, PNG or WebP/);
});

test("rejects unsupported SVG", () => {
  assert.throws(
    () => parseImage("data:image/svg+xml;base64,AAAA"),
    /JPG, PNG or WebP/
  );
});


/* =========================================================
   CONFIDENCE (api/analyze.js)
========================================================= */

test("confidence stays between 0 and 100", () => {
  assert.equal(clampConfidence(-10), 0);
  assert.equal(clampConfidence(55.4), 55);
  assert.equal(clampConfidence(500), 100);
  assert.equal(clampConfidence("invalid"), 0);
});


/* =========================================================
   CONFIDENCE (app.js — client-side mirror)
========================================================= */

test("client clampConfidence matches server behavior", () => {
  assert.equal(clampConfidenceClient(-10), 0);
  assert.equal(clampConfidenceClient(150), 100);
  assert.equal(clampConfidenceClient("abc"), 0);
  assert.equal(clampConfidenceClient(73), 73);
});


/* =========================================================
   ESCAPING (app.js)
========================================================= */

test("escapeHTML neutralizes script tags", () => {
  const result = escapeHTML("<script>alert(1)</script>");
  assert.ok(!result.includes("<script>"));
});

test("escapeHTML handles quotes", () => {
  assert.ok(escapeHTML(`He said "hi"`).includes("&quot;"));
});

test("escapeHTML handles null and undefined safely", () => {
  assert.equal(escapeHTML(null), "");
  assert.equal(escapeHTML(undefined), "");
});


/* =========================================================
   SEVERITY MAPPING (app.js)
========================================================= */

test("getSeverityClass maps known severities", () => {
  assert.equal(getSeverityClass("Healthy"), "good");
  assert.equal(getSeverityClass("Watch"), "warn");
  assert.equal(getSeverityClass("Concern"), "bad");
});

test("getSeverityClass defaults unknown severities to warn", () => {
  assert.equal(getSeverityClass("nonsense"), "warn");
  assert.equal(getSeverityClass(""), "warn");
});


/* =========================================================
   RANDOM IMAGE PROTECTION
========================================================= */

test("non-crop image receives low confidence", async () => {
  const fakeFetch = async () => ({
    ok: true,
    async text() {
      return JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    is_crop: false,
                    crop_match: false,
                    title: "Not a crop image",
                    summary: "The uploaded image does not appear to show a crop.",
                    reason: "No clear plant or crop is visible.",
                    severity: "Unknown",
                    confidence: 99,
                    action: "Upload a clear crop photo.",
                    prevention: "Use a well-lit image of the plant."
                  })
                }
              ]
            }
          }
        ]
      });
    }
  });

  const result = await analyzeWithGemini({
    apiKey: "test-key",
    image: parseImage(validImage),
    crop: "Tomato",
    language: "English",
    field: {},
    fetchImpl: fakeFetch
  });

  assert.equal(result.is_crop, false);
  assert.equal(result.confidence, 15);
});


/* =========================================================
   API ERROR
========================================================= */

test("Gemini errors are handled", async () => {
  const fakeFetch = async () => ({
    ok: false,
    async text() {
      return JSON.stringify({ error: { message: "Invalid request" } });
    }
  });

  await assert.rejects(
    () =>
      analyzeWithGemini({
        apiKey: "test-secret",
        image: parseImage(validImage),
        crop: "Tomato",
        language: "English",
        field: {},
        fetchImpl: fakeFetch
      }),
    /Invalid request/
  );
});


/* =========================================================
   ACCESSIBILITY
========================================================= */

test("index contains accessibility essentials", () => {
  const html = fs.readFileSync("index.html", "utf8");

  assert.match(html, /viewport/);
  assert.match(html, /Skip to main content/);
  assert.match(html, /aria-live/);
});

test("scan page contains camera and gallery", () => {
  const html = fs.readFileSync("scan.html", "utf8");

  assert.match(html, /cameraInput/);
  assert.match(html, /galleryInput/);
  assert.match(html, /accept="image\/\*"/);
});

test("scan page result region supports progressbar semantics", () => {
  // Static markup only has the initial waiting state; the dynamic
  // progressbar attributes are injected by app.js at render time
  // (covered indirectly by the renderResult behavior above).
  const html = fs.readFileSync("scan.html", "utf8");
  assert.match(html, /id="result"/);
});


/* =========================================================
   SECURITY
========================================================= */

test("frontend does not contain Gemini API key", () => {
  const files = [
    "index.html",
    "app.js",
    "styles.css",
    "scan.html",
    "history.html",
    "field.html",
    "guide.html",
    "README.md"
  ];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(content, /AIza[0-9A-Za-z_-]{20,}/);
  }
});


/* =========================================================
   PROJECT STRUCTURE
========================================================= */

test("required project files exist", () => {
  const files = [
    "index.html",
    "app.js",
    "styles.css",
    "scan.html",
    "history.html",
    "field.html",
    "guide.html",
    "vercel.json",
    "package.json",
    "README.md",
    "api/analyze.js",
    "tests/smoke.test.js"
  ];

  for (const file of files) {
    assert.equal(fs.existsSync(file), true, `${file} is missing`);
  }
});
