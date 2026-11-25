/**
 * Multiplayer Combat Impact & Blood VFX System
 *
 * Adapts Story Mode's visual effects without modifying Story Mode:
 * 1. Blood impact animation on Saber hits (64-frame 8x8 sprite sheet from assets/vfx/bulletHit_sheet.webp / .png)
 * 2. Floor blood pool decal on Saber STAGGERED collapse (assets/blood_decals_psx.glb)
 * 3. Wall bullet-impact decals aligned to wall/pillar surface normals (reuses ../systems/wall_decals.js)
 */

import {
  initWallDecals,
  spawnWallDecal,
  updateWallDecals,
  cleanupWallDecals,
  getActiveWallDecalsCount
} from '../systems/wall_decals.js';

const TOTAL_FRAMES = 64;
const GRID_SIZE = 8;
const ANIM_DURATION = 1.07; // 64 frames @ 60fps (~1.07s matching Story Mode)
const MAX_BLOOD_IMPACT_POOL = 16;

const MAX_STAGGER_DECALS = 35;
const STAGGER_DECAL_VISIBLE_SEC = 18.0;
const STAGGER_DECAL_FADE_SEC = 4.0;
const STAGGER_DECAL_TOTAL_SEC = STAGGER_DECAL_VISIBLE_SEC + STAGGER_DECAL_FADE_SEC;
const STAGGER_DECAL_SCALE = 0.62;
const STAGGER_DECAL_FLOOR_Y = 0.035;

let vfxScene = null;
let vfxCamera = null;

// Pooled 64-frame blood splash animation state
let sharedImpactGeo = null;
let baseBloodTexture = null;
const bloodImpactPool = [];
const activeBloodImpacts = [];

// Shared blood_decals_psx.glb template & active floor decals for staggered Sabers
let bloodDecalTemplate = null;
let bloodDecalLoadingPromise = null;
const pendingStaggerPositions = [];
const activeStaggerDecals = [];

function toVector3(v) {
  if (!v || typeof THREE === 'undefined' || !THREE.Vector3) return null;
  if (v instanceof THREE.Vector3) return v.clone();
  return new THREE.Vector3(v.x || 0, v.y || 0, v.z || 0);
}

function disposeStaggerDecal(entry) {
  if (!entry) return;
  if (vfxScene && entry.mesh) {
    vfxScene.remove(entry.mesh);
  }
  if (Array.isArray(entry.materials)) {
    for (const m of entry.materials) {
      if (m.material && typeof m.material.dispose === 'function') {
        m.material.dispose();
      }
    }
  }
}

function loadBloodDecalAsset() {
  if (bloodDecalTemplate || bloodDecalLoadingPromise) return bloodDecalLoadingPromise;
  if (typeof THREE === 'undefined' || typeof THREE.GLTFLoader !== 'function') return null;

  bloodDecalLoadingPromise = new THREE.GLTFLoader()
    .loadAsync('assets/blood_decals_psx.glb')
    .then((gltf) => {
      bloodDecalTemplate = gltf.scene;
      while (pendingStaggerPositions.length > 0) {
        const pos = pendingStaggerPositions.shift();
        spawnSaberStaggerBloodDecal(pos);
      }
      return bloodDecalTemplate;
    })
    .catch((err) => {
      console.warn('[ImpactVFX] Failed to load assets/blood_decals_psx.glb:', err);
      return null;
    });

  return bloodDecalLoadingPromise;
}

/**
 * Initializes pooled blood splash sprites, blood_decals_psx floor pool loader, and wall decals.
 */
export function initMultiplayerImpactVFX(scene, camera) {
  vfxScene = scene;
  vfxCamera = camera;

  if (!scene || typeof THREE === 'undefined') return;

  initWallDecals(scene);
  loadBloodDecalAsset();

  if (sharedImpactGeo) return;

  sharedImpactGeo = new THREE.PlaneGeometry(1, 1);

  const loader = new THREE.TextureLoader();
  baseBloodTexture = loader.load(
    'assets/vfx/bulletHit_sheet.webp',
    (tex) => {
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.encoding = THREE.sRGBEncoding;
    },
    undefined,
    () => {
      loader.load('assets/vfx/bulletHit_sheet.png', (tex) => {
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.encoding = THREE.sRGBEncoding;
        if (baseBloodTexture) {
          baseBloodTexture.image = tex.image;
          baseBloodTexture.needsUpdate = true;
        }
      });
    }
  );

  for (let i = 0; i < MAX_BLOOD_IMPACT_POOL; i++) {
    const texInstance = baseBloodTexture.clone();
    texInstance.repeat.set(1 / GRID_SIZE, 1 / GRID_SIZE);
    texInstance.offset.set(0, (GRID_SIZE - 1) / GRID_SIZE);

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

    const mesh = new THREE.Mesh(sharedImpactGeo, mat);
    mesh.visible = false;
    mesh.renderOrder = 99;
    mesh.raycast = () => {};
    scene.add(mesh);

    bloodImpactPool.push({
      mesh,
      tex: texInstance,
      active: false,
      elapsed: 0,
      duration: ANIM_DURATION,
      roll: 0,
      attachedTo: null
    });
  }
}

/**
 * Plays Story Mode's 64-frame blood splash animation at the exact Saber body hit position.
 */
export function spawnSaberBloodImpact(hitPoint, isHeadshot = false, hitNormal = null, targetParent = null) {
  if (!vfxScene || !vfxCamera || typeof THREE === 'undefined') return null;

  const pointVec = toVector3(hitPoint);
  if (!pointVec) return null;

  let impact = bloodImpactPool.find((item) => !item.active);
  if (!impact) {
    impact = activeBloodImpacts.shift();
    if (impact && impact.attachedTo) {
      impact.attachedTo.remove(impact.mesh);
      vfxScene.add(impact.mesh);
      impact.attachedTo = null;
    }
  }
  if (!impact) return null;

  impact.active = true;
  impact.elapsed = 0;
  impact.duration = ANIM_DURATION;
  impact.roll = Math.random() * Math.PI * 2;

  const normInput = toVector3(hitNormal);
  let norm;
  if (normInput && normInput.lengthSq() > 0.0001) {
    norm = normInput.normalize();
  } else {
    norm = new THREE.Vector3().subVectors(vfxCamera.position, pointVec).normalize();
  }

  // Offset 2mm outward along surface normal to eliminate Z-fighting
  const surfacePos = pointVec.clone().addScaledVector(norm, 0.002);

  const baseScale = isHeadshot ? 1.2 : 0.95;
  const scaleVar = baseScale * (0.9 + Math.random() * 0.2);

  if (targetParent) {
    targetParent.updateMatrixWorld(true);
    targetParent.add(impact.mesh);
    impact.attachedTo = targetParent;
    impact.mesh.position.copy(targetParent.worldToLocal(surfacePos.clone()));

    const parentScale = new THREE.Vector3();
    targetParent.getWorldScale(parentScale);
    impact.mesh.scale.set(
      scaleVar / (parentScale.x || 1),
      scaleVar / (parentScale.y || 1),
      scaleVar / (parentScale.z || 1)
    );

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

  impact.tex.offset.set(0, (GRID_SIZE - 1) / GRID_SIZE);
  impact.mesh.visible = true;

  if (!activeBloodImpacts.includes(impact)) {
    activeBloodImpacts.push(impact);
  }
  return impact;
}

/**
 * Spawns Story Mode's blood_decals_psx pool aligned horizontally on the floor beneath a staggered Saber.
 */
export function spawnSaberStaggerBloodDecal(position) {
  if (!vfxScene || !position || typeof THREE === 'undefined') return null;

  if (!bloodDecalTemplate) {
    if (pendingStaggerPositions.length < MAX_STAGGER_DECALS) {
      pendingStaggerPositions.push({ x: position.x || 0, y: position.y || 0, z: position.z || 0 });
    }
    loadBloodDecalAsset();
    return null;
  }

  const group = bloodDecalTemplate.clone(true);
  const materials = [];

  group.traverse((o) => {
    if (!o.isMesh) return;
    o.raycast = () => {};
    o.renderOrder = 15;
    const cloneMaterial = (material) => {
      const copy = material.clone();
      copy.depthWrite = false;
      copy.polygonOffset = true;
      copy.polygonOffsetFactor = -1;
      materials.push({ material: copy, opacity: copy.opacity ?? 1.0 });
      return copy;
    };
    o.material = Array.isArray(o.material)
      ? o.material.map(cloneMaterial)
      : cloneMaterial(o.material);
  });

  group.scale.setScalar(STAGGER_DECAL_SCALE);
  const floorY = (typeof position.y === 'number' ? position.y : 0) + STAGGER_DECAL_FLOOR_Y;
  group.position.set(position.x || 0, floorY, position.z || 0);
  group.rotation.y = Math.random() * Math.PI * 2;

  vfxScene.add(group);
  const entry = { mesh: group, t: 0, materials };
  activeStaggerDecals.push(entry);

  while (activeStaggerDecals.length > MAX_STAGGER_DECALS) {
    disposeStaggerDecal(activeStaggerDecals.shift());
  }

  return entry;
}

/**
 * Spawns a Story Mode wall bullet-impact decal aligned to the wall surface normal.
 */
export function spawnMultiplayerWallDecal(point, normal, weaponType = 'pistol') {
  const ptVec = toVector3(point);
  const normVec = toVector3(normal);
  if (!ptVec) return null;
  const normalizedType = (typeof weaponType === 'string' && weaponType.toLowerCase() === 'shotgun')
    ? 'shotgun'
    : 'pistol';
  return spawnWallDecal(ptVec, normVec, normalizedType);
}

/**
 * Advances all active blood impact frames, billboarding, wall decal fades, and stagger blood pool fades.
 */
export function updateMultiplayerImpactVFX(dt) {
  if (!(dt > 0)) return;

  updateWallDecals(dt);

  if (vfxCamera) {
    for (let i = activeBloodImpacts.length - 1; i >= 0; i--) {
      const impact = activeBloodImpacts[i];
      impact.elapsed += dt;

      const progress = impact.elapsed / impact.duration;
      if (progress >= 1.0) {
        if (impact.attachedTo) {
          impact.attachedTo.remove(impact.mesh);
          vfxScene.add(impact.mesh);
          impact.attachedTo = null;
        }
        impact.mesh.visible = false;
        impact.active = false;
        activeBloodImpacts.splice(i, 1);
        continue;
      }

      if (impact.attachedTo) {
        const localQuat = impact.attachedTo.quaternion.clone().invert().multiply(vfxCamera.quaternion);
        impact.mesh.quaternion.copy(localQuat);
        impact.mesh.rotateZ(impact.roll);
      } else {
        impact.mesh.quaternion.copy(vfxCamera.quaternion);
        impact.mesh.rotateZ(impact.roll);
      }

      const frameIndex = Math.min(TOTAL_FRAMES - 1, Math.floor(progress * TOTAL_FRAMES));
      const row = Math.floor(frameIndex / GRID_SIZE);
      const col = frameIndex % GRID_SIZE;
      const u = col / GRID_SIZE;
      const v = (GRID_SIZE - 1 - row) / GRID_SIZE;
      impact.tex.offset.set(u, v);
    }
  }

  for (let i = activeStaggerDecals.length - 1; i >= 0; i--) {
    const d = activeStaggerDecals[i];
    d.t += dt;
    if (d.t > STAGGER_DECAL_VISIBLE_SEC) {
      const fade = Math.max(0, 1.0 - (d.t - STAGGER_DECAL_VISIBLE_SEC) / STAGGER_DECAL_FADE_SEC);
      for (const m of d.materials) {
        m.material.opacity = m.opacity * fade;
      }
      if (d.t >= STAGGER_DECAL_TOTAL_SEC) {
        disposeStaggerDecal(d);
        activeStaggerDecals.splice(i, 1);
      }
    }
  }
}

export function detachBloodImpactsFrom(target) {
  if (!target || !vfxScene) return;
  for (const impact of activeBloodImpacts) {
    if (impact.attachedTo === target) {
      target.remove(impact.mesh);
      vfxScene.add(impact.mesh);
      impact.attachedTo = null;
    }
  }
}

export function cleanupMultiplayerImpactVFX() {
  for (const impact of activeBloodImpacts) {
    if (impact.attachedTo) {
      impact.attachedTo.remove(impact.mesh);
      vfxScene?.add(impact.mesh);
      impact.attachedTo = null;
    }
    impact.mesh.visible = false;
    impact.active = false;
  }
  activeBloodImpacts.length = 0;

  while (activeStaggerDecals.length > 0) {
    disposeStaggerDecal(activeStaggerDecals.pop());
  }
  pendingStaggerPositions.length = 0;

  cleanupWallDecals();
}

export function getImpactVFXStats() {
  return {
    activeBloodImpacts: activeBloodImpacts.length,
    bloodPoolSize: bloodImpactPool.length,
    activeStaggerDecals: activeStaggerDecals.length,
    activeWallDecals: getActiveWallDecalsCount()
  };
}
