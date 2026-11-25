import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomManager } from './room_manager.js';
import { MSG_TYPES } from './protocol.js';
import { LocalPlayerController } from '../js/multiplayer/player_controller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function installMinimalThreeEnv() {
  class Vec3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vec3(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
    subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
    lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    length() { return Math.sqrt(this.lengthSq()); }
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
    negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    applyMatrix3(m) {
      const e = m.elements;
      const x = this.x, y = this.y, z = this.z;
      this.x = e[0] * x + e[3] * y + e[6] * z;
      this.y = e[1] * x + e[4] * y + e[7] * z;
      this.z = e[2] * x + e[5] * y + e[8] * z;
      return this;
    }
    distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  }
  class Quat {
    constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
    copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
    clone() { return new Quat(this.x, this.y, this.z, this.w); }
    invert() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
    multiply() { return this; }
    setFromUnitVectors(from, to) {
      // Exact planar alignment encoding matching vector direction in test assertions
      const d = from.dot(to);
      if (d < -0.9999) {
        this.x = 0; this.y = 1; this.z = 0; this.w = 0;
      } else {
        const cx = from.y * to.z - from.z * to.y;
        const cy = from.z * to.x - from.x * to.z;
        const cz = from.x * to.y - from.y * to.x;
        this.x = cx; this.y = cy; this.z = cz; this.w = 1 + d;
        const len = Math.hypot(this.x, this.y, this.z, this.w) || 1;
        this.x /= len; this.y /= len; this.z /= len; this.w /= len;
      }
      return this;
    }
  }
  class Mat4 {
    constructor() { this.elements = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
    multiplyMatrices() { return this; }
  }
  class Mat3 {
    constructor() { this.elements = [1,0,0, 0,1,0, 0,0,1]; }
    getNormalMatrix() { return this; }
  }
  class Obj3D {
    constructor() {
      this.position = new Vec3();
      this.rotation = { x: 0, y: 0, z: 0 };
      this.scale = new Vec3(1, 1, 1);
      this.quaternion = new Quat();
      this.matrixWorld = new Mat4();
      this.visible = true;
      this.children = [];
      this.parent = null;
      this.userData = {};
    }
    add(c) {
      if (c.parent && c.parent !== this) c.parent.remove(c);
      c.parent = this;
      if (!this.children.includes(c)) this.children.push(c);
    }
    remove(c) {
      this.children = this.children.filter(x => x !== c);
      if (c.parent === this) c.parent = null;
    }
    clear() { this.children = []; }
    clone() {
      const c = new this.constructor();
      c.position.copy(this.position);
      c.scale.copy(this.scale);
      c.geometry = this.geometry;
      c.material = this.material;
      c.isMesh = this.isMesh;
      for (const ch of this.children) c.add(ch.clone());
      return c;
    }
    updateMatrixWorld() {}
    worldToLocal(v) {
      return v.set(v.x - this.position.x, v.y - this.position.y, v.z - this.position.z);
    }
    getWorldScale(t) { return t.set(this.scale.x, this.scale.y, this.scale.z); }
    rotateZ(rad) { this.rotation.z += rad; }
    traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  }

  class MockTexture {
    constructor(url = '') {
      this.url = url;
      this.repeat = { set: (x, y) => { this.repeat.x = x; this.repeat.y = y; }, x: 1, y: 1 };
      this.offset = { set: (x, y) => { this.offset.x = x; this.offset.y = y; }, x: 0, y: 0 };
    }
    clone() {
      const t = new MockTexture(this.url);
      t.repeat.set(this.repeat.x, this.repeat.y);
      t.offset.set(this.offset.x, this.offset.y);
      return t;
    }
  }

  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
  globalThis.document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    pointerLockElement: null,
    createElement: () => ({
      width: 64,
      height: 64,
      getContext: () => ({ createRadialGradient: () => ({ addColorStop: () => {} }), fillStyle: '', fillRect: () => {} })
    })
  };
  globalThis.THREE = {
    Vector3: Vec3,
    Quaternion: Quat,
    Matrix4: Mat4,
    Matrix3: Mat3,
    Group: Obj3D,
    Scene: Obj3D,
    Mesh: class extends Obj3D {
      constructor(geo, mat) {
        super();
        this.geometry = geo;
        this.material = mat;
        this.isMesh = true;
      }
    },
    PlaneGeometry: class { constructor(w, h) { this.w = w; this.h = h; } },
    BoxGeometry: class {},
    CylinderGeometry: class {},
    RingGeometry: class { rotateX() { return this; } },
    BufferGeometry: class { setFromPoints() { return this; } },
    MeshBasicMaterial: class {
      constructor(opts = {}) { Object.assign(this, opts); }
      clone() { return new THREE.MeshBasicMaterial(this); }
      dispose() { this.disposed = true; }
    },
    MeshStandardMaterial: class {
      constructor(opts = {}) { Object.assign(this, opts); }
      clone() { return new THREE.MeshStandardMaterial(this); }
      dispose() { this.disposed = true; }
    },
    MeshLambertMaterial: class { constructor(opts = {}) { Object.assign(this, opts); } },
    LineBasicMaterial: class {},
    SpriteMaterial: class {},
    Sprite: class extends Obj3D {},
    Line: class extends Obj3D {},
    LineLoop: class extends Obj3D {},
    ArrowHelper: class extends Obj3D {},
    PointLight: class extends Obj3D {},
    SpotLight: class extends Obj3D { constructor() { super(); this.target = new Obj3D(); } },
    CanvasTexture: class {},
    Box3: class { setFromObject() { return this; } getCenter(v) { return v; } getSize(v) { return v; } },
    Color: class { constructor(h) { this.h = h; } clone() { return new THREE.Color(this.h); } setHex(h) { this.h = h; } },
    DoubleSide: 2,
    FrontSide: 0,
    LinearFilter: 1,
    LinearMipmapLinearFilter: 2,
    sRGBEncoding: 3001,
    AdditiveBlending: 2,
    LoopOnce: 2200,
    TextureLoader: class {
      load(url, onLoad) {
        const tex = new MockTexture(url);
        if (onLoad) onLoad(tex);
        return tex;
      }
    },
    GLTFLoader: class {
      async loadAsync(url) {
        if (url === 'assets/blood_decals_psx.glb') {
          const g = new Obj3D();
          const child = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            new THREE.MeshBasicMaterial({ opacity: 0.92 })
          );
          g.add(child);
          return { scene: g, animations: [] };
        }
        return { scene: new Obj3D(), animations: [] };
      }
      load() {}
    },
    Raycaster: null
  };
}

test('1. Server projectile impact protocol validates wall vs Saber hits, enforces range, and preserves damage balance', () => {
  const rm = new RoomManager();
  const ws1 = { readyState: 1, send: () => {} };
  const ws2 = { readyState: 1, send: () => {} };
  const mockLayout = { placements: [] };

  const created = rm.createRoom(ws1, 'VFX01', 'default', mockLayout);
  rm.joinRoom(ws2, 'VFX01');
  rm.setPlayerReady(ws2, true);
  rm.startMatch(ws1);

  const room = rm.getRoom('VFX01');
  room.simulation.stop();
  const p1 = room.players.get(created.player.id);
  const alpha = room.simulation.sim.saberAlpha;

  // Position player 1 within weapon range of Saber Alpha
  p1.position = { x: 40, y: 0, z: -180 };
  room.simulation.updatePlayerMovement(p1.id, 40, 0, -180);
  alpha.position.set(45, 0, -180);

  // Wall shot: sanitized strictly to wall impacts (forged saber kind dropped!)
  const wallRes = rm.handleWeaponFire(ws1, 'PISTOL', [
    { kind: 'wall', point: { x: 42, y: 1.5, z: -180 }, normal: { x: -1, y: 0, z: 0 }, weaponType: 'pistol' },
    { kind: 'saber', monsterId: 'saber_alpha', point: { x: 45, y: 1.2, z: -180 } }
  ]);
  assert.equal(wallRes.success, true);
  assert.ok(wallRes.impactEvent);
  assert.equal(wallRes.impactEvent.type, MSG_TYPES.PROJECTILE_IMPACT);
  assert.equal(wallRes.impactEvent.payload.impacts.length, 1);
  assert.equal(wallRes.impactEvent.payload.impacts[0].kind, 'wall');

  // Empty air miss (no impacts) -> no PROJECTILE_IMPACT broadcast
  const missRes = rm.handleWeaponFire(ws1, 'PISTOL', []);
  assert.equal(missRes.success, true);
  assert.equal(missRes.impactEvent, null);

  // Pistol hit on Saber Alpha: deals 50 damage and emits 1 synchronized saber blood impact
  const pistolHit = rm.handleAttackMonster(ws1, 'saber_alpha', 50, 'PISTOL', [
    { kind: 'saber', monsterId: 'saber_alpha', point: { x: 44.6, y: 1.3, z: -180 }, normal: { x: -1, y: 0, z: 0 }, isHeadshot: false }
  ]);
  assert.equal(pistolHit.success, true);
  assert.equal(pistolHit.damageDealt, 50);
  assert.equal(pistolHit.staggered, false);
  assert.equal(alpha.health, 50);
  assert.equal(pistolHit.impactEvent.payload.impacts.length, 1);
  assert.equal(pistolHit.impactEvent.payload.impacts[0].kind, 'saber');

  // Shotgun out of range (> 30m) rejected -> no blood impact event
  alpha.position.set(140, 0, -180);
  const outOfRangeShotgun = rm.handleAttackMonster(ws1, 'saber_alpha', 100, 'SHOTGUN', [
    { kind: 'saber', monsterId: 'saber_alpha', point: { x: 140, y: 1.2, z: -180 } }
  ]);
  assert.equal(outOfRangeShotgun.success, false);
  assert.equal(outOfRangeShotgun.impactEvent, undefined);

  // Move within shotgun range -> single blast deals remaining HP and triggers STAGGERED + blood impact
  alpha.position.set(48, 0, -180);
  const shotgunStagger = rm.handleAttackMonster(ws1, 'saber_alpha', 100, 'SHOTGUN', [
    { kind: 'saber', monsterId: 'saber_alpha', point: { x: 47.6, y: 1.6, z: -180 }, isHeadshot: true },
    { kind: 'saber', monsterId: 'saber_alpha', point: { x: 47.6, y: 1.1, z: -179.9 }, isHeadshot: false }
  ]);
  assert.equal(shotgunStagger.success, true);
  assert.equal(shotgunStagger.staggered, true);
  assert.equal(alpha.getCurrentStateName(), 'STAGGERED');
  assert.equal(shotgunStagger.impactEvent.payload.impacts.length, 2);

  // Shooting already-invulnerable staggered Saber produces damageDealt=0 and no bogus blood splash
  const invulnHit = rm.handleAttackMonster(ws1, 'saber_alpha', 50, 'PISTOL', [
    { kind: 'saber', monsterId: 'saber_alpha', point: { x: 47.6, y: 0.3, z: -180 } }
  ]);
  assert.equal(invulnHit.damageDealt, 0);
  assert.equal(invulnHit.impactEvent, null);

  room.simulation.destroy();
});

test('2. Client ImpactVFX & SaberManager: single stagger decal per entry, recovery re-stagger, body blood anim, wall normal decals, pooling & cleanup', async () => {
  installMinimalThreeEnv();

  const impactVfx = await import('../js/multiplayer/impact_vfx.js');
  const { SaberManager } = await import('../js/multiplayer/saber_manager.js');

  const scene = new THREE.Scene();
  const camera = new THREE.Group();
  camera.position.set(48, 1.62, -187);

  impactVfx.initMultiplayerImpactVFX(scene, camera);
  // Allow async blood_decals_psx GLB loader promise to settle
  await new Promise((r) => setTimeout(r, 15));

  const saberManager = new SaberManager(scene);
  await new Promise((r) => setTimeout(r, 15));

  // Verify Story Mode assets are referenced accurately on disk
  assert.ok(fs.existsSync(path.join(__dirname, '../assets/blood_decals_psx.glb')));
  assert.ok(fs.existsSync(path.join(__dirname, '../assets/wallDecal.png')));
  assert.ok(fs.existsSync(path.join(__dirname, '../assets/vfx/bulletHit_sheet.webp')));

  // A. Trigger Saber STAGGERED via authoritative MONSTER_SNAPSHOT -> spawns EXACTLY 1 blood_decals_psx decal on floor
  saberManager.handleSnapshot({
    matchGeneration: 1,
    monsters: [{ id: 'saber_alpha', state: 'CHASE', health: 50, x: 50, y: 0, z: -180, yaw: 0 }]
  });
  assert.equal(impactVfx.getImpactVFXStats().activeStaggerDecals, 0, 'No stagger decal during CHASE');

  // Repeated 20Hz STAGGERED snapshots for the SAME stagger event MUST spawn only 1 decal
  for (let i = 0; i < 10; i++) {
    saberManager.handleSnapshot({
      matchGeneration: 1,
      monsters: [{ id: 'saber_alpha', state: 'STAGGERED', health: 0, x: 50, y: 0, z: -180, yaw: 0 }]
    });
  }
  assert.equal(impactVfx.getImpactVFXStats().activeStaggerDecals, 1, 'Exactly one blood_decals_psx pool spawned per stagger');

  // Verify floor alignment (y = 0.035, scale = 0.62 matching Story Mode)
  const decalNode = scene.children.find(c => c.isMesh === undefined && Math.abs(c.position.y - 0.035) < 1e-6 && Math.abs(c.scale.x - 0.62) < 1e-6);
  assert.ok(decalNode, 'Stagger blood decal placed at floor height y=0.035 and scale=0.62');
  assert.equal(decalNode.position.x, 50);
  assert.equal(decalNode.position.z, -180);

  // Saber recovers -> gets staggered again later -> spawns 1 new blood decal
  saberManager.handleSnapshot({
    matchGeneration: 1,
    monsters: [{ id: 'saber_alpha', state: 'RECOVER', health: 100, x: 50, y: 0, z: -180, yaw: 0 }]
  });
  saberManager.handleSnapshot({
    matchGeneration: 1,
    monsters: [{ id: 'saber_alpha', state: 'PATROL', health: 100, x: 54, y: 0, z: -175, yaw: 0 }]
  });
  saberManager.handleSnapshot({
    matchGeneration: 1,
    monsters: [{ id: 'saber_alpha', state: 'STAGGERED', health: 0, x: 54, y: 0, z: -175, yaw: 0 }]
  });
  assert.equal(impactVfx.getImpactVFXStats().activeStaggerDecals, 2, 'Second stagger after recovery spawns fresh floor decal');

  // B. Synchronized Saber blood impact animation (Pistol & Shotgun) attached cleanly to Saber group
  saberManager.handleProjectileImpact({
    shooterId: 'p_1',
    weaponType: 'PISTOL',
    impacts: [
      { kind: 'saber', monsterId: 'saber_alpha', weaponType: 'pistol', point: { x: 54.3, y: 1.25, z: -175 }, normal: { x: 1, y: 0, z: 0 }, isHeadshot: false }
    ]
  });
  assert.equal(impactVfx.getImpactVFXStats().activeBloodImpacts, 1);

  saberManager.handleProjectileImpact({
    shooterId: 'p_2',
    weaponType: 'SHOTGUN',
    impacts: [
      { kind: 'saber', monsterId: 'saber_alpha', weaponType: 'shotgun', point: { x: 54.1, y: 1.6, z: -175.2 }, normal: { x: 0, y: 0, z: -1 }, isHeadshot: true },
      { kind: 'saber', monsterId: 'saber_alpha', weaponType: 'shotgun', point: { x: 54.2, y: 1.0, z: -175.1 }, normal: { x: 0, y: 0, z: -1 }, isHeadshot: false }
    ]
  });
  assert.equal(impactVfx.getImpactVFXStats().activeBloodImpacts, 3);
  assert.ok(saberManager.saberAlpha.group.children.some(c => c.visible && c.renderOrder === 99), 'Blood animation mesh attached directly to Saber group');

  // Advancing 1.2s finishes 1.07s sprite sheet animation and returns instances to pool
  impactVfx.updateMultiplayerImpactVFX(0.5);
  assert.equal(impactVfx.getImpactVFXStats().activeBloodImpacts, 3);
  impactVfx.updateMultiplayerImpactVFX(0.7);
  assert.equal(impactVfx.getImpactVFXStats().activeBloodImpacts, 0, 'Blood impacts auto-release to pool after 1.07s animation');

  // C. Wall bullet decals aligned to distinct wall orientations (+X, -Z, diagonal) & capped at pool size 64
  saberManager.handleProjectileImpact({
    shooterId: 'p_1',
    weaponType: 'PISTOL',
    impacts: [
      { kind: 'wall', weaponType: 'pistol', point: { x: 40, y: 1.5, z: -185 }, normal: { x: 1, y: 0, z: 0 } },
      { kind: 'wall', weaponType: 'pistol', point: { x: 45, y: 1.5, z: -170 }, normal: { x: 0, y: 0, z: -1 } }
    ]
  });
  assert.equal(impactVfx.getImpactVFXStats().activeWallDecals, 2);

  // Stress pool cap: spawn 100 wall impacts & 30 blood impacts & 50 stagger decals -> must stay strictly bounded
  for (let i = 0; i < 80; i++) {
    impactVfx.spawnMultiplayerWallDecal({ x: i, y: 1.2, z: -180 }, { x: 0, y: 0, z: 1 }, 'shotgun');
  }
  for (let i = 0; i < 25; i++) {
    impactVfx.spawnSaberBloodImpact({ x: 54, y: 1.2, z: -175 }, false, { x: 0, y: 0, z: 1 }, saberManager.saberAlpha.group);
  }
  for (let i = 0; i < 45; i++) {
    impactVfx.spawnSaberStaggerBloodDecal({ x: 50 + i, y: 0, z: -180 });
  }
  const stats = impactVfx.getImpactVFXStats();
  assert.ok(stats.activeWallDecals <= 64, `Wall decals bounded (${stats.activeWallDecals} <= 64)`);
  assert.ok(stats.activeBloodImpacts <= 16, `Blood impacts bounded (${stats.activeBloodImpacts} <= 16)`);
  assert.ok(stats.activeStaggerDecals <= 35, `Stagger floor decals bounded (${stats.activeStaggerDecals} <= 35)`);

  // Match reset cleans up all decals & blood impacts cleanly
  saberManager.reset(2);
  const afterReset = impactVfx.getImpactVFXStats();
  assert.equal(afterReset.activeWallDecals, 0);
  assert.equal(afterReset.activeBloodImpacts, 0);
  assert.equal(afterReset.activeStaggerDecals, 0);

  saberManager.destroy();
});

test('3. Hitscan routing prevents wall decals on Saber hits, prevents Saber blood on occluded/missed shots, and avoids client+server duplicates', () => {
  installMinimalThreeEnv();

  const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const saberGroup = new THREE.Group();
  saberGroup.position.set(50, 0, -180);
  const saberHitbox = new THREE.Mesh(new THREE.CylinderGeometry(), new THREE.MeshBasicMaterial());
  saberHitbox.userData = {
    isMonster: true,
    monsterId: 'saber_alpha',
    saber: { group: saberGroup, isModelLoaded: false }
  };

  let scenario = 'SABER_FIRST';
  THREE.Raycaster = class {
    set() {}
    intersectObjects() {
      if (scenario === 'SABER_FIRST') {
        return [{ distance: 4.0, point: new THREE.Vector3(50, 1.3, -180), object: saberHitbox, face: { normal: new THREE.Vector3(0, 0, 1) } }];
      }
      if (scenario === 'WALL_FIRST') {
        return [{ distance: 2.0, point: new THREE.Vector3(49, 1.4, -182), object: wallMesh, face: { normal: new THREE.Vector3(0, 0, 1) } }];
      }
      return [];
    }
  };

  const sentFire = [];
  const sentAttacks = [];
  const mockNetwork = {
    isConnected: true,
    fireWeapon: (w, o, d, extra) => sentFire.push({ w, extra }),
    attackMonster: (id, dmg, w, extra) => sentAttacks.push({ id, dmg, w, extra })
  };

  let localImpactTriggered = 0;
  const mockSaberManager = {
    getHitboxes: () => [saberHitbox],
    handleProjectileImpact: () => { localImpactTriggered++; }
  };
  const mockCollision = {
    getRaycastTargets: () => [wallMesh]
  };
  const camera = new THREE.Group();
  camera.getWorldDirection = (out) => out.set(0, 0, -1);

  const pc = new LocalPlayerController(camera, new THREE.Scene(), mockNetwork, mockCollision);
  pc.setSaberManager(mockSaberManager);

  // Case A: Shot hits Saber -> sends attackMonster with saber impact, 0 wall impacts, 0 duplicate local pre-spawn
  scenario = 'SABER_FIRST';
  pc._performWeaponHitscan('PISTOL');
  assert.equal(sentAttacks.length, 1);
  assert.equal(sentAttacks[0].extra.impacts.length, 1);
  assert.equal(sentAttacks[0].extra.impacts[0].kind, 'saber');
  assert.equal(sentFire[0].extra.impacts.length, 0, 'No wall decal spawned when hitting Saber');
  assert.equal(localImpactTriggered, 0, 'Connected client waits for authoritative PROJECTILE_IMPACT broadcast (zero duplicate)');

  // Case B: Shot hits wall -> sends wall impact on fireWeapon, 0 attackMonster / Saber blood
  sentFire.length = 0;
  sentAttacks.length = 0;
  scenario = 'WALL_FIRST';
  pc._performWeaponHitscan('SHOTGUN');
  assert.equal(sentAttacks.length, 0, 'Occluded/wall shot must not trigger Saber blood or damage');
  assert.equal(sentFire[0].extra.impacts.length, 7, 'Shotgun pellets hitting wall spawn wall impacts');
  assert.ok(sentFire[0].extra.impacts.every(i => i.kind === 'wall'));

  // Case C: Shot misses all geometry -> zero wall decals and zero Saber blood
  sentFire.length = 0;
  sentAttacks.length = 0;
  scenario = 'MISS';
  pc._performWeaponHitscan('PISTOL');
  assert.equal(sentAttacks.length, 0);
  assert.equal(sentFire[0].extra.impacts.length, 0);
});
