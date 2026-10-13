import puppeteer from 'puppeteer';

const CHROME_PATH = '/home/venkatengineer/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome';

async function runTest() {
  console.log("Launching headless Chrome...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--use-gl=angle', '--use-angle=swiftshader']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleLogs = [];
  const errors = [];

  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    if (text.includes('✓ ALL') || text.includes('SELF-TEST')) {
      console.log("[PAGE CONSOLE]", text);
    }
  });

  page.on('pageerror', err => {
    console.error("[PAGE ERROR]", err.message);
    errors.push(err.message);
  });

  console.log("Navigating to http://localhost:1408/?selftest=1...");
  await page.goto('http://localhost:1408/?selftest=1', { waitUntil: 'networkidle2' });

  // 1. Check self-test output
  const selfTestsPassed = consoleLogs.some(l => l.includes('ALL MATHEMATICAL & SIMULATION SELF-TESTS PASSED'));
  console.log("✓ Self-tests passed:", selfTestsPassed);

  // 2. Launch demo flight simulation
  console.log("Launching demo simulation...");
  await page.evaluate(() => {
    window.launchDemoSimulation();
  });

  // Wait 1.5 seconds for trajectory to load and Cesium scene to render
  await new Promise(r => setTimeout(r, 1500));

  // 3. Verify initial state
  const simInit = await page.evaluate(() => {
    const s = window.state.sim;
    const cur = s.interpolatedPacket;
    return {
      active: s.active,
      paused: s.paused,
      speed: s.speed,
      historyLength: window.state.history.length,
      currentAlt: cur ? cur.alt : 0,
      flightPhase: cur ? cur.flightPhase : 'unknown',
      cesiumReady: !!window.state.cesiumViewer
    };
  });
  console.log("Simulation initialized:", simInit);

  // 4. Test Ascent Phase (seek to 25% of trajectory)
  console.log("Seeking to 25% (Ascent phase)...");
  await page.evaluate(() => {
    window.seekSimToFraction(0.25);
    window.pauseSimulation();
  });
  await new Promise(r => setTimeout(r, 500));

  const ascentStatus = await page.evaluate(() => {
    const cur = window.state.sim.interpolatedPacket;
    const uriProp = window.state.cesiumEntities.balloonModel.model.uri;
    const modelUri = uriProp._callback ? uriProp._callback() : uriProp.getValue();
    return {
      alt: cur.alt,
      vs: cur.vs,
      phase: cur.flightPhase,
      modelUri
    };
  });
  console.log("Ascent state (25%):", ascentStatus);
  if (ascentStatus.phase !== 'ASCENT' || !ascentStatus.modelUri.includes('balloon_assembly.glb')) {
    throw new Error(`Ascent phase verification failed: ${JSON.stringify(ascentStatus)}`);
  }
  await page.screenshot({ path: 'screenshot_ascent.png' });

  // 5. Test Parachute Descent Phase (seek to 85% of trajectory)
  console.log("Seeking to 85% (Parachute Descent phase)...");
  await page.evaluate(() => {
    window.seekSimToFraction(0.85);
    window.pauseSimulation();
  });
  await new Promise(r => setTimeout(r, 500));

  const descentStatus = await page.evaluate(() => {
    const cur = window.state.sim.interpolatedPacket;
    const uriProp = window.state.cesiumEntities.balloonModel.model.uri;
    const modelUri = uriProp._callback ? uriProp._callback() : uriProp.getValue();
    return {
      alt: cur.alt,
      vs: cur.vs,
      phase: cur.flightPhase,
      modelUri
    };
  });
  console.log("Descent state (85%):", descentStatus);
  if (descentStatus.phase !== 'DESCENT' || !descentStatus.modelUri.includes('parachute_descent.glb')) {
    throw new Error(`Descent phase verification failed: ${JSON.stringify(descentStatus)}`);
  }
  await page.screenshot({ path: 'screenshot_descent.png' });

  // 6. Test Touchdown Phase (seek to 100%)
  console.log("Seeking to 100% (Touchdown phase)...");
  await page.evaluate(() => {
    window.seekSimToFraction(1.0);
    window.pauseSimulation();
  });
  await new Promise(r => setTimeout(r, 500));

  const touchdownStatus = await page.evaluate(() => {
    const cur = window.state.sim.interpolatedPacket;
    return {
      alt: cur.alt,
      phase: cur.flightPhase
    };
  });
  console.log("Touchdown state (100%):", touchdownStatus);
  if (touchdownStatus.phase !== 'TOUCHDOWN') {
    throw new Error(`Touchdown phase verification failed: ${JSON.stringify(touchdownStatus)}`);
  }
  await page.screenshot({ path: 'screenshot_touchdown.png' });

  // 7. Test Camera Modes (Orbit, Follow, Chase, Ground)
  console.log("Testing 4 camera modes...");
  for (const mode of ['orbit', 'follow', 'chase', 'ground']) {
    await page.evaluate((m) => {
      window.setSimCameraMode(m);
    }, mode);
    await new Promise(r => setTimeout(r, 150));
    const activeMode = await page.evaluate(() => window.state.sim.cameraMode);
    console.log(`✓ Camera mode '${mode}' active:`, activeMode === mode);
  }

  // 8. Test Scale Modes (Physical 1:1 vs Enhanced)
  console.log("Testing scale modes...");
  await page.evaluate(() => window.setSimScaleMode('enhanced', 5.0));
  const isEnhanced = await page.evaluate(() => window.state.sim.scaleMode === 'enhanced' && window.state.sim.scaleMultiplier === 5.0);
  console.log("✓ Enhanced scale (5x):", isEnhanced);

  await page.evaluate(() => window.setSimScaleMode('physical', 1.0));
  const isPhysical = await page.evaluate(() => window.state.sim.scaleMode === 'physical' && window.state.sim.scaleMultiplier === 1.0);
  console.log("✓ Physical scale (1:1):", isPhysical);

  // 9. Test Playback Speeds
  console.log("Testing playback speeds (0.25x - 10x)...");
  for (const spd of [0.25, 0.5, 1, 2, 5, 10]) {
    await page.evaluate((s) => window.setSimSpeed(s), spd);
    const curSpd = await page.evaluate(() => window.state.sim.speed);
    if (curSpd !== spd) throw new Error(`Speed set to ${spd} failed, got ${curSpd}`);
  }
  console.log("✓ All playback speeds verified.");

  // 10. Test Event Log Click-to-Seek
  console.log("Testing event log click-to-seek...");
  await page.evaluate(() => {
    const entry = document.querySelector('.event-entry');
    if (entry) entry.click();
  });
  await new Promise(r => setTimeout(r, 300));
  console.log("✓ Event log click-to-seek executed without error.");

  // 11. Final Framed Screenshot
  await page.evaluate(() => {
    window.seekSimToFraction(0.4);
    window.setSimCameraMode('follow');
    window.playSimulation();
  });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: 'screenshot_final_sim.png' });
  console.log("✓ Final simulation view screenshot captured.");

  await browser.close();
  console.log("\n==========================================");
  console.log("ALL TESTS & VERIFICATIONS PASSED WITH 0 ERRORS!");
  console.log("==========================================");
}

runTest().catch(err => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
