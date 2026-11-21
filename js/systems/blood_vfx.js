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
 * Positions directly on the character surface with a small outward normal offset (~2mm),
 * attaches to the character group so it moves synchronously with Saber,
 * and maintains camera-facing billboarding with randomized roll variation.
 *
 * @param {THREE.Vector3} hitPoint - World position of bullet impact on Saber
 * @param {boolean} isHeadshot - Whether this hit is a critical headshot
 * @param {THREE.Vector3|null} [hitNormal=null] - Outward surface normal at hit location
 * @param {THREE.Object3D|null} [targetParent=null] - Character group to attach to
 * @param {string} [mode='sprite'] - 'sprite' (60fps atlas) or 'video' (WebM VideoTexture)
 */
export function spawnBloodImpact(hitPoint, isHeadshot = false, hitNormal = null, targetParent = null, mode = 'sprite') {
  if (!vfxScene || !vfxCamera) return;

  if (mode === 'video') {
    spawnVideoImpact(hitPoint, isHeadshot, hitNormal, targetParent);
    return;
  }

  // Find an available instance from pool, or recycle oldest active
  let impact = impactPool.find(item => !item.active);
  if (!impact) {
    impact = activeImpacts.shift(); // recycle oldest
    if (impact && impact.attachedTo) {
      impact.attachedTo.remove(impact.mesh);
      vfxScene.add(impact.mesh);
      impact.attachedTo = null;
    }
  }
  if (!impact) return;

  impact.active = true;
  impact.elapsed = 0;
  impact.duration = ANIM_DURATION;
  impact.roll = Math.random() * Math.PI * 2;

  // Determine surface normal vector pointing outward from character surface
  let norm = null;
  if (hitNormal && hitNormal.lengthSq() > 0.0001) {
    norm = hitNormal.clone().normalize();
  } else {
    norm = new THREE.Vector3().subVectors(vfxCamera.position, hitPoint).normalize();
  }

  // Position directly on the mesh surface with a small outward offset (2mm = 0.002m)
  // along the surface normal to prevent Z-fighting and ensure it sits on top of the mesh
  const surfacePos = hitPoint.clone().addScaledVector(norm, 0.002);

  // Scale: 0.85m to 1.15m for body shot, 1.1m to 1.35m for headshot
  const baseScale = isHeadshot ? 1.2 : 0.95;
  const scaleVar = baseScale * (0.9 + Math.random() * 0.2);

  if (targetParent) {
    targetParent.add(impact.mesh);
    impact.attachedTo = targetParent;
    impact.mesh.position.copy(targetParent.worldToLocal(surfacePos.clone()));

    // Compensate for targetParent's local transform scale (e.g. Mixamo model scale ~0.0105)
    // so world size is always authentic ~0.95m - 1.25m across all parent coordinate spaces
    const parentScale = new THREE.Vector3();
    targetParent.getWorldScale(parentScale);
    const sx = scaleVar / (parentScale.x || 1);
    const sy = scaleVar / (parentScale.y || 1);
    const sz = scaleVar / (parentScale.z || 1);
    impact.mesh.scale.set(sx, sy, sz);

    const localQuat = targetParent.quaternion.clone().invert().multiply(vfxCamera.quaternion);
    impact.mesh.quaternion.copy(localQuat);
    impact.mesh.rotateZ(impact.roll);
  } else {
    vfxScene.add(impact.mesh);
    impact.attachedTo = null;
    impact.mesh.position.copy(surfacePos);
    impact.mesh.quaternion.copy(vfxCamera.quaternion);
    impact.mesh.rotateZ(impact.roll);
    impact.mesh.scale.set(scaleVar, scaleVar, 1);
  }

  // Reset UV offset to frame 0
  impact.tex.offset.set(0, (GRID_SIZE - 1) / GRID_SIZE);
  impact.mesh.visible = true;

  if (!activeImpacts.includes(impact)) {
    activeImpacts.push(impact);
  }
}

function spawnVideoImpact(hitPoint, isHeadshot, hitNormal, targetParent) {
  let vItem = videoPool.find(v => !v.active);
  if (!vItem) {
    vItem = videoPool[0]; // reuse first
    if (vItem && vItem.attachedTo) {
      vItem.attachedTo.remove(vItem.mesh);
      vfxScene.add(vItem.mesh);
      vItem.attachedTo = null;
    }
  }
  if (!vItem) return;

  vItem.active = true;
  vItem.roll = Math.random() * Math.PI * 2;
  let norm = null;
  if (hitNormal && hitNormal.lengthSq() > 0.0001) {
    norm = hitNormal.clone().normalize();
  } else {
    norm = new THREE.Vector3().subVectors(vfxCamera.position, hitPoint).normalize();
  }

  const surfacePos = hitPoint.clone().addScaledVector(norm, 0.002);
  const baseScale = isHeadshot ? 1.2 : 0.95;

  if (targetParent) {
    targetParent.add(vItem.mesh);
    vItem.attachedTo = targetParent;
    vItem.mesh.position.copy(targetParent.worldToLocal(surfacePos.clone()));

    const parentScale = new THREE.Vector3();
    targetParent.getWorldScale(parentScale);
    const sx = baseScale / (parentScale.x || 1);
    const sy = baseScale / (parentScale.y || 1);
    const sz = baseScale / (parentScale.z || 1);
    vItem.mesh.scale.set(sx, sy, sz);

    const localQuat = targetParent.quaternion.clone().invert().multiply(vfxCamera.quaternion);
    vItem.mesh.quaternion.copy(localQuat);
    vItem.mesh.rotateZ(vItem.roll);
  } else {
    vfxScene.add(vItem.mesh);
    vItem.attachedTo = null;
    vItem.mesh.position.copy(surfacePos);
    vItem.mesh.quaternion.copy(vfxCamera.quaternion);
    vItem.mesh.rotateZ(vItem.roll);
    vItem.mesh.scale.set(baseScale, baseScale, 1);
  }

  vItem.mesh.visible = true;

  vItem.video.currentTime = 0;
  vItem.video.play().catch(() => {});

  vItem.video.onended = () => {
    if (vItem.attachedTo) {
      vItem.attachedTo.remove(vItem.mesh);
      vfxScene.add(vItem.mesh);
      vItem.attachedTo = null;
    }
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
      // Completed playback - detach and return to pool
      if (impact.attachedTo) {
        impact.attachedTo.remove(impact.mesh);
        vfxScene.add(impact.mesh);
        impact.attachedTo = null;
      }
      impact.mesh.visible = false;
      impact.active = false;
      activeImpacts.splice(i, 1);
      continue;
    }

    // Billboarding: Keep quad facing camera while preserving character attachment and random roll
    if (impact.attachedTo) {
      const localQuat = impact.attachedTo.quaternion.clone().invert().multiply(vfxCamera.quaternion);
      impact.mesh.quaternion.copy(localQuat);
      impact.mesh.rotateZ(impact.roll);
    } else {
      impact.mesh.quaternion.copy(vfxCamera.quaternion);
      impact.mesh.rotateZ(impact.roll);
    }

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
 * Detaches any impacts currently parented to a specific object or its descendants.
 * Called when an enemy is defeated or removed.
 * @param {THREE.Object3D} target
 */
export function detachFrom(target) {
  if (!target || !vfxScene) return;
  for (const impact of activeImpacts) {
    if (impact.attachedTo === target || (impact.mesh.parent && isDescendant(impact.mesh.parent, target))) {
      impact.mesh.parent.remove(impact.mesh);
      vfxScene.add(impact.mesh);
      impact.attachedTo = null;
    }
  }
  for (const vItem of videoPool) {
    if (vItem.attachedTo === target || (vItem.mesh.parent && isDescendant(vItem.mesh.parent, target))) {
      vItem.mesh.parent.remove(vItem.mesh);
      vfxScene.add(vItem.mesh);
      vItem.attachedTo = null;
    }
  }
}

function isDescendant(node, ancestor) {
  let cur = node;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * Resets all active blood impacts (e.g. on level change or restart).
 */
export function cleanupBloodVFX() {
  for (const impact of activeImpacts) {
    if (impact.attachedTo) {
      impact.attachedTo.remove(impact.mesh);
      vfxScene.add(impact.mesh);
      impact.attachedTo = null;
    }
    impact.mesh.visible = false;
    impact.active = false;
  }
  activeImpacts.length = 0;

  for (const vItem of videoPool) {
    if (vItem.attachedTo) {
      vItem.attachedTo.remove(vItem.mesh);
      vfxScene.add(vItem.mesh);
      vItem.attachedTo = null;
    }
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
    detachFrom: detachFrom,
    getActiveCount: getActiveImpactCount,
    getTotalPooled: getTotalPooled
  };
}
