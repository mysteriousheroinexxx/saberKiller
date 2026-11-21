// Authentic Blood Splash Visual Effects System
// Integrates bulletHit.mov (converted to 64-frame sprite sheet & VP9 WebM with alpha)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.module.js';

const TOTAL_FRAMES = 64;
const GRID_SIZE = 8;
const ANIM_DURATION = 1.07; // 64 frames @ 60fps ~ 1.07s
const MAX_POOL_SIZE = 16;

let vfxScene = null;
let vfxCamera = null;
let baseTexture = null;
let sharedGeometry = null;

// Pool of active and available impact objects
const impactPool = [];
const activeImpacts = [];

// Video texture pool for video-mode playback
const videoPool = [];

export function initBloodVFX(scene, camera) {
  vfxScene = scene;
  vfxCamera = camera;

  if (sharedGeometry) return; // already initialized

  sharedGeometry = new THREE.PlaneGeometry(1, 1);

  // Load the 8x8 sprite sheet atlas (WebP with alpha, fallback to PNG)
  const loader = new THREE.TextureLoader();
  const texturePath = 'assets/vfx/bulletHit_sheet.webp';

  baseTexture = loader.load(texturePath, (tex) => {
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.encoding = THREE.sRGBEncoding;
    console.log('[BloodVFX] Blood splash WebP atlas loaded successfully.');
  }, undefined, (err) => {
    console.warn('[BloodVFX] WebP load error, falling back to PNG:', err);
    loader.load('assets/vfx/bulletHit_sheet.png', (tex) => {
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.encoding = THREE.sRGBEncoding;
      baseTexture.image = tex.image;
      baseTexture.needsUpdate = true;
    });
  });

  // Pre-allocate mesh pool
  for (let i = 0; i < MAX_POOL_SIZE; i++) {
    const texInstance = baseTexture.clone();
    texInstance.repeat.set(1 / GRID_SIZE, 1 / GRID_SIZE);
    texInstance.offset.set(0, 7 / GRID_SIZE); // start at tile 0 (top-left)

    const mat = new THREE.MeshStandardMaterial({
      map: texInstance,
      transparent: true,
      alphaTest: 0.005,
      depthTest: true,
      depthWrite: false,
      roughness: 0.35,
      metalness: 0.05,
      emissive: new THREE.Color(0x180202),
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(sharedGeometry, mat);
    mesh.visible = false;
    mesh.renderOrder = 99; // Render over character geometry cleanly
    scene.add(mesh);

    impactPool.push({
      mesh,
      tex: texInstance,
      active: false,
      elapsed: 0,
      duration: ANIM_DURATION,
      mode: 'sprite'
    });
  }

  // Pre-allocate video pool for WebM video texture mode
  for (let i = 0; i < 4; i++) {
    const video = document.createElement('video');
    video.src = 'assets/vfx/bulletHit.webm';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const videoTex = new THREE.VideoTexture(video);
    videoTex.minFilter = THREE.LinearFilter;
    videoTex.magFilter = THREE.LinearFilter;
    videoTex.format = THREE.RGBAFormat;
    videoTex.encoding = THREE.sRGBEncoding;

    const vMat = new THREE.MeshBasicMaterial({
      map: videoTex,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const vMesh = new THREE.Mesh(sharedGeometry, vMat);
    vMesh.visible = false;
    vMesh.renderOrder = 99;
    scene.add(vMesh);

    videoPool.push({
      video,
      mesh: vMesh,
      tex: videoTex,
      active: false
    });
  }
}

/**
 * Spawns a physical 3D blood impact at the specified bullet hit location.
 * @param {THREE.Vector3} hitPoint - World position of bullet impact on Saber
 * @param {boolean} isHeadshot - Whether this hit is a critical headshot
 * @param {string} [mode='sprite'] - 'sprite' (60fps atlas) or 'video' (WebM VideoTexture)
 */
export function spawnBloodImpact(hitPoint, isHeadshot = false, mode = 'sprite') {
  if (!vfxScene || !vfxCamera) return;

  if (mode === 'video') {
    spawnVideoImpact(hitPoint, isHeadshot);
    return;
  }

  // Find an available instance from pool, or recycle oldest active
  let impact = impactPool.find(item => !item.active);
  if (!impact) {
    impact = activeImpacts.shift(); // recycle oldest
  }
  if (!impact) return;

  impact.active = true;
  impact.elapsed = 0;
  impact.duration = ANIM_DURATION;

  // Direction from hit point towards camera
  const toCam = new THREE.Vector3().subVectors(vfxCamera.position, hitPoint).normalize();

  // Position slightly in front of Saber's surface towards the camera to prevent clipping
  impact.mesh.position.copy(hitPoint).addScaledVector(toCam, 0.06);

  // Align quad to face camera with random Z roll
  impact.mesh.quaternion.copy(vfxCamera.quaternion);
  impact.mesh.rotateZ(Math.random() * Math.PI * 2);

  // Scale: 0.85m to 1.15m for body shot, 1.1m to 1.35m for headshot
  const baseScale = isHeadshot ? 1.25 : 0.95;
  const scaleVar = baseScale * (0.9 + Math.random() * 0.2);
  impact.mesh.scale.set(scaleVar, scaleVar, 1);

  // Reset UV offset to frame 0
  impact.tex.offset.set(0, (GRID_SIZE - 1) / GRID_SIZE);
  impact.mesh.visible = true;

  if (!activeImpacts.includes(impact)) {
    activeImpacts.push(impact);
  }
}

function spawnVideoImpact(hitPoint, isHeadshot) {
  let vItem = videoPool.find(v => !v.active);
  if (!vItem) {
    vItem = videoPool[0]; // reuse first
  }
  if (!vItem) return;

  vItem.active = true;
  const toCam = new THREE.Vector3().subVectors(vfxCamera.position, hitPoint).normalize();
  vItem.mesh.position.copy(hitPoint).addScaledVector(toCam, 0.06);
  vItem.mesh.quaternion.copy(vfxCamera.quaternion);
  vItem.mesh.rotateZ(Math.random() * Math.PI * 2);

  const baseScale = isHeadshot ? 1.25 : 0.95;
  vItem.mesh.scale.set(baseScale, baseScale, 1);
  vItem.mesh.visible = true;

  vItem.video.currentTime = 0;
  vItem.video.play().catch(() => {});

  vItem.video.onended = () => {
    vItem.mesh.visible = false;
    vItem.active = false;
    vItem.video.pause();
  };
}

/**
 * Updates all active blood impacts. Must be called every frame with delta time.
 * @param {number} dt - Frame delta time in seconds
 */
export function updateBloodVFX(dt) {
  if (!vfxCamera) return;

  for (let i = activeImpacts.length - 1; i >= 0; i--) {
    const impact = activeImpacts[i];
    impact.elapsed += dt;

    const progress = impact.elapsed / impact.duration;
    if (progress >= 1.0) {
      // Completed playback - return to pool
      impact.mesh.visible = false;
      impact.active = false;
      activeImpacts.splice(i, 1);
      continue;
    }

    // Keep impact billboarded towards the camera as the player moves
    impact.mesh.quaternion.copy(vfxCamera.quaternion);

    // Calculate current frame index in the 64-frame sequence
    const frameIndex = Math.min(TOTAL_FRAMES - 1, Math.floor(progress * TOTAL_FRAMES));
    const row = Math.floor(frameIndex / GRID_SIZE);
    const col = frameIndex % GRID_SIZE;

    // In Three.js UV coordinates, V=0 is bottom and V=1 is top.
    // Row 0 of the texture atlas is at the top of the image (V = (GRID_SIZE - 1) / GRID_SIZE)
    const u = col / GRID_SIZE;
    const v = (GRID_SIZE - 1 - row) / GRID_SIZE;

    impact.tex.offset.set(u, v);
  }
}

/**
 * Resets all active blood impacts (e.g. on level change or restart).
 */
export function cleanupBloodVFX() {
  for (const impact of activeImpacts) {
    impact.mesh.visible = false;
    impact.active = false;
  }
  activeImpacts.length = 0;

  for (const vItem of videoPool) {
    vItem.mesh.visible = false;
    vItem.active = false;
    vItem.video.pause();
  }
}

export function getActiveImpactCount() {
  return activeImpacts.length;
}

export function getTotalPooled() {
  return impactPool.length;
}

// Expose debug interface
if (typeof window !== 'undefined') {
  window.BloodVFX = {
    spawn: spawnBloodImpact,
    update: updateBloodVFX,
    cleanup: cleanupBloodVFX,
    getActiveCount: getActiveImpactCount,
    getTotalPooled: getTotalPooled
  };
}
