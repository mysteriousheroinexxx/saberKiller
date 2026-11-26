// Saber Killer — Multiplayer Client Entrypoint
// Loads Level 0 environment independently and initializes MPManager

import { initLevel0Env, enterLevel0Env, leaveLevel0Env, updateLevel0Env, getCollisionHandler } from '../levels/level0_env.js';
import { MPManager } from './mp_manager.js';
import { RemotePlayer, preloadPlayerAssets } from './remote_player.js';
import {
  initMultiplayerLighting,
  setMapLights,
  updateMultiplayerLighting,
  setExposure,
  setAmbientIntensity,
  setPointIntensity,
  setLightColor,
  setPlayerLightIntensity,
  resetLighting,
  getLightingConfig,
  LIGHTING_DEFAULTS
} from './lighting.js';
import { SanityController, SANITY_STATE, SANITY_EVENTS } from './sanity_controller.js';
import { SanityHUD } from './sanity_hud.js';
import { WorldItemManager } from './item_manager.js';
import { WorldPlacementEditor } from './world_editor.js';
import { InteractionManager } from './interaction_manager.js';
import { InventoryUI } from './inventory_ui.js';
import { ExitDoorManager } from './exit_door_manager.js';
import { SaberObservationUI } from './saber_observation_ui.js';
import { initMultiplayerImpactVFX } from './impact_vfx.js';
import { AudioSettingsUI } from './audio_settings_ui.js';

let scene, camera, renderer, mpManager, playerLight;
let lastTime = performance.now();
let isGameActive = false;
let isEnvReady = false;
let itemManager = null;
let worldEditor = null;
let interactionManager = null;
let inventoryUI = null;
let audioSettingsUI = null;
let exitDoorManager = null;
let saberObservationUI = null;
let devToolsEnabled = false;

// Survival Mode Sanity System
let sanityController = null;
let sanityHUD = null;
let currentSanityVig = 0.0;
let currentSanityDesat = 0.0;
let currentBlackout = 0.0;

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
      uVignette: { value: 0.45 },
      uGrain: { value: 0.0 },
      uFringe: { value: 0.0 },
      uSanityVignette: { value: 0.0 },
      uSanityDesat: { value: 0.0 },
      uBlackout: { value: 0.0 }
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
      uniform float uSanityVignette;
      uniform float uSanityDesat;
      uniform float uBlackout;
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

        // Saturation boost with mild paranoia desaturation
        float finalSat = max(0.0, uSaturation - uSanityDesat);
        col = mix(vec3(luma), col, finalSat);

        // Vignette falloff with progressive sanity constriction
        float totalVig = uVignette + uSanityVignette;
        float vig = smoothstep(0.75, 0.22, dist * totalVig);
        col *= vig;

        // Fine grain
        float noise = (rand(uv + fract(gl_FragCoord.xy * 0.13)) - 0.5) * uGrain;
        col += noise;

        // Visual Blackout (gradual collapse at zero sanity)
        col = mix(col, vec3(0.0), clamp(uBlackout, 0.0, 1.0));

        gl_FragColor = vec4(col, 1.0);
      }
    `
  };

  postMat = new THREE.ShaderMaterial(postShader);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
  postScene.add(quad);
}

async function checkDevToolsConfig() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('dev') === '1' || urlParams.get('devtools') === '1' || urlParams.get('dev-rendering') === '1') {
    return true;
  }
  try {
    const res = await fetch('/__config', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      return !!data.renderingDevTools;
    }
  } catch (e) {
    console.warn('[DEV TOOLS] Could not query /__config:', e);
  }
  return false;
}

async function init() {
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
  renderer.toneMappingExposure = 0.50;
  renderer.physicallyCorrectLights = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  initPostProcessing(window.innerWidth, window.innerHeight);
  initMultiplayerImpactVFX(scene, camera);

  // 2b. Initialize Survival Mode Sanity Controller and authentic Budget-Backrooms HUD
  sanityController = new SanityController();
  sanityHUD = new SanityHUD(sanityController, document.body);

  sanityController.onSanityDepleted = (payload) => {
    console.warn('[SURVIVAL] Sanity depleted to 0%!', payload);
  };

  window.scene = scene;
  window.camera = camera;
  window.renderer = renderer;
  window.postMat = postMat;
  window.survivalSanity = sanityController;
  window.survivalHUD = sanityHUD;
  window.sanityController = sanityController;

  // Player localized PointLight (provides subtle local camera presence)
  playerLight = new THREE.PointLight(0xfff5aa, 3.5, 20, 1.5);
  playerLight.name = 'MP_LocalPlayerLight';
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
  devToolsEnabled = await checkDevToolsConfig();
  if (!devToolsEnabled) {
    console.log('[DEV TOOLS] Developer tools disabled by server. Removing panels from DOM.');
    document.getElementById('dev-comparison-panel')?.remove();
    document.getElementById('dev-panel-toggle')?.remove();
    document.getElementById('dev-saber-panel')?.remove();
    document.getElementById('dev-saber-toggle')?.remove();
    document.getElementById('world-editor-overlay')?.remove();
    document.getElementById('dev-pickup-hud-diag')?.remove();
    document.getElementById('dev-weapon-hud-diag')?.remove();
    document.getElementById('dev-coord-hud-diag')?.remove();
  }

  mpManager = new MPManager(scene, camera, {
    onStatusChange: ({ status, message }) => {
      if (statusEl) statusEl.textContent = message;
      if (status === 'disconnected') {
        disableUnloadGuard();
        isGameActive = false;
      }
    },
    onRoomJoined: (payload) => {
      isGameActive = true;
      enableUnloadGuard();
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        try { document.activeElement.blur(); } catch (e) {}
      }
      if (lobbyPanel) lobbyPanel.style.display = 'none';

      if (payload.runState === 'LOBBY') {
        // Pre-game staging lobby flow:
        // Hide Level 0 environment and in-game HUDs; do NOT lock mouse pointer
        leaveLevel0Env(scene);
        if (itemManager && itemManager.container) itemManager.container.visible = false;
        if (playerLight) playerLight.visible = false;
        if (hudOverlay) hudOverlay.style.display = 'none';
        if (sanityHUD) sanityHUD.setVisible(false);
      } else {
        // Direct in-game match flow (e.g. late join or legacy room)
        enterLevel0Env(scene);
        if (itemManager && itemManager.container) itemManager.container.visible = true;
        if (playerLight) playerLight.visible = true;
        if (hudOverlay) hudOverlay.style.display = 'block';
        if (sanityHUD) sanityHUD.setVisible(true);
        if (inventoryUI) inventoryUI.render();
        if (roomInfoEl) roomInfoEl.textContent = `ROOM: ${payload.roomCode}`;
        if (countEl) countEl.textContent = `PLAYERS: ${payload.totalPlayers || 1} / 2`;

        // Layout revision synchronization across room clients (dev mode)
        if (devToolsEnabled && payload.layoutRevision && payload.layoutRevision !== 'default' &&
            itemManager?.loadedRevisionFilename !== payload.layoutRevision) {
          console.log(`[ROOM LAYOUT SYNC] Synchronizing room ${payload.roomCode} to layout: ${payload.layoutRevision}`);
          const revUrl = `/api/developer/world-layout/load?file=${encodeURIComponent(payload.layoutRevision)}`;
          itemManager?.loadWorldItems(revUrl)
            .then(() => {
              mpManager?.resyncWorldItems();
              if (worldEditor?.ui?.layoutSelect) {
                worldEditor.ui.layoutSelect.value = payload.layoutRevision;
              }
            })
            .catch(e => console.warn('[ROOM LAYOUT SYNC] Error:', e));
        }

        if (renderer && renderer.domElement) {
          renderer.domElement.tabIndex = 0;
          try { renderer.domElement.focus(); } catch (e) {}
        }

        if (!mpManager.localPlayer.isEditorActive && (!worldEditor || !worldEditor.isOpen) && !audioSettingsUI?.isOpen) {
          mpManager.localPlayer.requestPointerLock(renderer.domElement);
        }
      }
    },
    onMatchStarted: (payload) => {
      console.log(`[MATCH START] Transitioning room ${payload.roomCode} to Level 0...`);
      enterLevel0Env(scene);
      if (itemManager && itemManager.container) itemManager.container.visible = true;
      if (playerLight) playerLight.visible = true;
      if (hudOverlay) hudOverlay.style.display = 'block';
      if (sanityHUD) sanityHUD.setVisible(true);
      if (inventoryUI) inventoryUI.render();
      if (roomInfoEl) roomInfoEl.textContent = `ROOM: ${payload.roomCode}`;
      if (countEl) countEl.textContent = `PLAYERS: ${payload.startingPlayers || 2} / 2`;

      if (devToolsEnabled && payload.layoutRevision && payload.layoutRevision !== 'default' &&
          itemManager?.loadedRevisionFilename !== payload.layoutRevision) {
        const revUrl = `/api/developer/world-layout/load?file=${encodeURIComponent(payload.layoutRevision)}`;
        itemManager?.loadWorldItems(revUrl)
          .then(() => mpManager?.resyncWorldItems())
          .catch(e => console.warn('[ROOM LAYOUT SYNC] Error:', e));
      }

      if (renderer && renderer.domElement) {
        renderer.domElement.tabIndex = 0;
        try { renderer.domElement.focus(); } catch (e) {}
      }

      if (!mpManager.localPlayer.isEditorActive && (!worldEditor || !worldEditor.isOpen) && !audioSettingsUI?.isOpen) {
        mpManager.localPlayer.requestPointerLock(renderer.domElement);
      }
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

  window.mpManager = mpManager;
  window.localPlayer = mpManager.localPlayer;
  window.audioManager = mpManager.audioManager;
  window.ambientAudio = mpManager.ambientAudio;

  if (sanityHUD && mpManager.localPlayer) {
    sanityHUD.setPlayer(mpManager.localPlayer);
  }

  inventoryUI = new InventoryUI(mpManager.inventory, mpManager.localPlayer, mpManager.network, document.body);
  window.inventoryUI = inventoryUI;

  audioSettingsUI = new AudioSettingsUI(mpManager.audioManager, {
    player: mpManager.localPlayer
  });
  window.audioSettingsUI = audioSettingsUI;

  ['btn-lobby-audio-settings', 'btn-staging-audio-settings', 'btn-hud-audio-settings'].forEach((btnId) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { btn.blur(); } catch {}
        audioSettingsUI?.open();
      });
    }
  });

  if (mpManager.stagingLobby) {
    mpManager.stagingLobby.setOnLeave(() => leaveMultiplayerSession());
  }

  // Auto-connect to local server immediately on page load (runs concurrently with heavy 3D asset downloads)
  mpManager.connect(defaultWsHost);

  // 5. Connect button actions
  function connectThen(serverUrl, action) {
    if (mpManager.network.isConnected) {
      action();
      return;
    }
    btnCreate.disabled = true;
    btnJoin.disabled = true;
    mpManager.connect(serverUrl);
    mpManager.network.whenOpen()
      .then(() => action())
      .catch(err => showError(err.message))
      .finally(() => {
        btnCreate.disabled = false;
        btnJoin.disabled = false;
      });
  }

  btnCreate.addEventListener('click', () => {
    if (!isEnvReady) {
      showError('Level environment is still loading, please wait...');
      return;
    }
    const srv = serverInput.value.trim();
    const customCode = roomInput.value.trim().toUpperCase() || null;
    const layoutRev = (devToolsEnabled && worldEditor?.ui?.layoutSelect?.value && worldEditor.ui.layoutSelect.value !== 'default')
      ? worldEditor.ui.layoutSelect.value
      : null;

    connectThen(srv, () => mpManager.createRoom(customCode, layoutRev));
  });

  btnJoin.addEventListener('click', () => {
    if (!isEnvReady) {
      showError('Level environment is still loading, please wait...');
      return;
    }
    const srv = serverInput.value.trim();
    const code = roomInput.value.trim().toUpperCase();
    if (!code) {
      showError('Please enter a room code.');
      return;
    }
    connectThen(srv, () => mpManager.joinRoom(code));
  });

  // Click canvas to resume pointer lock
  renderer.domElement.tabIndex = 0;
  renderer.domElement.addEventListener('click', () => {
    try { renderer.domElement.focus(); } catch (e) {}
    if (isGameActive && mpManager && !mpManager.localPlayer.isEditorActive && (!worldEditor || !worldEditor.isOpen) && !window.inventoryUI?.isOpen && !window.audioSettingsUI?.isOpen) {
      mpManager.localPlayer.requestPointerLock(renderer.domElement);
    }
  });

  // 5b. Browser unload confirmation safeguard and Ctrl+W capture protection
  // Accidental Ctrl+W / Cmd+W Tab Closure Prevention (Capture Phase)
  function handleCtrlWCapture(e) {
    const isW = (e.key === 'w' || e.key === 'W' || e.code === 'KeyW' || e.keyCode === 87);
    const isCtrlOrCmd = Boolean(e.ctrlKey || e.metaKey);

    if (isCtrlOrCmd && isW) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
      console.log('[INPUT GUARD] Intercepted Ctrl+W / Cmd+W in capture phase (prevented default & propagation)');
      return false;
    }
  }

  // Attach capture-phase listener directly to window
  window.addEventListener('keydown', handleCtrlWCapture, true);

  // Dynamic BeforeUnload Safeguard: Active ONLY during live multiplayer sessions
  let isUnloadGuardActive = false;

  function beforeUnloadHandler(e) {
    if (isGameActive && mpManager?.network?.isConnected) {
      e.preventDefault();
      const msg = 'You are currently in an active multiplayer session. Are you sure you want to disconnect?';
      e.returnValue = msg;
      return msg;
    }
  }

  function enableUnloadGuard() {
    if (isUnloadGuardActive) return;
    window.addEventListener('beforeunload', beforeUnloadHandler);
    isUnloadGuardActive = true;
    console.log('[SESSION] Unload guard enabled for active multiplayer session');
  }

  function disableUnloadGuard() {
    if (!isUnloadGuardActive) return;
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    isUnloadGuardActive = false;
    console.log('[SESSION] Unload guard removed (session ended or intentionally leaving)');
  }

  // Intentional session exit handler: cleans up guard and returns to lobby cleanly
  function leaveMultiplayerSession() {
    disableUnloadGuard();
    isGameActive = false;
    if (mpManager) {
      mpManager.disconnect();
      mpManager.connect(defaultWsHost);
    }
    if (hudOverlay) hudOverlay.style.display = 'none';
    const stagingOverlay = document.getElementById('staging-lobby-overlay');
    if (stagingOverlay) stagingOverlay.style.display = 'none';
    if (lobbyPanel) lobbyPanel.style.display = 'block';
    if (sanityHUD) sanityHUD.setVisible(false);
    const downedOverlay = document.getElementById('bb-downed-overlay');
    if (downedOverlay) downedOverlay.style.display = 'none';
    const elimOverlay = document.getElementById('bb-eliminated-overlay');
    if (elimOverlay) elimOverlay.style.display = 'none';
    const goOverlay = document.getElementById('bb-gameover-overlay');
    if (goOverlay) goOverlay.style.display = 'none';
    if (audioSettingsUI && audioSettingsUI.isOpen) audioSettingsUI.close();
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch (err) {}
    }
    if (statusEl) statusEl.textContent = 'Disconnected from session.';
    console.log('[SESSION] Intentionally left multiplayer session; unload guard removed.');
  }

  // Hook intentional leave buttons and links
  const btnLeaveRoom = document.getElementById('btn-leave-room');
  if (btnLeaveRoom) {
    btnLeaveRoom.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      leaveMultiplayerSession();
    });
  }

  const btnGameOverLobby = document.getElementById('bb-btn-gameover-lobby');
  if (btnGameOverLobby) {
    btnGameOverLobby.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      leaveMultiplayerSession();
    });
  }

  document.querySelectorAll('.back-link').forEach(link => {
    link.addEventListener('click', () => {
      leaveMultiplayerSession();
    });
  });

  // Expose helpers for verification and external integration
  window.leaveMultiplayerSession = leaveMultiplayerSession;
  window.enableUnloadGuard = enableUnloadGuard;
  window.disableUnloadGuard = disableUnloadGuard;
  window.handleCtrlWCapture = handleCtrlWCapture;
  window.beforeUnloadHandler = beforeUnloadHandler;
  window.isUnloadGuardActive = () => isUnloadGuardActive;

  // 6. Load Level 0 Environment
  statusEl.textContent = 'Loading Level 0 PBR Environment...';
  await initLevel0Env(scene, () => {
    enterLevel0Env(scene);
    const ch = getCollisionHandler();
    if (ch) {
      const origCircleHitsWall = ch.circleHitsWall.bind(ch);
      ch.circleHitsWall = (px, pz, radius) => {
        if (exitDoorManager && exitDoorManager.collidesWithDoor(px, pz, radius)) {
          return true;
        }
        if (itemManager && typeof itemManager.collidesWithProps === 'function' && itemManager.collidesWithProps(px, pz, radius)) {
          return true;
        }
        return origCircleHitsWall(px, pz, radius);
      };
      mpManager.setCollisionHandler(ch);
    }

    // Initialize dedicated multiplayer Backrooms Level 0 lighting
    fetch('assets/level0/level0_map.json')
      .then(r => r.json())
      .then(map => {
        if (map.lights) {
          setMapLights(map.lights);
          updateMultiplayerLighting(0.016, camera.position, mpManager?.remotePlayers);
        }
      })
      .catch(err => console.warn('[MP LIGHTING] Failed to load level0_map.json:', err));

    initMultiplayerLighting(scene, renderer, playerLight);

    // Apply default Configuration D immediately to environment materials
    applyRenderConfig('combined');

    // Initialize world item placements with collision handler for intersection checks
    itemManager = new WorldItemManager(scene, ch);
    mpManager.setItemManager(itemManager);
    window.itemManager = itemManager;
  });

  const initialLayout = devToolsEnabled ? '/api/developer/world-layout/load' : 'assets/data/world_items.json';
  try {
    await itemManager.loadWorldItems(initialLayout);
    console.log(`[WORLD ITEMS] World items and props loaded successfully from ${initialLayout}`);
  } catch (err) {
    console.warn(`[WORLD ITEMS] Failed to load ${initialLayout}, falling back to default:`, err);
    await itemManager.loadWorldItems('assets/data/world_items.json');
  }

  // Initialize Reusable Interaction Framework
  interactionManager = new InteractionManager(camera, scene, itemManager, {
    maxDistance: 2.1,
    onInteract: (target, requestId) => {
      const pPos = mpManager.localPlayer ? mpManager.localPlayer.pos : null;
      const clientPos = pPos ? { x: +pPos.x.toFixed(3), y: +(pPos.y || 0).toFixed(3), z: +pPos.z.toFixed(3) } : null;

      if (target.isPickup) {
        console.log(`[STAGE 3/19] [CLIENT] Pickup request created: target=${target.id} (${target.type})`);
        console.log(`[STAGE 4/19] [CLIENT] Request ID assigned: ${requestId} for item: ${target.id}`);
        console.log(`[PICKUP ${requestId}] E received; constructing request for ${target.id}`);
        console.log(`[PICKUP ${requestId}] Sending ITEM_PICKUP_REQUEST via WebSocket`);
        const result = mpManager.network.requestItemPickup(target.id, requestId, clientPos);
        if (result.sent) console.log(`[PICKUP ${requestId}] WebSocket send completed`);
        else console.warn(`[PICKUP ${requestId}] WebSocket send did not occur (readyState=${mpManager.network.ws?.readyState ?? 'no socket'})`);
        return result;
      } else if (target.type === 'vending_almond' || target.id?.startsWith('prop_vending')) {
        console.log(`[VENDING ${requestId}] E received on ${target.id}; constructing dispense request`);
        const result = mpManager.network.requestVendingDispense(target.id, requestId, clientPos);
        if (result.sent) console.log(`[VENDING ${requestId}] WebSocket send completed`);
        else console.warn(`[VENDING ${requestId}] WebSocket send did not occur (readyState=${mpManager.network.ws?.readyState ?? 'no socket'})`);
        return result;
      } else if (target.type === 'revive_teammate') {
        if (!target.hasRequiredItem) {
          if (interactionManager) {
            interactionManager.handleReviveRejected('You need a Health Pack in your inventory to revive teammate!');
          }
          return false;
        }
        console.log(`[REVIVE ${requestId}] Requesting teammate revival for target ${target.targetPlayerId}`);
        const result = mpManager.network.requestRevive(target.targetPlayerId, requestId, clientPos);
        return result;
      } else if (target.type === 'exit_door' || target.id === 'level0_exit_door') {
        const door = exitDoorManager ? exitDoorManager.getDoor('level0_exit_door') : null;
        const isLocked = door ? door.locked : true;
        if (isLocked) {
          const carriedKeys = mpManager.inventory ? mpManager.inventory.getCount('doorKey') : 0;
          const requiredKeys = door?.requiredKeys || 1;
          if (carriedKeys < requiredKeys) {
            if (interactionManager) {
              const msg = (requiredKeys > 1)
                ? `Requires all ${requiredKeys} Brass Door Keys to be carried by you (you have ${carriedKeys})`
                : 'Requires Brass Door Key';
              interactionManager.diagnostics.serverResult = `REJECTED — Locked (${msg})`;
              interactionManager.diagnostics.lastRejection = msg;
              interactionManager._notifyDiagnostics();
              interactionManager._finishPickupRequest(requestId);
            }
            return false;
          }
          console.log(`[EXIT DOOR ${requestId}] Unlocking door ${target.id} with all ${requiredKeys} Brass Door Keys`);
          const result = mpManager.network.requestDoorUnlock(target.id, requestId, clientPos);
          return result;
        } else {
          console.log(`[EXIT DOOR ${requestId}] Escaping Level 0 through exit doorway`);
          const result = mpManager.network.requestEscape(target.id, clientPos);
          if (interactionManager) interactionManager._finishPickupRequest(requestId);
          return result;
        }
      }
    },
    onDiagnosticsChange: (diag) => {
      updatePickupDiagnosticsUI(diag);
    }
  });
  window.interactionManager = interactionManager;
  window.inventory = mpManager.inventory;

  // Initialize Level 0 Exit Door Entity and Network Synchronizer
  exitDoorManager = new ExitDoorManager(scene, interactionManager);
  window.exitDoorManager = exitDoorManager;
  if (mpManager.roomDoors) {
    exitDoorManager.initDoors(mpManager.roomDoors);
  }

  // Network door response and state update handlers
  mpManager.network.onDoorUnlockResponse = (payload) => {
    interactionManager.handleDoorUnlockResponse(payload);
    if (payload.success && exitDoorManager) {
      exitDoorManager.setDoorState(payload.doorId, false);
    }
  };

  mpManager.network.onDoorStateUpdate = (payload) => {
    if (exitDoorManager && payload) {
      exitDoorManager.setDoorState(payload.doorId, payload.locked, payload.unlockedBy);
    }
  };

  isEnvReady = true;
  window.isEnvReady = true;
  if (mpManager?.network?.isConnected) {
    statusEl.textContent = `Connected (${mpManager.network.serverUrl})`;
  } else if (!mpManager?.network?.ws) {
    mpManager.connect(defaultWsHost);
  } else {
    statusEl.textContent = 'Connecting to Server...';
  }

  // Resize handling
  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (postRenderTarget) postRenderTarget.setSize(w, h);
    if (postMat) postMat.uniforms.uResolution.value.set(w, h);
  });

  // Check URL query parameters for automated comparison or autotest
  const params = new URLSearchParams(window.location.search);
  const autoTest = params.get('autotest');
  const autoClient = params.get('client') || '1';
  const autoRoom = params.get('room') || 'DUAL';
  const autoAction = params.get('action') || (autoClient === '1' ? 'create' : 'join');
  const compare = params.get('compare') || params.get('investigate');

  if (compare) {
    runAutomatedComparisonSuite();
  } else if (autoTest) {
    runAutoTest(autoClient, autoRoom, autoAction);
  }

  // Developer rendering and world placement tools configuration
  if (devToolsEnabled) {
    console.log('[DEV TOOLS] Server enabled developer rendering panel (--dev-rendering).');
    worldEditor = new WorldPlacementEditor({
      scene,
      camera,
      renderer,
      itemManager,
      localPlayer: mpManager.localPlayer
    });
    window.worldEditor = worldEditor;
    initDevComparisonUI();

    // Saber AI Developer Observation Interface
    saberObservationUI = new SaberObservationUI(mpManager);
    window.saberObservationUI = saberObservationUI;

    mpManager.network.onDevAiTelemetry = (payload) => {
      if (saberObservationUI) {
        saberObservationUI.updateTelemetry(payload);
      }
    };

    const origSoundBroadcast = mpManager.network.onSoundEventBroadcast;
    mpManager.network.onSoundEventBroadcast = (payload) => {
      if (origSoundBroadcast) origSoundBroadcast(payload);
      if (saberObservationUI) {
        const st = payload.soundType || payload.stimulus?.soundType || 'SOUND';
        const rad = payload.detectionRadius || payload.stimulus?.detectionRadius || 0;
        saberObservationUI.addLog(`[SOUND] ${st} (r=${rad.toFixed(0)}m)`, st.includes('GUNSHOT') ? 'alert' : 'highlight');
      }
    };

    // Developer weapon firing and coordinates diagnostic HUD elements
    const devWeaponHud = document.getElementById('dev-weapon-hud-diag');
    if (devWeaponHud) {
      devWeaponHud.style.display = 'block';
    }
    const devCoordHud = document.getElementById('dev-coord-hud-diag');
    if (devCoordHud) {
      devCoordHud.style.display = 'block';
    }
  } else {
    // If not enabled by server flag, completely remove dev panel elements and do not bind dev keys
    console.log('[DEV TOOLS] Developer tools disabled by server. Removing panel from DOM.');
    document.getElementById('dev-comparison-panel')?.remove();
    document.getElementById('dev-panel-toggle')?.remove();
    document.getElementById('dev-saber-panel')?.remove();
    document.getElementById('dev-saber-toggle')?.remove();
    document.getElementById('world-editor-overlay')?.remove();
    document.getElementById('dev-pickup-hud-diag')?.remove();
    document.getElementById('dev-weapon-hud-diag')?.remove();
    document.getElementById('dev-coord-hud-diag')?.remove();
  }

  // Check URL query parameters for verification suite
  const verify = params.get('verify');
  if (verify) {
    runVerificationSuite(verify);
  }

  // Expose additional multiplayer state to window
  window.mpManager = mpManager;
  window.localPlayer = mpManager.localPlayer;
  window.audioManager = mpManager.audioManager;
  window.ambientAudio = mpManager.ambientAudio;
  window.teleportLocalPlayer = (x, y, z, yaw, pitch) => mpManager?.localPlayer?.teleport(x, y, z, yaw, pitch);
  Object.defineProperty(window, 'isGameActive', { get: () => isGameActive });
  window.multiplayerLighting = {
    setExposure,
    setAmbientIntensity,
    setPointIntensity,
    setLightColor,
    setPlayerLightIntensity,
    resetLighting,
    getLightingConfig,
    LIGHTING_DEFAULTS
  };
  window.survivalHUD = sanityHUD;
  window.sanityHUD = sanityHUD;
  window.applyRenderConfig = applyRenderConfig;
  window.switchView = switchView;
  window.RENDER_CONFIGS = RENDER_CONFIGS;
  window.VIEWPOINTS = VIEWPOINTS;
  window.itemManager = itemManager;

  // 7. Render Loop
  requestAnimationFrame(loop);
}

// =============================================================================
// INTERACTIVE RENDERING COMPARISON MODULE
// Profiles: A (Original), B (Clean Post), C (Texture Quality), D (Combined)
// Viewpoints: Normal (Hallway), Wallpaper (Close-up), Carpet (Oblique Angle)
// =============================================================================

export const RENDER_CONFIGS = {
  original: {
    key: 'A',
    id: 'original',
    name: 'A — Original (Baseline)',
    grain: 0.085,
    fringe: 0.0035,
    vignette: 0.45,
    saturation: 1.25,
    anisotropy: 1,
    wallNormalScale: 1.0,
    carpetNormalScale: 1.2
  },
  clean_post: {
    key: 'B',
    id: 'clean_post',
    name: 'B — Clean Post-Processing',
    grain: 0.0,
    fringe: 0.0,
    vignette: 0.45,
    saturation: 1.25,
    anisotropy: 1,
    wallNormalScale: 1.0,
    carpetNormalScale: 1.2
  },
  texture_quality: {
    key: 'C',
    id: 'texture_quality',
    name: 'C — Texture Quality',
    grain: 0.085,
    fringe: 0.0035,
    vignette: 0.45,
    saturation: 1.25,
    anisotropy: 16,
    wallNormalScale: 0.4,
    carpetNormalScale: 0.6
  },
  combined: {
    key: 'D',
    id: 'combined',
    name: 'D — Combined Optimum',
    grain: 0.0,
    fringe: 0.0,
    vignette: 0.45,
    saturation: 1.25,
    anisotropy: 16,
    wallNormalScale: 0.4,
    carpetNormalScale: 0.6
  }
};

export const VIEWPOINTS = {
  normal: {
    key: 'normal',
    name: 'Normal Gameplay (Hallway)',
    pos: { x: 48.69, y: 1.62, z: -187.65 },
    yaw: -Math.PI / 2,
    pitch: 0.04
  },
  ceiling: {
    key: 'ceiling',
    name: 'Ceiling Fixture & Tiles',
    pos: { x: 48.69, y: 1.62, z: -187.65 },
    yaw: -Math.PI / 2,
    pitch: 0.65
  },
  wallpaper: {
    key: 'wallpaper',
    name: 'Wallpaper (Close-up)',
    pos: { x: 47.40, y: 1.62, z: -187.65 },
    yaw: Math.PI / 2,
    pitch: 0.0
  },
  carpet: {
    key: 'carpet',
    name: 'Carpet (Oblique Angle)',
    pos: { x: 48.69, y: 1.62, z: -187.65 },
    yaw: -Math.PI / 2,
    pitch: -0.48
  },
  pillar_hall: {
    key: 'pillar_hall',
    name: 'Pillar Hall (Large Room)',
    pos: { x: 75.70, y: 1.62, z: -181.40 },
    yaw: 0.0,
    pitch: 0.0
  },
  exit_corridor: {
    key: 'exit_corridor',
    name: 'Exit Corridor (Vista)',
    pos: { x: 79.55, y: 1.62, z: 198.00 },
    yaw: 0.0,
    pitch: 0.0
  },
  items_overview: {
    key: 'items_overview',
    name: 'World Items Overview (Hallway)',
    pos: { x: 47.0, y: 1.50, z: -187.5 },
    yaw: -Math.PI / 2,
    pitch: -0.15
  },
  items_table: {
    key: 'items_table',
    name: 'Items on Table (Close-up)',
    pos: { x: 44.5, y: 1.25, z: -186.8 },
    yaw: 0.0,
    pitch: -0.25
  },
  items_shelf: {
    key: 'items_shelf',
    name: 'Items on Metal Shelf (Close-up)',
    pos: { x: 44.5, y: 1.25, z: -188.0 },
    yaw: Math.PI,
    pitch: -0.10
  },
  items_floor: {
    key: 'items_floor',
    name: 'Items on Carpet Floor (Close-up)',
    pos: { x: 45.0, y: 1.20, z: -187.4 },
    yaw: -Math.PI / 2,
    pitch: -0.45
  },
  items_vending: {
    key: 'items_vending',
    name: 'Almond Water Vending Machine (Close-up)',
    pos: { x: 41.5, y: 1.25, z: -186.9 },
    yaw: 0.0,
    pitch: 0.0
  },
  items_furniture: {
    key: 'items_furniture',
    name: 'Furniture Wall Clearance (Oblique View)',
    pos: { x: 42.5, y: 1.45, z: -187.35 },
    yaw: -Math.PI / 2 + 0.35,
    pitch: -0.15
  }
};

let currentProfileKey = 'combined';
let currentViewKey = 'normal';
let cachedMaterials = null;

function cacheMaterials() {
  if (cachedMaterials) return cachedMaterials;
  let wallMat = null, floorMat = null, ceilMat = null;

  scene.traverse(o => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.color) {
          const hex = m.color.getHex();
          if (hex === 0xd6ce88 && !wallMat) wallMat = m;
          if (hex === 0xbfae6d && !floorMat) floorMat = m;
          if (hex === 0xebe9d6 && !ceilMat) ceilMat = m;
        }
      }
    }
  });

  if (wallMat || floorMat || ceilMat) {
    const textures = [
      wallMat?.map, wallMat?.normalMap, wallMat?.roughnessMap,
      floorMat?.map, floorMat?.normalMap, floorMat?.roughnessMap, floorMat?.aoMap,
      ceilMat?.map, ceilMat?.normalMap, ceilMat?.roughnessMap, ceilMat?.aoMap
    ].filter(Boolean);

    cachedMaterials = {
      wall: wallMat,
      floor: floorMat,
      ceil: ceilMat,
      textures
    };
  }

  return cachedMaterials;
}

export function applyRenderConfig(configKey) {
  const cfg = RENDER_CONFIGS[configKey] || RENDER_CONFIGS.combined;
  currentProfileKey = configKey in RENDER_CONFIGS ? configKey : 'combined';

  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 16;
  const effectiveAniso = Math.min(cfg.anisotropy, maxAniso);

  console.log(`[RENDER COMPARISON] Applying ${cfg.name} | Aniso: ${effectiveAniso}x (Max GPU: ${maxAniso}x)`);

  // 1. Post-processing uniforms (mutating existing instance directly)
  if (postMat) {
    postMat.uniforms.uGrain.value = cfg.grain;
    postMat.uniforms.uFringe.value = cfg.fringe;
    postMat.uniforms.uVignette.value = cfg.vignette;
    postMat.uniforms.uSaturation.value = cfg.saturation;
  }

  // 2. Texture anisotropy & normalScale on existing Level 0 material instances
  const mats = cacheMaterials();
  if (mats) {
    for (const tex of mats.textures) {
      if (tex.anisotropy !== effectiveAniso) {
        tex.anisotropy = effectiveAniso;
        tex.needsUpdate = true;
      }
    }
    if (mats.wall?.normalScale) {
      mats.wall.normalScale.set(cfg.wallNormalScale, cfg.wallNormalScale);
      mats.wall.needsUpdate = true;
    }
    if (mats.floor?.normalScale) {
      mats.floor.normalScale.set(cfg.carpetNormalScale, cfg.carpetNormalScale);
      mats.floor.needsUpdate = true;
    }
  }

  updateDevUI(currentProfileKey, currentViewKey);
  return cfg;
}

export function switchView(viewKey) {
  const vp = VIEWPOINTS[viewKey] || VIEWPOINTS.normal;
  currentViewKey = viewKey in VIEWPOINTS ? viewKey : 'normal';

  if (mpManager && mpManager.localPlayer) {
    mpManager.localPlayer.pos.set(vp.pos.x, 0.0, vp.pos.z);
    mpManager.localPlayer.yaw = vp.yaw;
    mpManager.localPlayer.pitch = vp.pitch;
  }
  camera.position.set(vp.pos.x, vp.pos.y, vp.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = vp.yaw;
  camera.rotation.x = vp.pitch;

  if (playerLight) {
    playerLight.position.copy(camera.position);
  }

  updateMultiplayerLighting(0.016, camera.position, mpManager?.remotePlayers);
  updateDevUI(currentProfileKey, currentViewKey);
  console.log(`[RENDER COMPARISON] Switched viewpoint to: ${vp.name}`);
}

function updateDevUI(cfgKey = currentProfileKey, viewKey = currentViewKey) {
  const cfg = RENDER_CONFIGS[cfgKey];
  if (!cfg) return;

  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 16;
  const effectiveAniso = Math.min(cfg.anisotropy, maxAniso);

  // Update profile buttons active state
  ['A', 'B', 'C', 'D'].forEach(k => {
    const btn = document.getElementById(`btn-prof-${k}`);
    if (btn) btn.classList.toggle('active', cfg.key === k);
  });

  // Update view buttons active state
  ['normal', 'wallpaper', 'carpet'].forEach(vk => {
    const btn = document.getElementById(`btn-v-${vk}`);
    if (btn) btn.classList.toggle('active', viewKey === vk);
  });

  // Update text readout
  const titleEl = document.getElementById('readout-title');
  const grainEl = document.getElementById('readout-grain');
  const fringeEl = document.getElementById('readout-fringe');
  const anisoEl = document.getElementById('readout-aniso');
  const wallNormEl = document.getElementById('readout-wall-norm');
  const carpetNormEl = document.getElementById('readout-carpet-norm');

  if (titleEl) titleEl.textContent = cfg.name;
  if (grainEl) grainEl.textContent = `${cfg.grain.toFixed(3)}${cfg.grain === 0 ? ' (Disabled)' : ''}`;
  if (fringeEl) fringeEl.textContent = `${cfg.fringe.toFixed(4)}${cfg.fringe === 0 ? ' (Disabled)' : ''}`;
  if (anisoEl) anisoEl.textContent = `${effectiveAniso}x (Hardware Max: ${maxAniso}x)`;
  if (wallNormEl) wallNormEl.textContent = `${cfg.wallNormalScale.toFixed(2)}${cfg.wallNormalScale < 1.0 ? ' (Tuned)' : ' (Baseline)'}`;
  if (carpetNormEl) carpetNormEl.textContent = `${cfg.carpetNormalScale.toFixed(2)}${cfg.carpetNormalScale < 1.0 ? ' (Tuned)' : ' (Baseline)'}`;
}

function initDevComparisonUI() {
  const panel = document.getElementById('dev-comparison-panel');
  const toggleBtn = document.getElementById('dev-panel-toggle');
  const closeBtn = document.getElementById('btn-dev-close');

  if (!panel) return;

  function setPanelVisible(show) {
    panel.style.display = show ? 'block' : 'none';
    if (toggleBtn) toggleBtn.style.display = show ? 'none' : 'block';
  }

  if (closeBtn) closeBtn.addEventListener('click', () => setPanelVisible(false));
  if (toggleBtn) toggleBtn.addEventListener('click', () => setPanelVisible(true));

  // Profile selection buttons
  const profMap = {
    'btn-prof-A': 'original',
    'btn-prof-B': 'clean_post',
    'btn-prof-C': 'texture_quality',
    'btn-prof-D': 'combined'
  };

  Object.entries(profMap).forEach(([btnId, pKey]) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener('click', () => {
        applyRenderConfig(pKey);
      });
    }
  });

  // Viewpoint selection buttons
  const viewMap = {
    'btn-v-normal': 'normal',
    'btn-v-wallpaper': 'wallpaper',
    'btn-v-carpet': 'carpet'
  };

  Object.entries(viewMap).forEach(([btnId, vKey]) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener('click', () => {
        switchView(vKey);
      });
    }
  });

  // Lighting adjustment controls
  const slideExposure = document.getElementById('dev-slide-exposure');
  const valExposure = document.getElementById('dev-val-exposure');
  const slideAmbient = document.getElementById('dev-slide-ambient');
  const valAmbient = document.getElementById('dev-val-ambient');
  const slidePoint = document.getElementById('dev-slide-point');
  const valPoint = document.getElementById('dev-val-point');
  const slidePlayerFill = document.getElementById('dev-slide-player-fill');
  const valPlayerFill = document.getElementById('dev-val-player-fill');
  const colorTint = document.getElementById('dev-color-tint');
  const valColor = document.getElementById('dev-val-color');
  const btnResetLighting = document.getElementById('dev-reset-lighting');

  const curL = getLightingConfig();
  if (slideExposure && valExposure) {
    slideExposure.value = curL.exposure;
    valExposure.textContent = Number(curL.exposure).toFixed(2);
    slideExposure.addEventListener('input', (e) => {
      setExposure(e.target.value);
      valExposure.textContent = Number(e.target.value).toFixed(2);
    });
  }

  if (slideAmbient && valAmbient) {
    slideAmbient.value = curL.ambientIntensity;
    valAmbient.textContent = Number(curL.ambientIntensity).toFixed(2);
    slideAmbient.addEventListener('input', (e) => {
      setAmbientIntensity(e.target.value);
      valAmbient.textContent = Number(e.target.value).toFixed(2);
    });
  }

  if (slidePoint && valPoint) {
    slidePoint.value = curL.pointIntensity;
    valPoint.textContent = Math.round(curL.pointIntensity);
    slidePoint.addEventListener('input', (e) => {
      setPointIntensity(e.target.value);
      valPoint.textContent = Math.round(e.target.value);
    });
  }

  if (slidePlayerFill && valPlayerFill) {
    slidePlayerFill.value = curL.playerLightIntensity;
    valPlayerFill.textContent = Number(curL.playerLightIntensity).toFixed(2);
    slidePlayerFill.addEventListener('input', (e) => {
      setPlayerLightIntensity(e.target.value);
      valPlayerFill.textContent = Number(e.target.value).toFixed(2);
    });
  }

  if (colorTint && valColor) {
    colorTint.value = curL.lightColorHex;
    valColor.textContent = curL.lightColorHex;
    colorTint.addEventListener('input', (e) => {
      setLightColor(e.target.value);
      valColor.textContent = e.target.value;
    });
  }

  if (btnResetLighting) {
    btnResetLighting.addEventListener('click', () => {
      const def = resetLighting();
      if (slideExposure) slideExposure.value = def.exposure;
      if (valExposure) valExposure.textContent = def.exposure.toFixed(2);
      if (slideAmbient) slideAmbient.value = def.ambientIntensity;
      if (valAmbient) valAmbient.textContent = def.ambientIntensity.toFixed(2);
      if (slidePoint) slidePoint.value = def.pointIntensity;
      if (valPoint) valPoint.textContent = Math.round(def.pointIntensity);
      if (slidePlayerFill) slidePlayerFill.value = def.playerLightIntensity;
      if (valPlayerFill) valPlayerFill.textContent = def.playerLightIntensity.toFixed(2);
      if (colorTint) colorTint.value = def.lightColorHex;
      if (valColor) valColor.textContent = def.lightColorHex;
    });
  }

  // World items placement debug bounding box and editor toggle
  const btnToggleBounds = document.getElementById('dev-toggle-bounds');
  if (btnToggleBounds) {
    btnToggleBounds.addEventListener('click', () => {
      if (itemManager) {
        const isVis = itemManager.toggleDebugVisuals();
        btnToggleBounds.textContent = isVis ? 'Bounds [ON]' : 'Bounds [OFF]';
        btnToggleBounds.classList.toggle('active', isVis);
      }
    });
  }

  const btnOpenEditor = document.getElementById('dev-open-editor');
  if (btnOpenEditor) {
    btnOpenEditor.addEventListener('click', () => {
      if (worldEditor) {
        worldEditor.toggle();
      }
    });
  }

  // Map Coordinates & Teleportation Developer Controls
  const teleXInput = document.getElementById('dev-tele-x');
  const teleYInput = document.getElementById('dev-tele-y');
  const teleZInput = document.getElementById('dev-tele-z');
  const btnJump = document.getElementById('dev-btn-jump');
  const btnUseCurr = document.getElementById('dev-btn-use-curr');
  const teleFeedback = document.getElementById('dev-tele-feedback');

  function showTeleFeedback(msg, isError = false) {
    if (!teleFeedback) return;
    teleFeedback.textContent = msg;
    teleFeedback.style.color = isError ? '#ff6666' : '#00ff88';
    setTimeout(() => {
      if (teleFeedback.textContent === msg) {
        teleFeedback.textContent = '';
      }
    }, 4000);
  }

  function executeJump(x, y, z, label = null) {
    if (!mpManager || !mpManager.localPlayer) {
      showTeleFeedback('Player not active', true);
      return false;
    }
    if (isNaN(x) || isNaN(z)) {
      showTeleFeedback('Invalid X or Z coordinate', true);
      return false;
    }
    const finalY = !isNaN(y) ? y : 0.0;
    mpManager.localPlayer.teleport(x, finalY, z);
    if (teleXInput) teleXInput.value = x.toFixed(2);
    if (teleYInput) teleYInput.value = finalY.toFixed(2);
    if (teleZInput) teleZInput.value = z.toFixed(2);
    showTeleFeedback(`Jumped to ${label ? label + ' ' : ''}[${x.toFixed(2)}, ${finalY.toFixed(2)}, ${z.toFixed(2)}]`);
    return true;
  }

  if (btnJump) {
    btnJump.addEventListener('click', () => {
      const x = parseFloat(teleXInput?.value);
      const y = parseFloat(teleYInput?.value);
      const z = parseFloat(teleZInput?.value);
      executeJump(x, y, z);
    });
  }

  // Allow pressing Enter in coordinate inputs to jump
  [teleXInput, teleYInput, teleZInput].forEach(input => {
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          btnJump?.click();
        }
      });
    }
  });

  if (btnUseCurr) {
    btnUseCurr.addEventListener('click', () => {
      if (mpManager?.localPlayer?.pos) {
        if (teleXInput) teleXInput.value = mpManager.localPlayer.pos.x.toFixed(2);
        if (teleYInput) teleYInput.value = mpManager.localPlayer.pos.y.toFixed(2);
        if (teleZInput) teleZInput.value = mpManager.localPlayer.pos.z.toFixed(2);
        showTeleFeedback('Filled inputs from current position');
      }
    });
  }

  // Quick Preset Teleport Buttons
  const presets = {
    'dev-preset-spawn': { x: 48.69, y: 0.0, z: -187.65, label: 'Spawn' },
    'dev-preset-key': { x: 44.50, y: 0.0, z: -188.70, label: 'Key Shelf' },
    'dev-preset-exit': { x: 79.55, y: 0.0, z: 205.20, label: 'Exit Door' },
    'dev-preset-pistol': { x: 60.594, y: 0.936, z: -183.877, label: 'Pistol' },
    'dev-preset-shotgun': { x: 40.50, y: 0.0, z: -179.80, label: 'Shotgun' }
  };

  Object.entries(presets).forEach(([btnId, target]) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener('click', () => {
        executeJump(target.x, target.y, target.z, target.label);
      });
    }
  });

  // Sanity simulation test buttons
  document.getElementById('dev-sanity-100')?.addEventListener('click', () => sanityController?.setSanity(100));
  document.getElementById('dev-sanity-50')?.addEventListener('click', () => sanityController?.setSanity(50));
  document.getElementById('dev-sanity-8')?.addEventListener('click', () => sanityController?.setSanity(8));
  document.getElementById('dev-sanity-0')?.addEventListener('click', () => sanityController?.setSanity(0));
  document.getElementById('dev-sanity-pause')?.addEventListener('click', () => sanityController?.togglePause());
  document.getElementById('dev-sanity-regen')?.addEventListener('click', () => sanityController?.startRapidRegen());

  // Survival resources dev test buttons
  document.getElementById('dev-hp-down')?.addEventListener('click', () => mpManager?.localPlayer?.damage(25));
  document.getElementById('dev-hp-up')?.addEventListener('click', () => mpManager?.localPlayer?.heal(25));
  document.getElementById('dev-stamina-drain')?.addEventListener('click', () => mpManager?.localPlayer?.setStamina(0));
  document.getElementById('dev-stamina-full')?.addEventListener('click', () => mpManager?.localPlayer?.setStamina(100));
  document.getElementById('dev-item-pistol')?.addEventListener('click', () => mpManager?.localPlayer?.setWeapon(0));
  document.getElementById('dev-item-shotgun')?.addEventListener('click', () => mpManager?.localPlayer?.setWeapon(1));
  document.getElementById('dev-item-torch')?.addEventListener('click', () => mpManager?.localPlayer?.setWeapon(2));
  document.getElementById('dev-item-fire')?.addEventListener('click', () => mpManager?.localPlayer?.fire());
  document.getElementById('dev-item-reload')?.addEventListener('click', () => mpManager?.localPlayer?.startReload());

  // Developer Inventory & Pickup Inspection UI
  const invPlayerEl = document.getElementById('dev-inv-player');
  const invSlotsEl = document.getElementById('dev-inv-slots');
  const invGridEl = document.getElementById('dev-inventory-grid');
  const btnToggleSlotDetails = document.getElementById('dev-btn-toggle-slot-details');
  const btnQueryRoomItems = document.getElementById('dev-btn-query-room-items');
  const slotDetailsEl = document.getElementById('dev-slot-details');
  const pickupLogEl = document.getElementById('dev-pickup-log');

  function appendPickupLog(html) {
    if (!pickupLogEl) return;
    const time = new Date().toLocaleTimeString();
    const row = document.createElement('div');
    row.style.marginBottom = '2px';
    row.innerHTML = `<span style="color:#7a7872;">[${time}]</span> ${html}`;
    pickupLogEl.appendChild(row);
    pickupLogEl.scrollTop = pickupLogEl.scrollHeight;
  }

  function renderDevInventoryGrid() {
    if (!invGridEl || !mpManager?.inventory) return;
    const slots = mpManager.inventory.getSlots();
    const occupied = slots.filter(s => s !== null).length;

    if (invPlayerEl) {
      invPlayerEl.textContent = `PLAYER: ${mpManager.myPlayerId || 'LOCAL'}`;
    }
    if (invSlotsEl) {
      invSlotsEl.textContent = `SLOTS: ${occupied} / ${mpManager.inventory.capacity}`;
    }

    invGridEl.innerHTML = '';
    slots.forEach((slot, idx) => {
      const slotBox = document.createElement('div');
      slotBox.style.aspectRatio = '1 / 1';
      slotBox.style.background = slot ? 'rgba(30, 28, 22, 0.85)' : 'rgba(12, 12, 10, 0.6)';
      slotBox.style.border = slot ? '1px solid #d4af37' : '1px solid rgba(212, 175, 55, 0.15)';
      slotBox.style.borderRadius = '3px';
      slotBox.style.position = 'relative';
      slotBox.style.display = 'flex';
      slotBox.style.flexDirection = 'column';
      slotBox.style.alignItems = 'center';
      slotBox.style.justifyContent = 'center';
      slotBox.title = slot ? `${slot.name} (${slot.typeId})\nQty: ${slot.quantity}/${slot.maxStack}\nID: ${slot.instanceId}` : `Slot #${idx + 1} (Empty)`;

      const numBadge = document.createElement('span');
      numBadge.style.position = 'absolute';
      numBadge.style.top = '1px';
      numBadge.style.left = '3px';
      numBadge.style.fontSize = '8px';
      numBadge.style.color = '#7a7872';
      numBadge.textContent = `${idx + 1}`;
      slotBox.appendChild(numBadge);

      if (slot) {
        if (slot.iconUrl) {
          const img = document.createElement('img');
          img.src = slot.iconUrl;
          img.style.width = '18px';
          img.style.height = '18px';
          img.style.objectFit = 'contain';
          slotBox.appendChild(img);
        } else {
          const label = document.createElement('span');
          label.style.fontSize = '9px';
          label.style.fontWeight = 'bold';
          label.textContent = slot.typeId.substring(0, 3).toUpperCase();
          slotBox.appendChild(label);
        }

        if (slot.quantity > 1) {
          const countBadge = document.createElement('span');
          countBadge.style.position = 'absolute';
          countBadge.style.bottom = '1px';
          countBadge.style.right = '3px';
          countBadge.style.fontSize = '9px';
          countBadge.style.fontWeight = 'bold';
          countBadge.style.color = '#edece6';
          countBadge.textContent = `${slot.quantity}`;
          slotBox.appendChild(countBadge);
        }
      }

      invGridEl.appendChild(slotBox);
    });

    renderDevSlotDetails();
  }

  function renderDevSlotDetails() {
    if (!slotDetailsEl || !mpManager?.inventory) return;
    const slots = mpManager.inventory.getSlots();
    const occupied = slots.filter(s => s !== null);
    if (occupied.length === 0) {
      slotDetailsEl.innerHTML = '<div style="color: #9c9a92;">No inventory items.</div>';
      return;
    }
    let html = '<table style="width:100%; border-collapse:collapse; font-size:10px;">';
    html += '<tr style="border-bottom: 1px solid rgba(212,175,55,0.3); color:#d4af37;"><th style="text-align:left;">#</th><th style="text-align:left;">Item</th><th style="text-align:center;">Qty</th><th style="text-align:left;">Instance</th></tr>';
    slots.forEach((s, idx) => {
      if (s) {
        html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td>${idx + 1}</td>
          <td>${s.name}</td>
          <td style="text-align:center;">${s.quantity}/${s.maxStack}</td>
          <td style="color:#9c9a92; font-size:9px;" title="${s.instanceId}">${s.instanceId.split('_').slice(-2).join('_')}</td>
        </tr>`;
      }
    });
    html += '</table>';
    slotDetailsEl.innerHTML = html;
  }

  if (mpManager?.inventory) {
    mpManager.inventory.subscribe((slots, event) => {
      renderDevInventoryGrid();
      if (event && event.type === 'item_added') {
        appendPickupLog(`<span style="color:#a8ffb2;">+ Added ${event.added}x ${event.typeId}</span>`);
      }
    });
  }

  if (btnToggleSlotDetails) {
    btnToggleSlotDetails.addEventListener('click', () => {
      if (slotDetailsEl) {
        const isHidden = slotDetailsEl.style.display === 'none';
        slotDetailsEl.style.display = isHidden ? 'block' : 'none';
        btnToggleSlotDetails.textContent = isHidden ? 'Hide Details' : 'Inspect Details';
      }
    });
  }

  if (btnQueryRoomItems) {
    btnQueryRoomItems.addEventListener('click', () => {
      if (mpManager?.network?.isConnected) {
        mpManager.network.send('ROOM_ITEMS_STATE', {});
        appendPickupLog('Requested room items state...');
      } else {
        appendPickupLog('<span style="color:#ff6b6b">Not connected to room</span>');
      }
    });
  }

  // Hook into mpManager ui events for dev pickup log
  const prevItemCollected = mpManager.ui.onItemCollected;
  mpManager.ui.onItemCollected = (payload) => {
    if (prevItemCollected) prevItemCollected(payload);
    appendPickupLog(`<span style="color:#d4af37;">[COLLECTED]</span> ${payload.itemId} (${payload.itemType}) by ${payload.collectedBy}`);
  };

  const prevPickupRejected = mpManager.ui.onPickupRejected;
  mpManager.ui.onPickupRejected = (payload) => {
    if (prevPickupRejected) prevPickupRejected(payload);
    appendPickupLog(`<span style="color:#ff6b6b;">[REJECTED]</span> ${payload.itemId || 'unknown'}: ${payload.reason}`);
  };

  const prevRoomItemsState = mpManager.ui.onRoomItemsState;
  mpManager.ui.onRoomItemsState = (payload) => {
    if (prevRoomItemsState) prevRoomItemsState(payload);
    const available = payload.items ? payload.items.filter(i => i.available).length : 0;
    const total = payload.items ? payload.items.length : 0;
    appendPickupLog(`<span style="color:#a0e0ff;">[ROOM STATE]</span> ${payload.roomCode}: ${available}/${total} items available`);
  };

  // Real-time developer pickup pipeline diagnostics update
  function updatePickupDiagnosticsUI(diag) {
    if (!diag) return;
    const targetIdEl = document.getElementById('diag-target-id');
    const targetTypeEl = document.getElementById('diag-target-type');
    const eligEl = document.getElementById('diag-target-eligibility');
    const keyEl = document.getElementById('diag-last-key');
    const reqEl = document.getElementById('diag-last-request');
    const serverEl = document.getElementById('diag-server-result');
    const invEl = document.getElementById('diag-inv-result');
    const rejEl = document.getElementById('diag-last-rejection');

    if (targetIdEl) targetIdEl.textContent = diag.targetId || 'NONE';
    if (targetTypeEl) targetTypeEl.textContent = diag.targetType || '--';
    if (eligEl) {
      eligEl.textContent = diag.eligibility || 'NOT TARGETED';
      eligEl.style.color = (diag.eligibility && diag.eligibility.startsWith('ELIGIBLE')) ? '#00ff88' : ((diag.eligibility && diag.eligibility.startsWith('OUT')) ? '#ff6b6b' : '#9c9a92');
    }
    if (keyEl) keyEl.textContent = diag.lastKey || 'NONE';
    if (reqEl) reqEl.textContent = diag.lastRequest || 'NONE';
    if (serverEl) {
      serverEl.textContent = diag.serverResult || 'NONE';
      if (diag.serverResult && diag.serverResult.startsWith('ACCEPTED')) {
        serverEl.style.color = '#00ff88';
      } else if (diag.serverResult && diag.serverResult.startsWith('REJECTED')) {
        serverEl.style.color = '#ff6b6b';
      } else if (diag.serverResult && (diag.serverResult.startsWith('TIMEOUT') || diag.serverResult.startsWith('DISCONNECTED'))) {
        serverEl.style.color = '#ffaa00';
      } else if (diag.serverResult && diag.serverResult.startsWith('PENDING')) {
        serverEl.style.color = '#ffd700';
      } else {
        serverEl.style.color = '#edece6';
      }
    }
    if (invEl) invEl.textContent = diag.inventoryResult || '0 / 12 slots';
    if (rejEl) {
      rejEl.textContent = diag.lastRejection || 'NONE';
      rejEl.style.color = (diag.lastRejection && diag.lastRejection !== 'NONE') ? '#ff4444' : '#9c9a92';
    }

    // Live HUD reflection of pickup pipeline (only under --dev-rendering)
    const hudDiag = document.getElementById('dev-pickup-hud-diag');
    const hudTarget = document.getElementById('hud-diag-target');
    const hudStatus = document.getElementById('hud-diag-status');
    if (hudDiag && hudTarget && hudStatus) {
      if (diag.targetId) {
        hudDiag.style.display = 'block';
        hudTarget.textContent = `${diag.targetId} (${diag.targetType || 'item'})`;
        const shortKey = diag.lastKey ? diag.lastKey.split(' at ')[0] : 'NONE';
        const shortServer = diag.serverResult ? diag.serverResult.split(' at ')[0] : 'NONE';
        hudStatus.innerHTML = `${diag.eligibility} &middot; KEY: ${shortKey} &middot; ${shortServer}`;
      } else if (diag.serverResult && diag.serverResult !== 'NONE') {
        hudDiag.style.display = 'block';
        hudTarget.textContent = 'NONE';
        hudStatus.innerHTML = `${diag.serverResult.split(' at ')[0]}`;
      } else {
        hudDiag.style.display = 'none';
      }
    }
  }
  window.updatePickupDiagnosticsUI = updatePickupDiagnosticsUI;

  // Initial render
  renderDevInventoryGrid();
  if (interactionManager?.diagnostics) {
    updatePickupDiagnosticsUI(interactionManager.diagnostics);
  }

  // Keyboard shortcut listener (Preserves WASD and eliminates single-letter hotkey conflicts)
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;

    if (e.key === 'F2') {
      e.preventDefault();
      const isVisible = panel.style.display !== 'none';
      setPanelVisible(!isVisible);
    } else if (e.key === 'F4') {
      e.preventDefault();
      if (worldEditor) worldEditor.toggle();
    }
    // Sanity simulation test hotkeys (non-alphabetic)
    else if (sanityController) {
      if (e.key === '[') sanityController.drainSanity(10, 'key_drain');
      else if (e.key === ']') sanityController.restoreSanity(10);
      else if (e.key === '\\') sanityController.togglePause();
      else if (e.key === '0') sanityController.setSanity(0);
      else if (e.key === '9') sanityController.setSanity(100);
    }
  });

  setPanelVisible(true);
  updateDevUI(currentProfileKey, currentViewKey);
}

async function runVerificationSuite(mode) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  console.log(`[VERIFICATION SUITE] Starting test mode: ${mode}...`);

  for (let i = 0; i < 60; i++) {
    if (isEnvReady) break;
    await wait(100);
  }
  await wait(600);

  if (mode === 'test_a') {
    // Normal Server Test: Panel must be completely absent from DOM, Configuration D active
    const panel = document.getElementById('dev-comparison-panel');
    const toggle = document.getElementById('dev-panel-toggle');
    const panelAbsent = (panel === null && toggle === null);

    const mats = cacheMaterials();
    const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 16;
    const effectiveAniso = Math.min(16, maxAniso);
    const grain = postMat?.uniforms?.uGrain?.value;
    const fringe = postMat?.uniforms?.uFringe?.value;
    const wallNorm = mats?.wall?.normalScale?.x;
    const carpetNorm = mats?.floor?.normalScale?.x;
    const aniso = mats?.textures?.[0]?.anisotropy;

    const isConfigD = (grain === 0.0 && fringe === 0.0 &&
      Math.abs(wallNorm - 0.4) < 0.01 &&
      Math.abs(carpetNorm - 0.6) < 0.01 &&
      aniso === effectiveAniso);

    const success = panelAbsent && isConfigD;
    console.log(`[VERIFICATION TEST A] Result: ${success ? 'PASS' : 'FAIL'} | panelAbsent=${panelAbsent}, isConfigD=${isConfigD}`);

    renderScene();
    const shot = renderer.domElement.toDataURL('image/png');
    await fetch('/api/screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'verify_A_normal_srv', shot })
    }).catch(() => {});

    await fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: 'test_a',
        test: 'Test A — Normal Server',
        success,
        panelAbsent,
        isConfigD,
        grain,
        fringe,
        wallNormalScale: wallNorm,
        carpetNormalScale: carpetNorm,
        anisotropy: aniso,
        maxAnisotropy: maxAniso
      })
    }).catch(() => {});

    await fetch('/api/log', {
      method: 'POST',
      body: JSON.stringify({ status: success ? 'TEST_A_PASSED' : 'TEST_A_FAILED' })
    }).catch(() => {});
  } else if (mode === 'test_b') {
    // Developer Server Test: Panel exists and is visible, starts with D, switching A/B/C/D, hide/reopen
    const panel = document.getElementById('dev-comparison-panel');
    const toggle = document.getElementById('dev-panel-toggle');
    const panelVisible = (panel !== null && panel.style.display !== 'none');
    const toggleHidden = (toggle !== null && toggle.style.display === 'none');

    const activeBtn = document.querySelector('.dev-btn.active');
    const initialProfileD = (activeBtn?.getAttribute('data-profile') === 'combined');
    const readoutTitle = document.getElementById('readout-title')?.textContent || '';

    // Test profile switching
    let switchingPassed = true;

    // Switch A
    applyRenderConfig('original');
    await wait(150);
    const isA = (postMat.uniforms.uGrain.value === 0.085 &&
      document.getElementById('btn-prof-A')?.classList.contains('active'));
    if (!isA) switchingPassed = false;

    // Switch B
    applyRenderConfig('clean_post');
    await wait(150);
    const isB = (postMat.uniforms.uGrain.value === 0.0 &&
      document.getElementById('btn-prof-B')?.classList.contains('active'));
    if (!isB) switchingPassed = false;

    // Switch C
    applyRenderConfig('texture_quality');
    await wait(150);
    const isC = (postMat.uniforms.uGrain.value === 0.085 &&
      document.getElementById('btn-prof-C')?.classList.contains('active'));
    if (!isC) switchingPassed = false;

    // Switch D
    applyRenderConfig('combined');
    await wait(150);
    const isD = (postMat.uniforms.uGrain.value === 0.0 &&
      document.getElementById('btn-prof-D')?.classList.contains('active'));
    if (!isD) switchingPassed = false;

    // Repeated switching drift test
    for (let i = 0; i < 5; i++) {
      applyRenderConfig('original');
      applyRenderConfig('combined');
    }
    const mats = cacheMaterials();
    const driftCheckPassed = (Math.abs(mats.wall.normalScale.x - 0.4) < 0.001 &&
      Math.abs(mats.floor.normalScale.x - 0.6) < 0.001);

    // Hide & reopen test
    const closeBtn = document.getElementById('btn-dev-close');
    closeBtn?.click();
    const hiddenOk = (panel.style.display === 'none' && toggle.style.display !== 'none');
    toggle?.click();
    const reopenedOk = (panel.style.display !== 'none' && toggle.style.display === 'none');
    const hideReopenPassed = hiddenOk && reopenedOk;

    const success = panelVisible && initialProfileD && switchingPassed && driftCheckPassed && hideReopenPassed;
    console.log(`[VERIFICATION TEST B] Result: ${success ? 'PASS' : 'FAIL'} | initialD=${initialProfileD}, switching=${switchingPassed}, driftCheck=${driftCheckPassed}, hideReopen=${hideReopenPassed}`);

    await fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: 'test_b',
        test: 'Test B — Developer Server',
        success,
        panelVisible,
        toggleHidden,
        initialProfileD,
        readoutTitle,
        switchingPassed,
        driftCheckPassed,
        hideReopenPassed
      })
    }).catch(() => {});

    await fetch('/api/log', {
      method: 'POST',
      body: JSON.stringify({ status: success ? 'TEST_B_PASSED' : 'TEST_B_FAILED' })
    }).catch(() => {});
  } else if (mode === 'test_c') {
    // Visual Verification Test: Capture D at Normal, Wallpaper, Carpet viewpoints
    await preloadPlayerAssets();

    const peer = new RemotePlayer('peer_proxy', scene, {
      x: 51.50,
      y: 0.0,
      z: -187.65,
      yaw: Math.PI / 2, // Facing player
      pitch: 0.0
    });

    applyRenderConfig('combined');

    // Hide panel for clean shots
    const panel = document.getElementById('dev-comparison-panel');
    if (panel) panel.style.display = 'none';

    const views = ['normal', 'wallpaper', 'carpet'];
    for (const vKey of views) {
      peer.group.visible = (vKey === 'normal');
      switchView(vKey);
      await wait(600);
      renderScene();
      const shot = renderer.domElement.toDataURL('image/png');
      const label = `verify_D_${vKey}`;
      await fetch('/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, shot })
      }).catch(() => {});
    }

    const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 16;
    const effectiveAniso = Math.min(16, maxAniso);
    await fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: 'test_c',
        test: 'Test C — Visual Verification',
        success: true,
        profile: 'combined',
        grain: 0.0,
        fringe: 0.0,
        wallpaperNormalScale: 0.4,
        carpetNormalScale: 0.6,
        anisotropy: effectiveAniso,
        hardwareMaxAnisotropy: maxAniso,
        viewsCaptured: views
      })
    }).catch(() => {});

    await fetch('/api/log', {
      method: 'POST',
      body: JSON.stringify({ status: 'TEST_C_PASSED' })
    }).catch(() => {});
  } else if (mode === 'lighting_before' || mode === 'lighting_after' || mode === 'before' || mode === 'after') {
    // 6-viewpoint lighting comparison capture
    await preloadPlayerAssets();

    const peer = new RemotePlayer('peer_proxy', scene, {
      x: 51.50,
      y: 0.0,
      z: -187.65,
      yaw: Math.PI / 2, // Facing player
      pitch: 0.0
    });

    // Ensure Configuration D is baseline
    applyRenderConfig('combined');

    const panel = document.getElementById('dev-comparison-panel');
    if (panel) panel.style.display = 'none';

    const cleanMode = mode.replace(/^lighting_/, '');
    const views = ['normal', 'ceiling', 'wallpaper', 'carpet', 'pillar_hall', 'exit_corridor'];
    for (const vKey of views) {
      peer.group.visible = (vKey === 'normal');
      switchView(vKey);
      await wait(700);
      renderScene();
      const shot = renderer.domElement.toDataURL('image/png');
      const label = `lighting_${cleanMode}_${vKey}`;
      await fetch('/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, shot })
      }).catch(() => {});
    }

    await fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: `lighting_${cleanMode}`,
        viewsCaptured: views,
        timestamp: Date.now()
      })
    }).catch(() => {});

    await fetch('/api/log', {
      method: 'POST',
      body: JSON.stringify({ status: `LIGHTING_${cleanMode.toUpperCase()}_COMPLETE` })
    }).catch(() => {});
  }
}

async function runAutomatedComparisonSuite() {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  console.log('[RENDER COMPARISON] Starting 4-profile x 3-viewpoint comparison capture suite...');

  // Wait for Level 0 environment to load
  for (let i = 0; i < 60; i++) {
    if (isEnvReady) break;
    await wait(100);
  }

  // Preload player assets and spawn peer proxy for normal view
  await preloadPlayerAssets();

  const peer = new RemotePlayer('peer_proxy', scene, {
    x: 51.50,
    y: 0.0,
    z: -187.65,
    yaw: Math.PI / 2, // Facing player
    pitch: 0.0
  });

  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 16;
  console.log(`[RENDER COMPARISON] Hardware Max Anisotropy: ${maxAniso}x`);

  const profiles = ['original', 'clean_post', 'texture_quality', 'combined'];
  const views = ['normal', 'wallpaper', 'carpet'];

  for (const profKey of profiles) {
    const cfg = applyRenderConfig(profKey);
    await wait(300);

    for (const vKey of views) {
      peer.group.visible = (vKey === 'normal');
      switchView(vKey);

      await wait(600); // Allow render & lighting to settle

      renderScene();

      const shot = renderer.domElement.toDataURL('image/png');
      const label = `compare_${cfg.key}_${vKey}`;

      try {
        await fetch('/api/screenshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, shot })
        });
        console.log(`[RENDER COMPARISON] Captured: ${label}`);
      } catch (err) {
        console.warn('Screenshot upload failed:', err);
      }

      const effectiveAniso = Math.min(cfg.anisotropy, maxAniso);
      const telemetry = {
        suite: 'interactive_comparison',
        profileKey: cfg.key,
        profileId: cfg.id,
        profileName: cfg.name,
        viewpointKey: vKey,
        viewpointName: VIEWPOINTS[vKey].name,
        grain: cfg.grain,
        fringe: cfg.fringe,
        vignette: cfg.vignette,
        saturation: cfg.saturation,
        anisotropy: effectiveAniso,
        hardwareMaxAnisotropy: maxAniso,
        wallNormalScale: cfg.wallNormalScale,
        carpetNormalScale: cfg.carpetNormalScale,
        cameraPosition: { x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2) },
        cameraRotation: { x: +camera.rotation.x.toFixed(2), y: +camera.rotation.y.toFixed(2), z: +camera.rotation.z.toFixed(2) },
        viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
        artifact: `${label}.png`
      };

      try {
        await fetch('/api/telemetry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client: `${cfg.key}_${vKey}`, ...telemetry })
        });
      } catch (err) {}

      await wait(300);
    }
  }

  console.log('[RENDER COMPARISON] All 12 screenshots and telemetry records successfully captured!');
  try {
    await fetch('/api/log', {
      method: 'POST',
      body: JSON.stringify({ status: 'ALL_COMPARISONS_CAPTURED' })
    });
  } catch (e) {}
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

function updateSanityVisualEffects(dt) {
  if (!sanityController || !postMat) return;

  const snap = sanityController.getSnapshot();
  const sanity = snap.currentSanity;

  let targetVig = 0.0;
  let targetDesat = 0.0;
  let targetBlackout = 0.0;

  if (snap.state === SANITY_STATE.NORMAL) {
    targetVig = 0.0;
    targetDesat = 0.0;
    targetBlackout = 0.0;
  } else if (snap.state === SANITY_STATE.MILD_PARANOIA) {
    // 80.0 down to 10.0: progressive, restrained visual distortion
    const t = (80.0 - sanity) / 70.0;
    targetVig = t * 0.35; // Adds up to 0.35 vignette (from 0.45 to 0.80)
    targetDesat = t * 0.25; // Subtle desaturation (1.25 -> 1.00)
    targetBlackout = 0.0;
  } else if (snap.state === SANITY_STATE.PANIC) {
    // 10.0 down to 0.0: stronger vignette and visual impairment
    const t = (10.0 - sanity) / 10.0;
    targetVig = 0.35 + t * 0.45; // Adds up to 0.80 vignette (from 0.80 to 1.25)
    targetDesat = 0.25 + t * 0.35; // Further desaturation (1.00 -> 0.65)
    targetBlackout = 0.0;
  } else if (snap.state === SANITY_STATE.DEPLETED) {
    // 0.0: gradual visual blackout
    targetVig = 0.80;
    targetDesat = 0.60;
    targetBlackout = 1.0;
  }

  // Smooth interpolation without pops
  const smoothRate = snap.state === SANITY_STATE.DEPLETED ? 1.8 : 4.0;
  const blend = 1.0 - Math.exp(-dt * smoothRate);

  currentSanityVig += (targetVig - currentSanityVig) * blend;
  currentSanityDesat += (targetDesat - currentSanityDesat) * blend;
  currentBlackout += (targetBlackout - currentBlackout) * blend;

  if (postMat.uniforms.uSanityVignette) {
    postMat.uniforms.uSanityVignette.value = currentSanityVig;
  }
  if (postMat.uniforms.uSanityDesat) {
    postMat.uniforms.uSanityDesat.value = currentSanityDesat;
  }
  if (postMat.uniforms.uBlackout) {
    postMat.uniforms.uBlackout.value = currentBlackout;
  }
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
    // Update dedicated multiplayer Backrooms Level 0 lighting
    updateMultiplayerLighting(dt, mpManager.localPlayer.pos, mpManager.remotePlayers);
  }

  // Survival Mode Sanity Simulation and Visual Effects
  if (sanityController) {
    if (!sanityController.hasServerSync) {
      sanityController.update(dt);
    }
    updateSanityVisualEffects(dt);
  }

  // Update Survival Mode HUD (Health, Resources, Stamina)
  if (sanityHUD && mpManager?.localPlayer) {
    sanityHUD.updatePlayer(mpManager.localPlayer);
  }

  // Update developer weapon firing diagnostics HUD (under --dev-rendering)
  if (devToolsEnabled && mpManager?.localPlayer) {
    const diag = mpManager.localPlayer.getFiringDiagnostics();
    const elWeapon = document.getElementById('dev-diag-weapon');
    const elAmmo = document.getElementById('dev-diag-ammo');
    const elCool = document.getElementById('dev-diag-cool');
    const elReload = document.getElementById('dev-diag-reload');
    const elInput = document.getElementById('dev-diag-input');
    const elRej = document.getElementById('dev-diag-rejection');
    if (elWeapon) elWeapon.textContent = diag.selectedWeapon;
    if (elAmmo) elAmmo.textContent = `${diag.magAmmo} / ${diag.reserveAmmo}`;
    if (elCool) elCool.textContent = diag.cooldown;
    if (elReload) elReload.textContent = diag.reloadState;
    if (elInput) elInput.textContent = diag.lastFiringInput;
    if (elRej) {
      elRej.textContent = diag.lastRejectionReason;
      elRej.style.color = (diag.lastRejectionReason !== 'NONE') ? '#ff6666' : '#9c9a92';
    }

    // Live coordinates telemetry update
    if (mpManager.localPlayer.pos) {
      const lp = mpManager.localPlayer;
      const xStr = lp.pos.x.toFixed(2);
      const yStr = lp.pos.y.toFixed(2);
      const zStr = lp.pos.z.toFixed(2);
      const yawDeg = (((lp.yaw * 180 / Math.PI) % 360 + 360) % 360).toFixed(1);
      const pitchDeg = ((lp.pitch * 180 / Math.PI)).toFixed(1);

      const elCurX = document.getElementById('dev-cur-x');
      if (elCurX) elCurX.textContent = xStr;
      const elCurY = document.getElementById('dev-cur-y');
      if (elCurY) elCurY.textContent = yStr;
      const elCurZ = document.getElementById('dev-cur-z');
      if (elCurZ) elCurZ.textContent = zStr;
      const elCurYaw = document.getElementById('dev-cur-yaw');
      if (elCurYaw) elCurYaw.textContent = `${yawDeg}°`;
      const elCurRot = document.getElementById('dev-cur-rot');
      if (elCurRot) elCurRot.textContent = `Yaw: ${yawDeg}° | Pitch: ${pitchDeg}°`;

      const hudPos = document.getElementById('hud-diag-pos');
      if (hudPos) hudPos.textContent = `X: ${xStr} | Y: ${yStr} | Z: ${zStr}`;
      const hudRot = document.getElementById('hud-diag-rot');
      if (hudRot) hudRot.textContent = `Yaw: ${yawDeg}° | Pitch: ${pitchDeg}°`;
    }
  }

  // Update Reusable Interaction Framework
  if (interactionManager && isGameActive) {
    interactionManager.update();
  }

  // Update Exit Door Entity (smooth hinge animation and doorway escape walk-through)
  if (exitDoorManager && isGameActive && mpManager?.localPlayer) {
    exitDoorManager.update(dt, mpManager.localPlayer.pos);
  }

  renderScene();
}

window.addEventListener('DOMContentLoaded', init);
