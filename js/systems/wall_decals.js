// Authentic Wall Bullet-Impact Decal System
// Spawns temporary wallDecal.png quads aligned to surface normals on bullet impacts,
// smoothly fading away after ~5 seconds over ~2 seconds.

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const MAX_DECALS = 64;
const VISIBLE_DURATION = 5.0; // fully visible for ~5s
const FADE_DURATION = 2.0;    // smooth fade over ~2s
const TOTAL_LIFETIME = VISIBLE_DURATION + FADE_DURATION; // 7.0s total

const PISTOL_SIZE = 0.22;
const SHOTGUN_SIZE = 0.13;
const NORMAL_OFFSET = 0.002; // 2mm offset to eliminate Z-fighting

let decalScene = null;
let sharedGeometry = null;
let decalTexture = null;

const decalPool = [];
const activeDecals = [];

export function initWallDecals(scene) {
  decalScene = scene;
  if (sharedGeometry) return;

  sharedGeometry = new THREE.PlaneGeometry(1, 1);

  const loader = new THREE.TextureLoader();
  decalTexture = loader.load('assets/wallDecal.png', (tex) => {
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.encoding = THREE.sRGBEncoding;
  });

  // Pre-allocate mesh pool for zero GC allocation during combat
  for (let i = 0; i < MAX_DECALS; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: decalTexture,
      transparent: true,
      opacity: 1.0,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: THREE.FrontSide
    });

    const mesh = new THREE.Mesh(sharedGeometry, mat);
    mesh.visible = false;
    mesh.renderOrder = 20; // Render cleanly in front of wall materials
    scene.add(mesh);

    decalPool.push({
      mesh,
      mat,
      active: false,
      elapsed: 0,
      baseOpacity: 0.95
    });
  }
}

export function spawnWallDecal(point, normal, weaponType = 'pistol') {
  if (!decalScene || !sharedGeometry) return null;

  const validNormal = (normal && normal.lengthSq() > 0.001) ? normal.clone().normalize() : Z_AXIS.clone();

  // Retrieve an inactive decal from pool, or recycle oldest active decal
  let decal = decalPool.find(d => !d.active);
  if (!decal) {
    if (activeDecals.length > 0) {
      decal = activeDecals.shift();
    } else {
      return null;
    }
  }

  const size = (weaponType === 'shotgun')
    ? (SHOTGUN_SIZE + (Math.random() - 0.5) * 0.03)
    : (PISTOL_SIZE + (Math.random() - 0.5) * 0.04);

  // Position sitting 2mm off the wall surface along the normal
  decal.mesh.position.copy(point).addScaledVector(validNormal, NORMAL_OFFSET);

  // Orient planar quad matching the wall surface normal
  decal.mesh.quaternion.setFromUnitVectors(Z_AXIS, validNormal);
  // Add randomized roll rotation around normal so bullet impacts look unique
  decal.mesh.rotateZ(Math.random() * Math.PI * 2);

  decal.mesh.scale.set(size, size, 1);
  decal.baseOpacity = 0.95;
  decal.mat.opacity = decal.baseOpacity;
  decal.mesh.visible = true;
  decal.elapsed = 0;
  decal.active = true;

  activeDecals.push(decal);
  return decal;
}

export function updateWallDecals(dt) {
  for (let i = activeDecals.length - 1; i >= 0; i--) {
    const d = activeDecals[i];
    d.elapsed += dt;
    if (d.elapsed < VISIBLE_DURATION) {
      d.mat.opacity = d.baseOpacity;
    } else if (d.elapsed < TOTAL_LIFETIME) {
      const fadeProgress = (d.elapsed - VISIBLE_DURATION) / FADE_DURATION;
      d.mat.opacity = d.baseOpacity * Math.max(0, 1.0 - fadeProgress);
    } else {
      d.mesh.visible = false;
      d.active = false;
      activeDecals.splice(i, 1);
    }
  }
}

export function cleanupWallDecals() {
  for (const d of activeDecals) {
    d.mesh.visible = false;
    d.active = false;
  }
  activeDecals.length = 0;
}

export function getActiveWallDecalsCount() {
  return activeDecals.length;
}

export function getActiveWallDecals() {
  return activeDecals;
}
