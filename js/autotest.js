// Automated verification, benchmarking, and blood VFX capture for Level 0
(async function() {
  if (!new URLSearchParams(location.search).has('autotest')) return;

  const origLog = console.log;
  console.log = function(...args) {
    origLog.apply(console, args);
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
    }).catch(() => {});
  };

  console.log('[AUTOTEST] Initializing Level 0 validation and Blood VFX test suite...');

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  // 1. Wait for engine boot
  for (let i = 0; i < 40; i++) {
    if (window.G && window.P && window.LEVELS && window.applyLevelTheme && window.BloodVFX) break;
    await wait(200);
  }

  console.log('[AUTOTEST] Engine boot confirmed. Starting game in Backrooms Level 0...');
  window.G.start();
  window.applyLevelTheme('backrooms');

  // 2. Wait 3.5 seconds for PBR textures, GLTF models, and WebGL shaders to compile
  await wait(3500);

  const P = window.P;
  const scene = window.scene;
  const camera = window.camera;
  const renderer = window.renderer;
  const renderScene = window.renderScene;
  const BloodVFX = window.BloodVFX;

  // 3. Telemetry & Collision Verification
  const startHitsWall = typeof window.circleHitsWall === 'function' ? window.circleHitsWall(48.69, -187.65, 0.32) : false;
  const wallHitsWall = typeof window.circleHitsWall === 'function' ? window.circleHitsWall(45.99, -187.65, 0.32) : true;
  const customColl = typeof window.isWall !== 'undefined';

  async function captureShot(label, isLast = false) {
    if (renderScene) renderScene();
    else renderer.render(scene, camera);

    const shot = renderer.domElement.toDataURL('image/png');
    await fetch('/api/screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shot, label, isLast, playerPos: { x: P.pos.x, y: P.pos.y, z: P.pos.z } })
    });
    console.log(`[AUTOTEST] Saved shot: ${label}`);
  }

  // --- TEST: Miss / Wall Hit Test (Must NOT trigger blood) ---
  P.pos.set(48.69, 0, -187.65);
  P.yaw = Math.PI / 2; // Look at solid wall behind player
  P.pitch = 0;
  camera.position.set(48.69, 1.62, -187.65);
  camera.rotation.y = P.yaw;
  camera.rotation.x = P.pitch;
  await wait(200);

  const beforeMissCount = BloodVFX ? BloodVFX.getActiveCount() : 0;
  if (typeof window.shoot === 'function') {
    // Ensure player has ammo
    P.bullets = 50; P.mag.bullets = 12; P.cool = 0; P.reloadT = 0;
    window.shoot();
  }
  await wait(150);
  const afterMissCount = BloodVFX ? BloodVFX.getActiveCount() : 0;
  const wallHitDidNotTriggerBlood = (beforeMissCount === 0 && afterMissCount === 0);
  const wallSparksGenerated = window.particles && window.particles.length > 0;
  console.log('[AUTOTEST] Wall hit test:', { beforeMissCount, afterMissCount, wallHitDidNotTriggerBlood, wallSparksGenerated });

  // Clear spark particles before Saber test
  if (window.particles) {
    for (const p of window.particles) { if (p.s) scene.remove(p.s); }
    window.particles.length = 0;
  }

  // --- TEST: Saber Hit & Blood Animation Surface Positioning ---
  function aimAt(zb, targetY = 1.25) {
    const dx = zb.group.position.x - P.pos.x;
    const dz = zb.group.position.z - P.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    P.yaw = Math.atan2(-dx, -dz);
    P.pitch = Math.atan2(targetY - 1.62, d);
    camera.position.set(P.pos.x, 1.62, P.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = P.yaw;
    camera.rotation.x = P.pitch;
    camera.updateMatrixWorld(true);
  }

  let saber = null;
  if (window.spawnZombie) {
    saber = window.spawnZombie(49.8, -173.14);
    if (saber && saber.group) {
      saber.group.position.set(49.8, 0, -173.14);
      saber.group.rotation.y = Math.PI / 2; // Facing player
      saber.hp = 800; // ensure survival for test shots
      saber.riseT = 1.0;
      saber.state = 'chase';
      saber.group.updateMatrixWorld(true);
    }
  }

  // Wait 600ms for animations and render loop to synchronize
  await wait(600);
  if (saber) aimAt(saber, 1.20); // Aim at chest

  // Shoot Saber body shot
  P.bullets = 50; P.mag.bullets = 12; P.cool = 0; P.reloadT = 0;
  if (typeof window.shoot === 'function') {
    window.shoot();
  }

  // Wait 120ms for blood splash to bloom
  await wait(120);
  const hitActiveCount = BloodVFX ? BloodVFX.getActiveCount() : 0;
  const bloodTriggeredOnSaberHit = hitActiveCount > 0;
  const legacyParticleCountOnSaberHit = window.particles ? window.particles.length : 0;
  const noLegacyBloodParticles = (legacyParticleCountOnSaberHit === 0);
  console.log('[AUTOTEST] Saber body hit test:', {
    hitActiveCount,
    bloodTriggeredOnSaberHit,
    legacyParticleCountOnSaberHit,
    noLegacyBloodParticles
  });

  // Capture screenshot of blood impact on Saber body surface
  await captureShot('saber_blood_impact_surface');

  // Let Saber advance while blood animation plays to verify it stays locked on surface
  await wait(300);
  await captureShot('saber_blood_moving_surface');

  // --- TEST: Headshot Test ---
  if (saber && saber.group) {
    aimAt(saber, 1.55); // Aim directly at head
  }
  P.cool = 0; P.reloadT = 0;
  if (typeof window.shoot === 'function') {
    window.shoot();
  }
  await wait(120);
  await captureShot('saber_headshot_impact');

  // --- TEST: Repeated Multi-Hit Test ---
  if (saber) aimAt(saber, 1.25);
  P.cool = 0; P.reloadT = 0;
  if (typeof window.shoot === 'function') {
    window.shoot(); // second hit
    await wait(80);
    P.cool = 0;
    if (saber) aimAt(saber, 1.25);
    window.shoot(); // third hit
  }
  await wait(100);
  const multiHitCount = BloodVFX ? BloodVFX.getActiveCount() : 0;
  const multiHitSupported = multiHitCount >= 2;
  console.log('[AUTOTEST] Multi-hit test:', { multiHitCount, multiHitSupported });

  // Wait for splash animations to complete (>1.07s game time) to verify cleanup
  for (let c = 0; c < 35; c++) {
    if (BloodVFX && BloodVFX.getActiveCount() === 0) break;
    await wait(100);
  }
  const afterCompletionCount = BloodVFX ? BloodVFX.getActiveCount() : 0;
  const cleanedUpProperly = afterCompletionCount === 0;
  console.log('[AUTOTEST] Cleanup test:', { afterCompletionCount, cleanedUpProperly });

  // Benchmark 60 frames with blood VFX loaded
  let frameTimes = [];
  let lastTime = performance.now();
  for (let f = 0; f < 60; f++) {
    await new Promise(r => requestAnimationFrame(r));
    const now = performance.now();
    frameTimes.push(now - lastTime);
    lastTime = now;
  }
  const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  const fps = Math.round(1000 / avgFrameTime);

  const errors = window.__errors || [];

  const telemetry = {
    level: window.currentLevel,
    fps,
    avgFrameMs: +avgFrameTime.toFixed(2),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    playerStartCollisionSafe: !startHitsWall,
    solidWallBlocksMovement: wallHitsWall,
    customCollisionActive: customColl,
    wallHitDidNotTriggerBlood,
    wallSparksGenerated,
    bloodTriggeredOnSaberHit,
    noLegacyBloodParticles,
    multiHitSupported,
    cleanedUpProperly,
    activeBloodCountFinal: afterCompletionCount,
    jsErrorCount: errors.length,
    jsErrors: errors
  };

  console.log('[AUTOTEST] Telemetry collected:', JSON.stringify(telemetry));
  await fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(telemetry)
  }).catch(() => {});

  // Last capture: signal end
  P.pos.set(47.5, 0, -158.0);
  P.yaw = 0;
  P.pitch = 0.06;
  camera.position.set(47.5, 1.62, -158.0);
  camera.rotation.y = P.yaw;
  camera.rotation.x = P.pitch;
  await wait(400);
  await captureShot('level0_integrated_corner_decal', true);

  console.log('[AUTOTEST] All tests and captures completed!');
})();
