// Saber Killer — Multiplayer Client Entrypoint
// Loads Level 0 environment independently and initializes MPManager

import { initLevel0Env, enterLevel0Env, updateLevel0Env, getCollisionHandler } from '../levels/level0_env.js';
import { MPManager } from './mp_manager.js';
import { preloadPlayerAssets } from './remote_player.js';

let scene, camera, renderer, mpManager, playerLight;
let lastTime = performance.now();
let isGameActive = false;
let isEnvReady = false;

// Post-processing pipeline (matching Level 0 authentic grading)
let postScene, postCam, postRenderTarget, postMat;

function initPostProcessing(w, h) {
  postScene = new THREE.Scene();
  postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  postRenderTarget = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    encoding: THREE.LinearEncoding
  });

  const postShader = {
    uniforms: {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(w, h) },
      uSaturation: { value: 1.25 },
      uVignette: { value: 0.95 },
      uGrain: { value: 0.085 },
      uFringe: { value: 0.0035 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      uniform float uSaturation;
      uniform float uVignette;
      uniform float uGrain;
      uniform float uFringe;
      varying vec2 vUv;

      float rand(vec2 co) {
        return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        vec2 uv = vUv;
        vec2 dir = uv - vec2(0.5);
        float dist = length(dir);

        // Chromatic Aberration (Scene Fringe)
        vec2 offset = dir * uFringe * pow(dist, 1.4);
        float r = texture2D(tDiffuse, uv - offset).r;
        float g = texture2D(tDiffuse, uv).g;
        float b = texture2D(tDiffuse, uv + offset).b;
        vec3 col = vec3(r, g, b);

        // Backrooms 6-color sampled grading
        float luma = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 shadowGrad = vec3(0.88, 0.82, 0.52);
        vec3 midGrad    = vec3(0.96, 0.94, 0.72);
        vec3 highGrad   = vec3(1.02, 1.01, 0.88);
        vec3 tint = mix(shadowGrad, midGrad, smoothstep(0.05, 0.45, luma));
        tint = mix(tint, highGrad, smoothstep(0.45, 0.85, luma));
        col *= tint;

        // Saturation boost
        col = mix(vec3(luma), col, uSaturation);

        // Vignette falloff
        float vig = smoothstep(0.75, 0.22, dist * uVignette);
        col *= vig;

        // Fine grain
        float noise = (rand(uv + fract(gl_FragCoord.xy * 0.13)) - 0.5) * uGrain;
        col += noise;

        gl_FragColor = vec4(col, 1.0);
      }
    `
  };

  postMat = new THREE.ShaderMaterial(postShader);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
  postScene.add(quad);
}

function init() {
  const container = document.getElementById('canvas-container');

  // 1. Scene & Camera
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a08);
  scene.fog = new THREE.FogExp2(0x0a0a08, 0.015);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 800);
  camera.position.set(48.69, 1.62, -187.65);
  scene.add(camera);

  // 2. WebGLRenderer with preserveDrawingBuffer for screenshots
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.physicallyCorrectLights = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  initPostProcessing(window.innerWidth, window.innerHeight);

  // Ambient fill light for Backrooms Level 0
  const ambLight = new THREE.AmbientLight(0xfff5d0, 0.2);
  scene.add(ambLight);

  // Player localized PointLight
  playerLight = new THREE.PointLight(0xffe8a0, 1.2, 16, 2.0);
  playerLight.position.set(48.69, 1.62, -187.65);
  scene.add(playerLight);

  // 3. UI elements
  const statusEl = document.getElementById('connection-status');
  const countEl = document.getElementById('player-count');
  const roomInfoEl = document.getElementById('room-info');
  const lobbyPanel = document.getElementById('lobby-panel');
  const hudOverlay = document.getElementById('hud-overlay');
  const errorBanner = document.getElementById('error-banner');
  const serverInput = document.getElementById('server-address');
  const roomInput = document.getElementById('room-code-input');
  const btnCreate = document.getElementById('btn-create-room');
  const btnJoin = document.getElementById('btn-join-room');

  // Set default server address
  const defaultWsHost = window.location.host || '127.0.0.1:8749';
  serverInput.value = defaultWsHost;

  function showError(msg) {
    if (!errorBanner) return;
    errorBanner.textContent = msg;
    errorBanner.style.display = 'block';
    setTimeout(() => { errorBanner.style.display = 'none'; }, 4000);
  }

  // 4. Initialize MPManager
  mpManager = new MPManager(scene, camera, {
    onStatusChange: ({ status, message }) => {
      if (statusEl) statusEl.textContent = message;
    },
    onRoomJoined: (payload) => {
      isGameActive = true;
      if (lobbyPanel) lobbyPanel.style.display = 'none';
      if (hudOverlay) hudOverlay.style.display = 'block';
      if (roomInfoEl) roomInfoEl.textContent = `ROOM: ${payload.roomCode}`;
      if (countEl) countEl.textContent = `PLAYERS: ${payload.totalPlayers || 1} / 2`;
      mpManager.localPlayer.requestPointerLock(renderer.domElement);
    },
    onPlayerJoined: (payload) => {
      if (countEl) countEl.textContent = `PLAYERS: 2 / 2`;
    },
    onPlayerLeft: (payload) => {
      if (countEl) countEl.textContent = `PLAYERS: 1 / 2`;
    },
    onPlayerCountChange: (count) => {
      if (countEl) countEl.textContent = `PLAYERS: ${count} / 2`;
    },
    onError: (err) => {
      showError(err);
    }
  });

  // 5. Connect button actions
  btnCreate.addEventListener('click', () => {
    const srv = serverInput.value.trim();
    const customCode = roomInput.value.trim().toUpperCase() || null;
    if (!mpManager.network.isConnected) {
      mpManager.connect(srv);
      mpManager.network.ws.addEventListener('open', () => {
        mpManager.createRoom(customCode);
      }, { once: true });
    } else {
      mpManager.createRoom(customCode);
    }
  });

  btnJoin.addEventListener('click', () => {
    const srv = serverInput.value.trim();
    const code = roomInput.value.trim().toUpperCase();
    if (!code) {
      showError('Please enter a room code.');
      return;
    }
    if (!mpManager.network.isConnected) {
      mpManager.connect(srv);
      mpManager.network.ws.addEventListener('open', () => {
        mpManager.joinRoom(code);
      }, { once: true });
    } else {
      mpManager.joinRoom(code);
    }
  });

  // Click canvas to resume pointer lock
  renderer.domElement.addEventListener('click', () => {
    if (isGameActive && mpManager) {
      mpManager.localPlayer.requestPointerLock(renderer.domElement);
    }
  });

  // 6. Load Level 0 Environment
  statusEl.textContent = 'Loading Level 0 PBR Environment...';
  initLevel0Env(scene, () => {
    enterLevel0Env(scene);
    const ch = getCollisionHandler();
    if (ch) {
      mpManager.setCollisionHandler(ch);
    }
    isEnvReady = true;
    statusEl.textContent = 'Ready to Connect';
  });

  // Auto-connect to local server on page load
  mpManager.connect(defaultWsHost);

  // Resize handling
  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (postRenderTarget) postRenderTarget.setSize(w, h);
    if (postMat) postMat.uniforms.uResolution.value.set(w, h);
  });

  // Check URL query parameters for automated test execution: ?autotest=1&client=1&room=TEST&action=create|join
  const params = new URLSearchParams(window.location.search);
  const autoTest = params.get('autotest');
  const autoClient = params.get('client') || '1';
  const autoRoom = params.get('room') || 'DUAL';
  const autoAction = params.get('action') || (autoClient === '1' ? 'create' : 'join');

  if (autoTest) {
    runAutoTest(autoClient, autoRoom, autoAction);
  }

  // Expose to window for testing & debugging
  window.mpManager = mpManager;
  window.scene = scene;
  window.camera = camera;

  // 7. Render Loop
  requestAnimationFrame(loop);
}

async function runAutoTest(clientNum, roomCode, action) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  console.log(`[AUTOTEST MP] Initializing Client ${clientNum} in room ${roomCode}...`);

  // Wait for Level 0 environment to be fully ready
  for (let i = 0; i < 50; i++) {
    if (isEnvReady) break;
    await wait(100);
  }

  // Preload player models before joining
  await preloadPlayerAssets();

  // 1. Wait for connection and room join
  await wait(500);
  if (action === 'create') {
    mpManager.createRoom(roomCode);
  } else {
    mpManager.joinRoom(roomCode);
  }

  // 2. Wait for room joined confirmation
  for (let i = 0; i < 40; i++) {
    if (mpManager.myPlayerId) break;
    await wait(100);
  }

  // 3. Wait for peer to connect (up to 15s)
  for (let i = 0; i < 150; i++) {
    if (mpManager.remotePlayers.size >= 1) break;
    await wait(100);
  }

  await wait(1200); // Wait for T-800 meshes to attach

  // 4. Orient camera to face peer
  function facePeer() {
    const peers = [...mpManager.remotePlayers.values()];
    if (peers.length > 0) {
      const peer = peers[0];
      const dx = peer.group.position.x - mpManager.localPlayer.pos.x;
      const dz = peer.group.position.z - mpManager.localPlayer.pos.z;
      const targetYaw = Math.atan2(-dx, -dz);
      mpManager.localPlayer.yaw = targetYaw;
      camera.rotation.order = 'YXZ';
      camera.rotation.y = targetYaw;
      camera.rotation.x = 0.05;
    }
  }

  facePeer();

  // Client 2 moves back and forth for 1 second to test movement & interpolation
  if (clientNum === '2') {
    for (let m = 0; m < 20; m++) {
      mpManager.localPlayer.pos.z += 0.03;
      await wait(50);
    }
  }

  await wait(600);
  facePeer(); // Ensure looking directly at peer after movement
  await wait(400); // Let network update broadcast final facing yaw to peer

  // 5. Capture screenshot
  renderScene();
  const shot = renderer.domElement.toDataURL('image/png');
  const label = `mp_client${clientNum}_views_peer`;
  try {
    await fetch('/api/screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, shot })
    });
    console.log(`[AUTOTEST MP] Saved screenshot: ${label}`);
  } catch (e) {
    console.warn('Screenshot upload failed:', e);
  }

  // 6. Gather and send telemetry
  const peers = [...mpManager.remotePlayers.values()];
  const telemetry = {
    client: `client${clientNum}`,
    roomCode: mpManager.currentRoomCode,
    myPlayerId: mpManager.myPlayerId,
    totalPlayersInRoom: 1 + mpManager.remotePlayers.size,
    remotePlayersCount: mpManager.remotePlayers.size,
    remotePlayerId: peers[0]?.id || null,
    remotePlayerHasMesh: !!peers[0]?.characterModel,
    remotePlayerHasWeapon: !!peers[0]?.weaponModel,
    remotePlayerPosition: peers[0] ? {
      x: +peers[0].group.position.x.toFixed(2),
      y: +peers[0].group.position.y.toFixed(2),
      z: +peers[0].group.position.z.toFixed(2)
    } : null,
    localPlayerPosition: {
      x: +mpManager.localPlayer.pos.x.toFixed(2),
      y: +mpManager.localPlayer.pos.y.toFixed(2),
      z: +mpManager.localPlayer.pos.z.toFixed(2)
    },
    jsErrors: window.__errors || []
  };

  try {
    await fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telemetry)
    });
  } catch (e) {}

  console.log('[AUTOTEST MP] Telemetry completed:', telemetry);
}

function renderScene() {
  if (postRenderTarget && postScene) {
    renderer.setRenderTarget(postRenderTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    postMat.uniforms.tDiffuse.value = postRenderTarget.texture;
    renderer.render(postScene, postCam);
  } else {
    renderer.render(scene, camera);
  }
}

function loop(timestamp) {
  requestAnimationFrame(loop);

  const dt = Math.min(0.1, (timestamp - lastTime) / 1000);
  lastTime = timestamp;

  if (mpManager) {
    mpManager.update(dt);
    if (playerLight && mpManager.localPlayer) {
      playerLight.position.set(mpManager.localPlayer.pos.x, 1.62, mpManager.localPlayer.pos.z);
    }
    // Update Level 0 lighting and atmosphere
    updateLevel0Env(dt, mpManager.localPlayer.pos, null, mpManager.localPlayer.yaw);
  }

  renderScene();
}

window.addEventListener('DOMContentLoaded', init);
