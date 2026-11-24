// Remote Player Visual Representation (T-800 Full-Body Model + Chest Weapon Anchor)
import { TransformInterpolator } from './interpolation.js';

let sharedT800Template = null;
let sharedPistolTemplate = null;
let loadPromise = null;

export function preloadPlayerAssets() {
  if (loadPromise) return loadPromise;

  const loader = new THREE.GLTFLoader();

  loadPromise = new Promise((resolve) => {
    let t800Loaded = false;
    let pistolLoaded = false;

    function checkReady() {
      if (t800Loaded && pistolLoaded) {
        resolve({ template: sharedT800Template, pistol: sharedPistolTemplate });
      }
    }

    // 1. Load normalized T-800 model
    loader.load('assets/t-800_player.glb', (gltf) => {
      sharedT800Template = gltf.scene;
      sharedT800Template.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      t800Loaded = true;
      checkReady();
    }, undefined, (err) => {
      console.warn('[RemotePlayer] Failed to load T-800 GLB, using fallback mesh:', err);
      // Fallback procedural figure
      sharedT800Template = createFallbackFigure();
      t800Loaded = true;
      checkReady();
    });

    // 2. Load Beretta Px4 Compact weapon model
    loader.load('assets/beretta_px4_storm_compact.glb', (gltf) => {
      sharedPistolTemplate = gltf.scene;
      sharedPistolTemplate.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material) {
            o.material.roughness = 0.38;
            o.material.metalness = 0.65;
          }
        }
      });
      pistolLoaded = true;
      checkReady();
    }, undefined, (err) => {
      console.warn('[RemotePlayer] Failed to load Beretta GLB, using fallback box weapon:', err);
      sharedPistolTemplate = createFallbackWeapon();
      pistolLoaded = true;
      checkReady();
    });
  });

  return loadPromise;
}

function createWeaponMesh(templateScene) {
  const root = new THREE.Group();
  const clone = templateScene.clone(true);
  clone.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(clone);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // Scale ~22cm third-person weapon
  const s = 0.22 / (Math.max(size.x, size.y, size.z) || 1);
  clone.position.set(-center.x, -center.y + 2.5, -center.z);

  const wrap = new THREE.Group();
  wrap.add(clone);
  wrap.rotation.set(0, Math.PI, 0); // Muzzle points along -Z
  wrap.scale.setScalar(s);
  root.add(wrap);
  return root;
}

function createFallbackFigure() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.4, metalness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.3), mat);
  body.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.28, 0.25), mat);
  head.position.y = 1.65;
  g.add(body); g.add(head);
  return g;
}

function createFallbackWeapon() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9, roughness: 0.2 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.22), mat);
  b.position.set(0, 0, -0.1);
  g.add(b);
  return g;
}

export class RemotePlayer {
  constructor(id, scene, initialSpawn = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }) {
    this.id = id;
    this.scene = scene;
    this.state = 'ACTIVE';
    this.interpolator = new TransformInterpolator({ interpolationDelay: 80 });
    this.isDisposed = false;
    this.characterModel = null;
    this.weaponModel = null;

    this.group = new THREE.Group();
    this.group.name = `RemotePlayer_${id}`;

    // Body sub-group (rotates with yaw)
    this.bodyGroup = new THREE.Group();
    this.group.add(this.bodyGroup);

    // Visual model pivot (rotates visual model 180 deg / PI rad around local Y to face forward)
    this.visualPivot = new THREE.Group();
    this.visualPivot.name = `VisualPivot_${id}`;
    this.visualPivot.rotation.y = Math.PI;
    this.bodyGroup.add(this.visualPivot);

    // Weapon anchor at chest/shoulder height (tilts with pitch)
    this.weaponAnchor = new THREE.Group();
    this.weaponAnchor.name = `WeaponAnchor_${id}`;
    this.weaponAnchor.position.set(0.16, 1.22, -0.22);
    this.bodyGroup.add(this.weaponAnchor);

    // Initial position
    this.group.position.set(initialSpawn.x, initialSpawn.y, initialSpawn.z);
    this.bodyGroup.rotation.y = initialSpawn.yaw;

    this.interpolator.pushSnapshot({
      x: initialSpawn.x,
      y: initialSpawn.y,
      z: initialSpawn.z,
      yaw: initialSpawn.yaw,
      pitch: initialSpawn.pitch,
      timestamp: Date.now()
    });

    this.scene.add(this.group);
    this._buildVisuals();
  }

  _buildVisuals() {
    if (!sharedT800Template || !sharedPistolTemplate) {
      preloadPlayerAssets().then(() => this._attachMeshes());
    } else {
      this._attachMeshes();
    }
  }

  _attachMeshes() {
    if (this.isDisposed) return;

    // 1. Clone T-800 character mesh onto visual pivot
    if (sharedT800Template && !this.characterModel) {
      const modelClone = sharedT800Template.clone(true);
      modelClone.position.set(0, 0, 0);
      this.visualPivot.add(modelClone);
      this.characterModel = modelClone;
    }

    // 2. Clone and attach weapon to chest anchor
    if (sharedPistolTemplate && !this.weaponModel) {
      const weaponMesh = createWeaponMesh(sharedPistolTemplate);
      this.weaponAnchor.add(weaponMesh);
      this.weaponModel = weaponMesh;
    }
  }

  pushUpdate(updatePayload) {
    this.interpolator.pushSnapshot(updatePayload);
  }

  update(dt) {
    const state = this.interpolator.update(dt);

    // Update root world position
    this.group.position.set(state.x, state.y, state.z);

    // Update body yaw
    this.bodyGroup.rotation.y = state.yaw;

    // Tilt weapon anchor with player look pitch
    this.weaponAnchor.rotation.x = state.pitch;
  }

  setState(newState) {
    this.state = newState;
    if (newState === 'DOWNED') {
      // Prone posture on floor
      this.visualPivot.rotation.x = -Math.PI / 2;
      this.visualPivot.position.set(0, 0.22, -0.4);
      if (this.weaponAnchor) this.weaponAnchor.visible = false;
      this.group.visible = true;
    } else if (newState === 'ACTIVE') {
      // Upright active posture
      this.visualPivot.rotation.x = 0;
      this.visualPivot.position.set(0, 0, 0);
      if (this.weaponAnchor) this.weaponAnchor.visible = true;
      this.group.visible = true;
    } else if (newState === 'ELIMINATED') {
      // Disappear / hide eliminated player
      this.group.visible = false;
    }
  }

  reset(spawn = null) {
    this.interpolator.clear();
    this.setState('ACTIVE');
    if (spawn) {
      this.group.position.set(spawn.x, spawn.y, spawn.z);
      this.bodyGroup.rotation.y = spawn.yaw || 0;
      this.weaponAnchor.rotation.x = spawn.pitch || 0;
      this.interpolator.pushSnapshot({
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        yaw: spawn.yaw || 0,
        pitch: spawn.pitch || 0,
        timestamp: Date.now()
      });
    }
    this.group.visible = true;
  }

  destroy() {
    this.isDisposed = true;
    if (this.group && this.group.parent) {
      this.scene.remove(this.group);
    }
    // Traverse and dispose local cloned geometries if non-shared
    this.group.traverse(o => {
      if (o.isMesh && o.geometry && !o.geometry.isShared) {
        o.geometry.dispose();
      }
    });
  }
}
