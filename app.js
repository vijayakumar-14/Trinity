/**
 * ============================================================================
 * AERODRIFT — Scientific Flight Analysis & Mission Control Engine
 * SEDHACKS '26 · Team TRINITY · Rajalakshmi Engineering College · SEDS REC
 *
 * ES Module Application Architecture:
 * 1. CONFIG & GLOBAL STATE
 * 2. PURE MATHEMATICAL UTILITIES & RUNTIME SELF-TEST SUITE (?selftest=1)
 * 3. PROCEDURAL AUDIO SYNTHESIZER & ALERTS
 * 4. ATMOSPHERIC WIND PROFILING & MONTE CARLO LANDING PREDICTOR
 * 5. LEAFLET CARTOGRAPHIC VISUALIZATION & MONTE CARLO SAMPLE CLOUD
 * 6. SCIENTIFIC CHART.JS TELEMETRY SYSTEM
 * 7. AVIONICS: ATTITUDE INDICATOR & INERTIAL MEASUREMENT UNIT
 * 8. TELEMETRY PARSER, SANITIZER & DERIVED METRICS
 * 9. FIREBASE REALTIME DATABASE INTERFACE & COMMAND DISPATCH
 * 10. REPLAY CONSOLE & REALISTIC FLIGHT TRAJECTORY SIMULATOR
 * 11. SCIENTIFIC DATA EXPORT GENERATORS (CSV, GPX, GEOJSON)
 * 12. SUBSYSTEM NAVIGATION & UI EVENT CONTROLLERS
 * 13. INITIALIZATION PIPELINE
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
  MAX_HISTORY_BUFFER: 3000,
  PREDICTION_THROTTLE_MS: 1500,
  CHART_UPDATE_THROTTLE_MS: 400,
  LINK_STALE_THRESHOLD_SEC: 10,
  LINK_LOST_THRESHOLD_SEC: 30,
  MAX_SPARKLINE_POINTS: 20,
  METERS_PER_DEG_LAT: 111320,
  EARTH_RADIUS_M: 6371000,
  STANDARD_GRAVITY: 9.80665,
  SCALE_95_CI: 2.447749 // 2-DOF Chi-Squared sqrt(5.99146) = ~2.448
};

const state = {
  // Navigation & Workspace
  activeView: "overview",

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

  // Derived Dynamics
  verticalSpeedMs: 0,
  vsMovingAverageQueue: [],
  flightPhase: "PRE-LAUNCH", // "PRE-LAUNCH" | "ASCENT" | "FLOAT/BURST ZONE" | "DESCENT"

  // Landing Prediction & Monte Carlo
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
    samples: [], // [{ lat, lng, timeSec }]
    isProvisional: true,
    lastRunTs: 0
  },

  // Configuration Settings
  settings: {
    groundElevationM: 0,
    unitSystem: "metric",
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

  // Authoritative 3D Flight Simulation Engine
  sim: {
    active: false,
    isPlaying: false,
    currentTimeMs: 0,
    startTimeMs: 0,
    endTimeMs: 0,
    durationMs: 0,
    speed: 1.0,            // 0.25, 0.5, 1.0, 2.0, 5.0, 10.0
    currentIndex: 0,
    lastWallClockMs: 0,
    rafId: null,
    apogeeM: 0,
    apogeeIndex: -1,
    burstIndex: -1,
    touchdownIndex: -1,
    cameraMode: "orbit",   // "orbit" | "follow" | "chase" | "ground"
    scaleMode: "physical", // "physical" | "enhanced"
    scaleMultiplier: 5.0,  // used when scaleMode is "enhanced"
    showTrail: true,
    showFuturePath: true,
    showModel: true,
    showWindVector: true,
    showMonteCarlo: true,
    showEllipse: true,
    showNoGo: true,
    interpolatedPacket: null,
    chaseSmoothHeading: 0
  },

  // Backward-compatible replay reference pointing to sim
  replay: {
    active: false,
    speed: 1,
    index: 0,
    timer: null,
    paused: true
  },

  // Leaflet Map & Layer References
  map: null,
  mapLayers: {
    trailLine: null,
    balloonMarker: null,
    launchMarker: null,
    predictedMarker: null,
    projectedLine: null,
    ellipsePolygon: null,
    noGoCircle: null,
    mcSamplesLayer: null
  },

  // 3D CesiumJS Earth Globe (WGS84 Ellipsoid)
  cesiumViewer: null,
  cesiumEntities: {
    balloonModel: null,
    ascentTrail: null,
    descentTrail: null,
    futureTrail: null,
    windVector: null,
    launch: null,
    touchdown: null,
    ellipse: null,
    noGo: null
  },
  mapMode: "3d", // "3d" (CesiumJS) | "2d" (Leaflet)
  altitudeMultiplier: 1.0, // 1x default: true physical MSL altitude
  activeCameraPreset: "mission",

  // Chart.js Instances
  overviewChart: null,
  analysisMasterChart: null,
  activeChartTab: "alt-time",

  // Procedural Web Audio Context
  audioCtx: null,

  // Mission Events Stream & Safety Watchdogs
  events: [],
  alertCooldowns: {}
};

// Expose state globally for headless diagnostics and tests
window.state = state;

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
 * Scale factor for 95% confidence region in 2D Gaussian approximation:
 * chi2_inv(0.95, df=2) = -2 * ln(1 - 0.95) = 5.99146 -> sqrt = 2.447749 (~2.448)
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

  const scale95 = CONFIG.SCALE_95_CI;
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

  console.group("%c[AERODRIFT SELF-TEST SUITE]", "color: #74C9CF; font-weight: bold;");
  try {
    // 1. Haversine Test (REC Chennai to Marina Beach ~4.1km)
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

    // 6. Simulation Continuous State Interpolation
    const origHist = state.history;
    const origSim = { ...state.sim };
    state.history = [
      { ts: 1000, lat: 13.0, lng: 80.0, alt: 100, computed_vs: 5.0, gps_speed: 10.0 },
      { ts: 2000, lat: 13.2, lng: 80.4, alt: 200, computed_vs: 7.0, gps_speed: 20.0 }
    ];
    state.sim.active = true;
    state.sim.currentTimeMs = 1500;
    const interp = getSimInterpolatedState();
    console.assert(Math.abs(interp.lat - 13.1) < 0.0001, `Interpolated lat failed: ${interp.lat}`);
    console.assert(Math.abs(interp.alt - 150) < 0.0001, `Interpolated alt failed: ${interp.alt}`);
    console.assert(Math.abs(interp.vs - 6.0) < 0.0001, `Interpolated vs failed: ${interp.vs}`);
    state.history = origHist;
    state.sim = origSim;

    // 7. Simulation Scale Mode Validation
    setSimScaleMode("enhanced", 5.0);
    console.assert(state.sim.scaleMode === "enhanced" && state.sim.scaleMultiplier === 5.0, "Enhanced scale mode failed");
    setSimScaleMode("physical", 1.0);
    console.assert(state.sim.scaleMode === "physical" && state.sim.scaleMultiplier === 1.0, "Physical scale mode failed");

    console.log("%c✓ ALL MATHEMATICAL & SIMULATION SELF-TESTS PASSED SUCCESSFULLY", "color: #A7D96C; font-weight: bold;");
  } catch (err) {
    console.error("Self-test encountered an error:", err);
  }
  console.groupEnd();
}

/* ============================================================================
 * SECTION 3: PROCEDURAL AUDIO SYNTHESIZER & ALERTS
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
    // Autoplay restrictions handled silently
  }
}

/**
 * Display toast and add permanent entry to Mission Event Log.
 */
function recordEvent(title, message, severity = "info") {
  const ts = new Date();
  const timeStr = ts.toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" }) + " UTC";

  // Prevent duplicate alert within 15 seconds
  const alertKey = `${title}_${severity}`;
  const nowMs = Date.now();
  if (state.alertCooldowns[alertKey] && nowMs - state.alertCooldowns[alertKey] < 15000) {
    return;
  }
  state.alertCooldowns[alertKey] = nowMs;

  state.events.unshift({ timeStr, title, message, severity });
  if (state.events.length > 150) state.events.pop();

  const container = $("events-log-container");
  if (container) {
    const el = document.createElement("div");
    el.className = "event-entry";
    el.dataset.eventTs = state.sim && state.sim.active ? state.sim.currentTimeMs : Date.now();
    el.style.cursor = "pointer";
    el.title = "Click to jump simulation timeline to this event";
    el.innerHTML = `
      <span class="event-time">${timeStr}</span>
      <span class="event-badge ${severity}">${severity.toUpperCase()}</span>
      <span class="event-desc"><strong>${title}:</strong> ${message}</span>
    `;
    el.addEventListener("click", () => {
      if (state.sim && state.sim.active && el.dataset.eventTs) {
        seekSimToTime(Number(el.dataset.eventTs));
        showToast("TIMELINE SEEK", `Jumped to event: ${title}`, "info");
      }
    });
    container.insertBefore(el, container.firstChild);
  }

  showToast(title, message, severity);
  playAlertChime(severity);
}

function showToast(title, message, severity = "info") {
  const stack = $("toast-stack");
  if (!stack) return;

  const toast = document.createElement("div");
  toast.className = `toast-item ${severity}`;
  const icon = severity === "crit" ? "🚨" : severity === "warn" ? "⚠️" : severity === "nominal" ? "✅" : "ℹ️";

  toast.innerHTML = `
    <span>${icon}</span>
    <div>
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${message}</div>
    </div>
  `;
  stack.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(30px)";
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

/* ============================================================================
 * SECTION 4: ATMOSPHERIC WIND PROFILING & MONTE CARLO PREDICTOR
 * ============================================================================ */

/**
 * Construct layered horizontal wind profile from historical telemetry.
 * Discretized into 500m intervals.
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
      v: bands[idx].sumV / bands[idx].count,
      count: bands[idx].count
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

  // Nearest known band
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
 * Retrieve atmospheric wind vector, speed, bearing and cardinal at given altitude MSL.
 */
export function getCurrentLayerWind(alt) {
  if (!Number.isFinite(alt)) return { u: 0, v: 0, speed: 0, bearing: 0, cardinal: "--" };
  const windData = buildWindProfile();
  const w = getWindAtAltitude(alt, windData, 0, 0);
  const speed = Math.hypot(w.u, w.v);
  const bearing = (Math.atan2(w.u, w.v) * 180 / Math.PI + 360) % 360;
  return {
    u: w.u,
    v: w.v,
    speed,
    bearing,
    cardinal: cardinalDirection(bearing)
  };
}

/**
 * Render the Atmospheric Sounding Layers Table in Flight Analysis view.
 */
function renderSoundingTable() {
  const tbody = $("sounding-table-body");
  if (!tbody) return;

  const { profile, bandSize } = buildWindProfile();
  const keys = Object.keys(profile).map(Number).sort((a, b) => a - b);

  if (keys.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 16px;">
          Awaiting ascent telemetry sounding data...
        </td>
      </tr>
    `;
    return;
  }

  let html = "";
  for (const k of keys) {
    const bandLow = k * bandSize;
    const bandHigh = bandLow + bandSize;
    const u = profile[k].u;
    const v = profile[k].v;
    const count = profile[k].count;
    const speed = Math.sqrt(u * u + v * v);
    const speedKmh = speed * 3.6;
    const courseRad = Math.atan2(u, v);
    const courseDeg = ((courseRad * 180) / Math.PI + 360) % 360;
    const cardinal = cardinalDirection(courseDeg);

    html += `
      <tr>
        <td class="font-mono"><strong>${bandLow} - ${bandHigh} m</strong></td>
        <td>${count}</td>
        <td>${u >= 0 ? "+" : ""}${u.toFixed(1)} m/s</td>
        <td>${v >= 0 ? "+" : ""}${v.toFixed(1)} m/s</td>
        <td style="color: var(--accent-primary);"><strong>${speed.toFixed(1)} m/s</strong> (${speedKmh.toFixed(1)} km/h)</td>
        <td>${courseDeg.toFixed(0)}°</td>
        <td><span class="phase-tag badge-phase-pre">${cardinal}</span></td>
      </tr>
    `;
  }
  tbody.innerHTML = html;
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
  let baseDescentRate = 5.0; // nominal parachute terminal velocity default
  if (isDescent && state.verticalSpeedMs < -1.0) {
    baseDescentRate = Math.abs(state.verticalSpeedMs);
  }

  const fallbackWind = windComponents(current.gps_speed || 0, current.gps_course || 0);
  const windData = buildWindProfile();

  const numRuns = state.settings.mcRuns || 300;
  const landingPoints = [];

  const dt = 2.0; // 2-second numerical step

  for (let r = 0; r < numRuns; r++) {
    // Perturbations:
    // Wind Speed: ±15% -> [0.85, 1.15]
    const windSpeedFactor = 1.0 + (Math.random() * 0.3 - 0.15);
    // Wind Direction: ±10 deg
    const windDirPerturbRad = ((Math.random() * 20 - 10) * Math.PI) / 180;
    // Parachute Drag/Descent Rate: ±20% -> [0.80, 1.20]
    const descentFactor = 1.0 + (Math.random() * 0.4 - 0.2);
    const descentRate = Math.max(1.5, baseDescentRate * descentFactor);

    let simLat = current.lat;
    let simLng = current.lng;
    let simAlt = current.alt;
    let elapsedSec = 0;

    while (simAlt > groundElev && elapsedSec < 18000) {
      const baseW = getWindAtAltitude(simAlt, windData, fallbackWind.u, fallbackWind.v);

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

  state.prediction.samples = landingPoints;

  // Mean Landing Coordinate
  const meanLat = landingPoints.reduce((acc, p) => acc + p.lat, 0) / numRuns;
  const meanLng = landingPoints.reduce((acc, p) => acc + p.lng, 0) / numRuns;
  const meanTimeSec = landingPoints.reduce((acc, p) => acc + p.timeSec, 0) / numRuns;

  // Covariance Matrix in local Cartesian meters
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

  // 95% Confidence Ellipse Eigen-decomposition
  const { semiMajor, semiMinor, angleDeg, angleRad } = eigenDecomposition2x2(varX, covXY, varY);

  // Generate 36-point boundary polygon for Leaflet
  const ellipseCoords = [];
  const NUM_STEPS = 36;
  for (let i = 0; i <= NUM_STEPS; i++) {
    const theta = (i * 2 * Math.PI) / NUM_STEPS;
    const xLocal = semiMajor * Math.cos(theta) * Math.cos(angleRad) - semiMinor * Math.sin(theta) * Math.sin(angleRad);
    const yLocal = semiMajor * Math.cos(theta) * Math.sin(angleRad) + semiMinor * Math.sin(theta) * Math.cos(angleRad);
    const vert = destinationPoint(meanLat, meanLng, xLocal, yLocal);
    ellipseCoords.push([vert.lat, vert.lng]);
  }

  state.prediction.lat = meanLat;
  state.prediction.lng = meanLng;
  state.prediction.etlSec = Math.round(meanTimeSec);
  state.prediction.semiMajorM = Math.round(semiMajor);
  state.prediction.semiMinorM = Math.round(semiMinor);
  state.prediction.orientationDeg = Math.round(((angleDeg % 360) + 360) % 360);
  state.prediction.ellipseCoords = ellipseCoords;

  state.prediction.distanceCurrentKm = haversineDistance(current.lat, current.lng, meanLat, meanLng) / 1000;
  if (state.launchPoint) {
    state.prediction.distanceLaunchKm = haversineDistance(state.launchPoint.lat, state.launchPoint.lng, meanLat, meanLng) / 1000;
  } else {
    state.prediction.distanceLaunchKm = state.prediction.distanceCurrentKm;
  }

  // Check No-Go Perimeter Alert
  const noGoTag = $("nogo-status-tag");
  const noGoLabel = $("nogo-dist-label");
  if (state.settings.noGoZone.enabled) {
    const distToNoGo = haversineDistance(meanLat, meanLng, state.settings.noGoZone.lat, state.settings.noGoZone.lng) / 1000;
    const delta = distToNoGo - state.settings.noGoZone.radiusKm;
    if (distToNoGo < state.settings.noGoZone.radiusKm) {
      if (noGoTag) {
        noGoTag.textContent = "BREACH DETECTED";
        noGoTag.className = "phase-tag badge-phase-descent";
      }
      if (noGoLabel) noGoLabel.textContent = `INSIDE PERIMETER (${distToNoGo.toFixed(1)} km from center)`;
      recordEvent("NO-GO PERIMETER VIOLATION", `Predicted touchdown point inside restricted zone (${distToNoGo.toFixed(1)} km)`, "crit");
    } else {
      if (noGoTag) {
        noGoTag.textContent = "CLEAR";
        noGoTag.className = "phase-tag badge-phase-ascent";
      }
      if (noGoLabel) noGoLabel.textContent = `${delta.toFixed(1)} km outside perimeter`;
    }
  } else if (noGoTag) {
    noGoTag.textContent = "DISABLED";
    noGoTag.className = "phase-tag badge-phase-pre";
    if (noGoLabel) noGoLabel.textContent = "Monitoring inactive";
  }

  renderPredictionPanel();
  updateMapPrediction();
}

function renderPredictionPanel() {
  const p = state.prediction;
  const badge = $("prediction-status-badge");

  if (badge) {
    if (p.isProvisional) {
      badge.textContent = "PROVISIONAL (ASCENT)";
      badge.className = "phase-tag badge-phase-float";
    } else {
      badge.textContent = "ACTIVE (DESCENT)";
      badge.className = "phase-tag badge-phase-descent";
    }
  }

  if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
    if ($("pred-lat")) $("pred-lat").textContent = p.lat.toFixed(5);
    if ($("pred-lng")) $("pred-lng").textContent = p.lng.toFixed(5);
    if ($("open-gmaps-link")) $("open-gmaps-link").href = `https://www.google.com/maps?q=${p.lat},${p.lng}`;

    const mins = Math.floor(p.etlSec / 60);
    const secs = String(p.etlSec % 60).padStart(2, "0");
    if ($("pred-etl")) $("pred-etl").textContent = `${mins}:${secs}`;

    if ($("pred-dist-current")) $("pred-dist-current").textContent = `${p.distanceCurrentKm.toFixed(1)} km`;
    if ($("pred-dist-launch")) $("pred-dist-launch").textContent = `${p.distanceLaunchKm.toFixed(1)} km`;

    if ($("pred-ellipse-axes")) $("pred-ellipse-axes").textContent = `${p.semiMajorM} × ${p.semiMinorM} m`;
    if ($("pred-ellipse-orient")) $("pred-ellipse-orient").textContent = `ORIENT: ${p.orientationDeg}° (95% CI)`;

    // Sidebar fields in Trajectory view
    if ($("sidebar-semi-major")) $("sidebar-semi-major").textContent = `${p.semiMajorM} m`;
    if ($("sidebar-semi-minor")) $("sidebar-semi-minor").textContent = `${p.semiMinorM} m`;
    if ($("sidebar-orient")) $("sidebar-orient").textContent = `${p.orientationDeg}°`;
    const descRate = state.flightPhase === "DESCENT" ? Math.abs(state.verticalSpeedMs) : 5.0;
    if ($("sidebar-desc-rate")) $("sidebar-desc-rate").textContent = `${descRate.toFixed(1)} m/s`;
  }
}

/* ============================================================================
 * SECTION 5: GEOSPATIAL ENGINE: CESIUMJS WGS84 3D GLOBE & SIMULATION VISUALIZER
 * ============================================================================ */

/**
 * Authoritative continuous interpolation of vehicle telemetry at current simulation time.
 * Provides 60fps smooth movement across discrete historical flight samples.
 */
export function getSimInterpolatedState() {
  if (state.history.length === 0) return state.liveTelemetry;
  if (!state.sim.active) return state.liveTelemetry;

  const t = state.sim.currentTimeMs;
  const hist = state.history;

  if (t <= hist[0].ts) {
    const p = hist[0];
    const res = {
      ...p,
      vs: p.computed_vs || 0,
      speed: p.gps_speed || 0,
      heading: p.gps_course || 0,
      flightPhase: (p.alt < 50 && Math.abs(p.computed_vs || 0) < 1.0) ? "PRE-LAUNCH" : "ASCENT",
      ts: p.ts
    };
    state.sim.interpolatedPacket = res;
    return res;
  }

  if (t >= hist[hist.length - 1].ts) {
    const p = hist[hist.length - 1];
    const res = {
      ...p,
      vs: p.computed_vs || 0,
      speed: p.gps_speed || 0,
      heading: p.gps_course || 0,
      flightPhase: "TOUCHDOWN",
      ts: p.ts
    };
    state.sim.interpolatedPacket = res;
    return res;
  }

  // Binary search for exact bounding interval
  let low = 0;
  let high = hist.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (hist[mid].ts <= t) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const i0 = Math.max(0, high);
  const i1 = Math.min(hist.length - 1, i0 + 1);

  state.sim.currentIndex = i0;

  const p0 = hist[i0];
  const p1 = hist[i1];

  const dt = (p1.ts - p0.ts) || 1;
  const alpha = Math.max(0, Math.min(1, (t - p0.ts) / dt));

  const lat = p0.lat + alpha * (p1.lat - p0.lat);
  const lng = p0.lng + alpha * (p1.lng - p0.lng);
  const alt = p0.alt + alpha * (p1.alt - p0.alt);
  const vs = (p0.computed_vs || 0) + alpha * ((p1.computed_vs || 0) - (p0.computed_vs || 0));
  const speed = (p0.gps_speed || 0) + alpha * ((p1.gps_speed || 0) - (p0.gps_speed || 0));
  const heading = p0.gps_course !== undefined ? p0.gps_course : calculateBearing(p0.lat, p0.lng, p1.lat, p1.lng);
  const temp = (p0.temp || 0) + alpha * ((p1.temp || 0) - (p0.temp || 0));
  const pressure = (p0.pressure || 0) + alpha * ((p1.pressure || 0) - (p0.pressure || 0));
  const roll = (p0.roll || 0) + alpha * ((p1.roll || 0) - (p0.roll || 0));
  const pitch = (p0.pitch || 0) + alpha * ((p1.pitch || 0) - (p0.pitch || 0));

  let flightPhase = "ASCENT";
  if (state.sim.burstIndex >= 0 && i0 >= state.sim.burstIndex) {
    flightPhase = (state.sim.touchdownIndex >= 0 && i0 >= state.sim.touchdownIndex) ? "TOUCHDOWN" : "DESCENT";
  } else if (alt < 100 && Math.abs(vs) < 1.0) {
    flightPhase = "PRE-LAUNCH";
  } else if (alt > 15000 && Math.abs(vs) < 1.0) {
    flightPhase = "FLOAT/BURST ZONE";
  }

  const result = {
    ...p0,
    lat,
    lng,
    alt,
    computed_vs: vs,
    vs,
    gps_speed: speed,
    speed,
    gps_course: heading,
    heading,
    temp,
    pressure,
    roll,
    pitch,
    flightPhase,
    ts: t
  };

  state.sim.interpolatedPacket = result;
  return result;
}

export function getSimFlightPhase() {
  const cur = getSimInterpolatedState();
  return cur ? cur.flightPhase : state.flightPhase;
}

async function initCesiumGlobe() {
  if (state.cesiumViewer || !window.Cesium) return;
  const container = $("cesium-globe-container");
  if (!container) return;

  try {
    state.cesiumViewer = new Cesium.Viewer("cesium-globe-container", {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      vrButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
      navigationInstructionsInitiallyVisible: false,
      scene3DOnly: true,
      skyAtmosphere: new Cesium.SkyAtmosphere(),
      terrainProvider: new Cesium.EllipsoidTerrainProvider() // WGS84 Reference Ellipsoid
    });

    const viewer = state.cesiumViewer;
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.depthTestAgainstTerrain = false;

    // 1. Natural Earth II base layer (instant global fallback from Cesium Assets)
    try {
      const fallbackUrl = Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII");
      const fallbackProvider = await Cesium.TileMapServiceImageryProvider.fromUrl(fallbackUrl);
      viewer.imageryLayers.addImageryProvider(fallbackProvider);
    } catch (err) {
      console.warn("Natural Earth base texture could not be loaded:", err);
    }

    // 2. High-resolution satellite imagery (ESRI World Imagery) streamed on top
    try {
      const esriProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
        { enablePickFeatures: false }
      );
      const esriLayer = viewer.imageryLayers.addImageryProvider(esriProvider);
      esriLayer.errorEvent.addEventListener(() => {
        console.warn("ESRI satellite tile error, loading OpenStreetMap fallback");
        try {
          viewer.imageryLayers.addImageryProvider(
            new Cesium.UrlTemplateImageryProvider({
              url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
              maximumLevel: 19
            })
          );
        } catch (_) {}
      });
    } catch (err) {
      console.warn("ESRI imagery provider error, loading OpenStreetMap fallback:", err);
      try {
        viewer.imageryLayers.addImageryProvider(
          new Cesium.UrlTemplateImageryProvider({
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            maximumLevel: 19
          })
        );
      } catch (_) {}
    }

    // 3. 3D Recorded Trajectory Polyline (Ascent: Solid Cyan)
    state.cesiumEntities.ascentTrail = viewer.entities.add({
      name: "Recorded Ascent Trajectory",
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          if (!state.sim.showTrail || state.history.length === 0) return [];
          const mult = state.sim.scaleMode === "enhanced" ? state.sim.scaleMultiplier : 1.0;
          const cur = getSimInterpolatedState();
          const burstIdx = state.sim.burstIndex >= 0 ? state.sim.burstIndex : state.history.length - 1;
          const endIdx = Math.min(state.sim.currentIndex, burstIdx);

          const pts = [];
          for (let i = 0; i <= endIdx && i < state.history.length; i++) {
            const p = state.history[i];
            if (Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.alt)) {
              pts.push(Cesium.Cartesian3.fromDegrees(p.lng, p.lat, p.alt * mult));
            }
          }
          if (cur && (state.sim.burstIndex < 0 || state.sim.currentIndex < state.sim.burstIndex)) {
            pts.push(Cesium.Cartesian3.fromDegrees(cur.lng, cur.lat, cur.alt * mult));
          }
          return pts;
        }, false),
        width: 3.5,
        material: Cesium.Color.fromCssColorString("#74C9CF"),
        show: new Cesium.CallbackProperty(() => state.sim.showTrail, false)
      }
    });

    // 4. 3D Recorded Trajectory Polyline (Descent: Solid Amber)
    state.cesiumEntities.descentTrail = viewer.entities.add({
      name: "Recorded Descent Trajectory",
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          if (!state.sim.showTrail || state.history.length === 0) return [];
          if (state.sim.burstIndex < 0 || state.sim.currentIndex < state.sim.burstIndex) return [];
          const mult = state.sim.scaleMode === "enhanced" ? state.sim.scaleMultiplier : 1.0;
          const cur = getSimInterpolatedState();
          const startIdx = state.sim.burstIndex;
          const endIdx = state.sim.currentIndex;

          const pts = [];
          for (let i = startIdx; i <= endIdx && i < state.history.length; i++) {
            const p = state.history[i];
            if (Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.alt)) {
              pts.push(Cesium.Cartesian3.fromDegrees(p.lng, p.lat, p.alt * mult));
            }
          }
          if (cur) {
            pts.push(Cesium.Cartesian3.fromDegrees(cur.lng, cur.lat, cur.alt * mult));
          }
          return pts;
        }, false),
        width: 3.5,
        material: Cesium.Color.fromCssColorString("#E9B86A"),
        show: new Cesium.CallbackProperty(() => state.sim.showTrail, false)
      }
    });

    // 5. Future / Forecast Trajectory Polyline (Dashed Amber)
    state.cesiumEntities.futureTrail = viewer.entities.add({
      name: "Forecast Descent Path",
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          if (!state.sim.showFuturePath || state.history.length === 0) return [];
          const mult = state.sim.scaleMode === "enhanced" ? state.sim.scaleMultiplier : 1.0;
          const cur = getSimInterpolatedState();
          if (!cur) return [];

          const pts = [Cesium.Cartesian3.fromDegrees(cur.lng, cur.lat, cur.alt * mult)];
          for (let i = state.sim.currentIndex + 1; i < state.history.length; i++) {
            const p = state.history[i];
            if (Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.alt)) {
              pts.push(Cesium.Cartesian3.fromDegrees(p.lng, p.lat, p.alt * mult));
            }
          }
          return pts;
        }, false),
        width: 2.0,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString("rgba(233, 184, 106, 0.75)"),
          dashLength: 14.0
        }),
        show: new Cesium.CallbackProperty(() => state.sim.showFuturePath, false)
      }
    });

    // 6. 3D Atmospheric Wind Vector Arrow at Vehicle Altitude
    state.cesiumEntities.windVector = viewer.entities.add({
      name: "Atmospheric Wind Vector",
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          if (!state.sim.showWindVector) return [];
          const cur = getSimInterpolatedState();
          if (!cur) return [];
          const mult = state.sim.scaleMode === "enhanced" ? state.sim.scaleMultiplier : 1.0;
          const wind = getCurrentLayerWind(cur.alt);
          if (wind.speed < 0.5) return [];

          const scaleM = 60.0; // 60 meters visual length per m/s
          const p1 = Cesium.Cartesian3.fromDegrees(cur.lng, cur.lat, cur.alt * mult);
          const p2 = destinationPoint(cur.lat, cur.lng, wind.u * scaleM, wind.v * scaleM);
          const c2 = Cesium.Cartesian3.fromDegrees(p2.lng, p2.lat, cur.alt * mult);
          return [p1, c2];
        }, false),
        width: 3.5,
        material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.fromCssColorString("#74C9CF")),
        show: new Cesium.CallbackProperty(() => state.sim.showWindVector, false)
      }
    });

    // 7. 3D Balloon Vehicle Assembly Model (Real GLB Geometry, Rigging & Payload)
    state.cesiumEntities.balloonModel = viewer.entities.add({
      name: "AERODRIFT Stratospheric Balloon Assembly",
      position: new Cesium.CallbackProperty(() => {
        const cur = getSimInterpolatedState();
        if (!cur) return Cesium.Cartesian3.fromDegrees(80.2707, 13.0827, 25);
        const mult = state.sim.scaleMode === "enhanced" ? state.sim.scaleMultiplier : 1.0;
        return Cesium.Cartesian3.fromDegrees(cur.lng, cur.lat, cur.alt * mult);
      }, false),
      orientation: new Cesium.CallbackProperty(() => {
        const cur = getSimInterpolatedState();
        if (!cur) return Cesium.Quaternion.IDENTITY;
        const mult = state.sim.scaleMode === "enhanced" ? state.sim.scaleMultiplier : 1.0;
        const pos = Cesium.Cartesian3.fromDegrees(cur.lng, cur.lat, cur.alt * mult);
        const h = Cesium.Math.toRadians(cur.heading || 0);
        const p = Cesium.Math.toRadians(cur.pitch || 0);
        const r = Cesium.Math.toRadians(cur.roll || 0);
        const hpr = new Cesium.HeadingPitchRoll(h, p, r);
        return Cesium.Transforms.headingPitchRollQuaternion(pos, hpr);
      }, false),
      model: {
        uri: new Cesium.CallbackProperty(() => {
          const cur = getSimInterpolatedState();
          const phase = cur ? cur.flightPhase : "ASCENT";
          if (phase === "DESCENT" || phase === "TOUCHDOWN") {
            return "assets/parachute_descent.glb";
          }
          return "assets/balloon_assembly.glb";
        }, false),
        minimumPixelSize: 52,
        maximumScale: 500,
        scale: new Cesium.CallbackProperty(() => {
          const cur = getSimInterpolatedState();
          if (!cur) return 1.0;
          const visualBoost = state.sim.scaleMode === "enhanced" ? 2.5 : 1.0;
          if (cur.flightPhase === "DESCENT" || cur.flightPhase === "TOUCHDOWN") {
            return 1.4 * visualBoost;
          }
          // Physical balloon expansion with altitude: P0/P ~ exp(h/7200) -> radius exp(h/21600)
          const expFactor = Math.min(2.8, Math.exp((cur.alt || 0) / 21600));
          return expFactor * visualBoost;
        }, false)
      },
      label: {
        text: new Cesium.CallbackProperty(() => {
          const cur = getSimInterpolatedState();
          if (!cur) return "";
          const exag = state.sim.scaleMode === "enhanced" ? ` [${state.sim.scaleMultiplier}x EXAG]` : "";
          const vsSign = cur.vs >= 0 ? "+" : "";
          return `AERODRIFT · ${cur.flightPhase}\n${formatNum(cur.alt, 0)}m MSL · ${vsSign}${formatNum(cur.vs, 1)}m/s${exag}`;
        }, false),
        font: "11px 'JetBrains Mono', monospace",
        fillColor: Cesium.Color.fromCssColorString("#E8EDE7"),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("rgba(16, 19, 17, 0.88)"),
        pixelOffset: new Cesium.Cartesian2(0, -36),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1800000)
      },
      show: new Cesium.CallbackProperty(() => state.sim.showModel, false)
    });

    // 8. Launch Site Pad Marker on Surface
    state.cesiumEntities.launch = viewer.entities.add({
      name: "Launch Site (REC Chennai)",
      position: new Cesium.CallbackProperty(() => {
        if (!state.launchPoint) return null;
        return Cesium.Cartesian3.fromDegrees(state.launchPoint.lng, state.launchPoint.lat, state.launchPoint.alt || 0);
      }, false),
      point: {
        pixelSize: 8,
        color: Cesium.Color.fromCssColorString("#74C9CF"),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1.5,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2500000)
      },
      label: {
        text: "PAD REC CHENNAI",
        font: "10px 'JetBrains Mono', monospace",
        fillColor: Cesium.Color.fromCssColorString("#A1AAA2"),
        pixelOffset: new Cesium.Cartesian2(0, 14),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1200000)
      }
    });

    // 9. Predicted Touchdown Target Marker on Surface
    state.cesiumEntities.touchdown = viewer.entities.add({
      name: "Predicted Touchdown Point",
      position: new Cesium.CallbackProperty(() => {
        const pred = state.prediction;
        if (!pred || !Number.isFinite(pred.lat) || !Number.isFinite(pred.lng)) return null;
        return Cesium.Cartesian3.fromDegrees(pred.lng, pred.lat, state.settings.groundElevationM || 0);
      }, false),
      point: {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString("#E9B86A"),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2500000)
      },
      label: {
        text: "TOUCHDOWN TARGET",
        font: "10px 'JetBrains Mono', monospace",
        fillColor: Cesium.Color.fromCssColorString("#E9B86A"),
        pixelOffset: new Cesium.Cartesian2(0, 16),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1200000)
      }
    });

    // 10. 95% Confidence Dispersion Ellipse on Surface
    state.cesiumEntities.ellipse = viewer.entities.add({
      name: "95% Confidence Dispersion Perimeter",
      polygon: {
        hierarchy: new Cesium.CallbackProperty(() => {
          const coords = state.prediction.ellipseCoords;
          if (!coords || coords.length === 0) return null;
          const cartesianList = coords.map((c) =>
            Cesium.Cartesian3.fromDegrees(c[1], c[0], (state.settings.groundElevationM || 0) + 5)
          );
          return new Cesium.PolygonHierarchy(cartesianList);
        }, false),
        material: Cesium.Color.fromCssColorString("rgba(233, 184, 106, 0.22)"),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#E9B86A"),
        outlineWidth: 2,
        show: new Cesium.CallbackProperty(() => state.sim.showEllipse, false)
      }
    });

    // 11. No-Go Restricted Airspace Zone on Surface
    state.cesiumEntities.noGo = viewer.entities.add({
      name: "Restricted Airspace Perimeter",
      position: new Cesium.CallbackProperty(() => {
        if (!state.settings.noGoZone.enabled) return null;
        return Cesium.Cartesian3.fromDegrees(state.settings.noGoZone.lng, state.settings.noGoZone.lat, 0);
      }, false),
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => state.settings.noGoZone.radiusKm * 1000, false),
        semiMinorAxis: new Cesium.CallbackProperty(() => state.settings.noGoZone.radiusKm * 1000, false),
        material: Cesium.Color.fromCssColorString("rgba(228, 119, 119, 0.15)"),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#E47777"),
        outlineWidth: 1.5,
        show: new Cesium.CallbackProperty(() => state.sim.showNoGo, false)
      }
    });

    // Interactive ScreenSpaceEventHandler for 3D clicks
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id) {
        const id = picked.id;
        if (id === state.cesiumEntities.balloonModel) {
          setSimCameraMode("follow");
          showToast("CAMERA MODE: FOLLOW", "Camera locked to ascending balloon assembly.", "info");
        } else if (id === state.cesiumEntities.launch && state.launchPoint) {
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(state.launchPoint.lng, state.launchPoint.lat, 2500),
            duration: 1.2
          });
          showToast("LAUNCH SITE", "Pad REC Chennai (13.0827°N, 80.2707°E)", "info");
        } else if (id === state.cesiumEntities.touchdown) {
          flyToRecoveryView(true);
          showToast("TOUCHDOWN TARGET", "Centered on predicted landing zone.", "info");
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Initial camera view
    flyToMissionView(false);

  } catch (err) {
    console.error("CesiumJS init error:", err);
    const statusTag = $("globe-status-tag");
    if (statusTag) {
      statusTag.textContent = "3D WEBGL FALLBACK (2D ACTIVE)";
      statusTag.style.color = "var(--status-caution)";
    }
  }
}

function flyToGlobalView(animate = true) {
  if (!state.cesiumViewer) return;
  state.activeCameraPreset = "global";
  updateCameraPresetButtons("global");
  state.cesiumViewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(80.2707, 13.0827, 20000000.0), // 20,000 km in space
    orientation: {
      heading: Cesium.Math.toRadians(0.0),
      pitch: Cesium.Math.toRadians(-90.0),
      roll: 0.0
    },
    duration: animate ? 1.5 : 0
  });
}

function flyToMissionView(animate = true) {
  if (!state.cesiumViewer) return;
  state.activeCameraPreset = "mission";
  updateCameraPresetButtons("mission");
  state.cesiumViewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(80.60, 12.30, 110000.0), // 110 km altitude south of corridor
    orientation: {
      heading: Cesium.Math.toRadians(0.0),
      pitch: Cesium.Math.toRadians(-45.0),
      roll: 0.0
    },
    duration: animate ? 1.5 : 0
  });
}

function flyToRecoveryView(animate = true) {
  if (!state.cesiumViewer) return;
  state.activeCameraPreset = "recovery";
  updateCameraPresetButtons("recovery");
  const lat = state.prediction.lat || (state.liveTelemetry ? state.liveTelemetry.lat : 13.0827);
  const lng = state.prediction.lng || (state.liveTelemetry ? state.liveTelemetry.lng : 80.2707);
  state.cesiumViewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat - 0.14, 22000.0), // 22 km altitude south of touchdown
    orientation: {
      heading: Cesium.Math.toRadians(0.0),
      pitch: Cesium.Math.toRadians(-55.0),
      roll: 0.0
    },
    duration: animate ? 1.5 : 0
  });
}

export function setSimCameraMode(mode) {
  state.sim.cameraMode = mode;
  const btns = document.querySelectorAll(".btn-sim-cam");
  btns.forEach(b => b.classList.toggle("active", b.dataset.cam === mode));

  if (!state.cesiumViewer) return;

  if (mode === "follow") {
    state.cesiumViewer.trackedEntity = state.cesiumEntities.balloonModel;
  } else {
    state.cesiumViewer.trackedEntity = undefined;
  }

  if (mode === "orbit") {
    showToast("CAMERA: ORBIT", "Free 3D rotation, tilt, and zoom active.", "info");
  } else if (mode === "follow") {
    showToast("CAMERA: FOLLOW", "Camera centered on balloon vehicle.", "info");
  } else if (mode === "chase") {
    showToast("CAMERA: CHASE", "Camera following behind flight vector.", "info");
  } else if (mode === "ground") {
    showToast("CAMERA: GROUND", "Ground perspective tracking vehicle.", "info");
  }
}

export function setSimScaleMode(mode, multiplier) {
  state.sim.scaleMode = mode;
  if (multiplier !== undefined) {
    state.sim.scaleMultiplier = Number(multiplier) || 5.0;
  }

  const btnPhys = $("btn-scale-physical");
  const btnEnh = $("btn-scale-enhanced");
  const selectMult = $("select-enhanced-mult");
  const statusTag = $("globe-status-tag");

  if (btnPhys) btnPhys.classList.toggle("active", mode === "physical");
  if (btnEnh) btnEnh.classList.toggle("active", mode === "enhanced");
  if (selectMult) {
    selectMult.classList.toggle("hidden", mode !== "enhanced");
    if (multiplier !== undefined) selectMult.value = String(state.sim.scaleMultiplier);
  }

  if (statusTag) {
    if (mode === "physical") {
      statusTag.textContent = "WGS84 ELLIPSOID · PHYSICAL (1:1)";
    } else {
      statusTag.textContent = `WGS84 · ${state.sim.scaleMultiplier}x ENHANCED (VISUAL AID)`;
    }
  }

  state.altitudeMultiplier = mode === "enhanced" ? state.sim.scaleMultiplier : 1.0;

  if (state.cesiumViewer && state.cesiumViewer.scene) {
    state.cesiumViewer.scene.requestRender();
  }
}

function updateCameraPresetButtons(activePreset) {
  const btnGlobal = $("cam-preset-global");
  const btnMission = $("cam-preset-mission");
  const btnRecovery = $("cam-preset-recovery");

  if (btnGlobal) btnGlobal.classList.toggle("active", activePreset === "global");
  if (btnMission) btnMission.classList.toggle("active", activePreset === "mission");
  if (btnRecovery) btnRecovery.classList.toggle("active", activePreset === "recovery");
}

function setMapDisplayMode(mode) {
  state.mapMode = mode;
  const globeContainer = $("cesium-globe-container");
  const leafletContainer = $("flight-map");
  const btn3d = $("btn-mode-3d");
  const btn2d = $("btn-mode-2d");

  if (mode === "3d") {
    if (globeContainer) globeContainer.classList.remove("hidden");
    if (leafletContainer) leafletContainer.classList.add("hidden");
    if (btn3d) btn3d.classList.add("active");
    if (btn2d) btn2d.classList.remove("active");
    if (state.cesiumViewer) state.cesiumViewer.resize();
  } else {
    if (globeContainer) globeContainer.classList.add("hidden");
    if (leafletContainer) leafletContainer.classList.remove("hidden");
    if (btn3d) btn3d.classList.remove("active");
    if (btn2d) btn2d.classList.add("active");
    if (state.map) {
      state.map.invalidateSize();
      if (state.liveTelemetry) updateMapTelemetry(state.liveTelemetry);
    }
  }
}

function initMap() {
  if (state.map || !window.L) return;

  const mapEl = $("flight-map");
  if (!mapEl) return;

  state.map = L.map("flight-map", {
    zoomControl: true,
    attributionControl: true
  }).setView([13.0827, 80.2707], 10);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    subdomains: "abcd",
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(state.map);

  // Layer 1: Trajectory Polyline
  state.mapLayers.trailLine = L.polyline([], {
    color: "#74C9CF",
    weight: 2.5,
    opacity: 0.9,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(state.map);

  // Layer 2: Projected Descent Vector Line
  state.mapLayers.projectedLine = L.polyline([], {
    color: "#E9B86A",
    weight: 1.5,
    dashArray: "4, 6",
    opacity: 0.8
  }).addTo(state.map);

  // Layer 3: 95% Confidence Dispersion Ellipse
  state.mapLayers.ellipsePolygon = L.polygon([], {
    color: "#E9B86A",
    weight: 1.5,
    dashArray: "4, 4",
    fillColor: "#E9B86A",
    fillOpacity: 0.08
  }).addTo(state.map);

  // Layer 4: Monte Carlo 300-Run Landing Scatter Cloud
  state.mapLayers.mcSamplesLayer = L.layerGroup().addTo(state.map);

  // Custom Tactical SVG Icons
  const balloonSvg = `
    <svg viewBox="0 0 28 28" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14" cy="14" r="12" fill="#171B18" stroke="#A7D96C" stroke-width="2"/>
      <circle cx="14" cy="14" r="4" fill="#A7D96C"/>
      <line x1="14" y1="2" x2="14" y2="6" stroke="#A7D96C" stroke-width="1.5"/>
      <line x1="14" y1="22" x2="14" y2="26" stroke="#A7D96C" stroke-width="1.5"/>
      <line x1="2" y1="14" x2="6" y2="14" stroke="#A7D96C" stroke-width="1.5"/>
      <line x1="22" y1="14" x2="26" y2="14" stroke="#A7D96C" stroke-width="1.5"/>
    </svg>`;
  const balloonIcon = L.divIcon({
    html: balloonSvg,
    className: "tactical-balloon-marker",
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });

  const launchSvg = `
    <svg viewBox="0 0 22 22" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="16" height="16" rx="2" fill="#171B18" stroke="#74C9CF" stroke-width="1.5"/>
      <line x1="11" y1="6" x2="11" y2="16" stroke="#74C9CF" stroke-width="1.5"/>
      <line x1="6" y1="11" x2="16" y2="11" stroke="#74C9CF" stroke-width="1.5"/>
    </svg>`;
  const launchIcon = L.divIcon({
    html: launchSvg,
    className: "tactical-launch-marker",
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  const predSvg = `
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="#E9B86A" stroke-width="1.5" stroke-dasharray="2 2"/>
      <circle cx="12" cy="12" r="3" fill="#E9B86A"/>
    </svg>`;
  const predIcon = L.divIcon({
    html: predSvg,
    className: "tactical-target-marker",
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  state.mapLayers.balloonMarker = L.marker([13.0827, 80.2707], { icon: balloonIcon }).addTo(state.map);
  state.mapLayers.launchMarker = L.marker([13.0827, 80.2707], { icon: launchIcon });
  state.mapLayers.predictedMarker = L.marker([13.0827, 80.2707], { icon: predIcon });
}

function updateMapTelemetry(current) {
  if (!state.map || !current || !Number.isFinite(current.lat) || !Number.isFinite(current.lng)) {
    return;
  }

  // Update vehicle marker
  state.mapLayers.balloonMarker.setLatLng([current.lat, current.lng]);

  // Update Launch Marker
  if (state.launchPoint && !state.map.hasLayer(state.mapLayers.launchMarker)) {
    state.mapLayers.launchMarker.setLatLng([state.launchPoint.lat, state.launchPoint.lng]);
    state.mapLayers.launchMarker.addTo(state.map);
  }

  // Update trajectory polyline
  const latLngs = state.history
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => [p.lat, p.lng]);
  state.mapLayers.trailLine.setLatLngs(latLngs);

  // Update Tactical Map HUD
  if ($("hud-lat")) $("hud-lat").textContent = current.lat.toFixed(5);
  if ($("hud-lng")) $("hud-lng").textContent = current.lng.toFixed(5);
  if ($("hud-alt")) $("hud-alt").textContent = formatNum(current.alt, 0);
  if ($("map-point-counter")) $("map-point-counter").textContent = state.history.length;

  if (state.launchPoint) {
    const dLaunch = haversineDistance(state.launchPoint.lat, state.launchPoint.lng, current.lat, current.lng) / 1000;
    if ($("hud-dist-launch")) $("hud-dist-launch").textContent = `${dLaunch.toFixed(1)} km`;
  }

  if (state.settings.mapFollow && state.activeView === "trajectory" && state.mapMode === "2d") {
    state.map.panTo([current.lat, current.lng], { animate: true, duration: 0.5 });
  }
}

function updateMapPrediction() {
  const p = state.prediction;
  const current = state.liveTelemetry;

  if (!state.map) return;

  if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
    // 1. Predicted Marker
    state.mapLayers.predictedMarker.setLatLng([p.lat, p.lng]);
    if (!state.map.hasLayer(state.mapLayers.predictedMarker)) {
      state.mapLayers.predictedMarker.addTo(state.map);
    }

    // 2. Projected Line from current vehicle to target
    if (current && Number.isFinite(current.lat) && Number.isFinite(current.lng)) {
      state.mapLayers.projectedLine.setLatLngs([
        [current.lat, current.lng],
        [p.lat, p.lng]
      ]);
    }

    // 3. 95% Confidence Dispersion Ellipse
    if (p.ellipseCoords && p.ellipseCoords.length > 0) {
      state.mapLayers.ellipsePolygon.setLatLngs(p.ellipseCoords);
    }

    // 4. Monte Carlo 300-Run Landing Scatter Cloud
    if (state.mapLayers.mcSamplesLayer) {
      state.mapLayers.mcSamplesLayer.clearLayers();
      if (p.samples && p.samples.length > 0) {
        // Decimate points for smooth cartographic rendering
        const step = Math.max(1, Math.floor(p.samples.length / 120));
        for (let i = 0; i < p.samples.length; i += step) {
          const pt = p.samples[i];
          L.circleMarker([pt.lat, pt.lng], {
            radius: 2,
            color: "#E9B86A",
            fillColor: "#E9B86A",
            fillOpacity: 0.35,
            weight: 0
          }).addTo(state.mapLayers.mcSamplesLayer);
        }
      }
    }
  }
}

function fitAllMapBounds() {
  if (state.mapMode === "3d") {
    flyToMissionView(true);
    return;
  }

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
    state.map.fitBounds(L.latLngBounds(pts), { padding: [35, 35], maxZoom: 14 });
  }
}

/* ============================================================================
 * SECTION 6: SCIENTIFIC CHART.JS TELEMETRY SYSTEM
 * ============================================================================ */

function initChart() {
  if (!window.Chart) return;

  // 0. Register simulation synchronous crosshair plugin
  if (Chart.registry && !Chart.registry.plugins.get("simCrosshair")) {
    const simCrosshairPlugin = {
      id: "simCrosshair",
      afterDatasetsDraw(chart) {
        if (!state.sim || !state.sim.active || state.history.length === 0) return;
        const curTs = state.sim.currentTimeMs;
        const startTs = state.sim.startTimeMs;
        const endTs = state.sim.endTimeMs;
        if (!curTs || !startTs || endTs <= startTs) return;

        const chartArea = chart.chartArea;
        if (!chartArea) return;

        const frac = Math.max(0, Math.min(1, (curTs - startTs) / (endTs - startTs)));
        const x = chartArea.left + frac * (chartArea.right - chartArea.left);

        const ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(116, 201, 207, 0.9)";
        ctx.lineWidth = 1.5;
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();

        ctx.fillStyle = "#74C9CF";
        ctx.beginPath();
        ctx.arc(x, chartArea.top + 3, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };
    Chart.register(simCrosshairPlugin);
  }

  function attachChartSimClick(canvas, chart) {
    if (!canvas || !chart) return;
    canvas.style.cursor = "crosshair";
    canvas.addEventListener("click", (evt) => {
      if (!state.sim || !state.sim.active || state.history.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = evt.clientX - rect.left;
      const chartArea = chart.chartArea;
      if (!chartArea || x < chartArea.left || x > chartArea.right) return;
      const fraction = (x - chartArea.left) / (chartArea.right - chartArea.left);
      seekSimToFraction(fraction);
      showToast("CHART SEEK", `Timeline jumped to ${(fraction * 100).toFixed(1)}% of mission profile`, "info");
    });
  }

  // 1. Overview Primary Profile Chart
  const overviewCanvas = $("mission-chart");
  if (overviewCanvas && !state.overviewChart) {
    const ctx = overviewCanvas.getContext("2d");
    state.overviewChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Altitude MSL (m)",
            data: [],
            borderColor: "#A7D96C",
            backgroundColor: "rgba(167, 217, 108, 0.08)",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.15,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#171B18",
            borderColor: "#343D36",
            borderWidth: 1,
            titleColor: "#A1AAA2",
            bodyColor: "#E8EDE7",
            titleFont: { family: "JetBrains Mono", size: 10 },
            bodyFont: { family: "JetBrains Mono", size: 11 },
            padding: 8
          }
        },
        scales: {
          x: {
            grid: { color: "#262E28" },
            ticks: { color: "#758078", font: { family: "JetBrains Mono", size: 9 }, maxTicksLimit: 7 },
            border: { display: false }
          },
          y: {
            grid: { color: "#262E28" },
            ticks: { color: "#758078", font: { family: "JetBrains Mono", size: 9 }, maxTicksLimit: 6 },
            border: { display: false }
          }
        }
      }
    });
    attachChartSimClick(overviewCanvas, state.overviewChart);
  }

  // 2. Flight Analysis Master Chart
  const analysisCanvas = $("analysis-master-chart");
  if (analysisCanvas && !state.analysisMasterChart) {
    const ctx2 = analysisCanvas.getContext("2d");
    state.analysisMasterChart = new Chart(ctx2, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Altitude (m)",
            data: [],
            borderColor: "#A7D96C",
            backgroundColor: "rgba(167, 217, 108, 0.06)",
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.15,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#171B18",
            borderColor: "#343D36",
            borderWidth: 1,
            titleColor: "#A1AAA2",
            bodyColor: "#E8EDE7",
            titleFont: { family: "JetBrains Mono", size: 10 },
            bodyFont: { family: "JetBrains Mono", size: 11 },
            padding: 8
          }
        },
        scales: {
          x: {
            grid: { color: "#262E28" },
            ticks: { color: "#758078", font: { family: "JetBrains Mono", size: 9 }, maxTicksLimit: 8 },
            border: { display: false }
          },
          y: {
            grid: { color: "#262E28" },
            ticks: { color: "#758078", font: { family: "JetBrains Mono", size: 9 }, maxTicksLimit: 6 },
            border: { display: false }
          }
        }
      }
    });
    attachChartSimClick(analysisCanvas, state.analysisMasterChart);
  }
}

function updateChart() {
  if (state.history.length === 0) return;

  // Decimation for high-framerate rendering
  const maxPts = 500;
  const step = Math.max(1, Math.floor(state.history.length / maxPts));
  const samples = [];
  for (let i = 0; i < state.history.length; i += step) {
    samples.push(state.history[i]);
  }
  if (samples[samples.length - 1] !== state.history[state.history.length - 1]) {
    samples.push(state.history[state.history.length - 1]);
  }

  // 1. Update Overview Chart
  if (state.overviewChart) {
    const ovLabels = samples.map((p) =>
      p.ts
        ? new Date(p.ts).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        : "--"
    );
    const ovData = samples.map((p) => Number(p.alt || 0));

    state.overviewChart.data.labels = ovLabels;
    state.overviewChart.data.datasets[0].data = ovData;
    state.overviewChart.update("none");

    if ($("chart-stat-x")) $("chart-stat-x").textContent = ovLabels[ovLabels.length - 1] || "--";
    if ($("chart-stat-y")) $("chart-stat-y").textContent = `${formatNum(ovData[ovData.length - 1], 1)} m`;
    if ($("chart-stat-count")) $("chart-stat-count").textContent = state.history.length;
  }

  // 2. Update Analysis Master Chart according to active tab
  if (state.analysisMasterChart) {
    const tab = state.activeChartTab;
    let labels = [];
    let data = [];
    let labelText = "";
    let color = "#A7D96C";
    let bgGrad = "rgba(167, 217, 108, 0.06)";

    if (tab === "alt-time") {
      labelText = "Altitude MSL (m)";
      color = "#A7D96C";
      bgGrad = "rgba(167, 217, 108, 0.08)";
      labels = samples.map((p) => p.ts ? new Date(p.ts).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--");
      data = samples.map((p) => Number(p.alt || 0));
    } else if (tab === "vs-time") {
      labelText = "Vertical Velocity (m/s)";
      color = "#74C9CF";
      bgGrad = "rgba(116, 201, 207, 0.08)";
      labels = samples.map((p) => p.ts ? new Date(p.ts).toLocaleTimeString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--");
      data = samples.map((p) => Number(p.computed_vs || 0));
    } else if (tab === "temp-alt") {
      labelText = "Temperature (°C)";
      color = "#B89EF5";
      bgGrad = "rgba(184, 158, 245, 0.08)";
      labels = samples.map((p) => `${formatNum(p.alt, 0)} m`);
      data = samples.map((p) => Number(p.temp || 0));
    } else if (tab === "press-alt") {
      labelText = "Pressure (hPa)";
      color = "#E9B86A";
      bgGrad = "rgba(233, 184, 106, 0.08)";
      labels = samples.map((p) => `${formatNum(p.alt, 0)} m`);
      data = samples.map((p) => Number(p.pressure || 0));
    } else if (tab === "wind-alt") {
      labelText = "Wind Speed (m/s)";
      color = "#74C9CF";
      bgGrad = "rgba(116, 201, 207, 0.08)";
      labels = samples.map((p) => `${formatNum(p.alt, 0)} m`);
      data = samples.map((p) => Number(p.gps_speed || 0));
    }

    state.analysisMasterChart.data.labels = labels;
    state.analysisMasterChart.data.datasets[0].label = labelText;
    state.analysisMasterChart.data.datasets[0].data = data;
    state.analysisMasterChart.data.datasets[0].borderColor = color;
    state.analysisMasterChart.data.datasets[0].backgroundColor = bgGrad;
    state.analysisMasterChart.update("none");
  }

  // Update sounding table in Analysis view
  renderSoundingTable();
}

/* ============================================================================
 * SECTION 7: AVIONICS: ATTITUDE INDICATOR & IMU
 * ============================================================================ */

function updateAttitudeAndIMU(data) {
  if (!data) return;

  const roll = Number.isFinite(data.roll) ? data.roll : 0;
  const pitch = Number.isFinite(data.pitch) ? data.pitch : 0;

  // Artificial Horizon transform
  const drum = $("horizon-drum");
  if (drum) {
    const clampedPitch = Math.max(-35, Math.min(35, pitch));
    const pitchOffsetPx = clampedPitch * 2.2;
    drum.style.transform = `rotate(${-roll}deg) translateY(${pitchOffsetPx}px)`;
  }

  if ($("imu-roll-val")) $("imu-roll-val").textContent = `${roll >= 0 ? "+" : ""}${roll.toFixed(1)}°`;
  if ($("imu-pitch-val")) $("imu-pitch-val").textContent = `${pitch >= 0 ? "+" : ""}${pitch.toFixed(1)}°`;

  // Accelerations (ax, ay, az in m/s²)
  const ax = Number.isFinite(data.ax) ? data.ax : 0;
  const ay = Number.isFinite(data.ay) ? data.ay : 0;
  const az = Number.isFinite(data.az) ? data.az : 9.81;

  if ($("val-ax")) $("val-ax").textContent = `${ax >= 0 ? "+" : ""}${ax.toFixed(2)}`;
  if ($("val-ay")) $("val-ay").textContent = `${ay >= 0 ? "+" : ""}${ay.toFixed(2)}`;
  if ($("val-az")) $("val-az").textContent = `${az >= 0 ? "+" : ""}${az.toFixed(2)}`;

  const toPct = (val) => Math.max(0, Math.min(100, ((val + 20) / 40) * 100));
  if ($("bar-ax")) $("bar-ax").style.width = `${toPct(ax)}%`;
  if ($("bar-ay")) $("bar-ay").style.width = `${toPct(ay)}%`;
  if ($("bar-az")) $("bar-az").style.width = `${toPct(az)}%`;

  const totalG = Math.sqrt(ax * ax + ay * ay + az * az) / CONFIG.STANDARD_GRAVITY;
  if ($("total-g-badge")) $("total-g-badge").textContent = `TOTAL: ${totalG.toFixed(2)} G`;

  // Gyroscope (gx, gy, gz in deg/s)
  const gx = Number.isFinite(data.gx) ? data.gx : 0;
  const gy = Number.isFinite(data.gy) ? data.gy : 0;
  const gz = Number.isFinite(data.gz) ? data.gz : 0;

  if ($("val-gx")) $("val-gx").textContent = `${gx >= 0 ? "+" : ""}${gx.toFixed(1)}`;
  if ($("val-gy")) $("val-gy").textContent = `${gy >= 0 ? "+" : ""}${gy.toFixed(1)}`;
  if ($("val-gz")) $("val-gz").textContent = `${gz >= 0 ? "+" : ""}${gz.toFixed(1)}`;

  const toGyroPct = (val) => Math.max(0, Math.min(100, ((val + 360) / 720) * 100));
  if ($("bar-gx")) $("bar-gx").style.width = `${toGyroPct(gx)}%`;
  if ($("bar-gy")) $("bar-gy").style.width = `${toGyroPct(gy)}%`;
  if ($("bar-gz")) $("bar-gz").style.width = `${toGyroPct(gz)}%`;
}

function updateCompassRose(data) {
  const course = Number.isFinite(data.gps_course) ? data.gps_course : 0;
  const windFrom = (course + 180) % 360;
  const speed = data.gps_speed || 0;

  const needleDrift = $("needle-drift");
  if (needleDrift) needleDrift.setAttribute("transform", `rotate(${course} 100 100)`);

  const needleWind = $("needle-wind");
  if (needleWind) needleWind.setAttribute("transform", `rotate(${windFrom} 100 100)`);

  const courseCardinal = cardinalDirection(course);
  const windCardinal = cardinalDirection(windFrom);

  if ($("compass-heading-deg")) $("compass-heading-deg").textContent = `${formatNum(course, 0)}°`;
  if ($("compass-heading-cardinal")) $("compass-heading-cardinal").textContent = courseCardinal;
  if ($("nav-cardinal-badge")) $("nav-cardinal-badge").textContent = `${courseCardinal} (${formatNum(course, 0)}°)`;

  if ($("nav-drift-toward")) $("nav-drift-toward").textContent = `${formatNum(course, 1)}° (${courseCardinal})`;
  if ($("nav-wind-from")) $("nav-wind-from").textContent = `${formatNum(windFrom, 1)}° (${windCardinal})`;

  if ($("nav-speed-ms")) $("nav-speed-ms").textContent = `${formatNum(speed, 1)} m/s`;
  if ($("nav-speed-kmh")) $("nav-speed-kmh").textContent = formatNum(speed * 3.6, 1);
  if ($("nav-speed-knots")) $("nav-speed-knots").textContent = formatNum(speed * 1.94384, 1);
}

/* ============================================================================
 * SECTION 8: TELEMETRY PARSER, SANITIZER & DERIVED METRICS
 * ============================================================================ */

function processDerivedMetrics(packet) {
  const t = packet.ts || Date.now();
  const alt = packet.alt;

  // 1. Vertical speed calculation
  let instantaneousVs = 0;
  if (state.history.length > 0) {
    const prev = state.history[state.history.length - 1];
    const dt = (t - (prev.ts || t)) / 1000;
    if (dt > 0.3 && dt < 15 && Number.isFinite(prev.alt) && Number.isFinite(alt)) {
      instantaneousVs = (alt - prev.alt) / dt;
    }
  }

  // 5-sample smoothing queue
  state.vsMovingAverageQueue.push(instantaneousVs);
  if (state.vsMovingAverageQueue.length > 5) {
    state.vsMovingAverageQueue.shift();
  }
  state.verticalSpeedMs = calculateMovingAverage(state.vsMovingAverageQueue);
  packet.computed_vs = state.verticalSpeedMs;

  // 2. Apogee & Envelope Burst Detection
  if (Number.isFinite(alt)) {
    if (alt > state.apogeeM) {
      state.apogeeM = alt;
    }
    // Envelope burst: altitude drops > 200m after passing 10,000m
    if (state.apogeeM >= 10000 && (state.apogeeM - alt) > 200 && !state.burstDetected) {
      state.burstDetected = true;
      recordEvent("ENVELOPE BURST DETECTED", `Apogee recorded at ${formatNum(state.apogeeM, 0)} m. Parachute descent underway.`, "warn");
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

  checkSafetyAlerts(packet);
}

function checkSafetyAlerts(p) {
  if (p.sats !== null && p.sats !== undefined && p.sats < 4) {
    recordEvent("GNSS FIX DEGRADED", `Low satellite count (${p.sats} sats). Fix accuracy compromised.`, "warn");
  }
  if (p.temp !== null && p.temp !== undefined && p.temp < -60) {
    recordEvent("EXTREME LOW TEMPERATURE", `Ambient sensor registered ${formatNum(p.temp, 1)} °C.`, "warn");
  }
  if (state.verticalSpeedMs < -15) {
    recordEvent("RAPID DESCENT RATE", `Descent velocity ${formatNum(state.verticalSpeedMs, 1)} m/s exceeds threshold.`, "crit");
  }
  if (p.rssi !== null && p.rssi !== undefined && p.rssi < -85) {
    recordEvent("RF LINK ATTENUATED", `RSSI attenuated to ${p.rssi} dBm. Packet drop expected.`, "warn");
  }
}

function renderDashboard(data) {
  if (!data) return;

  // Hide empty state once packets arrive
  const emptyOverlay = $("empty-state-overlay");
  if (emptyOverlay && !emptyOverlay.classList.contains("hidden")) {
    emptyOverlay.classList.add("hidden");
  }

  // Mission MET Clock
  if (state.missionStartTs && $("mission-clock")) {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - state.missionStartTs) / 1000));
    const h = String(Math.floor(elapsedSec / 3600)).padStart(2, "0");
    const m = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, "0");
    const s = String(elapsedSec % 60).padStart(2, "0");
    $("mission-clock").textContent = `T+ ${h}:${m}:${s}`;
  }

  // Flight Phase Badge
  const phaseBadge = $("flight-phase-badge");
  if (phaseBadge) {
    phaseBadge.textContent = state.flightPhase;
    phaseBadge.className = "phase-tag";
    if (state.flightPhase === "ASCENT") phaseBadge.classList.add("badge-phase-ascent");
    else if (state.flightPhase === "FLOAT/BURST ZONE") phaseBadge.classList.add("badge-phase-float");
    else if (state.flightPhase === "DESCENT") phaseBadge.classList.add("badge-phase-descent");
    else phaseBadge.classList.add("badge-phase-pre");
  }

  // METRIC 1: Altitude
  const alt = data.alt;
  if ($("val-alt")) $("val-alt").textContent = formatNum(alt, 1);
  const altFt = Number.isFinite(alt) ? alt * 3.28084 : null;
  if ($("val-alt-ft")) $("val-alt-ft").textContent = `${formatNum(altFt, 0)} ft`;
  if ($("apogee-val")) $("apogee-val").textContent = formatNum(state.apogeeM, 0);

  // METRIC 2: Vertical Speed
  const vs = state.verticalSpeedMs;
  if ($("val-vs")) {
    $("val-vs").textContent = `${vs >= 0 ? "+" : ""}${formatNum(vs, 1)}`;
    $("val-vs").style.color = vs > 0 ? "var(--accent-primary)" : vs < -1 ? "var(--status-caution)" : "var(--text-primary)";
  }
  const vsFpm = vs * 196.85;
  if ($("val-vs-fpm")) $("val-vs-fpm").textContent = `${vsFpm >= 0 ? "+" : ""}${formatNum(vsFpm, 0)} ft/min`;

  // METRIC 3: Drift Speed
  const spd = data.gps_speed;
  if ($("val-speed")) $("val-speed").textContent = formatNum(spd, 1);
  const spdKmh = Number.isFinite(spd) ? spd * 3.6 : null;
  const spdKn = Number.isFinite(spd) ? spd * 1.94384 : null;
  if ($("val-speed-dual")) $("val-speed-dual").textContent = `${formatNum(spdKmh, 1)} km/h · ${formatNum(spdKn, 1)} kn`;
  if ($("speed-heading-badge")) $("speed-heading-badge").textContent = Number.isFinite(data.gps_course) ? `${formatNum(data.gps_course, 0)}°` : "--°";

  // METRIC 4: Temperature
  const temp = data.temp;
  if ($("val-temp")) $("val-temp").textContent = formatNum(temp, 1);
  const tempF = Number.isFinite(temp) ? (temp * 9) / 5 + 32 : null;
  if ($("val-temp-f")) $("val-temp-f").textContent = `${formatNum(tempF, 1)} °F`;

  // METRIC 5: Pressure
  const press = data.pressure;
  if ($("val-press")) $("val-press").textContent = formatNum(press, 1);
  const pressAtm = Number.isFinite(press) ? press / 1013.25 : null;
  if ($("val-press-atm")) $("val-press-atm").textContent = `${formatNum(pressAtm, 3)} atm`;

  // METRIC 6: Satellites & HDOP
  const sats = data.sats;
  if ($("val-sats")) $("val-sats").textContent = sats !== null && sats !== undefined ? sats : "--";
  if ($("hdop-badge")) $("hdop-badge").textContent = `HDOP: ${formatNum(data.hdop, 1)}`;

  if ($("gnss-bars")) {
    const bars = $("gnss-bars").children;
    for (let i = 0; i < bars.length; i++) {
      if (sats >= (i + 1) * 3) {
        bars[i].classList.add("active");
      } else {
        bars[i].classList.remove("active");
      }
    }
  }

  // METRIC 7: RSSI & Loss
  const rssi = data.rssi;
  if ($("val-rssi")) $("val-rssi").textContent = rssi !== null && rssi !== undefined ? rssi : "--";
  const pktSeq = data.packet_seq;
  if ($("val-pkt-seq")) $("val-pkt-seq").textContent = pktSeq ? `PKT #${pktSeq}` : "PKT #--";
  const lost = data.packets_lost || 0;
  const lossPct = pktSeq && pktSeq > 0 ? (lost / pktSeq) * 100 : 0;
  if ($("loss-pct-badge")) $("loss-pct-badge").textContent = `LOSS: ${lossPct.toFixed(1)}%`;

  // Sparklines
  updateSparkline("spark-alt", "alt");
  updateSparkline("spark-vs", "computed_vs");
  updateSparkline("spark-speed", "gps_speed");
  updateSparkline("spark-temp", "temp");
  updateSparkline("spark-press", "pressure");
  updateSparkline("spark-rssi", "rssi");

  // Navigation & Instruments
  updateCompassRose(data);
  updateAttitudeAndIMU(data);

  // Diagnostics
  if ($("diag-rssi-val")) $("diag-rssi-val").textContent = rssi ? `${rssi} dBm` : "-- dBm";
  const rssiPct = rssi ? Math.max(0, Math.min(100, ((rssi + 110) / 70) * 100)) : 0;
  if ($("diag-rssi-fill")) $("diag-rssi-fill").style.width = `${rssiPct}%`;
  if ($("diag-seq")) $("diag-seq").textContent = pktSeq || "--";
  if ($("diag-lost")) $("diag-lost").textContent = lost;
  if ($("diag-loss-pct")) $("diag-loss-pct").textContent = `${lossPct.toFixed(2)}%`;

  // Cutdown state
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

  const width = 50;
  const height = 16;

  const pointsStr = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  svg.innerHTML = `<polyline points="${pointsStr}" />`;
}

function updateCutdownState(remoteState) {
  const stateStr = (remoteState || "safe").toLowerCase();
  const badge = $("cutdown-state-badge");
  const stepSafe = $("step-safe");
  const stepArmed = $("step-armed");
  const stepFired = $("step-fired");

  if (stepSafe) stepSafe.classList.remove("active");
  if (stepArmed) stepArmed.classList.remove("active");
  if (stepFired) stepFired.classList.remove("active");

  if (!badge) return;
  badge.className = "cutdown-status-badge";

  if (stateStr === "fired") {
    badge.textContent = "FIRED";
    badge.classList.add("badge-fired");
    if (stepFired) stepFired.classList.add("active");
  } else if (stateStr === "armed") {
    badge.textContent = "ARMED";
    badge.classList.add("badge-armed");
    if (stepArmed) stepArmed.classList.add("active");
  } else {
    badge.textContent = "SAFE";
    badge.classList.add("badge-safe");
    if (stepSafe) stepSafe.classList.add("active");
  }
}

/* ============================================================================
 * SECTION 9: FIREBASE REALTIME DATABASE INTERFACE & COMMANDS
 * ============================================================================ */

function initFirebase() {
  const hasConfig =
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.includes("YOUR_") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.includes("your-project-id");

  if (!hasConfig) {
    if ($("setup-banner")) $("setup-banner").classList.remove("hidden");
    if ($("empty-state-overlay")) $("empty-state-overlay").classList.remove("hidden");
    setRtdbStatus(false);
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    state.db = getDatabase(app);

    const connectedRef = ref(state.db, ".info/connected");
    onValue(connectedRef, (snap) => {
      const connected = Boolean(snap.val());
      state.isFirebaseConnected = connected;
      setRtdbStatus(connected);
      if (connected && $("setup-banner")) {
        $("setup-banner").classList.add("hidden");
      }
    });

    // 1. Live Telemetry Listener (/aerodrift/live)
    const liveRef = ref(state.db, "aerodrift/live");
    onValue(liveRef, (snap) => {
      if (state.replay.active) return;
      const data = snap.val();
      if (!data) return;
      ingestTelemetryPacket(data, true);
    });

    // 2. Historical Telemetry Listener (/aerodrift/history)
    const historyQuery = query(ref(state.db, "aerodrift/history"), limitToLast(500));
    onChildAdded(historyQuery, (snap) => {
      if (state.replay.active) return;
      const data = snap.val();
      if (!data) return;
      ingestHistoryPacket(data);
    });

    // 3. Cutdown Command State Listener (/aerodrift/commands/cutdown)
    const commandRef = ref(state.db, "aerodrift/commands/cutdown");
    onValue(commandRef, (snap) => {
      const val = snap.val();
      if (val) updateCutdownState(val);
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
  if (!dot || !txt) return;
  if (connected) {
    dot.className = "status-indicator-dot dot-connected";
    txt.textContent = "CONNECTED";
  } else {
    dot.className = "status-indicator-dot dot-disconnected";
    txt.textContent = "OFFLINE";
  }
}

function ingestTelemetryPacket(data, isLive = true) {
  if ((state.sim.active || state.isDemoSimulation) && isLive) {
    // When 3D simulation / demo is active, prevent remote live stream from disrupting the simulation
    return;
  }

  state.liveTelemetry = data;
  state.lastPacketTs = data.ts || Date.now();

  if (!state.missionStartTs) {
    state.missionStartTs = state.lastPacketTs;
  }

  // Set Launch Point from first GPS fix
  if (!state.launchPoint && Number.isFinite(data.lat) && Number.isFinite(data.lng)) {
    state.launchPoint = { lat: data.lat, lng: data.lng, alt: data.alt || 0 };
    recordEvent("LAUNCH SITE ACQUIRED", `Pad at ${data.lat.toFixed(4)}°, ${data.lng.toFixed(4)}°`, "nominal");
  }

  processDerivedMetrics(data);

  if (isLive) {
    state.history.push({ ...data });
    if (state.history.length > CONFIG.MAX_HISTORY_BUFFER) {
      state.history.shift();
    }
  }

  renderDashboard(data);
  updateMapTelemetry(data);
  updateChart();
  runLandingPrediction();
}

function ingestHistoryPacket(data) {
  if (state.sim.active || state.isDemoSimulation) return;
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
    recordEvent("CUTDOWN COMMAND DISPATCHED", `Command state set to '${cmd.toUpperCase()}'`, cmd === "fire" ? "crit" : "nominal");
  } catch (err) {
    console.error("Cutdown write failed:", err);
    recordEvent("COMMAND ERROR", err.message, "crit");
  }
}

/* ============================================================================
 * SECTION 10: REPLAY CONSOLE & REALISTIC FLIGHT TRAJECTORY SIMULATOR
 * ============================================================================ */

function startLinkHealthMonitor() {
  setInterval(() => {
    // UTC Clock
    if ($("utc-clock")) {
      $("utc-clock").textContent = new Date().toLocaleTimeString("en-GB", {
        timeZone: "UTC",
        hour12: false
      });
    }

    if (!state.lastPacketTs) {
      if ($("link-status-text")) $("link-status-text").textContent = "NO DATA";
      if ($("link-age-text")) $("link-age-text").textContent = "--";
      return;
    }

    const ageSec = Math.max(0, (Date.now() - state.lastPacketTs) / 1000);
    if ($("link-age-text")) $("link-age-text").textContent = `${ageSec.toFixed(1)}s`;
    if ($("diag-age")) $("diag-age").textContent = `${ageSec.toFixed(1)} s`;

    const dot = $("link-status-dot");
    const txt = $("link-status-text");
    const emergencyBanner = $("emergency-banner");
    const lockNotice = $("cutdown-lock-notice");
    const cutdownControls = $("cutdown-controls-box");

    if (ageSec > CONFIG.LINK_LOST_THRESHOLD_SEC) {
      // LINK LOST (>30s)
      if (dot) dot.className = "status-indicator-dot dot-lost";
      if (txt) {
        txt.textContent = "LOST";
        txt.style.color = "var(--status-critical)";
      }
      if (emergencyBanner) emergencyBanner.classList.remove("hidden");
      if (state.liveTelemetry) {
        if ($("emergency-coords")) $("emergency-coords").textContent = `${state.liveTelemetry.lat.toFixed(5)}°, ${state.liveTelemetry.lng.toFixed(5)}°`;
        if ($("emergency-alt")) $("emergency-alt").textContent = formatNum(state.liveTelemetry.alt, 0);
      }
      if (lockNotice) lockNotice.classList.remove("hidden");
      if (cutdownControls) {
        cutdownControls.style.opacity = "0.35";
        cutdownControls.style.pointerEvents = "none";
      }
    } else if (ageSec > CONFIG.LINK_STALE_THRESHOLD_SEC) {
      // LINK STALE (10s - 30s)
      if (dot) dot.className = "status-indicator-dot dot-stale";
      if (txt) {
        txt.textContent = "STALE";
        txt.style.color = "var(--status-caution)";
      }
      if (emergencyBanner) emergencyBanner.classList.add("hidden");
      if (lockNotice) lockNotice.classList.remove("hidden");
      if (cutdownControls) {
        cutdownControls.style.opacity = "0.35";
        cutdownControls.style.pointerEvents = "none";
      }
    } else {
      // LINK LIVE (<10s)
      if (dot) dot.className = "status-indicator-dot dot-live";
      if (txt) {
        txt.textContent = "LIVE";
        txt.style.color = "var(--status-nominal)";
      }
      if (emergencyBanner) emergencyBanner.classList.add("hidden");
      if (lockNotice) lockNotice.classList.add("hidden");
      if (cutdownControls) {
        cutdownControls.style.opacity = "1";
        cutdownControls.style.pointerEvents = "auto";
      }
    }
  }, 1000);
}

export function initFlightSimulation() {
  if (state.history.length === 0) return false;

  const hist = state.history;
  state.sim.startTimeMs = hist[0].ts;
  state.sim.endTimeMs = hist[hist.length - 1].ts;
  state.sim.durationMs = state.sim.endTimeMs - state.sim.startTimeMs;

  // Find peak altitude (apogee & burst index)
  let maxAlt = -Infinity;
  let maxIdx = 0;
  for (let i = 0; i < hist.length; i++) {
    const a = hist[i].alt || 0;
    if (a > maxAlt) {
      maxAlt = a;
      maxIdx = i;
    }
  }
  state.sim.apogeeM = maxAlt;
  state.sim.apogeeIndex = maxIdx;
  state.sim.burstIndex = maxIdx;

  // Find touchdown index (where altitude reaches surface after apogee)
  let tdIdx = hist.length - 1;
  for (let j = maxIdx; j < hist.length; j++) {
    if ((hist[j].alt || 0) <= (state.settings.groundElevationM || 0) + 15) {
      tdIdx = j;
      break;
    }
  }
  state.sim.touchdownIndex = tdIdx;

  // Position timeline event markers
  const burstMarker = $("sim-marker-burst");
  if (burstMarker && state.sim.durationMs > 0) {
    const burstFrac = (hist[maxIdx].ts - state.sim.startTimeMs) / state.sim.durationMs;
    burstMarker.style.left = `${(burstFrac * 100).toFixed(1)}%`;
    burstMarker.classList.remove("hidden");
  }

  const durationDisplay = $("sim-duration-display");
  if (durationDisplay) {
    const totalSec = Math.max(0, Math.floor(state.sim.durationMs / 1000));
    const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
    const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    durationDisplay.textContent = `DUR: ${hh}:${mm}:${ss}`;
  }

  const slider = $("sim-timeline-slider");
  if (slider) {
    slider.min = 0;
    slider.max = 1000;
    slider.value = 0;
  }

  return true;
}

export function startSimulation(autoPlay = true) {
  if (state.history.length === 0) {
    showToast("SIMULATION ERROR", "No trajectory data available to simulate.", "warn");
    return;
  }

  initFlightSimulation();
  state.sim.active = true;
  state.sim.paused = !autoPlay;
  state.sim.isPlaying = autoPlay;
  state.sim.currentTimeMs = state.sim.startTimeMs;
  state.sim.lastWallClockMs = performance.now();

  const playBtnText = $("sim-play-text");
  const playBtn = $("btn-sim-play-pause");
  if (playBtnText) playBtnText.textContent = autoPlay ? "PAUSE" : "PLAY";
  if (playBtn) playBtn.classList.toggle("is-playing", autoPlay);

  if ($("replay-indicator-badge")) $("replay-indicator-badge").classList.remove("hidden");
  if ($("btn-mode-live")) $("btn-mode-live").classList.remove("active");
  if ($("btn-mode-replay")) $("btn-mode-replay").classList.add("active");

  // Automatically activate 3D Trajectory workspace
  if (state.activeView !== "trajectory") {
    switchWorkspaceView("trajectory");
  }

  // Ensure Cesium 3D Globe is visible
  if (state.mapMode !== "3d") {
    setMapDisplayMode("3d");
  }

  syncSimulationFrame();

  if (!state.sim.rafId) {
    state.sim.rafId = requestAnimationFrame(simAnimationLoop);
  }

  recordEvent("SIMULATION RUNNING", `Authoritative clock active at ${state.sim.speed}x speed.`, "nominal");
}

export function playSimulation() {
  if (!state.sim.active) {
    startSimulation(true);
    return;
  }
  state.sim.paused = false;
  state.sim.isPlaying = true;
  state.sim.lastWallClockMs = performance.now();

  const playBtnText = $("sim-play-text");
  const playBtn = $("btn-sim-play-pause");
  if (playBtnText) playBtnText.textContent = "PAUSE";
  if (playBtn) playBtn.classList.add("is-playing");

  if (!state.sim.rafId) {
    state.sim.rafId = requestAnimationFrame(simAnimationLoop);
  }
}

export function pauseSimulation() {
  state.sim.paused = true;
  state.sim.isPlaying = false;

  const playBtnText = $("sim-play-text");
  const playBtn = $("btn-sim-play-pause");
  if (playBtnText) playBtnText.textContent = "PLAY";
  if (playBtn) playBtn.classList.remove("is-playing");
}

export function toggleSimPlayPause() {
  if (state.sim.paused) {
    playSimulation();
  } else {
    pauseSimulation();
  }
}

export function restartSimulation() {
  if (!state.sim.active) {
    startSimulation(true);
    return;
  }
  state.sim.currentTimeMs = state.sim.startTimeMs;
  state.sim.currentIndex = 0;
  syncSimulationFrame();
  playSimulation();
}

export function stepSimulation(secondsDelta) {
  if (!state.sim.active) {
    startSimulation(false);
  }
  pauseSimulation();
  state.sim.currentTimeMs = Math.max(
    state.sim.startTimeMs,
    Math.min(state.sim.endTimeMs, state.sim.currentTimeMs + secondsDelta * 1000)
  );
  syncSimulationFrame();
}

export function seekSimToTime(targetMs) {
  if (!state.sim.active) {
    startSimulation(false);
  }
  state.sim.currentTimeMs = Math.max(
    state.sim.startTimeMs,
    Math.min(state.sim.endTimeMs, targetMs)
  );
  syncSimulationFrame();
}

export function seekSimToFraction(frac) {
  if (!state.sim.active && state.history.length > 0) {
    startSimulation(false);
  }
  const f = Math.max(0, Math.min(1, frac));
  const t = state.sim.startTimeMs + f * (state.sim.endTimeMs - state.sim.startTimeMs);
  seekSimToTime(t);
}

export function setSimSpeed(speed) {
  const num = Number(speed);
  if (!num || num <= 0) return;
  state.sim.speed = num;
  state.replay.speed = num;

  const speedBtns = document.querySelectorAll(".btn-sim-speed");
  speedBtns.forEach(btn => {
    btn.classList.toggle("active", Number(btn.dataset.speed) === num);
  });
}

export function syncSimulationFrame() {
  if (state.history.length === 0) return;

  const cur = getSimInterpolatedState();
  if (!cur) return;

  // 1. Time Displays (Authoritative Clock & MET)
  const clockDisplay = $("sim-clock-display");
  if (clockDisplay) {
    clockDisplay.textContent = new Date(cur.ts).toLocaleTimeString("en-GB", {
      timeZone: "UTC",
      hour12: false
    }) + " UTC";
  }

  const metDisplay = $("sim-met-display");
  if (metDisplay) {
    const elapsedSec = Math.max(0, Math.floor((cur.ts - state.sim.startTimeMs) / 1000));
    const hh = String(Math.floor(elapsedSec / 3600)).padStart(2, "0");
    const mm = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, "0");
    const ss = String(elapsedSec % 60).padStart(2, "0");
    metDisplay.textContent = `T+${hh}:${mm}:${ss}`;
  }

  // 2. Flight Phase Badges
  const phaseBadge = $("sim-phase-badge");
  if (phaseBadge) {
    phaseBadge.textContent = cur.flightPhase;
    phaseBadge.className = `flight-phase-badge phase-${cur.flightPhase.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
  }
  const topPhaseBadge = $("telemetry-phase-badge");
  if (topPhaseBadge) topPhaseBadge.textContent = cur.flightPhase;

  // 3. Timeline Slider Progress
  const slider = $("sim-timeline-slider");
  if (slider && state.sim.durationMs > 0) {
    const frac = Math.max(0, Math.min(1, (cur.ts - state.sim.startTimeMs) / state.sim.durationMs));
    slider.value = Math.floor(frac * 1000);
  }

  // 4. Controller Telemetry Quick Pills
  const pillAlt = $("sim-pill-alt");
  if (pillAlt) pillAlt.textContent = `${formatNum(cur.alt, 0)} m`;

  const pillVs = $("sim-pill-vs");
  if (pillVs) pillVs.textContent = `${cur.vs >= 0 ? "+" : ""}${formatNum(cur.vs, 1)} m/s`;

  const pillDrift = $("sim-pill-drift");
  if (pillDrift) pillDrift.textContent = `${formatNum(cur.speed, 1)} m/s ${formatNum(cur.heading, 0)}°`;

  const pillWind = $("sim-pill-wind");
  if (pillWind) {
    const w = getCurrentLayerWind(cur.alt);
    pillWind.textContent = `${formatNum(w.speed, 1)}m/s @ ${formatNum(w.dir, 0)}°`;
  }

  // 5. Avionics & Metrics Updates
  state.liveTelemetry = cur;
  updateAttitudeAndIMU(cur);

  if ($("metric-alt")) $("metric-alt").textContent = formatNum(cur.alt, 1);
  if ($("metric-vs")) $("metric-vs").textContent = `${cur.vs >= 0 ? "+" : ""}${formatNum(cur.vs, 1)}`;
  if ($("metric-groundspeed")) $("metric-groundspeed").textContent = formatNum(cur.speed, 1);
  if ($("metric-track")) $("metric-track").textContent = `${formatNum(cur.heading, 0)}°`;
  if ($("metric-temp")) $("metric-temp").textContent = formatNum(cur.temp, 1);
  if ($("metric-pressure")) $("metric-pressure").textContent = formatNum(cur.pressure, 1);
  if ($("metric-sats")) $("metric-sats").textContent = cur.sats || 11;
  if ($("metric-hdop")) $("metric-hdop").textContent = cur.hdop || 0.9;
  if ($("metric-rssi")) $("metric-rssi").textContent = cur.rssi || -68;

  // 6. Camera chase / ground modes updates in Cesium
  if (state.cesiumViewer && window.Cesium) {
    const mult = state.sim.scaleMode === "enhanced" ? state.sim.scaleMultiplier : 1.0;
    if (state.sim.cameraMode === "chase") {
      const headingRad = Cesium.Math.toRadians(cur.heading || 0);
      const distBack = 160;
      const altAbove = 45;
      const dEast = -Math.sin(headingRad) * distBack;
      const dNorth = -Math.cos(headingRad) * distBack;
      const chasePos = destinationPoint(cur.lat, cur.lng, dEast, dNorth);
      state.cesiumViewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(chasePos.lng, chasePos.lat, (cur.alt * mult) + altAbove),
        orientation: {
          heading: headingRad,
          pitch: Cesium.Math.toRadians(-12.0),
          roll: 0.0
        }
      });
    } else if (state.sim.cameraMode === "ground") {
      const origin = (cur.flightPhase === "DESCENT" || cur.flightPhase === "TOUCHDOWN") && state.prediction && Number.isFinite(state.prediction.lat)
        ? { lat: state.prediction.lat, lng: state.prediction.lng, alt: state.settings.groundElevationM || 0 }
        : (state.launchPoint || { lat: 13.0827, lng: 80.2707, alt: 25 });
      const heading = calculateBearing(origin.lat, origin.lng, cur.lat, cur.lng);
      const groundDist = haversineDistance(origin.lat, origin.lng, cur.lat, cur.lng);
      const pitch = Math.atan2((cur.alt * mult) - origin.alt, Math.max(10, groundDist));
      state.cesiumViewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(origin.lng, origin.lat, origin.alt + 8),
        orientation: {
          heading: Cesium.Math.toRadians(heading),
          pitch: pitch,
          roll: 0.0
        }
      });
    }

    if (state.cesiumViewer.scene) {
      state.cesiumViewer.scene.requestRender();
    }
  }

  // 7. 2D Map Sync
  if (state.map && state.mapMode === "2d") {
    if (state.mapLayers.balloonMarker) {
      state.mapLayers.balloonMarker.setLatLng([cur.lat, cur.lng]);
    }
    if (state.settings.mapFollow) {
      state.map.panTo([cur.lat, cur.lng], { animate: false });
    }
  }

  // 8. Re-render charts for crosshair synchronization
  if (state.overviewChart) state.overviewChart.render();
  if (state.analysisMasterChart) state.analysisMasterChart.render();
}

export function simAnimationLoop(wallClockTs) {
  if (!state.sim.active) {
    state.sim.rafId = null;
    return;
  }

  if (!state.sim.lastWallClockMs) state.sim.lastWallClockMs = wallClockTs;
  const dtSec = Math.min(0.1, (wallClockTs - state.sim.lastWallClockMs) / 1000);
  state.sim.lastWallClockMs = wallClockTs;

  if (!state.sim.paused) {
    const simStepMs = dtSec * 1000 * state.sim.speed;
    state.sim.currentTimeMs += simStepMs;

    if (state.sim.currentTimeMs >= state.sim.endTimeMs) {
      state.sim.currentTimeMs = state.sim.endTimeMs;
      pauseSimulation();
      recordEvent("TOUCHDOWN DETECTED", "Flight reached surface landing site.", "nominal");
    }
  }

  syncSimulationFrame();

  if (state.sim.active) {
    state.sim.rafId = requestAnimationFrame(simAnimationLoop);
  } else {
    state.sim.rafId = null;
  }
}

function startReplayMode() {
  if (state.history.length < 5) {
    showToast("REPLAY UNAVAILABLE", "Insufficient flight trajectory history to replay.", "warn");
    return;
  }
  startSimulation(true);
}

function scheduleReplayStep() {
  // Maintained for backward compatibility; RAF loop drives authoritative sim
  if (!state.sim.paused) syncSimulationFrame();
}

function stopReplayMode() {
  pauseSimulation();
  state.sim.active = false;
  if ($("replay-indicator-badge")) $("replay-indicator-badge").classList.add("hidden");
  if ($("btn-mode-live")) $("btn-mode-live").classList.add("active");
  if ($("btn-mode-replay")) $("btn-mode-replay").classList.remove("active");
  recordEvent("LIVE MODE RESTORED", "Switched back to live telemetry stream.", "info");
}

function launchDemoSimulation() {
  if ($("setup-banner")) $("setup-banner").classList.add("hidden");
  if ($("empty-state-overlay")) $("empty-state-overlay").classList.add("hidden");

  state.isDemoSimulation = true;
  state.history = [];
  state.vsMovingAverageQueue = [];
  state.apogeeM = 0;
  state.burstDetected = false;
  state.missionStartTs = Date.now();

  recordEvent("SIMULATION INITIALIZED", "Generating stratospheric flight trajectory (Chennai to Bay of Bengal).", "nominal");

  const baseLat = 13.0827;
  const baseLng = 80.2707;
  let curLat = baseLat;
  let curLng = baseLng;
  let curAlt = 25.0; // Launch elevation REC Chennai 25m
  let curSeq = 100;
  let curTemp = 31.5;
  let curPress = 1012.0;

  let simTime = Date.now() - 3600000; // 1 hr prior

  // Generate Ascent Profile (220 samples up to 30.2 km)
  let prevAlt = curAlt;
  for (let i = 0; i < 220; i++) {
    const fraction = i / 220;
    const altIncrement = 135 + Math.random() * 10;
    curAlt += altIncrement;
    const dt = 12;
    const computedVs = altIncrement / dt;

    // Jet stream drift: balloon drifts Eastward/North-Eastward
    const speed = 8 + fraction * 28 + (Math.sin(fraction * 10) * 4);
    const course = 85 + Math.sin(fraction * 6) * 20;

    const { u, v } = windComponents(speed, course);
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
      computed_vs: Number(computedVs.toFixed(2)),
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
    prevAlt = curAlt;
  }

  // Generate Descent Profile down to ground level (0m) with aerodynamic deceleration
  const maxAltReached = curAlt;
  let j = 0;
  while (curAlt > (state.settings.groundElevationM || 0) && j < 250) {
    const fraction = j / 120;
    // Aerodynamic terminal descent velocity: ~38 m/s at 30km, decelerating to ~5 m/s near surface
    const vTerm = 5.0 * Math.exp(curAlt / 14400);
    const dt = 15;
    const altDrop = Math.min(curAlt - (state.settings.groundElevationM || 0), vTerm * dt);
    curAlt -= altDrop;
    const computedVs = -(altDrop / dt);

    const speed = 18 - Math.min(1, fraction) * 12 + Math.random() * 2;
    const course = 110 + Math.sin(j * 0.1) * 15;

    const { u, v } = windComponents(speed, course);
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
      alt: Math.max(state.settings.groundElevationM || 0, curAlt),
      computed_vs: Number(computedVs.toFixed(2)),
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
      rssi: -78 + Math.floor(Math.min(1, fraction) * 15),
      packet_seq: curSeq,
      packets_lost: 9,
      cutdown_state: "fired",
      ts: simTime
    });

    j++;
    if (curAlt <= (state.settings.groundElevationM || 0) + 0.1) break;
  }

  state.launchPoint = { lat: baseLat, lng: baseLng, alt: 25.0 };
  state.apogeeM = maxAltReached;
  state.burstDetected = true;

  // Compute Monte Carlo landing predictions & dispersion ellipse
  runLandingPrediction();
  updateMapPrediction();
  updateChart();
  fitAllMapBounds();

  // Launch interactive 3D simulation
  startSimulation(true);

  showToast("DEMO FLIGHT LOADED", "Full 30km ascent & parachute descent trajectory running in 3D simulator.", "nominal");
}

/* ============================================================================
 * SECTION 11: SCIENTIFIC DATA EXPORT GENERATORS
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
    <desc>SEDHACKS '26 · Team TRINITY · REC SEDS Chapter</desc>
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
      hackathon: "SEDHACKS '26",
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
 * SECTION 12: SUBSYSTEM NAVIGATION & UI EVENT LISTENERS
 * ============================================================================ */

function switchWorkspaceView(viewId) {
  state.activeView = viewId;

  // 1. Update navigation button styles
  const navButtons = document.querySelectorAll(".nav-tab-btn");
  navButtons.forEach((btn) => {
    const isTarget = btn.dataset.view === viewId;
    btn.classList.toggle("active", isTarget);
    btn.setAttribute("aria-selected", isTarget ? "true" : "false");
  });

  // 2. Update active workspace section
  const views = document.querySelectorAll(".workspace-view");
  views.forEach((v) => {
    v.classList.remove("active");
  });

  const targetSection = $(`view-${viewId}`);
  if (targetSection) {
    targetSection.classList.add("active");
  }

  // 3. View-specific lifecycle adjustments
  if (viewId === "trajectory") {
    if (!state.cesiumViewer && window.Cesium) {
      initCesiumGlobe();
    }
    setTimeout(() => {
      if (state.map) {
        state.map.invalidateSize();
        if (state.liveTelemetry) {
          updateMapTelemetry(state.liveTelemetry);
          updateMapPrediction();
        }
      }
      if (state.cesiumViewer) {
        try {
          state.cesiumViewer.resize();
        } catch (_) {}
      }
    }, 60);
  } else if (viewId === "analysis" || viewId === "overview") {
    setTimeout(() => {
      if (state.overviewChart) state.overviewChart.resize();
      if (state.analysisMasterChart) state.analysisMasterChart.resize();
      updateChart();
    }, 60);
  }
}

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

  if (!modal || !openBtn) return;

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

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

  // Step 1: Verification Input
  verifyInput.addEventListener("input", (e) => {
    const isMatched = e.target.value.trim() === "CUTDOWN";
    holdBtn.disabled = !isMatched;
    holdHint.textContent = isMatched
      ? "Trigger unlocked. Press and hold firmly for 5 seconds."
      : "Type 'CUTDOWN' above to enable trigger button";
  });

  // Step 2: 5-Second Hold-to-Fire Timer
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

  if ($("btn-arm-cutdown")) $("btn-arm-cutdown").addEventListener("click", () => writeCutdownCommand("armed"));
  if ($("btn-disarm-cutdown")) $("btn-disarm-cutdown").addEventListener("click", () => writeCutdownCommand("safe"));
}

function initUIListeners() {
  // 1. Subsystem Navigation Tabs
  const navButtons = document.querySelectorAll(".nav-tab-btn");
  navButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const targetView = e.currentTarget.dataset.view;
      if (targetView) switchWorkspaceView(targetView);
    });
  });

  // 2. Jump from Overview to Trajectory Map
  const jumpMapBtn = $("overview-jump-map-btn");
  if (jumpMapBtn) {
    jumpMapBtn.addEventListener("click", () => {
      switchWorkspaceView("trajectory");
      setTimeout(() => {
        if (state.map && state.liveTelemetry) {
          state.map.setView([state.liveTelemetry.lat, state.liveTelemetry.lng], 12);
        }
      }, 80);
    });
  }

  // 3. Chart Series Selection in Flight Analysis
  const chartTabs = document.querySelectorAll(".chart-tabs .tab-btn");
  chartTabs.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      chartTabs.forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      state.activeChartTab = e.target.dataset.chart;
      updateChart();
    });
  });

  // 4. Map Tactical Controls
  if ($("follow-balloon-toggle")) {
    $("follow-balloon-toggle").addEventListener("change", (e) => {
      state.settings.mapFollow = e.target.checked;
    });
  }
  if ($("map-fit-bounds-btn")) $("map-fit-bounds-btn").addEventListener("click", fitAllMapBounds);
  if ($("map-center-balloon-btn")) {
    $("map-center-balloon-btn").addEventListener("click", () => {
      if (state.liveTelemetry) {
        if (state.mapMode === "3d" && state.cesiumViewer && window.Cesium) {
          state.cesiumViewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
              state.liveTelemetry.lng,
              state.liveTelemetry.lat,
              Math.max(10000, (state.liveTelemetry.alt || 1000) * state.altitudeMultiplier + 5000)
            ),
            duration: 1.0
          });
        } else if (state.map) {
          state.map.setView([state.liveTelemetry.lat, state.liveTelemetry.lng], 13);
        }
      }
    });
  }

  // 5. Tactical Layer Visibility Toggles (3D Cesium & 2D Leaflet)
  if ($("layer-toggle-trail")) {
    $("layer-toggle-trail").addEventListener("change", (e) => {
      state.sim.showTrail = e.target.checked;
      if (state.mapLayers.trailLine) {
        if (e.target.checked) state.map.addLayer(state.mapLayers.trailLine);
        else state.map.removeLayer(state.mapLayers.trailLine);
      }
      if (state.cesiumViewer && state.cesiumViewer.scene) state.cesiumViewer.scene.requestRender();
    });
  }
  if ($("layer-toggle-future")) {
    $("layer-toggle-future").addEventListener("change", (e) => {
      state.sim.showFuturePath = e.target.checked;
      if (state.cesiumViewer && state.cesiumViewer.scene) state.cesiumViewer.scene.requestRender();
    });
  }
  if ($("layer-toggle-model")) {
    $("layer-toggle-model").addEventListener("change", (e) => {
      state.sim.showModel = e.target.checked;
      if (state.cesiumViewer && state.cesiumViewer.scene) state.cesiumViewer.scene.requestRender();
    });
  }
  if ($("layer-toggle-wind")) {
    $("layer-toggle-wind").addEventListener("change", (e) => {
      state.sim.showWindVector = e.target.checked;
      if (state.cesiumViewer && state.cesiumViewer.scene) state.cesiumViewer.scene.requestRender();
    });
  }
  if ($("layer-toggle-mc")) {
    $("layer-toggle-mc").addEventListener("change", (e) => {
      state.sim.showMonteCarlo = e.target.checked;
      if (state.mapLayers.mcSamplesLayer) {
        if (e.target.checked) state.map.addLayer(state.mapLayers.mcSamplesLayer);
        else state.map.removeLayer(state.mapLayers.mcSamplesLayer);
      }
    });
  }
  if ($("layer-toggle-ellipse")) {
    $("layer-toggle-ellipse").addEventListener("change", (e) => {
      state.sim.showEllipse = e.target.checked;
      if (state.mapLayers.ellipsePolygon) {
        if (e.target.checked) state.map.addLayer(state.mapLayers.ellipsePolygon);
        else state.map.removeLayer(state.mapLayers.ellipsePolygon);
      }
      if (state.cesiumViewer && state.cesiumViewer.scene) state.cesiumViewer.scene.requestRender();
    });
  }
  if ($("layer-toggle-nogo")) {
    $("layer-toggle-nogo").addEventListener("change", (e) => {
      state.sim.showNoGo = e.target.checked;
      if (state.mapLayers.noGoCircle) {
        if (e.target.checked) state.map.addLayer(state.mapLayers.noGoCircle);
        else state.map.removeLayer(state.mapLayers.noGoCircle);
      }
      if (state.cesiumViewer && state.cesiumViewer.scene) state.cesiumViewer.scene.requestRender();
    });
  }

  // 6. Prediction Copy & Inputs
  if ($("copy-pred-coords-btn")) {
    $("copy-pred-coords-btn").addEventListener("click", () => {
      if (Number.isFinite(state.prediction.lat)) {
        const str = `${state.prediction.lat.toFixed(6)}, ${state.prediction.lng.toFixed(6)}`;
        navigator.clipboard.writeText(str);
        showToast("COPIED TO CLIPBOARD", str, "nominal");
      }
    });
  }

  if ($("input-ground-elev")) {
    $("input-ground-elev").addEventListener("input", (e) => {
      state.settings.groundElevationM = Number(e.target.value) || 0;
      if ($("pred-ground-elev-label")) $("pred-ground-elev-label").textContent = `GND: ${state.settings.groundElevationM}m MSL`;
      runLandingPrediction();
    });
  }

  if ($("input-mc-runs")) {
    $("input-mc-runs").addEventListener("input", (e) => {
      const val = Number(e.target.value);
      state.settings.mcRuns = val;
      if ($("label-mc-runs")) $("label-mc-runs").textContent = val;
      runLandingPrediction();
    });
  }

  // 7. Sound Toggle
  if ($("sound-toggle-btn")) {
    $("sound-toggle-btn").addEventListener("click", () => {
      state.settings.soundAlerts = !state.settings.soundAlerts;
      if ($("sound-icon-on")) $("sound-icon-on").classList.toggle("hidden", !state.settings.soundAlerts);
      if ($("sound-icon-off")) $("sound-icon-off").classList.toggle("hidden", state.settings.soundAlerts);
      showToast("AUDIO ALERTS", state.settings.soundAlerts ? "Enabled" : "Muted", "info");
    });
  }

  // 8. No-Go Zone Inputs
  if ($("setting-nogo-enable")) {
    $("setting-nogo-enable").addEventListener("change", (e) => {
      state.settings.noGoZone.enabled = e.target.checked;
      updateNoGoMapCircle();
      runLandingPrediction();
    });
  }
  if ($("nogo-lat")) $("nogo-lat").addEventListener("input", updateNoGoInputs);
  if ($("nogo-lng")) $("nogo-lng").addEventListener("input", updateNoGoInputs);
  if ($("nogo-radius")) $("nogo-radius").addEventListener("input", updateNoGoInputs);

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
            color: "#E47777",
            weight: 1.5,
            dashArray: "4, 6",
            fillColor: "#E47777",
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

  // 9. Replay Mode Buttons
  if ($("btn-mode-live")) $("btn-mode-live").addEventListener("click", stopReplayMode);
  if ($("btn-mode-replay")) $("btn-mode-replay").addEventListener("click", startReplayMode);

  const speedBtns = document.querySelectorAll(".replay-speed-row [data-speed]");
  speedBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      speedBtns.forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");
      state.replay.speed = Number(e.target.dataset.speed);
      if ($("replay-speed-label")) $("replay-speed-label").textContent = `${state.replay.speed}x`;
    });
  });

  if ($("btn-replay-pause")) {
    $("btn-replay-pause").addEventListener("click", (e) => {
      state.replay.paused = !state.replay.paused;
      e.target.textContent = state.replay.paused ? "RESUME" : "PAUSE";
      if (!state.replay.paused) scheduleReplayStep();
    });
  }

  if ($("replay-timeline-slider")) {
    $("replay-timeline-slider").addEventListener("input", (e) => {
      const idx = Number(e.target.value);
      state.replay.index = idx;
      if (state.history[idx]) {
        ingestTelemetryPacket(state.history[idx], false);
        if ($("replay-timeline-label")) $("replay-timeline-label").textContent = `${idx + 1} / ${state.history.length}`;
      }
    });
  }

  // 10. Simulator Triggers
  const simTriggers = ["load-demo-sim-btn", "empty-launch-sim-btn", "empty-launch-sim-btn-modal", "drawer-launch-sim-btn"];
  simTriggers.forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("click", launchDemoSimulation);
  });

  // 11. Data Exports
  if ($("btn-export-csv")) $("btn-export-csv").addEventListener("click", exportCsv);
  if ($("btn-export-gpx")) $("btn-export-gpx").addEventListener("click", exportGpx);
  if ($("btn-export-geojson")) $("btn-export-geojson").addEventListener("click", exportGeoJson);

  // 12. Clear Events
  if ($("clear-events-btn")) {
    $("clear-events-btn").addEventListener("click", () => {
      state.events = [];
      if ($("events-log-container")) $("events-log-container").innerHTML = "";
    });
  }

  // 13. Emergency Focus
  if ($("emergency-focus-btn")) {
    $("emergency-focus-btn").addEventListener("click", () => {
      switchWorkspaceView("trajectory");
      if (state.liveTelemetry && state.map) {
        state.map.setView([state.liveTelemetry.lat, state.liveTelemetry.lng], 12);
      }
    });
  }

  if ($("dismiss-setup-btn")) {
    $("dismiss-setup-btn").addEventListener("click", () => {
      if ($("setup-banner")) $("setup-banner").classList.add("hidden");
    });
  }

  // 14. 3D Globe vs 2D Map toggles & camera presets & altitude scaling
  if ($("btn-mode-3d")) {
    $("btn-mode-3d").addEventListener("click", () => setMapDisplayMode("3d"));
  }
  if ($("btn-mode-2d")) {
    $("btn-mode-2d").addEventListener("click", () => setMapDisplayMode("2d"));
  }
  if ($("cam-preset-global")) {
    $("cam-preset-global").addEventListener("click", () => flyToGlobalView(true));
  }
  if ($("cam-preset-mission")) {
    $("cam-preset-mission").addEventListener("click", () => flyToMissionView(true));
  }
  if ($("cam-preset-recovery")) {
    $("cam-preset-recovery").addEventListener("click", () => flyToRecoveryView(true));
  }
  if ($("select-alt-scale")) {
    $("select-alt-scale").addEventListener("change", (e) => {
      const mult = parseFloat(e.target.value) || 1.0;
      state.altitudeMultiplier = mult;
      const tag = $("globe-status-tag");
      if (tag) {
        tag.textContent = mult === 1 ? "WGS84 ELLIPSOID · ESRI SATELLITE (1:1)" : `WGS84 · ${mult.toFixed(1)}x EXAGGERATED`;
      }
      if (state.cesiumViewer && state.cesiumViewer.scene) {
        state.cesiumViewer.scene.requestRender();
      }
    });
  }

  // 15. Authoritative 3D Flight Simulation Controller Dock Listeners
  if ($("btn-sim-restart")) $("btn-sim-restart").addEventListener("click", restartSimulation);
  if ($("btn-sim-step-back")) $("btn-sim-step-back").addEventListener("click", () => stepSimulation(-5));
  if ($("btn-sim-play-pause")) $("btn-sim-play-pause").addEventListener("click", toggleSimPlayPause);
  if ($("btn-sim-step-forward")) $("btn-sim-step-forward").addEventListener("click", () => stepSimulation(5));

  if ($("sim-timeline-slider")) {
    $("sim-timeline-slider").addEventListener("input", (e) => {
      const frac = Number(e.target.value) / 1000;
      seekSimToFraction(frac);
    });
  }

  const simSpeedBtns = document.querySelectorAll(".sim-speeds-bar .btn-sim-speed");
  simSpeedBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      setSimSpeed(e.target.dataset.speed);
    });
  });

  const simCamBtns = document.querySelectorAll(".sim-cameras-bar .btn-sim-cam");
  simCamBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      setSimCameraMode(e.target.dataset.cam);
    });
  });

  if ($("btn-sim-reset-cam")) {
    $("btn-sim-reset-cam").addEventListener("click", () => flyToMissionView(true));
  }

  if ($("btn-scale-physical")) {
    $("btn-scale-physical").addEventListener("click", () => setSimScaleMode("physical", 1.0));
  }
  if ($("btn-scale-enhanced")) {
    $("btn-scale-enhanced").addEventListener("click", () => setSimScaleMode("enhanced", state.sim.scaleMultiplier));
  }
  if ($("select-enhanced-mult")) {
    $("select-enhanced-mult").addEventListener("change", (e) => {
      setSimScaleMode("enhanced", Number(e.target.value));
    });
  }

  // 16. Keyboard Hotkeys (Space, ArrowLeft, ArrowRight, Home, 1-4)
  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) {
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      toggleSimPlayPause();
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      stepSimulation(-5);
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      stepSimulation(5);
    } else if (e.code === "Home") {
      e.preventDefault();
      restartSimulation();
    } else if (e.key === "1") {
      setSimCameraMode("orbit");
    } else if (e.key === "2") {
      setSimCameraMode("follow");
    } else if (e.key === "3") {
      setSimCameraMode("chase");
    } else if (e.key === "4") {
      setSimCameraMode("ground");
    }
  });

  // 17. Pause simulation when browser tab is inactive / backgrounded
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.sim.active && !state.sim.paused) {
      pauseSimulation();
    }
  });
}

/* ============================================================================
 * SECTION 13: INITIALIZATION PIPELINE
 * ============================================================================ */

function init() {
  runSelfTests();
  initMap();
  if (window.Cesium) {
    initCesiumGlobe();
  } else {
    window.addEventListener("load", () => {
      if (window.Cesium && !state.cesiumViewer) initCesiumGlobe();
    });
  }
  initChart();
  initCutdownGuardedFlow();
  initUIListeners();
  startLinkHealthMonitor();
  initFirebase();
}

// Expose simulation API globally for automation and headless verification
window.initFlightSimulation = initFlightSimulation;
window.startSimulation = startSimulation;
window.playSimulation = playSimulation;
window.pauseSimulation = pauseSimulation;
window.toggleSimPlayPause = toggleSimPlayPause;
window.restartSimulation = restartSimulation;
window.stepSimulation = stepSimulation;
window.seekSimToTime = seekSimToTime;
window.seekSimToFraction = seekSimToFraction;
window.setSimSpeed = setSimSpeed;
window.setSimCameraMode = setSimCameraMode;
window.setSimScaleMode = setSimScaleMode;
window.getSimInterpolatedState = getSimInterpolatedState;
window.launchDemoSimulation = launchDemoSimulation;

// Window load trigger
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
