/* =========================================================
   CropPilot — Main Application Controller
   ========================================================= */

"use strict";

/* =========================================================
   CONFIGURATION
   ========================================================= */

const API_URL = "/api/analyze";

const SUPPORTED_LANGUAGES = {
  English: "en-IN",
  Telugu: "te-IN",
  Hindi: "hi-IN",
  Tamil: "ta-IN",
  Kannada: "kn-IN"
};

const MAX_IMAGE_WIDTH = 1280;
const JPEG_QUALITY = 0.78;
const MAX_HISTORY = 30;


/* =========================================================
   GLOBAL STATE
   ========================================================= */

let selectedFile = null;
let selectedImageData = null;
let currentResult = null;
let currentObjectURL = null;

let field = {
  place: "Unknown",
  temperature: null,
  humidity: null,
  rain: null,
  wind: null
};


/* =========================================================
   DOM HELPERS
   ========================================================= */

function $(id) {
  return document.getElementById(id);
}


function setText(id, value) {
  const element = $(id);
  if (element) {
    element.textContent = value;
  }
}


function show(element) {
  if (element) {
    element.hidden = false;
  }
}


function hide(element) {
  if (element) {
    element.hidden = true;
  }
}


/* =========================================================
   LIVE ANNOUNCEMENTS (screen reader status updates)
   ========================================================= */

function announce(message) {
  const el = $("liveStatus");
  if (el) {
    el.textContent = message;
  }
}


/* =========================================================
   THEME
   ========================================================= */

function applyTheme(theme) {
  const isDark = theme === "dark";

  document.body.classList.toggle("dark", isDark);

  const button = $("themeButton");

  if (button) {
    button.textContent = isDark ? "☀️" : "🌙";

    button.setAttribute(
      "aria-label",
      isDark ? "Switch to light theme" : "Switch to dark theme"
    );
  }
}


function loadTheme() {
  const saved = localStorage.getItem("cropPilotTheme");
  applyTheme(saved === "dark" ? "dark" : "light");
}


function initTheme() {
  loadTheme();

  const button = $("themeButton");

  if (!button) {
    return;
  }

  button.addEventListener("click", () => {
    const dark = document.body.classList.contains("dark");
    const next = dark ? "light" : "dark";

    applyTheme(next);

    localStorage.setItem("cropPilotTheme", next);
  });
}


/* =========================================================
   IMAGE COMPRESSION
   ========================================================= */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image."));
    };

    image.src = url;
  });
}


async function compressImage(file) {
  const image = await loadImage(file);

  let width = image.naturalWidth;
  let height = image.naturalHeight;

  if (width > MAX_IMAGE_WIDTH) {
    const scale = MAX_IMAGE_WIDTH / width;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: false });

  context.drawImage(image, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) {
          reject(new Error("Image compression failed."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}


/* =========================================================
   FILE → DATA URL
   ========================================================= */

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not prepare image."));

    reader.readAsDataURL(blob);
  });
}


/* =========================================================
   PHOTO SELECTION
   ========================================================= */

async function handleSelectedPhoto(file) {
  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    alert("Please select an image file.");
    return;
  }

  try {
    selectedFile = file;

    setAnalysisWaiting();

    const compressed = await compressImage(file);

    selectedImageData = await blobToDataURL(compressed);

    const preview = $("preview");

    if (preview) {
      if (currentObjectURL) {
        URL.revokeObjectURL(currentObjectURL);
      }

      currentObjectURL = URL.createObjectURL(compressed);

      preview.src = currentObjectURL;
      preview.style.display = "block";
      preview.hidden = false;
    }

    const analyzeButton = $("analyzeButton");

    if (analyzeButton) {
      analyzeButton.disabled = false;
      analyzeButton.textContent = "🔍 Analyze My Crop";
    }

    announce("Crop photo selected successfully.");
  } catch (error) {
    console.error(error);
    selectedFile = null;
    selectedImageData = null;

    alert(error.message || "Unable to process the image.");
  }
}


/* =========================================================
   CAMERA / GALLERY
   ========================================================= */

function initFileInputs() {
  const cameraButton = $("cameraButton");
  const galleryButton = $("galleryButton");
  const cameraInput = $("cameraInput");
  const galleryInput = $("galleryInput");

  if (cameraButton && cameraInput) {
    cameraButton.addEventListener("click", () => {
      cameraInput.value = "";
      cameraInput.click();
    });
  }

  if (galleryButton && galleryInput) {
    galleryButton.addEventListener("click", () => {
      galleryInput.value = "";
      galleryInput.click();
    });
  }

  if (cameraInput) {
    cameraInput.addEventListener("change", event => {
      const file = event.target.files?.[0];
      handleSelectedPhoto(file);
    });
  }

  if (galleryInput) {
    galleryInput.addEventListener("change", event => {
      const file = event.target.files?.[0];
      handleSelectedPhoto(file);
    });
  }
}


/* =========================================================
   LANGUAGE
   ========================================================= */

function getSelectedLanguage() {
  const select = $("language");
  return select?.value || "English";
}


function saveLanguage() {
  const language = getSelectedLanguage();
  localStorage.setItem("cropPilotLanguage", language);
}


function loadLanguage() {
  const saved = localStorage.getItem("cropPilotLanguage");
  const select = $("language");

  if (select && saved && SUPPORTED_LANGUAGES[saved]) {
    select.value = saved;
  }
}


function initLanguage() {
  loadLanguage();

  const select = $("language");

  if (!select) {
    return;
  }

  select.addEventListener("change", () => {
    saveLanguage();

    const language = select.value;

    announce(`Language changed to ${language}.`);

    if (currentResult) {
      renderResult(currentResult);
    }
  });
}


/* =========================================================
   VOICE
   ========================================================= */

function getSpeechLanguage() {
  return SUPPORTED_LANGUAGES[getSelectedLanguage()] || "en-IN";
}


function buildSpeechText() {
  if (!currentResult) {
    return "Please analyze a crop image first.";
  }

  const parts = [
    currentResult.title,
    currentResult.summary,
    "Recommended action.",
    currentResult.action,
    "Prevention.",
    currentResult.prevention
  ];

  return parts.filter(Boolean).join(". ");
}


function speakResult() {
  if (!("speechSynthesis" in window)) {
    alert("Voice is not supported by this browser.");
    return;
  }

  const text = buildSpeechText();

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);

  utterance.lang = getSpeechLanguage();
  utterance.rate = 0.9;
  utterance.pitch = 1;

  window.speechSynthesis.speak(utterance);
}


function initVoice() {
  const buttons = [$("voiceButton"), $("speakButton")];

  buttons.forEach(button => {
    if (!button) {
      return;
    }

    button.addEventListener("click", () => {
      if (!currentResult) {
        alert("Analyze a crop first.");
        return;
      }

      speakResult();
    });
  });

  window.addEventListener("beforeunload", () => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  });
}


/* =========================================================
   FIELD DATA
   ========================================================= */

function updateFieldUI() {
  setText("temperature", field.temperature !== null ? `${field.temperature}°C` : "--");
  setText("humidity", field.humidity !== null ? `${field.humidity}%` : "--");
  setText("rain", field.rain !== null ? `${field.rain}%` : "--");
  setText("wind", field.wind !== null ? `${field.wind} km/h` : "--");

  setText(
    "weatherTemp",
    field.temperature !== null ? `🌤️ ${field.temperature}°C` : "🌤️ --°C"
  );
}


/* =========================================================
   WEATHER
   ========================================================= */

async function getWeather(lat, lon) {
  try {
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${encodeURIComponent(lat)}` +
      `&longitude=${encodeURIComponent(lon)}` +
      "&current=temperature_2m,relative_humidity_2m,wind_speed_10m" +
      "&hourly=precipitation_probability" +
      "&forecast_days=1" +
      "&timezone=auto";

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Weather request failed.");
    }

    const data = await response.json();
    const current = data.current;

    field.temperature = Math.round(Number(current.temperature_2m));
    field.humidity = Math.round(Number(current.relative_humidity_2m));
    field.wind = Math.round(Number(current.wind_speed_10m));

    const rainValues = data?.hourly?.precipitation_probability?.slice(0, 12) || [];

    field.rain = rainValues.length
      ? Math.max(...rainValues.map(Number))
      : null;

    updateFieldUI();
  } catch (error) {
    console.warn("Weather unavailable:", error);
  }
}


/* =========================================================
   REVERSE LOCATION
   ========================================================= */

async function reverseLocation(lat, lon) {
  try {
    const url =
      "https://geocoding-api.open-meteo.com/v1/reverse" +
      `?latitude=${encodeURIComponent(lat)}` +
      `&longitude=${encodeURIComponent(lon)}` +
      "&count=1" +
      "&language=en" +
      "&format=json";

    const response = await fetch(url);

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const place = data?.results?.[0];

    if (place) {
      const parts = [place.name, place.admin1].filter(Boolean);
      field.place = parts.join(", ");
    }

    setText("weatherLocation", `📍 ${field.place}`);
    setText("farmLocation", `📍 Farm location: ${field.place}`);
  } catch (error) {
    console.warn("Location name unavailable:", error);
  }
}


/* =========================================================
   GEOLOCATION
   ========================================================= */

function getLocation() {
  if (!navigator.geolocation) {
    setText("farmLocation", "📍 Location unavailable");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async position => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      await Promise.allSettled([getWeather(lat, lon), reverseLocation(lat, lon)]);
    },
    () => {
      setText("farmLocation", "📍 Location permission not granted");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000
    }
  );
}


/* =========================================================
   RESULT UI
   ========================================================= */

export function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


export function getSeverityClass(severity) {
  switch (String(severity || "").toLowerCase()) {
    case "healthy":
      return "good";
    case "watch":
      return "warn";
    case "concern":
      return "bad";
    default:
      return "warn";
  }
}


// Confidence clamp, pulled out into its own exported function so it's
// unit-testable independent of the DOM (mirrors the server-side version
// in api/analyze.js).
export function clampConfidence(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}


function renderResult(result) {
  const container = $("result");

  if (!container) {
    return;
  }

  const safe = result || {};

  const confidence = clampConfidence(safe.confidence);
  const severity = safe.severity || "Unknown";
  const title = safe.title || "Analysis complete";
  const summary = safe.summary || "No specific diagnosis returned.";
  const reason = safe.reason || "";
  const action = safe.action || "Follow local agricultural guidance.";
  const prevention = safe.prevention || "Continue regular crop monitoring.";

  const cropWarning =
    safe.crop_match === false
      ? `<div class="badge warn">⚠️ Crop selection may not match</div>`
      : "";

  const nonCrop =
    safe.is_crop === false
      ? `<div class="badge warn">📷 Image does not appear to be a crop</div>`
      : "";

  container.innerHTML = `

    <div class="result-title">
      ${escapeHTML(title)}
    </div>

    ${cropWarning}

    ${nonCrop}

    <div class="badge ${getSeverityClass(severity)}">
      ${escapeHTML(severity)}
    </div>

    <div class="sub">
      ${escapeHTML(summary)}
    </div>

    ${
      reason
        ? `
          <div class="sub" style="margin-top:8px">
            <strong>Why:</strong>
            ${escapeHTML(reason)}
          </div>
        `
        : ""
    }

    <div
      class="progress"
      role="progressbar"
      aria-valuenow="${confidence}"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-label="Diagnosis confidence: ${confidence} percent"
    >
      <div class="progress-bar" style="width:${confidence}%"></div>
    </div>

    <div class="sub" style="margin-top:7px">
      Confidence: ${confidence}%
    </div>

    <div class="advice">

      <div class="advice-box green-border">
        <strong>Recommended action</strong>
        <p>${escapeHTML(action)}</p>
      </div>

      <div class="advice-box">
        <strong>Prevention</strong>
        <p>${escapeHTML(prevention)}</p>
      </div>

    </div>

  `;

  currentResult = safe;

  saveHistory(safe);

  // Screen reader users otherwise get no signal that a result has
  // arrived — this is the key accessibility fix for the analyze flow.
  announce(
    `Analysis complete. ${title}. Severity: ${severity}. Confidence ${confidence} percent.`
  );
}


function setAnalysisWaiting() {
  const container = $("result");

  if (!container) {
    return;
  }

  container.innerHTML = `

    <div class="result-title">
      Photo ready
    </div>

    <div class="sub">
      Select your crop and tap Analyze My Crop.
    </div>

    <div
      class="progress"
      role="progressbar"
      aria-valuenow="5"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-label="Diagnosis confidence"
    >
      <div class="progress-bar" style="width:5%"></div>
    </div>

    <div class="sub" style="margin-top:7px">
      Confidence: --
    </div>

  `;
}


function setAnalysisLoading() {
  const container = $("result");

  if (!container) {
    return;
  }

  container.innerHTML = `

    <div class="result-title">
      🔬 Analyzing crop...
    </div>

    <div class="sub">
      Checking the image and field context.
    </div>

    <div
      class="progress"
      role="progressbar"
      aria-valuenow="70"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-label="Diagnosis confidence"
    >
      <div class="progress-bar" style="width:70%"></div>
    </div>

    <div class="sub" style="margin-top:7px">
      Please wait...
    </div>

  `;
}


/* =========================================================
   HISTORY (localStorage)
   ========================================================= */

function saveHistory(result) {
  try {
    const history = JSON.parse(localStorage.getItem("cropPilotHistory") || "[]");

    const entry = {
      date: new Date().toISOString(),
      crop: $("crop")?.value || "Other",
      title: result?.title || "Crop analysis",
      summary: result?.summary || "",
      confidence: clampConfidence(result?.confidence)
    };

    const updated = [entry, ...history].slice(0, MAX_HISTORY);

    localStorage.setItem("cropPilotHistory", JSON.stringify(updated));
  } catch (error) {
    console.warn("Could not save history:", error);
  }
}


/* =========================================================
   ANALYSIS
   ========================================================= */

async function analyzeCrop() {
  if (!selectedImageData) {
    alert("Please add a crop photo first.");
    return;
  }

  const crop = $("crop")?.value || "Other";
  const language = getSelectedLanguage();
  const button = $("analyzeButton");

  if (button) {
    button.disabled = true;
    button.textContent = "⏳ Analyzing...";
  }

  setAnalysisLoading();

  announce("Crop analysis started.");

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: selectedImageData,
        crop: crop,
        language: language,
        field: field
      })
    });

    const raw = await response.text();

    let data = null;

    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    if (!response.ok || !data) {
      throw new Error(data?.error || "Analysis failed. Please try again.");
    }

    renderResult(data);
  } catch (error) {
    console.error("Analyze error:", error);

    const container = $("result");

    if (container) {
      container.innerHTML = `
        <div class="result-title">Analysis failed</div>
        <div class="sub">${escapeHTML(error.message || "Something went wrong. Please try again.")}</div>
      `;
    }

    announce(`Analysis failed. ${error.message || "Please try again."}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "🔍 Analyze My Crop";
    }
  }
}


/* =========================================================
   INIT
   Guarded so this file can also be imported under Node's test
   runner (no `document` global there) purely for its exported
   pure functions — the app itself only runs in a browser.
   ========================================================= */

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initFileInputs();
    initLanguage();
    initVoice();
    getLocation();

    const analyzeButton = $("analyzeButton");

    if (analyzeButton) {
      analyzeButton.addEventListener("click", analyzeCrop);
    }
  });
}
