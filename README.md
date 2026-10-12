# AERODRIFT 🎈

**Stratospheric Balloon Tracking & Landing Prediction Dashboard**  
A zero-build, static aerospace mission-control and flight-analysis platform designed for high-altitude balloon tracking, stratospheric envelope burst detection, and client-side Monte Carlo landing zone prediction.

### 🛰️ Subsystem Workspaces
1. **Overview**: Live telemetry ribbon, integrated altitude trajectory profile, atmospheric synopsis, recovery forecast, and mission chronology.
2. **Flight Analysis**: High-resolution multi-series plotting, atmospheric lapse rate ($T$ vs $Z$), barometric pressure ($P$ vs $Z$), horizontal wind sounding ($V_w$ vs $Z$), and 500m discretized sounding table.
3. **Trajectory & Recovery**: CARTO Dark Matter geospatial map, 300-run Monte Carlo landing scatter cloud, 95% confidence covariance dispersion ellipse ($k=2.448$), and ground retrieval dossier.
4. **Avionics**: Artificial horizon attitude indicator, 3-axis accelerometer and gyroscope engineering meters, wind drift compass rose, and GNSS/RF link telemetry.
5. **Mission Operations**: Chronological event audit stream, guarded nichrome wire cutdown actuation console (5-second hold interlock), and restricted airspace (No-Go) monitoring.
6. **Replay & Export**: Historical trajectory playback scrubber (1x to 20x speeds), built-in 30km flight simulator, and scientific data exports (CSV, GPX 1.1, GeoJSON).

---

## 🚀 Quick Start & Firebase Configuration

### 1. Paste Your Firebase Credentials
Open [`firebase-config.js`](./firebase-config.js) and paste the web app config from **Firebase Console → Project Settings → General → SDK setup and configuration**:

```javascript
export const firebaseConfig = {
  apiKey: "AIzaSyYourActualApiKeyHere",
  authDomain: "your-project-id.firebaseapp.com",
  databaseURL: "https://your-project-id-default-rtdb.firebaseio.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};
```

---

## 🔒 Firebase Realtime Database Rules

In your Firebase Console, navigate to **Realtime Database → Rules** and paste the following rules:

```json
{
  "rules": {
    "aerodrift": {
      ".read": true,
      "live": {
        ".write": true
      },
      "history": {
        ".write": true
      },
      "commands": {
        "cutdown": {
          ".write": true
        }
      }
    }
  }
}
```

> ⚠️ **Flight Safety Note:** For hackathons and bench testing, these rules allow rapid telemetry ingestion. Prior to actual operational stratospheric flight, implement Firebase Authentication and restrict `aerodrift/commands/cutdown` write permissions to authenticated launch director accounts with signed auth tokens.

---

## 🛰️ Mock Telemetry Writer Script

Use this mock generator to simulate realistic flight telemetry (Ascent from Rajalakshmi Engineering College Chennai to 30.5 km, envelope burst, and parachute descent) before hardware is connected.

You can paste this directly into your browser developer console while on the site, or run it in Node.js:

```javascript
// ============================================================================
// AERODRIFT Flight Telemetry Simulator (Node.js or Browser Console)
// ============================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, push } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

async function simulateFlight() {
  console.log("🚀 Starting AeroDrift Flight Simulation...");

  // Launch coordinates: REC Chennai (13.0827°N, 80.2707°E, 25m MSL)
  let lat = 13.0827;
  let lng = 80.2707;
  let alt = 25.0;
  let seq = 1;
  let apogee = 0;
  let phase = "ascent";

  const liveRef = ref(db, "aerodrift/live");
  const historyRef = ref(db, "aerodrift/history");

  const interval = setInterval(async () => {
    const now = Date.now();

    if (phase === "ascent") {
      alt += 15.0 + Math.random() * 5.0; // ~5 m/s climb
      if (alt > apogee) apogee = alt;

      // Jet stream drift eastward into Bay of Bengal
      const speed = 12.0 + (alt / 1000) * 0.8;
      const course = 86.0 + Math.sin(seq / 10) * 8.0;

      lat += (speed * Math.cos(course * Math.PI / 180) * 1.5) / 111320;
      lng += (speed * Math.sin(course * Math.PI / 180) * 1.5) / (111320 * Math.cos(lat * Math.PI / 180));

      // Burst condition at 30,200m
      if (alt >= 30200) {
        phase = "descent";
        console.log(`💥 Envelope burst triggered at ${alt.toFixed(1)}m!`);
      }
    } else {
      // Parachute descent
      alt -= 25.0 + Math.random() * 8.0; // ~12 m/s descent
      const speed = 18.0 + Math.random() * 4.0;
      const course = 105.0;

      lat += (speed * Math.cos(course * Math.PI / 180) * 1.5) / 111320;
      lng += (speed * Math.sin(course * Math.PI / 180) * 1.5) / (111320 * Math.cos(lat * Math.PI / 180));

      if (alt <= 0) {
        alt = 0;
        clearInterval(interval);
        console.log("🪂 Touchdown recorded! Simulation complete.");
      }
    }

    // Atmosphere baro & temp physics
    const temp = Math.max(-58.0, 32.0 - (alt / 1000) * 6.5);
    const pressure = 1013.25 * Math.exp(-alt / 7200);

    const packet = {
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      alt: Number(alt.toFixed(1)),
      pressure: Number(pressure.toFixed(1)),
      temp: Number(temp.toFixed(1)),
      gps_speed: Number((14.0 + Math.random() * 6).toFixed(1)),
      gps_course: Number((92.0 + Math.random() * 8).toFixed(1)),
      sats: 10,
      hdop: 0.9,
      ax: Number((Math.random() * 0.08 - 0.04).toFixed(3)),
      ay: Number((Math.random() * 0.08 - 0.04).toFixed(3)),
      az: Number((9.81 + Math.random() * 0.1).toFixed(2)),
      gx: Number((Math.random() * 0.4 - 0.2).toFixed(1)),
      gy: Number((Math.random() * 0.4 - 0.2).toFixed(1)),
      gz: Number((Math.random() * 0.4 - 0.2).toFixed(1)),
      roll: Number((Math.random() * 4 - 2).toFixed(1)),
      pitch: Number((Math.random() * 3 - 1.5).toFixed(1)),
      rssi: -65 - Math.floor((alt / 30000) * 18),
      packet_seq: seq++,
      packets_lost: Math.floor(seq / 150),
      cutdown_state: phase === "descent" ? "fired" : "armed",
      ts: now
    };

    // Write to Firebase
    await set(liveRef, packet);
    await push(historyRef, packet);
    console.log(`[PKT #${packet.packet_seq}] Alt: ${packet.alt}m | Lat: ${packet.lat}° | Lng: ${packet.lng}°`);
  }, 1500);
}

simulateFlight();
```

> 💡 **Quick Hackathon Demo:** You can also click **"Launch Full Flight Simulation"** directly on the dashboard screen or in the settings drawer to test without writing to Firebase.

---

## ⚡ Deployment to Vercel

AeroDrift is built as a pure static web app with zero dependencies and no build step.

### Method 1: Vercel CLI
```bash
npm i -g vercel
vercel deploy --prod
```

### Method 2: Git Integration
1. Push this folder to a GitHub repository.
2. Go to [vercel.com](https://vercel.com) and click **"Add New Project"**.
3. Import the repository.
4. Leave **Build Command** and **Output Directory** empty (Framework Preset: **Other**).
5. Click **Deploy**.

---

## 🧪 Self-Test Verification Suite

To run the automated internal mathematical verification tests (Haversine distance, destination vector integration, wind decomposition, 2x2 eigen-decomposition covariance), append `?selftest=1` to the URL:

```
http://localhost:3000/?selftest=1
```

Check the browser console (`F12 → Console`) to verify that all mathematical invariants pass.
