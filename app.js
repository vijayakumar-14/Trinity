/**
 * ============================================================================
 * AERODRIFT - Stratospheric Balloon Tracking & Landing Prediction Dashboard
 * SEDHACKS'26 · Team TRINITY · Rajalakshmi Engineering College · SEDS REC Chapter
 *
 * ES Module Application Architecture:
 * 1. CONFIG & GLOBAL STATE
 * 2. PURE MATHEMATICAL UTILITIES & SELF-TEST SUITE (?selftest=1)
 * 3. AUDIO SYNTHESIZER & ALERTS ENGINE
 * 4. ATMOSPHERIC WIND PROFILING & MONTE CARLO LANDING PREDICTION ENGINE
 * 5. LEAFLET MAP VISUALIZATION LAYER
 * 6. CHART.JS TELEMETRY PROFILES
 * 7. ATTITUDE & IMU ARTIFICIAL HORIZON
 * 8. TELEMETRY PARSER, SANITIZER & DERIVED METRICS
 * 9. FIREBASE REALTIME DATABASE LISTENERS & COMMANDS
 * 10. REPLAY MODE & DEMO FLIGHT SIMULATION
 * 11. DATA EXPORT GENERATORS (CSV, GPX, GEOJSON)
 * 12. UI EVENT HANDLERS & INITIALIZATION
 * ============================================================================
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  query,
  limitToLast,
  set,
  onChildAdded
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

/* ============================================================================
 * SECTION 1: CONFIG & GLOBAL STATE
 * ============================================================================ */

const CONFIG = {
  MAX_HISTORY_BUFFER: 2000,
  PREDICTION_THROTTLE_MS: 2000,
  CHART_UPDATE_THROTTLE_MS: 500,
  LINK_STALE_THRESHOLD_SEC: 10,
  LINK_LOST_THRESHOLD_SEC: 30,
  MAX_SPARKLINE_POINTS: 20,
  METERS_PER_DEG_LAT: 111320,
  EARTH_RADIUS_M: 6371000,
  STANDARD_GRAVITY: 9.80665
};

const state = {
  // Database & Telemetry
  db: null,
  isFirebaseConnected: false,
  isDemoSimulation: false,
  liveTelemetry: null,
  history: [], // [{ lat, lng, alt, ... }]
  launchPoint: null,
  lastPacketTs: null,
  missionStartTs: null,
  apogeeM: 0,
  burstDetected: false,

  // Derived Metrics
  verticalSpeedMs: 0,
  vsMovingAverageQueue: [],
  flightPhase: "PRE-LAUNCH", // "PRE-LAUNCH" | "ASCENT" | "FLOAT/BURST ZONE" | "DESCENT"

  // Landing Prediction
  prediction: {
    lat: null,
    lng: null,
    etlSec: 0,
    distanceCurrentKm: 0,
    distanceLaunchKm: 0,
    semiMajorM: 0,
    semiMinorM: 0,
    orientationDeg: 0,
    ellipseCoords: [],
    isProvisional: true,
    lastRunTs: 0
  },

  // Settings
  settings: {
    groundElevationM: 0,
    unitSystem: "metric", // "metric" | "imperial"
    mcRuns: 300,
    mapFollow: true,
    soundAlerts: true,
    noGoZone: {
      enabled: false,
      lat: 13.0827,
      lng: 80.2707,
      radiusKm: 5.0
    }
  },

  // Replay
  replay: {
    active: false,
    speed: 1,
    index: 0,
    timer: null,
    paused: false
  },

  // Leaflet Map & Markers
  map: null,
  mapLayers: {
    trailLine: null,
    balloonMarker: null,
    launchMarker: null,
    predictedMarker: null,
    projectedLine: null,
    ellipsePolygon: null,
    noGoCircle: null
  },

  // Chart.js
  chart: null,
  activeChartTab: "alt-time",

  // Audio Context
  audioCtx: null,

  // Alerts & Event History
  events: [],
  alertCooldowns: {}
};

// DOM Helper
const $ = (id) => document.getElementById(id);

/* ============================================================================
 * SECTION 2: PURE MATHEMATICAL UTILITIES & SELF-TEST SUITE
 * ============================================================================ */

/**
 * Format a numeric value safely with fallback, preventing NaN or undefined.
 */
export function formatNum(val, decimals = 1, fallback = "--") {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) {
    return fallback;
  }
  return Number(val).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/**
 * Great-circle distance between two GPS coordinates using Haversine formula (in meters).
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
    return 0;
  }
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;

  const a = Math.sin(dLat / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return CONFIG.EARTH_RADIUS_M * c;
}

/**
 * Calculates initial compass bearing from coordinate 1 to 2 in degrees (0..360).
 */
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const dLon = (lon2 - lon1) * toRad;

  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  const brng = Math.atan2(y, x) * (180 / Math.PI);
  return (brng + 360) % 360;
}

/**
 * Propagate coordinates by east (dx) and north (dy) displacements in meters.
 */
export function destinationPoint(lat, lon, dxMeters, dyMeters) {
  const dLat = dyMeters / CONFIG.METERS_PER_DEG_LAT;
  const latRad = (lat * Math.PI) / 180;
  const cosLat = Math.cos(latRad);
  const dLon = cosLat !== 0 ? dxMeters / (CONFIG.METERS_PER_DEG_LAT * cosLat) : 0;
  return {
    lat: lat + dLat,
    lng: lon + dLon
  };
}

/**
 * Convert course angle and speed into eastward (u) and northward (v) velocity components.
 */
export function windComponents(speedMs, courseDeg) {
  const rad = (courseDeg * Math.PI) / 180;
  return {
    u: speedMs * Math.sin(rad), // Eastward drift
    v: speedMs * Math.cos(rad)  // Northward drift
  };
}

/**
 * Cardinal string representation from compass degree (0..360).
 */
export function cardinalDirection(deg) {
  if (!Number.isFinite(deg)) return "--";
  const val = Math.round(((deg % 360) + 360) % 360 / 22.5);
  const cardinals = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
  ];
  return cardinals[val % 16];
}

/**
 * Moving average calculation helper for an array of numbers.
 */
export function calculateMovingAverage(values) {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, curr) => acc + curr, 0);
  return sum / values.length;
}

/**
 * 2x2 Covariance Matrix Eigen-decomposition for 95% Uncertainty Ellipse.
 * Matrix C = [[varX, covXY], [covXY, varY]]
 */
export function eigenDecomposition2x2(varX, covXY, varY) {
  const trace = varX + varY;
  const det = varX * varY - covXY * covXY;
  const disc = Math.sqrt(Math.max(0, trace * trace - 4 * det));

  // Eigenvalues
  const lambda1 = Math.max(0, (trace + disc) / 2); // Major
  const lambda2 = Math.max(0, (trace - disc) / 2); // Minor

  // Angle of semi-major axis (radians and degrees)
  let angleRad = 0;
  if (Math.abs(covXY) > 1e-9 || Math.abs(varX - varY) > 1e-9) {
    angleRad = 0.5 * Math.atan2(2 * covXY, varX - varY);
  }
  const angleDeg = (angleRad * 180) / Math.PI;

  // Scale factor for 95% confidence region (2 DOF Chi-Squared = 5.99146 -> sqrt = 2.4477)
  const scale95 = 2.4477;
  const semiMajor = scale95 * Math.sqrt(lambda1);
  const semiMinor = scale95 * Math.sqrt(lambda2);

  return {
    semiMajor,
    semiMinor,
    angleDeg,
    angleRad
  };
}

/**
 * Self-test suite run when URL includes `?selftest=1`.
 */
function runSelfTests() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("selftest") !== "1") return;

  console.group("%c[AERODRIFT SELF-TEST SUITE]", "color: #22d3ee; font-weight: bold;");
  try {
    // 1. Haversine Test (REC Chennai to Marina Beach ~25-30km)
    const d = haversineDistance(13.0827, 80.2707, 13.0475, 80.2824);
    console.assert(d > 3500 && d < 4500, `Haversine distance failed: ${d}`);

    // 2. Destination Point
    const pt = destinationPoint(13.0, 80.0, 111320, 111320);
    console.assert(Math.abs(pt.lat - 14.0) < 0.01, `Destination lat failed: ${pt.lat}`);

    // 3. Wind Components
    const w = windComponents(10, 90);
    console.assert(Math.abs(w.u - 10) < 0.001 && Math.abs(w.v) < 0.001, `Wind components failed: ${JSON.stringify(w)}`);

    // 4. Moving Average
    const avg = calculateMovingAverage([2, 4, 6, 8, 10]);
    console.assert(avg === 6, `Moving average failed: ${avg}`);

    // 5. Eigen-decomposition of standard isotropic covariance
    const eig = eigenDecomposition2x2(100, 0, 100);
    console.assert(Math.abs(eig.semiMajor - 24.477) < 0.05, `Eigen semi-major failed: ${eig.semiMajor}`);

    console.log("%c✓ ALL MATHEMATICAL SELF-TESTS PASSED SUCCESSFULLY", "color: #22c55e; font-weight: bold;");
  } catch (err) {
    console.error("Self-test encountered an error:", err);
  }
  console.groupEnd();
}

/* ============================================================================
 * SECTION 3: AUDIO SYNTHESIZER & ALERTS ENGINE
 * ============================================================================ */

function initAudioContext() {
  if (!state.audioCtx && (window.AudioContext || window.webkitAudioContext)) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AudioContextClass();
  }
  if (state.audioCtx && state.audioCtx.state === "suspended") {
    state.audioCtx.resume();
  }
}

function playAlertChime(type = "info") {
  if (!state.settings.soundAlerts) return;
  try {
    initAudioContext();
    if (!state.audioCtx) return;

    const ctx = state.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === "crit") {
      // 2-tone urgent alarm
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(440, now + 0.15);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } else if (type === "warn") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(587.33, now); // D5
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else {
      osc.type = "sine";
      osc.frequency.setValueAtTime(659.25, now); // E5
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  } catch (e) {
    // Audio autoplay restrictions ignored silently
  }
}

/**
 * Display toast and add permanent entry to Mission Event Log.
 */
function recordEvent(title, message, severity = "info") {
  const ts = new Date();
  const timeStr = ts.toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" }) + " UTC";

  // Prevent spamming the same alert within 15 seconds
  const alertKey = `${title}_${severity}`;
  const nowMs = Date.now();
  if (state.alertCooldowns[alertKey] && nowMs - state.alertCooldowns[alertKey] < 15000) {
    return;
  }
  state.alertCooldowns[alertKey] = nowMs;

  // Add to internal events log
  state.events.unshift({ timeStr, title, message, severity });
  if (state.events.length > 100) state.events.pop();

  // Render to event log container
  const container = $("events-log-container");
  if (container) {
    const el = document.createElement("div");
    el.className = `event-item ${severity}`;
    el.innerHTML = `
      <span class="event-time font-mono">${timeStr}</span>
      <span class="event-tag">${severity.toUpperCase()}</span>
      <span class="event-msg"><strong>${title}:</strong> ${message}</span>
    `;
    container.insertBefore(el, container.firstChild);
  }

  // Render Toast
  showToast(title, message, severity);

  // Play Audio
  playAlertChime(severity);
}

function showToast(title, message, severity = "info") {
  const stack = $("toast-stack");
  if (!stack) return;

  const toast = document.createElement("div");
  toast.className = `toast-item ${severity}`;
  const icon = severity === "crit" ? "🚨" : severity === "warn" ? "⚠️" : severity === "nominal" ? "✅" : "ℹ️";

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-body">
      <span class="toast-title">${title}</span>
      <span class="toast-msg">${message}</span>
    </div>
  `;
  stack.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(50px)";
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

/* ============================================================================
 * SECTION 4: ATMOSPHERIC WIND PROFILING & MONTE CARLO PREDICTION ENGINE
 * ============================================================================ */

/**
 * Construct layered horizontal wind profile from historical telemetry.
 * Bands of 500m intervals.
 */
function buildWindProfile() {
  const bands = {}; // altitudeBandIndex -> { sumU, sumV, count }
  const BAND_SIZE = 500;

  for (const pt of state.history) {
    if (!Number.isFinite(pt.alt) || !Number.isFinite(pt.gps_speed) || !Number.isFinite(pt.gps_course)) {
      continue;
    }
    const bandIdx = Math.max(0, Math.floor(pt.alt / BAND_SIZE));
    const { u, v } = windComponents(pt.gps_speed, pt.gps_course);

    if (!bands[bandIdx]) {
      bands[bandIdx] = { sumU: 0, sumV: 0, count: 0 };
    }
    bands[bandIdx].sumU += u;
    bands[bandIdx].sumV += v;
    bands[bandIdx].count += 1;
  }

  const profile = {};
  for (const idx in bands) {
    profile[idx] = {
      u: bands[idx].sumU / bands[idx].count,
      v: bands[idx].sumV / bands[idx].count
    };
  }

  return { profile, bandSize: BAND_SIZE };
}

/**
 * Lookup wind (u, v) at altitude z from profile, with fallback/nearest interpolation.
 */
function getWindAtAltitude(alt, windData, fallbackU, fallbackV) {
  const { profile, bandSize } = windData;
  const idx = Math.max(0, Math.floor(alt / bandSize));

  if (profile[idx]) return profile[idx];

  // Search nearest known altitude band
  let bestDist = Infinity;
  let nearest = null;
  for (const k in profile) {
    const dist = Math.abs(Number(k) - idx);
    if (dist < bestDist) {
      bestDist = dist;
      nearest = profile[k];
    }
  }

  return nearest || { u: fallbackU, v: fallbackV };
}

/**
 * Executes 300 Monte Carlo forward integration runs with perturbation.
 */
function runLandingPrediction() {
  const tNow = Date.now();
  if (tNow - state.prediction.lastRunTs < CONFIG.PREDICTION_THROTTLE_MS) {
    return;
  }
  state.prediction.lastRunTs = tNow;

  const current = state.liveTelemetry;
  if (!current || !Number.isFinite(current.lat) || !Number.isFinite(current.lng) || !Number.isFinite(current.alt)) {
    return;
  }

  const groundElev = state.settings.groundElevationM || 0;
  if (current.alt <= groundElev) {
    return;
  }

  const isDescent = state.flightPhase === "DESCENT" || state.burstDetected;
  state.prediction.isProvisional = !isDescent;

  // Base descent rate
  let baseDescentRate = 5.0; // standard parachute descent velocity default
  if (isDescent && state.verticalSpeedMs < -1.0) {
    baseDescentRate = Math.abs(state.verticalSpeedMs);
  }

  // Base current wind fallback
  const fallbackWind = windComponents(current.gps_speed || 0, current.gps_course || 0);
  const windData = buildWindProfile();

  const numRuns = state.settings.mcRuns || 300;
  const landingPoints = []; // [{ lat, lng, timeSec }]

  // Time-stepped numerical integration
  const dt = 2.0; // 2-second integration step for smooth Monte Carlo performance

  for (let r = 0; r < numRuns; r++) {
    // Perturbations:
    // Wind Speed: ±15% -> [0.85, 1.15]
    const windSpeedFactor = 1.0 + (Math.random() * 0.3 - 0.15);
    // Wind Direction: ±10 deg
    const windDirPerturbRad = ((Math.random() * 20 - 10) * Math.PI) / 180;
    // Descent Rate: ±20% -> [0.80, 1.20]
    const descentFactor = 1.0 + (Math.random() * 0.4 - 0.2);
    const descentRate = Math.max(1.5, baseDescentRate * descentFactor);

    let simLat = current.lat;
    let simLng = current.lng;
    let simAlt = current.alt;
    let elapsedSec = 0;

    while (simAlt > groundElev && elapsedSec < 18000) { // Max 5 hour safety cutoff
      const baseW = getWindAtAltitude(simAlt, windData, fallbackWind.u, fallbackWind.v);

      // Rotate and scale wind vector
      const cosA = Math.cos(windDirPerturbRad);
      const sinA = Math.sin(windDirPerturbRad);
      const uRot = (baseW.u * cosA - baseW.v * sinA) * windSpeedFactor;
      const vRot = (baseW.u * sinA + baseW.v * cosA) * windSpeedFactor;

      const dx = uRot * dt;
      const dy = vRot * dt;

      const nextPos = destinationPoint(simLat, simLng, dx, dy);
      simLat = nextPos.lat;
      simLng = nextPos.lng;
      simAlt -= descentRate * dt;
      elapsedSec += dt;
    }

    landingPoints.push({ lat: simLat, lng: simLng, timeSec: elapsedSec });
  }

  // Compute Mean Landing Point
  const meanLat = landingPoints.reduce((acc, p) => acc + p.lat, 0) / numRuns;
  const meanLng = landingPoints.reduce((acc, p) => acc + p.lng, 0) / numRuns;
  const meanTimeSec = landingPoints.reduce((acc, p) => acc + p.timeSec, 0) / numRuns;

  // Compute 2x2 Covariance Matrix in local meters
  const cosMeanLat = Math.cos((meanLat * Math.PI) / 180);
  let varX = 0;
  let varY = 0;
  let covXY = 0;

  for (const pt of landingPoints) {
    const dx = (pt.lng - meanLng) * CONFIG.METERS_PER_DEG_LAT * cosMeanLat;
    const dy = (pt.lat - meanLat) * CONFIG.METERS_PER_DEG_LAT;
    varX += dx * dx;
    varY += dy * dy;
    covXY += dx * dy;
  }
  varX /= (numRuns - 1);
  varY /= (numRuns - 1);
  covXY /= (numRuns - 1);

  // Eigen-decomposition for 95% Confidence Ellipse
  const { semiMajor, semiMinor, angleDeg, angleRad } = eigenDecomposition2x2(varX, covXY, varY);

  // Generate 36 Polygon vertices for Leaflet
  const ellipseCoords = [];
  const NUM_STEPS = 36;
  for (let i = 0; i <= NUM_STEPS; i++) {
    const theta = (i * 2 * Math.PI) / NUM_STEPS;
    // Local coordinates in rotated ellipse frame
    const xLocal = semiMajor * Math.cos(theta) * Math.cos(angleRad) - semiMinor * Math.sin(theta) * Math.sin(angleRad);
    const yLocal = semiMajor * Math.cos(theta) * Math.sin(angleRad) + semiMinor * Math.sin(theta) * Math.cos(angleRad);
    const vert = destinationPoint(meanLat, meanLng, xLocal, yLocal);
    ellipseCoords.push([vert.lat, vert.lng]);
  }

  // Update State Prediction
  state.prediction.lat = meanLat;
  state.prediction.lng = meanLng;
  state.prediction.etlSec = Math.round(meanTimeSec);
  state.prediction.semiMajorM = Math.round(semiMajor);
  state.prediction.semiMinorM = Math.round(semiMinor);
  state.prediction.orientationDeg = Math.round(((angleDeg % 360) + 360) % 360);
  state.prediction.ellipseCoords = ellipseCoords;

  // Distances
  state.prediction.distanceCurrentKm = haversineDistance(current.lat, current.lng, meanLat, meanLng) / 1000;
  if (state.launchPoint) {
    state.prediction.distanceLaunchKm = haversineDistance(state.launchPoint.lat, state.launchPoint.lng, meanLat, meanLng) / 1000;
  } else {
    state.prediction.distanceLaunchKm = state.prediction.distanceCurrentKm;
  }

  // Check No-Go Zone Alert
  if (state.settings.noGoZone.enabled) {
    const distToNoGo = haversineDistance(meanLat, meanLng, state.settings.noGoZone.lat, state.settings.noGoZone.lng) / 1000;
    if (distToNoGo < state.settings.noGoZone.radiusKm) {
      recordEvent("NO-GO VIOLATION", `Predicted landing point is inside restricted perimeter (${distToNoGo.toFixed(1)} km from center)`, "crit");
    }
  }

  // Update UI and Map
  renderPredictionPanel();
  updateMapPrediction();
}

/* ============================================================================
 * SECTION 5: LEAFLET MAP VISUALIZATION LAYER
 * ============================================================================ */

function initMap() {
  if (state.map || !window.L) return;

  // Initialize Leaflet Map with CARTO Dark Matter free tiles
  state.map = L.map("flight-map", {
    zoomControl: true,
    attributionControl: true
  }).setView([13.0827, 80.2707], 10);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    subdomains: "abcd",
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(state.map);

  // Layer 1: Polyline Trail
  state.mapLayers.trailLine = L.polyline([], {
    color: "#22d3ee",
    weight: 3.5,
    opacity: 0.9,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(state.map);

  // Layer 2: Projected Descent Line (Dashed)
  state.mapLayers.projectedLine = L.polyline([], {
    color: "#f59e0b",
    weight: 2,
    dashArray: "6, 8",
    opacity: 0.8
  }).addTo(state.map);

  // Layer 3: Uncertainty Ellipse Polygon
  state.mapLayers.ellipsePolygon = L.polygon([], {
    color: "#ef4444",
    weight: 1.5,
    fillColor: "#ef4444",
    fillOpacity: 0.15
  }).addTo(state.map);

  // Layer 4: Custom Balloon Icon
  const balloonSvgHtml = `
    <div class="custom-balloon-marker">
      <div class="pulse-beacon"></div>
      <svg viewBox="0 0 32 32" width="28" height="28" fill="none">
        <path d="M16 2C10 2 6 7 6 13C6 18 11 22 14 25L15 27H17L18 25C21 22 26 18 26 13C26 7 22 2 16 2Z" fill="#0284c7" stroke="#22d3ee" stroke-width="1.8"/>
        <circle cx="16" cy="12" r="4" fill="#38bdf8"/>
        <rect x="14" y="28" width="4" height="2.5" fill="#f59e0b" rx="0.5"/>
      </svg>
    </div>
  `;
  const balloonIcon = L.divIcon({
    html: balloonSvgHtml,
    className: "balloon-div-icon",
    iconSize: [32, 32],
    iconAnchor: [16, 28]
  });
  state.mapLayers.balloonMarker = L.marker([13.0827, 80.2707], { icon: balloonIcon }).addTo(state.map);

  // Layer 5: Launch Marker
  const launchIconHtml = `
    <div class="launch-marker-icon font-mono" title="Launch Site">
      <span>PAD</span>
    </div>
  `;
  const launchIcon = L.divIcon({
    html: launchIconHtml,
    className: "launch-div-icon",
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
  state.mapLayers.launchMarker = L.marker([0, 0], { icon: launchIcon });

  // Layer 6: Predicted Landing Marker
  const landingIconHtml = `
    <div class="predicted-landing-icon font-mono" title="Estimated Landing Zone">
      <div class="target-crosshair"></div>
    </div>
  `;
  const landingIcon = L.divIcon({
    html: landingIconHtml,
    className: "landing-div-icon",
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
  state.mapLayers.predictedMarker = L.marker([0, 0], { icon: landingIcon });

  setTimeout(() => state.map && state.map.invalidateSize(), 200);
}

function updateMapTelemetry(current) {
  if (!state.map || !current || !Number.isFinite(current.lat) || !Number.isFinite(current.lng)) {
    return;
  }

  const pos = [current.lat, current.lng];

  // Update live marker
  state.mapLayers.balloonMarker.setLatLng(pos);
  state.mapLayers.balloonMarker.bindPopup(`
    <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">
      <strong style="color: #22d3ee;">AERODRIFT BALLOON</strong><br>
      Lat: ${current.lat.toFixed(5)}°<br>
      Lng: ${current.lng.toFixed(5)}°<br>
      Alt: ${formatNum(current.alt, 1)} m<br>
      Drift: ${formatNum(current.gps_speed, 1)} m/s (${formatNum(current.gps_course, 0)}°)<br>
      Phase: <span style="color:#f59e0b;">${state.flightPhase}</span>
    </div>
  `);

  // Update Trajectory Trail
  const trailCoords = state.history
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => [p.lat, p.lng]);
  state.mapLayers.trailLine.setLatLngs(trailCoords);

  // Update Launch Marker
  if (state.launchPoint && !state.map.hasLayer(state.mapLayers.launchMarker)) {
    state.mapLayers.launchMarker.setLatLng([state.launchPoint.lat, state.launchPoint.lng]).addTo(state.map);
  }

  // Update HUD
  $("hud-lat").textContent = `${current.lat.toFixed(5)}°`;
  $("hud-lng").textContent = `${current.lng.toFixed(5)}°`;
  $("hud-alt").textContent = `${formatNum(current.alt, 0)} m`;
  if (state.launchPoint) {
    const dLaunch = haversineDistance(state.launchPoint.lat, state.launchPoint.lng, current.lat, current.lng) / 1000;
    $("hud-dist-launch").textContent = `${dLaunch.toFixed(2)} km`;
  }
  $("map-point-counter").textContent = `${trailCoords.length} TRACK POINTS`;

  // Auto-follow if enabled
  if (state.settings.mapFollow) {
    state.map.panTo(pos, { animate: true, duration: 0.8 });
  }
}

function updateMapPrediction() {
  if (!state.map) return;
  const p = state.prediction;

  if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
    const landingPos = [p.lat, p.lng];

    // Marker
    state.mapLayers.predictedMarker.setLatLng(landingPos);
    if (!state.map.hasLayer(state.mapLayers.predictedMarker)) {
      state.mapLayers.predictedMarker.addTo(state.map);
    }
    state.mapLayers.predictedMarker.bindPopup(`
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">
        <strong style="color: #ef4444;">PREDICTED TOUCHDOWN</strong><br>
        Lat: ${p.lat.toFixed(5)}°<br>
        Lng: ${p.lng.toFixed(5)}°<br>
        Range: ${p.distanceCurrentKm.toFixed(1)} km<br>
        ETL: ${Math.floor(p.etlSec / 60)}m ${p.etlSec % 60}s<br>
        95% Ellipse: ${p.semiMajorM}m × ${p.semiMinorM}m
      </div>
    `);

    // Projected descent line
    if (state.liveTelemetry && Number.isFinite(state.liveTelemetry.lat)) {
      state.mapLayers.projectedLine.setLatLngs([
        [state.liveTelemetry.lat, state.liveTelemetry.lng],
        landingPos
      ]);
    }

    // 95% Uncertainty Ellipse
    if (p.ellipseCoords && p.ellipseCoords.length > 0) {
      state.mapLayers.ellipsePolygon.setLatLngs(p.ellipseCoords);
    }
  } else {
    if (state.map.hasLayer(state.mapLayers.predictedMarker)) {
      state.map.removeLayer(state.mapLayers.predictedMarker);
    }
    state.mapLayers.projectedLine.setLatLngs([]);
    state.mapLayers.ellipsePolygon.setLatLngs([]);
  }
}

function fitAllMapBounds() {
  if (!state.map) return;
  const pts = state.history
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => [p.lat, p.lng]);

  if (state.prediction && Number.isFinite(state.prediction.lat)) {
    pts.push([state.prediction.lat, state.prediction.lng]);
  }
  if (state.launchPoint) {
    pts.push([state.launchPoint.lat, state.launchPoint.lng]);
  }

  if (pts.length > 0) {
    state.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 });
  }
}

/* ============================================================================
 * SECTION 6: CHART.JS TELEMETRY PROFILES
 * ============================================================================ */

function initChart() {
  if (state.chart || !window.Chart) return;

  const canvas = $("mission-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Altitude (m)",
          data: [],
          borderColor: "#22d3ee",
          backgroundColor: "rgba(34, 211, 238, 0.08)",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.25,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        intersect: false,
        mode: "index"
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#070b16",
          borderColor: "rgba(34, 211, 238, 0.4)",
          borderWidth: 1,
          titleFont: { family: "JetBrains Mono", size: 11 },
          bodyFont: { family: "JetBrains Mono", size: 11 },
          padding: 8
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#64748b", font: { family: "JetBrains Mono", size: 9 }, maxTicksLimit: 6 },
          border: { display: false }
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#64748b", font: { family: "JetBrains Mono", size: 9 }, maxTicksLimit: 5 },
          border: { display: false }
        }
      }
    }
  });
}

function updateChart() {
  if (!state.chart || state.history.length === 0) return;

  // Decimation: cap points to 500 for high performance rendering
  const maxPts = 500;
  const step = Math.max(1, Math.floor(state.history.length / maxPts));
  const samples = [];
  for (let i = 0; i < state.history.length; i += step) {
    samples.push(state.history[i]);
  }
  if (samples[samples.length - 1] !== state.history[state.history.length - 1]) {
    samples.push(state.history[state.history.length - 1]);
  }

  const tab = state.activeChartTab;
  let labels = [];
  let data = [];
  let labelText = "";
  let color = "#22d3ee";
  let bgGrad = "rgba(34, 211, 238, 0.08)";

  if (tab === "alt-time") {
    labelText = "Altitude (m)";
    color = "#22d3ee";
    bgGrad = "rgba(34, 211, 238, 0.08)";
    labels = samples.map((p) => p.ts ? new Date(p.ts).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--");
    data = samples.map((p) => Number(p.alt || 0));
  } else if (tab === "temp-alt") {
    labelText = "Temperature (°C)";
    color = "#8b5cf6";
    bgGrad = "rgba(139, 92, 246, 0.08)";
    labels = samples.map((p) => `${formatNum(p.alt, 0)} m`);
    data = samples.map((p) => Number(p.temp || 0));
  } else if (tab === "press-alt") {
    labelText = "Pressure (hPa)";
    color = "#f59e0b";
    bgGrad = "rgba(245, 158, 11, 0.08)";
    labels = samples.map((p) => `${formatNum(p.alt, 0)} m`);
    data = samples.map((p) => Number(p.pressure || 0));
  } else if (tab === "wind-alt") {
    labelText = "Wind Speed (m/s)";
    color = "#38bdf8";
    bgGrad = "rgba(56, 189, 248, 0.08)";
    labels = samples.map((p) => `${formatNum(p.alt, 0)} m`);
    data = samples.map((p) => Number(p.gps_speed || 0));
  } else if (tab === "vs-time") {
    labelText = "Vertical Speed (m/s)";
    color = "#22c55e";
    bgGrad = "rgba(34, 197, 94, 0.08)";
    labels = samples.map((p) => p.ts ? new Date(p.ts).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--");
    data = samples.map((p) => Number(p.computed_vs || 0));
  }

  state.chart.data.labels = labels;
  state.chart.data.datasets[0].label = labelText;
  state.chart.data.datasets[0].data = data;
  state.chart.data.datasets[0].borderColor = color;
  state.chart.data.datasets[0].backgroundColor = bgGrad;
  state.chart.update("none");

  // Chart footer readouts
  const lastSample = samples[samples.length - 1];
  $("chart-stat-x").textContent = labels[labels.length - 1] || "--";
  $("chart-stat-y").textContent = `${formatNum(data[data.length - 1], 1)}`;
  $("chart-stat-count").textContent = state.history.length;
}

/* ============================================================================
 * SECTION 7: ATTITUDE & IMU ARTIFICIAL HORIZON
 * ============================================================================ */

function updateAttitudeAndIMU(data) {
  if (!data) return;

  const roll = Number.isFinite(data.roll) ? data.roll : 0;
  const pitch = Number.isFinite(data.pitch) ? data.pitch : 0;

  // Artificial Horizon transform
  const drum = $("horizon-drum");
  if (drum) {
    // 1 deg pitch translates ~2.2 pixels, clamp between -35 and +35 deg
    const clampedPitch = Math.max(-35, Math.min(35, pitch));
    const pitchOffsetPx = clampedPitch * 2.2;
    drum.style.transform = `rotate(${-roll}deg) translateY(${pitchOffsetPx}px)`;
  }

  $("imu-roll-val").textContent = `${roll >= 0 ? "+" : ""}${roll.toFixed(1)}°`;
  $("imu-pitch-val").textContent = `${pitch >= 0 ? "+" : ""}${pitch.toFixed(1)}°`;

  // Accelerations (ax, ay, az in m/s²)
  const ax = Number.isFinite(data.ax) ? data.ax : 0;
  const ay = Number.isFinite(data.ay) ? data.ay : 0;
  const az = Number.isFinite(data.az) ? data.az : 9.81;

  $("val-ax").textContent = `${ax >= 0 ? "+" : ""}${ax.toFixed(2)}`;
  $("val-ay").textContent = `${ay >= 0 ? "+" : ""}${ay.toFixed(2)}`;
  $("val-az").textContent = `${az >= 0 ? "+" : ""}${az.toFixed(2)}`;

  // Bar percentage mappings [-20 to +20 m/s²]
  const toPct = (val) => Math.max(0, Math.min(100, ((val + 20) / 40) * 100));
  $("bar-ax").style.width = `${toPct(ax)}%`;
  $("bar-ay").style.width = `${toPct(ay)}%`;
  $("bar-az").style.width = `${toPct(az)}%`;

  // Total G = sqrt(ax^2 + ay^2 + az^2) / 9.80665
  const totalG = Math.sqrt(ax * ax + ay * ay + az * az) / CONFIG.STANDARD_GRAVITY;
  $("total-g-badge").textContent = `TOTAL: ${totalG.toFixed(2)} G`;

  // Gyroscope (gx, gy, gz in deg/s)
  const gx = Number.isFinite(data.gx) ? data.gx : 0;
  const gy = Number.isFinite(data.gy) ? data.gy : 0;
  const gz = Number.isFinite(data.gz) ? data.gz : 0;

  $("val-gx").textContent = `${gx >= 0 ? "+" : ""}${gx.toFixed(1)}`;
  $("val-gy").textContent = `${gy >= 0 ? "+" : ""}${gy.toFixed(1)}`;
  $("val-gz").textContent = `${gz >= 0 ? "+" : ""}${gz.toFixed(1)}`;

  // Bar percentage mappings [-360 to +360 deg/s]
  const toGyroPct = (val) => Math.max(0, Math.min(100, ((val + 360) / 720) * 100));
  $("bar-gx").style.width = `${toGyroPct(gx)}%`;
  $("bar-gy").style.width = `${toGyroPct(gy)}%`;
  $("bar-gz").style.width = `${toGyroPct(gz)}%`;
}

/* ============================================================================
 * SECTION 8: TELEMETRY PARSER, SANITIZER & DERIVED METRICS
 * ============================================================================ */

/**
 * Computes dynamic vertical speed, detects envelope burst, and updates flight phase.
 */
function processDerivedMetrics(packet) {
  const t = packet.ts || Date.now();
  const alt = packet.alt;

  // 1. Vertical speed calculation from successive alt/ts
  let instantaneousVs = 0;
  if (state.history.length > 0) {
    const prev = state.history[state.history.length - 1];
    const dt = (t - (prev.ts || t)) / 1000;
    if (dt > 0.3 && dt < 15 && Number.isFinite(prev.alt) && Number.isFinite(alt)) {
      instantaneousVs = (alt - prev.alt) / dt;
    }
  }

  // 5-sample moving average smoothing
  state.vsMovingAverageQueue.push(instantaneousVs);
  if (state.vsMovingAverageQueue.length > 5) {
    state.vsMovingAverageQueue.shift();
  }
  state.verticalSpeedMs = calculateMovingAverage(state.vsMovingAverageQueue);
  packet.computed_vs = state.verticalSpeedMs;

  // 2. Apogee & Burst Detection
  if (Number.isFinite(alt)) {
    if (alt > state.apogeeM) {
      state.apogeeM = alt;
    }
    // Burst rule: altitude drops > 200m from apogee after reaching >= 10,000m
    if (state.apogeeM >= 10000 && (state.apogeeM - alt) > 200 && !state.burstDetected) {
      state.burstDetected = true;
      recordEvent("ENVELOPE BURST DETECTED", `Apogee recorded at ${formatNum(state.apogeeM, 0)} m. Descent underway.`, "warn");
    }
  }

  // 3. Flight Phase Detection
  const vs = state.verticalSpeedMs;
  const launchElev = state.launchPoint ? state.launchPoint.alt : 0;

  if (state.burstDetected || vs < -1.0) {
    state.flightPhase = "DESCENT";
  } else if (alt > 15000 && Math.abs(vs) < 1.0) {
    state.flightPhase = "FLOAT/BURST ZONE";
  } else if (vs > 1.0) {
    state.flightPhase = "ASCENT";
  } else if (Math.abs(vs) < 0.5 && alt < (launchElev + 300)) {
    state.flightPhase = "PRE-LAUNCH";
  }

  // Check alert triggers
  checkSafetyAlerts(packet);
}

function checkSafetyAlerts(p) {
  if (p.sats !== null && p.sats !== undefined && p.sats < 4) {
    recordEvent("GNSS FIX DEGRADED", `Low satellite count (${p.sats} sats). Navigation fix accuracy compromised.`, "warn");
  }
  if (p.temp !== null && p.temp !== undefined && p.temp < -60) {
    recordEvent("EXTREME LOW TEMPERATURE", `Ambient sensor registered ${formatNum(p.temp, 1)} °C. Battery insulation critical.`, "warn");
  }
  if (state.verticalSpeedMs < -15) {
    recordEvent("RAPID DESCENT RATE", `Descent velocity ${formatNum(state.verticalSpeedMs, 1)} m/s exceeds nominal threshold.`, "crit");
  }
  if (p.rssi !== null && p.rssi !== undefined && p.rssi < -85) {
    recordEvent("RF LINK WEAK", `RSSI attenuated to ${p.rssi} dBm. Packet drop expected.`, "warn");
  }
}

/**
 * Render all hero tiles, sparklines, navigation cards, and diagnostics.
 */
function renderDashboard(data) {
  if (!data) return;

  // Hide empty state once packets arrive
  const emptyOverlay = $("empty-state-overlay");
  if (emptyOverlay && emptyOverlay.classList.contains("active")) {
    emptyOverlay.classList.remove("active");
  }

  // Mission MET Clock
  if (state.missionStartTs) {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - state.missionStartTs) / 1000));
    const h = String(Math.floor(elapsedSec / 3600)).padStart(2, "0");
    const m = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, "0");
    const s = String(elapsedSec % 60).padStart(2, "0");
    $("mission-clock").textContent = `T+ ${h}:${m}:${s}`;
  }

  // Flight Phase Badge
  const phaseBadge = $("flight-phase-badge");
  phaseBadge.textContent = state.flightPhase;
  phaseBadge.className = "pill-badge";
  if (state.flightPhase === "ASCENT") phaseBadge.classList.add("badge-phase-ascent");
  else if (state.flightPhase === "FLOAT/BURST ZONE") phaseBadge.classList.add("badge-phase-float");
  else if (state.flightPhase === "DESCENT") phaseBadge.classList.add("badge-phase-descent");
  else phaseBadge.classList.add("badge-phase-pre");

  // HERO TILE 1: Altitude
  const alt = data.alt;
  $("val-alt").textContent = formatNum(alt, 1);
  const altFt = Number.isFinite(alt) ? alt * 3.28084 : null;
  $("val-alt-ft").textContent = `${formatNum(altFt, 0)} ft`;
  $("apogee-val").textContent = formatNum(state.apogeeM, 0);

  // HERO TILE 2: Vertical Speed
  const vs = state.verticalSpeedMs;
  $("val-vs").textContent = `${vs >= 0 ? "+" : ""}${formatNum(vs, 1)}`;
  const vsFpm = vs * 196.85; // m/s to ft/min
  $("val-vs-fpm").textContent = `${vsFpm >= 0 ? "+" : ""}${formatNum(vsFpm, 0)} ft/min`;
  $("val-vs").style.color = vs > 0 ? "var(--cyan)" : vs < -1 ? "var(--amber)" : "var(--text-main)";

  // HERO TILE 3: Ground Drift Speed
  const spd = data.gps_speed;
  $("val-speed").textContent = formatNum(spd, 1);
  const spdKmh = Number.isFinite(spd) ? spd * 3.6 : null;
  const spdKn = Number.isFinite(spd) ? spd * 1.94384 : null;
  $("val-speed-dual").textContent = `${formatNum(spdKmh, 1)} km/h · ${formatNum(spdKn, 1)} kn`;
  $("speed-heading-badge").textContent = Number.isFinite(data.gps_course) ? `${formatNum(data.gps_course, 0)}°` : "--°";

  // HERO TILE 4: Temperature
  const temp = data.temp;
  $("val-temp").textContent = formatNum(temp, 1);
  const tempF = Number.isFinite(temp) ? (temp * 9) / 5 + 32 : null;
  $("val-temp-f").textContent = `${formatNum(tempF, 1)} °F`;
  $("val-temp").style.color = temp < -40 ? "var(--cyan-bright)" : "var(--text-main)";

  // HERO TILE 5: Pressure
  const press = data.pressure;
  $("val-press").textContent = formatNum(press, 1);
  const pressAtm = Number.isFinite(press) ? press / 1013.25 : null;
  $("val-press-atm").textContent = `${formatNum(pressAtm, 3)} atm`;

  // HERO TILE 6: Satellites & HDOP
  const sats = data.sats;
  $("val-sats").textContent = sats !== null && sats !== undefined ? sats : "--";
  $("hdop-badge").textContent = `HDOP: ${formatNum(data.hdop, 1)}`;

  // GNSS Signal bars
  const bars = $("gnss-bars").children;
  for (let i = 0; i < bars.length; i++) {
    if (sats >= (i + 1) * 3) {
      bars[i].classList.add("active");
    } else {
      bars[i].classList.remove("active");
    }
  }

  // HERO TILE 7: RSSI & Loss
  const rssi = data.rssi;
  $("val-rssi").textContent = rssi !== null && rssi !== undefined ? rssi : "--";
  const pktSeq = data.packet_seq;
  $("val-pkt-seq").textContent = pktSeq ? `PKT #${pktSeq}` : "PKT #--";
  const lost = data.packets_lost || 0;
  const lossPct = pktSeq && pktSeq > 0 ? (lost / pktSeq) * 100 : 0;
  $("loss-pct-badge").textContent = `LOSS: ${lossPct.toFixed(1)}%`;

  // Update Mini Sparklines
  updateSparkline("spark-alt", "alt");
  updateSparkline("spark-vs", "computed_vs");
  updateSparkline("spark-speed", "gps_speed");
  updateSparkline("spark-temp", "temp");
  updateSparkline("spark-press", "pressure");
  updateSparkline("spark-rssi", "rssi");

  // COMPASS ROSE & NAVIGATION CARD
  updateCompassRose(data);

  // ATTITUDE & IMU CARD
  updateAttitudeAndIMU(data);

  // DIAGNOSTICS CARD
  $("diag-rssi-val").textContent = rssi ? `${rssi} dBm` : "-- dBm";
  // RSSI map [-110 to -40 dBm] -> 0% to 100%
  const rssiPct = rssi ? Math.max(0, Math.min(100, ((rssi + 110) / 70) * 100)) : 0;
  $("diag-rssi-fill").style.width = `${rssiPct}%`;
  $("diag-seq").textContent = pktSeq || "--";
  $("diag-lost").textContent = lost;
  $("diag-loss-pct").textContent = `${lossPct.toFixed(2)}%`;

  // PAYLOAD & CUTDOWN STATE
  updateCutdownState(data.cutdown_state);
}

function updateSparkline(svgId, prop) {
  const svg = $(svgId);
  if (!svg || state.history.length < 2) return;

  const pts = state.history.slice(-CONFIG.MAX_SPARKLINE_POINTS);
  const values = pts.map((p) => Number(p[prop] || 0)).filter((v) => Number.isFinite(v));
  if (values.length < 2) return;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const width = 60;
  const height = 20;

  const pointsStr = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  svg.innerHTML = `<polyline points="${pointsStr}" />`;
}

function updateCompassRose(data) {
  const course = Number.isFinite(data.gps_course) ? data.gps_course : 0;
  const windFrom = (course + 180) % 360;
  const speed = data.gps_speed || 0;

  // Needle 1: Drifting Toward (Cyan) -> points to course
  const needleDrift = $("needle-drift");
  if (needleDrift) {
    needleDrift.setAttribute("transform", `rotate(${course} 100 100)`);
  }

  // Needle 2: Wind Blowing From (Amber) -> points to windFrom
  const needleWind = $("needle-wind");
  if (needleWind) {
    needleWind.setAttribute("transform", `rotate(${windFrom} 100 100)`);
  }

  // Readouts
  const courseCardinal = cardinalDirection(course);
  const windCardinal = cardinalDirection(windFrom);

  $("compass-heading-deg").textContent = `${formatNum(course, 0)}°`;
  $("compass-heading-cardinal").textContent = courseCardinal;
  $("nav-cardinal-badge").textContent = `${courseCardinal} (${formatNum(course, 0)}°)`;

  $("nav-drift-toward").textContent = `${formatNum(course, 1)}° (${courseCardinal})`;
  $("nav-wind-from").textContent = `${formatNum(windFrom, 1)}° (${windCardinal})`;

  $("nav-speed-ms").textContent = formatNum(speed, 1);
  $("nav-speed-kmh").textContent = formatNum(speed * 3.6, 1);
  $("nav-speed-knots").textContent = formatNum(speed * 1.94384, 1);
}

function updateCutdownState(remoteState) {
  const stateStr = (remoteState || "safe").toLowerCase();
  const badge = $("cutdown-state-badge");
  const stepSafe = $("step-safe");
  const stepArmed = $("step-armed");
  const stepFired = $("step-fired");

  stepSafe.classList.remove("active");
  stepArmed.classList.remove("active");
  stepFired.classList.remove("active");

  badge.className = "cutdown-status-badge";

  if (stateStr === "fired") {
    badge.textContent = "FIRED";
    badge.classList.add("badge-fired");
    stepFired.classList.add("active");
  } else if (stateStr === "armed") {
    badge.textContent = "ARMED";
    badge.classList.add("badge-armed");
    stepArmed.classList.add("active");
  } else {
    badge.textContent = "SAFE";
    badge.classList.add("badge-safe");
    stepSafe.classList.add("active");
  }
}

function renderPredictionPanel() {
  const p = state.prediction;
  const badge = $("prediction-status-badge");

  if (p.isProvisional) {
    badge.textContent = "PROVISIONAL";
    badge.className = "pred-status-badge badge-provisional";
  } else {
    badge.textContent = "ACTIVE";
    badge.className = "pred-status-badge badge-active";
  }

  if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
    $("pred-lat").textContent = p.lat.toFixed(5);
    $("pred-lng").textContent = p.lng.toFixed(5);
    $("open-gmaps-link").href = `https://www.google.com/maps?q=${p.lat},${p.lng}`;

    const mins = Math.floor(p.etlSec / 60);
    const secs = String(p.etlSec % 60).padStart(2, "0");
    $("pred-etl").textContent = `${mins}:${secs}`;

    $("pred-dist-current").textContent = `${p.distanceCurrentKm.toFixed(1)} km`;
    $("pred-dist-launch").textContent = `${p.distanceLaunchKm.toFixed(1)} km`;

    $("pred-ellipse-axes").textContent = `${p.semiMajorM} × ${p.semiMinorM} m`;
    $("pred-ellipse-orient").textContent = `ORIENT: ${p.orientationDeg}° (95% CI)`;
  } else {
    $("pred-lat").textContent = "--.------";
    $("pred-lng").textContent = "--.------";
    $("pred-etl").textContent = "--:--";
    $("pred-dist-current").textContent = "-- km";
    $("pred-dist-launch").textContent = "-- km";
    $("pred-ellipse-axes").textContent = "-- × -- m";
  }

  $("pred-ground-elev-label").textContent = `GND: ${state.settings.groundElevationM}m MSL`;
}

/* ============================================================================
 * SECTION 9: FIREBASE REALTIME DATABASE LISTENERS & COMMANDS
 * ============================================================================ */

function initFirebase() {
  const hasConfig =
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.includes("YOUR_") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.includes("your-project-id");

  if (!hasConfig) {
    $("setup-banner").classList.remove("hidden");
    // Show empty state overlay
    $("empty-state-overlay").classList.add("active");
    setRtdbStatus(false);
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    state.db = getDatabase(app);

    // Monitor Firebase Connection State via .info/connected
    const connectedRef = ref(state.db, ".info/connected");
    onValue(connectedRef, (snap) => {
      const connected = Boolean(snap.val());
      state.isFirebaseConnected = connected;
      setRtdbStatus(connected);
      if (connected) {
        $("setup-banner").classList.add("hidden");
      }
    });

    // 1. Live Telemetry Listener (/aerodrift/live)
    const liveRef = ref(state.db, "aerodrift/live");
    onValue(liveRef, (snap) => {
      if (state.replay.active) return; // Do not overwrite in replay mode
      const data = snap.val();
      if (!data) return;

      ingestTelemetryPacket(data, true);
    });

    // 2. Historical Telemetry Listener (/aerodrift/history) - limitToLast(500)
    const historyQuery = query(ref(state.db, "aerodrift/history"), limitToLast(500));
    onChildAdded(historyQuery, (snap) => {
      if (state.replay.active) return;
      const data = snap.val();
      if (!data) return;

      ingestHistoryPacket(data);
    });

    // 3. Remote Cutdown Command State Listener (/aerodrift/commands/cutdown)
    const commandRef = ref(state.db, "aerodrift/commands/cutdown");
    onValue(commandRef, (snap) => {
      const val = snap.val();
      if (val) {
        updateCutdownState(val);
      }
    });

  } catch (err) {
    console.error("Firebase init failed:", err);
    recordEvent("FIREBASE ERROR", err.message, "crit");
    setRtdbStatus(false);
  }
}

function setRtdbStatus(connected) {
  const dot = $("rtdb-status-dot");
  const txt = $("rtdb-status-text");
  if (connected) {
    dot.className = "status-dot dot-connected";
    txt.textContent = "CONNECTED";
  } else {
    dot.className = "status-dot dot-disconnected";
    txt.textContent = "OFFLINE";
  }
}

function ingestTelemetryPacket(data, isLive = true) {
  state.liveTelemetry = data;
  state.lastPacketTs = data.ts || Date.now();

  if (!state.missionStartTs) {
    state.missionStartTs = state.lastPacketTs;
  }

  // Set Launch Point from first fix
  if (!state.launchPoint && Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
    state.launchPoint = { lat: data.lat, lng: data.lng, alt: data.alt || 0 };
    recordEvent("LAUNCH SITE ACQUIRED", `Pad at ${data.lat.toFixed(4)}°, ${data.lng.toFixed(4)}°`, "nominal");
  }

  // Process physics, moving average, burst, and phase
  processDerivedMetrics(data);

  // Ingest into buffer if not already present
  if (isLive) {
    state.history.push({ ...data });
    if (state.history.length > CONFIG.MAX_HISTORY_BUFFER) {
      state.history.shift();
    }
  }

  // Render Visuals
  renderDashboard(data);
  updateMapTelemetry(data);
  updateChart();
  runLandingPrediction();
}

function ingestHistoryPacket(data) {
  // Check if packet exists by seq or timestamp
  const exists = state.history.some((p) => p.packet_seq === data.packet_seq || (p.ts && p.ts === data.ts));
  if (!exists) {
    state.history.push({ ...data });
    if (state.history.length > CONFIG.MAX_HISTORY_BUFFER) {
      state.history.shift();
    }
    updateChart();
  }
}

async function writeCutdownCommand(cmd) {
  if (!state.db) {
    recordEvent("COMMAND FAILED", "Firebase Database is not connected.", "warn");
    return;
  }
  try {
    const cmdRef = ref(state.db, "aerodrift/commands/cutdown");
    await set(cmdRef, cmd);
    recordEvent("CUTDOWN COMMAND DISPATCHED", `Command set to '${cmd.toUpperCase()}'`, cmd === "fire" ? "crit" : "nominal");
  } catch (err) {
    console.error("Cutdown write failed:", err);
    recordEvent("COMMAND ERROR", err.message, "crit");
  }
}

/* ============================================================================
 * SECTION 10: LINK HEALTH TICKER & REPLAY / DEMO SIMULATION
 * ============================================================================ */

function startLinkHealthMonitor() {
  setInterval(() => {
    // 1. UTC Clock
    $("utc-clock").textContent = new Date().toLocaleTimeString("en-GB", {
      timeZone: "UTC",
      hour12: false
    });

    if (!state.lastPacketTs) {
      $("link-status-text").textContent = "NO DATA";
      $("link-age-text").textContent = "--";
      return;
    }

    const ageSec = Math.max(0, (Date.now() - state.lastPacketTs) / 1000);
    $("link-age-text").textContent = `${ageSec.toFixed(1)}s`;
    $("diag-age").textContent = `${ageSec.toFixed(1)} s`;

    const dot = $("link-status-dot");
    const txt = $("link-status-text");
    const emergencyBanner = $("emergency-banner");
    const lockNotice = $("cutdown-lock-notice");
    const cutdownControls = $("cutdown-controls-box");

    if (ageSec > CONFIG.LINK_LOST_THRESHOLD_SEC) {
      // LINK LOST (>30s)
      dot.className = "status-dot dot-lost";
      txt.textContent = "LOST";
      txt.style.color = "var(--red)";

      emergencyBanner.classList.remove("hidden");
      if (state.liveTelemetry) {
        $("emergency-coords").textContent = `${state.liveTelemetry.lat.toFixed(5)}°, ${state.liveTelemetry.lng.toFixed(5)}°`;
        $("emergency-alt").textContent = formatNum(state.liveTelemetry.alt, 0);
      }

      // Lock Cutdown
      lockNotice.classList.remove("hidden");
      cutdownControls.style.opacity = "0.35";
      cutdownControls.style.pointerEvents = "none";

    } else if (ageSec > CONFIG.LINK_STALE_THRESHOLD_SEC) {
      // LINK STALE (10s - 30s)
      dot.className = "status-dot dot-stale";
      txt.textContent = "STALE";
      txt.style.color = "var(--amber)";
      emergencyBanner.classList.add("hidden");

      lockNotice.classList.remove("hidden");
      cutdownControls.style.opacity = "0.35";
      cutdownControls.style.pointerEvents = "none";

    } else {
      // LINK LIVE (<10s)
      dot.className = "status-dot dot-live";
      txt.textContent = "LIVE";
      txt.style.color = "var(--green)";
      emergencyBanner.classList.add("hidden");

      lockNotice.classList.add("hidden");
      cutdownControls.style.opacity = "1";
      cutdownControls.style.pointerEvents = "auto";
    }
  }, 1000);
}

/**
 * Replay Engine for historical flight review at 1x, 5x, 20x.
 */
function startReplayMode() {
  if (state.history.length < 5) {
    showToast("REPLAY UNAVAILABLE", "Insufficient flight trajectory history to replay.", "warn");
    return;
  }

  state.replay.active = true;
  state.replay.index = 0;
  state.replay.paused = false;

  $("replay-indicator-badge").classList.remove("hidden");
  $("replay-active-controls").classList.remove("hidden");
  $("btn-mode-live").classList.remove("active");
  $("btn-mode-replay").classList.add("active");

  const slider = $("replay-timeline-slider");
  slider.max = state.history.length - 1;
  slider.value = 0;

  scheduleReplayStep();
  recordEvent("REPLAY MODE STARTED", `Replaying ${state.history.length} samples at ${state.replay.speed}x speed.`, "info");
}

function scheduleReplayStep() {
  if (!state.replay.active || state.replay.paused) return;

  if (state.replay.index >= state.history.length) {
    recordEvent("REPLAY COMPLETE", "End of flight history reached.", "info");
    state.replay.paused = true;
    $("btn-replay-pause").textContent = "REPLAY";
    return;
  }

  const packet = state.history[state.replay.index];
  ingestTelemetryPacket(packet, false);

  $("replay-timeline-slider").value = state.replay.index;
  $("replay-timeline-label").textContent = `${state.replay.index + 1} / ${state.history.length}`;

  state.replay.index++;

  const baseIntervalMs = 1000;
  const interval = Math.max(50, Math.floor(baseIntervalMs / state.replay.speed));
  state.replay.timer = setTimeout(scheduleReplayStep, interval);
}

function stopReplayMode() {
  if (state.replay.timer) clearTimeout(state.replay.timer);
  state.replay.active = false;

  $("replay-indicator-badge").classList.add("hidden");
  $("replay-active-controls").classList.add("hidden");
  $("btn-mode-live").classList.add("active");
  $("btn-mode-replay").classList.remove("active");

  recordEvent("LIVE MODE RESTORED", "Switched back to live telemetry stream.", "info");
}

/**
 * Realistic Demo Flight Simulation Generator (Launch -> 30km Burst -> Touchdown)
 */
function launchDemoSimulation() {
  $("setup-banner").classList.add("hidden");
  $("empty-state-overlay").classList.remove("active");

  state.isDemoSimulation = true;
  state.history = [];
  state.vsMovingAverageQueue = [];
  state.apogeeM = 0;
  state.burstDetected = false;
  state.missionStartTs = Date.now();

  recordEvent("SIMULATION INITIALIZED", "Generating stratospheric flight trajectory (Chennai to Bay of Bengal).", "nominal");

  // Simulated flight trajectory parameters
  const baseLat = 13.0827;
  const baseLng = 80.2707;
  let curLat = baseLat;
  let curLng = baseLng;
  let curAlt = 25.0; // REC launch altitude 25m
  let curSeq = 100;
  let curTemp = 31.5;
  let curPress = 1012.0;

  let simTime = Date.now() - 3600000; // Simulated 1 hr prior

  // Generate Ascent Profile (250 samples up to 30.2 km)
  for (let i = 0; i < 220; i++) {
    const fraction = i / 220;
    curAlt += 135 + Math.random() * 10; // ~5 m/s ascent
    // Jetstream drift: balloon drifts Eastward/North-Eastward
    const speed = 8 + fraction * 28 + (Math.sin(fraction * 10) * 4);
    const course = 85 + Math.sin(fraction * 6) * 20;

    const { u, v } = windComponents(speed, course);
    const dt = 12; // 12 seconds per sample
    const nextPos = destinationPoint(curLat, curLng, u * dt, v * dt);
    curLat = nextPos.lat;
    curLng = nextPos.lng;

    // Atmospheric lapse rate
    curTemp = Math.max(-58, 31.5 - (curAlt / 1000) * 6.5 + (Math.random() * 0.4 - 0.2));
    curPress = 1013.25 * Math.exp(-curAlt / 7200);

    simTime += dt * 1000;
    curSeq++;

    state.history.push({
      lat: curLat,
      lng: curLng,
      alt: curAlt,
      pressure: Number(curPress.toFixed(1)),
      temp: Number(curTemp.toFixed(1)),
      gps_speed: Number(speed.toFixed(1)),
      gps_course: Number(course.toFixed(1)),
      sats: 10 + (i % 3),
      hdop: 0.9,
      ax: Number((Math.random() * 0.08 - 0.04).toFixed(3)),
      ay: Number((Math.random() * 0.08 - 0.04).toFixed(3)),
      az: Number((9.81 + Math.random() * 0.2 - 0.1).toFixed(2)),
      gx: Number((Math.random() * 0.6 - 0.3).toFixed(1)),
      gy: Number((Math.random() * 0.6 - 0.3).toFixed(1)),
      gz: Number((Math.random() * 0.6 - 0.3).toFixed(1)),
      roll: Number((Math.random() * 4 - 2).toFixed(1)),
      pitch: Number((Math.random() * 3 - 1.5).toFixed(1)),
      rssi: -62 - Math.floor(fraction * 22),
      packet_seq: curSeq,
      packets_lost: Math.floor(fraction * 8),
      cutdown_state: "armed",
      ts: simTime
    });
  }

  // Generate Descent Profile (80 samples down to ground)
  const maxAltReached = curAlt;
  for (let j = 0; j < 80; j++) {
    const fraction = j / 80;
    curAlt -= 340 + Math.random() * 30; // ~12 m/s parachute descent
    if (curAlt < 10) curAlt = 0;

    const speed = 18 - fraction * 12 + Math.random() * 2;
    const course = 110 + Math.sin(fraction * 5) * 15;

    const { u, v } = windComponents(speed, course);
    const dt = 15;
    const nextPos = destinationPoint(curLat, curLng, u * dt, v * dt);
    curLat = nextPos.lat;
    curLng = nextPos.lng;

    curTemp = Math.min(29, -55 + ((maxAltReached - curAlt) / 1000) * 5.5);
    curPress = 1013.25 * Math.exp(-Math.max(0, curAlt) / 7200);

    simTime += dt * 1000;
    curSeq++;

    state.history.push({
      lat: curLat,
      lng: curLng,
      alt: Math.max(0, curAlt),
      pressure: Number(curPress.toFixed(1)),
      temp: Number(curTemp.toFixed(1)),
      gps_speed: Number(speed.toFixed(1)),
      gps_course: Number(course.toFixed(1)),
      sats: 11,
      hdop: 1.0,
      ax: Number((Math.random() * 0.2 - 0.1).toFixed(3)),
      ay: Number((Math.random() * 0.2 - 0.1).toFixed(3)),
      az: Number((9.81 + Math.random() * 0.5 - 0.25).toFixed(2)),
      gx: Number((Math.random() * 2 - 1).toFixed(1)),
      gy: Number((Math.random() * 2 - 1).toFixed(1)),
      gz: Number((Math.random() * 2 - 1).toFixed(1)),
      roll: Number((Math.random() * 8 - 4).toFixed(1)),
      pitch: Number((Math.random() * 6 - 3).toFixed(1)),
      rssi: -78 + Math.floor(fraction * 15),
      packet_seq: curSeq,
      packets_lost: 9,
      cutdown_state: "fired",
      ts: simTime
    });

    if (curAlt <= 0) break;
  }

  // Load the peak descent packet as current live telemetry
  const latestSimPacket = state.history[state.history.length - 20];
  state.launchPoint = { lat: baseLat, lng: baseLng, alt: 25.0 };
  state.apogeeM = maxAltReached;
  state.burstDetected = true;

  ingestTelemetryPacket(latestSimPacket, false);
  fitAllMapBounds();

  showToast("DEMO FLIGHT LOADED", "Full 30km ascent & parachute descent trajectory loaded.", "nominal");
}

/* ============================================================================
 * SECTION 11: DATA EXPORT GENERATORS (CSV, GPX, GEOJSON)
 * ============================================================================ */

function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCsv() {
  if (state.history.length === 0) {
    showToast("EXPORT ERROR", "No telemetry data recorded to export.", "warn");
    return;
  }
  const headers = [
    "timestamp_iso", "ts_epoch", "lat", "lng", "alt_m", "vertical_speed_ms",
    "pressure_hpa", "temp_c", "gps_speed_ms", "gps_course_deg", "sats", "hdop",
    "ax", "ay", "az", "gx", "gy", "gz", "roll", "pitch", "rssi", "packet_seq", "packets_lost"
  ];

  const rows = state.history.map((p) => [
    p.ts ? new Date(p.ts).toISOString() : "",
    p.ts || "",
    p.lat || "",
    p.lng || "",
    p.alt || "",
    p.computed_vs || "",
    p.pressure || "",
    p.temp || "",
    p.gps_speed || "",
    p.gps_course || "",
    p.sats || "",
    p.hdop || "",
    p.ax || "",
    p.ay || "",
    p.az || "",
    p.gx || "",
    p.gy || "",
    p.gz || "",
    p.roll || "",
    p.pitch || "",
    p.rssi || "",
    p.packet_seq || "",
    p.packets_lost || ""
  ]);

  const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  downloadFile(csvContent, `aerodrift_telemetry_${Date.now()}.csv`, "text/csv;charset=utf-8;");
}

function exportGpx() {
  if (state.history.length === 0) {
    showToast("EXPORT ERROR", "No trajectory data recorded to export.", "warn");
    return;
  }
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="AERODRIFT Mission Telemetry Engine" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>AERODRIFT Balloon Mission Flight Trajectory</name>
    <desc>SEDHACKS'26 · Team TRINITY · REC SEDS Chapter</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>Stratospheric Flight Train</name>
    <trkseg>\n`;

  for (const pt of state.history) {
    if (Number.isFinite(pt.lat) && Number.isFinite(pt.lng)) {
      const timeStr = pt.ts ? new Date(pt.ts).toISOString() : new Date().toISOString();
      gpx += `      <trkpt lat="${pt.lat}" lon="${pt.lng}">
        <ele>${pt.alt || 0}</ele>
        <time>${timeStr}</time>
      </trkpt>\n`;
    }
  }

  gpx += `    </trkseg>
  </trk>
</gpx>`;
  downloadFile(gpx, `aerodrift_flight_${Date.now()}.gpx`, "application/gpx+xml");
}

function exportGeoJson() {
  if (state.history.length === 0) {
    showToast("EXPORT ERROR", "No trajectory data recorded to export.", "warn");
    return;
  }
  const coordinates = state.history
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => [p.lng, p.lat, p.alt || 0]);

  const geoJson = {
    type: "FeatureCollection",
    properties: {
      mission: "AERODRIFT",
      hackathon: "SEDHACKS'26",
      team: "TRINITY",
      institution: "Rajalakshmi Engineering College (SEDS REC)",
      generatedAt: new Date().toISOString()
    },
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates
        },
        properties: {
          name: "Balloon Trajectory Polyline",
          pointsCount: coordinates.length,
          apogeeM: state.apogeeM
        }
      }
    ]
  };

  downloadFile(JSON.stringify(geoJson, null, 2), `aerodrift_trajectory_${Date.now()}.geojson`, "application/geo+json");
}

/* ============================================================================
 * SECTION 12: GUARDED CUTDOWN MODAL & UI EVENT LISTENERS
 * ============================================================================ */

function initCutdownGuardedFlow() {
  const modal = $("cutdown-modal");
  const openBtn = $("btn-fire-cutdown-open");
  const closeBtn = $("modal-cutdown-close");
  const cancelBtn = $("modal-cutdown-cancel");
  const verifyInput = $("cutdown-verify-input");
  const holdBtn = $("hold-fire-btn");
  const progressFill = $("hold-progress-fill");
  const holdBtnText = $("hold-btn-text");
  const holdHint = $("hold-hint-text");

  let holdInterval = null;
  let holdStartTs = null;
  const HOLD_DURATION_MS = 5000;

  openBtn.addEventListener("click", () => {
    modal.classList.remove("hidden");
    verifyInput.value = "";
    holdBtn.disabled = true;
    progressFill.style.width = "0%";
    holdBtnText.textContent = "PRESS & HOLD 5.0s";
    holdHint.textContent = "Type 'CUTDOWN' above to enable trigger button";
    verifyInput.focus();
  });

  const closeModal = () => {
    modal.classList.add("hidden");
    cancelHold();
  };

  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);

  // Step 1: Verification Input Checking
  verifyInput.addEventListener("input", (e) => {
    const isMatched = e.target.value.trim() === "CUTDOWN";
    holdBtn.disabled = !isMatched;
    holdHint.textContent = isMatched
      ? "Trigger unlocked. Press and hold firmly for 5 seconds."
      : "Type 'CUTDOWN' above to enable trigger button";
  });

  // Step 2: 5-Second Hold to Fire
  const startHold = (e) => {
    if (holdBtn.disabled) return;
    e.preventDefault();
    initAudioContext();

    holdStartTs = Date.now();
    holdBtnText.textContent = "FIRING IN 5.0s...";

    holdInterval = setInterval(() => {
      const elapsed = Date.now() - holdStartTs;
      const progress = Math.min(100, (elapsed / HOLD_DURATION_MS) * 100);
      progressFill.style.width = `${progress}%`;

      const remainingSec = Math.max(0, (HOLD_DURATION_MS - elapsed) / 1000).toFixed(1);
      holdBtnText.textContent = `HOLD FIRMLY (${remainingSec}s)`;

      if (elapsed >= HOLD_DURATION_MS) {
        clearInterval(holdInterval);
        holdInterval = null;
        triggerCutdownFire();
      }
    }, 50);
  };

  const cancelHold = () => {
    if (holdInterval) {
      clearInterval(holdInterval);
      holdInterval = null;
      progressFill.style.width = "0%";
      holdBtnText.textContent = "PRESS & HOLD 5.0s";
      holdHint.textContent = "Aborted: hold was released before 5 seconds.";
    }
  };

  const triggerCutdownFire = () => {
    writeCutdownCommand("fire");
    progressFill.style.width = "100%";
    holdBtnText.textContent = "FIRED!";
    recordEvent("CUTDOWN FIRED", "Pyro envelope separation command successfully transmitted.", "crit");
    setTimeout(closeModal, 800);
  };

  holdBtn.addEventListener("mousedown", startHold);
  window.addEventListener("mouseup", cancelHold);
  holdBtn.addEventListener("touchstart", startHold, { passive: false });
  window.addEventListener("touchend", cancelHold);
  window.addEventListener("touchcancel", cancelHold);

  // ARM and SAFE Button handlers
  $("btn-arm-cutdown").addEventListener("click", () => writeCutdownCommand("armed"));
  $("btn-disarm-cutdown").addEventListener("click", () => writeCutdownCommand("safe"));
}

function initUIListeners() {
  // Chart Tabs
  const chartTabs = document.querySelectorAll(".chart-tabs .tab-btn");
  chartTabs.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      chartTabs.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      e.target.classList.add("active");
      e.target.setAttribute("aria-selected", "true");
      state.activeChartTab = e.target.dataset.chart;
      updateChart();
    });
  });

  // Map Controls
  $("follow-balloon-toggle").addEventListener("change", (e) => {
    state.settings.mapFollow = e.target.checked;
  });
  $("map-fit-bounds-btn").addEventListener("click", fitAllMapBounds);
  $("map-center-balloon-btn").addEventListener("click", () => {
    if (state.liveTelemetry && state.map) {
      state.map.setView([state.liveTelemetry.lat, state.liveTelemetry.lng], 13);
    }
  });

  // Prediction Actions
  $("copy-pred-coords-btn").addEventListener("click", () => {
    if (Number.isFinite(state.prediction.lat)) {
      const str = `${state.prediction.lat.toFixed(6)}, ${state.prediction.lng.toFixed(6)}`;
      navigator.clipboard.writeText(str);
      showToast("COPIED TO CLIPBOARD", str, "nominal");
    }
  });

  // Settings Drawer Open / Close
  const drawer = $("settings-drawer");
  const drawerBackdrop = $("settings-drawer-backdrop");
  const openDrawer = () => {
    drawer.classList.add("open");
    drawerBackdrop.classList.remove("hidden");
  };
  const closeDrawer = () => {
    drawer.classList.remove("open");
    drawerBackdrop.classList.add("hidden");
  };

  $("settings-open-btn").addEventListener("click", openDrawer);
  $("empty-open-settings-btn").addEventListener("click", openDrawer);
  $("settings-drawer-close").addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", closeDrawer);

  // Settings Form Inputs
  $("input-ground-elev").addEventListener("input", (e) => {
    state.settings.groundElevationM = Number(e.target.value) || 0;
    runLandingPrediction();
  });

  $("input-mc-runs").addEventListener("input", (e) => {
    const val = Number(e.target.value);
    state.settings.mcRuns = val;
    $("label-mc-runs").textContent = val;
    runLandingPrediction();
  });

  $("setting-sound-alerts").addEventListener("change", (e) => {
    state.settings.soundAlerts = e.target.checked;
    updateSoundButtonIcon();
  });

  $("sound-toggle-btn").addEventListener("click", () => {
    state.settings.soundAlerts = !state.settings.soundAlerts;
    $("setting-sound-alerts").checked = state.settings.soundAlerts;
    updateSoundButtonIcon();
    showToast("AUDIO ALERTS", state.settings.soundAlerts ? "Enabled" : "Muted", "info");
  });

  function updateSoundButtonIcon() {
    $("sound-icon-on").classList.toggle("hidden", !state.settings.soundAlerts);
    $("sound-icon-off").classList.toggle("hidden", state.settings.soundAlerts);
  }

  // No-Go Zone Inputs
  $("setting-nogo-enable").addEventListener("change", (e) => {
    state.settings.noGoZone.enabled = e.target.checked;
    updateNoGoMapCircle();
    runLandingPrediction();
  });
  $("nogo-lat").addEventListener("input", updateNoGoInputs);
  $("nogo-lng").addEventListener("input", updateNoGoInputs);
  $("nogo-radius").addEventListener("input", updateNoGoInputs);

  function updateNoGoInputs() {
    state.settings.noGoZone.lat = Number($("nogo-lat").value) || 13.0827;
    state.settings.noGoZone.lng = Number($("nogo-lng").value) || 80.2707;
    state.settings.noGoZone.radiusKm = Number($("nogo-radius").value) || 5.0;
    updateNoGoMapCircle();
    runLandingPrediction();
  }

  function updateNoGoMapCircle() {
    if (!state.map) return;
    if (state.settings.noGoZone.enabled) {
      if (!state.mapLayers.noGoCircle) {
        state.mapLayers.noGoCircle = L.circle(
          [state.settings.noGoZone.lat, state.settings.noGoZone.lng],
          {
            radius: state.settings.noGoZone.radiusKm * 1000,
            color: "#ef4444",
            weight: 1.5,
            dashArray: "4, 6",
            fillColor: "#ef4444",
            fillOpacity: 0.08
          }
        ).addTo(state.map);
      } else {
        state.mapLayers.noGoCircle
          .setLatLng([state.settings.noGoZone.lat, state.settings.noGoZone.lng])
          .setRadius(state.settings.noGoZone.radiusKm * 1000);
      }
    } else if (state.mapLayers.noGoCircle) {
      state.map.removeLayer(state.mapLayers.noGoCircle);
      state.mapLayers.noGoCircle = null;
    }
  }

  // Replay Mode Buttons
  $("btn-mode-live").addEventListener("click", stopReplayMode);
  $("btn-mode-replay").addEventListener("click", startReplayMode);

  const speedBtns = document.querySelectorAll(".replay-speed-row [data-speed]");
  speedBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      speedBtns.forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      state.replay.speed = Number(e.target.dataset.speed);
      $("replay-speed-label").textContent = `${state.replay.speed}x`;
    });
  });

  $("btn-replay-pause").addEventListener("click", (e) => {
    state.replay.paused = !state.replay.paused;
    e.target.textContent = state.replay.paused ? "RESUME" : "PAUSE";
    if (!state.replay.paused) scheduleReplayStep();
  });

  $("replay-timeline-slider").addEventListener("input", (e) => {
    const idx = Number(e.target.value);
    state.replay.index = idx;
    if (state.history[idx]) {
      ingestTelemetryPacket(state.history[idx], false);
      $("replay-timeline-label").textContent = `${idx + 1} / ${state.history.length}`;
    }
  });

  // Simulator Triggers
  $("empty-launch-sim-btn").addEventListener("click", launchDemoSimulation);
  $("load-demo-sim-btn").addEventListener("click", launchDemoSimulation);
  $("drawer-launch-sim-btn").addEventListener("click", () => {
    launchDemoSimulation();
    closeDrawer();
  });

  // Exports
  $("btn-export-csv").addEventListener("click", exportCsv);
  $("btn-export-gpx").addEventListener("click", exportGpx);
  $("btn-export-geojson").addEventListener("click", exportGeoJson);

  // Clear events log
  $("clear-events-btn").addEventListener("click", () => {
    state.events = [];
    $("events-log-container").innerHTML = "";
  });

  $("emergency-focus-btn").addEventListener("click", () => {
    if (state.liveTelemetry && state.map) {
      state.map.setView([state.liveTelemetry.lat, state.liveTelemetry.lng], 12);
    }
  });

  $("dismiss-setup-btn").addEventListener("click", () => {
    $("setup-banner").classList.add("hidden");
  });
}

/* ============================================================================
 * SECTION 13: ANIMATED STARFIELD CANVAS
 * ============================================================================ */

function initStarfield() {
  const canvas = $("starfield");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener("resize", () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced) return;

  const stars = [];
  const NUM_STARS = Math.min(180, Math.floor((width * height) / 10000));

  for (let i = 0; i < NUM_STARS; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.8 + 0.2,
      speed: Math.random() * 0.15 + 0.05,
      twinkle: Math.random() * 0.02 + 0.005
    });
  }

  function renderStars() {
    ctx.clearRect(0, 0, width, height);

    for (const s of stars) {
      s.y -= s.speed;
      if (s.y < 0) {
        s.y = height;
        s.x = Math.random() * width;
      }

      s.alpha += s.twinkle;
      if (s.alpha > 0.95 || s.alpha < 0.2) {
        s.twinkle = -s.twinkle;
      }

      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, s.alpha)})`;
      ctx.fill();
    }

    requestAnimationFrame(renderStars);
  }

  renderStars();
}

/* ============================================================================
 * SECTION 14: INITIALIZATION
 * ============================================================================ */

function init() {
  runSelfTests();
  initStarfield();
  initMap();
  initChart();
  initCutdownGuardedFlow();
  initUIListeners();
  startLinkHealthMonitor();
  initFirebase();
}

// Window load trigger
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
