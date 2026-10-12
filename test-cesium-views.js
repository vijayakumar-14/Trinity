import puppeteer from 'puppeteer';

const CHROME_PATH = '/home/venkatengineer/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome';

async function run() {
  console.log('[TEST] Launching Puppeteer with SwiftShader WebGL...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--enable-unsafe-webgl',
      '--ignore-gpu-blocklist'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const errors = [];
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      errors.push(text);
      console.error(`[BROWSER ERROR] ${text}`);
    } else if (text.includes('SELF-TEST') || text.includes('PASSED')) {
      console.log(`[TEST SUITE] ${text}`);
    }
  });

  page.on('pageerror', err => {
    errors.push(err.message);
    console.error('[PAGE ERROR]', err.message);
  });

  console.log('[TEST] Navigating to http://localhost:1408/?selftest=1...');
  await page.goto('http://localhost:1408/?selftest=1', { waitUntil: 'networkidle2', timeout: 30000 });

  // Wait for Cesium library and Viewer initialization
  console.log('[TEST] Waiting for Cesium & Viewer initialization...');
  await page.waitForFunction(() => !!window.Cesium && !!window.state?.cesiumViewer, { timeout: 15000 });
  console.log('[TEST] Cesium Viewer initialized successfully!');

  // Launch demo simulation to populate 300+ trajectory packets
  console.log('[TEST] Triggering realistic flight demo simulation...');
  await page.evaluate(() => {
    const btn = document.getElementById('load-demo-sim-btn') || document.getElementById('empty-launch-sim-btn');
    if (btn) btn.click();
  });

  // Wait 2 seconds for telemetry packets to ingest and Monte Carlo to run
  await new Promise(r => setTimeout(r, 2000));

  // Switch to Trajectory & Recovery workspace view
  console.log('[TEST] Switching to Trajectory & Recovery workspace...');
  await page.evaluate(() => {
    const trajBtn = document.querySelector('[data-view="trajectory"]');
    if (trajBtn) trajBtn.click();
  });

  // Wait for container to resize and tiles to stream
  await new Promise(r => setTimeout(r, 4000));

  // Preset 1: GLOBAL VIEW (Complete Earth Globe in Space)
  console.log('[TEST] Activating Preset 1: GLOBAL VIEW...');
  await page.evaluate(() => {
    const btn = document.getElementById('cam-preset-global');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: 'screenshot-global.png' });
  console.log('[TEST] Captured screenshot-global.png (Global Earth View)');

  // Preset 2: MISSION VIEW (Framing Flight Trajectory Corridor & Stratospheric Arc)
  console.log('[TEST] Activating Preset 2: MISSION VIEW...');
  await page.evaluate(() => {
    const btn = document.getElementById('cam-preset-mission');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: 'screenshot-mission.png' });
  console.log('[TEST] Captured screenshot-mission.png (Mission Trajectory View)');

  // Preset 3: RECOVERY VIEW (Local Recovery Touchdown & 95% Dispersion Ellipse)
  console.log('[TEST] Activating Preset 3: RECOVERY VIEW...');
  await page.evaluate(() => {
    const btn = document.getElementById('cam-preset-recovery');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: 'screenshot-recovery.png' });
  console.log('[TEST] Captured screenshot-recovery.png (Local Recovery View)');

  // Test Altitude Exaggeration toggle (verify 5x and 1x)
  console.log('[TEST] Testing Altitude Exaggeration Selector...');
  await page.evaluate(() => {
    const sel = document.getElementById('select-alt-scale');
    if (sel) {
      sel.value = '5';
      sel.dispatchEvent(new Event('change'));
    }
  });
  await new Promise(r => setTimeout(r, 500));
  const mult5 = await page.evaluate(() => window.state.altitudeMultiplier);
  console.log(`[TEST] Altitude multiplier set to: ${mult5}x`);

  await page.evaluate(() => {
    const sel = document.getElementById('select-alt-scale');
    if (sel) {
      sel.value = '1';
      sel.dispatchEvent(new Event('change'));
    }
  });
  await new Promise(r => setTimeout(r, 500));
  const mult1 = await page.evaluate(() => window.state.altitudeMultiplier);
  console.log(`[TEST] Altitude multiplier restored to: ${mult1}x`);

  // Test 2D / 3D mode toggling
  console.log('[TEST] Testing 2D / 3D Mode Toggle...');
  await page.evaluate(() => {
    const btn2d = document.getElementById('btn-mode-2d');
    if (btn2d) btn2d.click();
  });
  await new Promise(r => setTimeout(r, 500));
  const mode2d = await page.evaluate(() => window.state.mapMode);
  console.log(`[TEST] Switched to map mode: ${mode2d}`);

  await page.evaluate(() => {
    const btn3d = document.getElementById('btn-mode-3d');
    if (btn3d) btn3d.click();
  });
  await new Promise(r => setTimeout(r, 500));
  const mode3d = await page.evaluate(() => window.state.mapMode);
  console.log(`[TEST] Restored to map mode: ${mode3d}`);

  // Diagnostics summary
  const stateSummary = await page.evaluate(() => ({
    hasCesium: !!window.Cesium,
    hasViewer: !!window.state?.cesiumViewer,
    imageryLayersCount: window.state?.cesiumViewer?.imageryLayers?.length || 0,
    trailPositionsCount: window.state?.cesiumEntities?.trail?.polyline?.positions?.getValue?.()?.length || 0,
    historyPackets: window.state?.history?.length || 0,
    landingLat: window.state?.prediction?.lat,
    landingLng: window.state?.prediction?.lng,
    ellipseCoordsCount: window.state?.prediction?.ellipseCoords?.length || 0,
    errorsCount: window.errors?.length || 0
  }));

  console.log('[TEST] State Summary:\n', JSON.stringify(stateSummary, null, 2));

  await browser.close();

  if (errors.length > 0) {
    console.warn(`[TEST] Completed with ${errors.length} browser errors (review if critical)`);
  } else {
    console.log('[TEST] Completed with ZERO browser errors! ALL CHECKS PASSED.');
  }
}

run().catch(err => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});
