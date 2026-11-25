import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_CATEGORIES,
  DEFAULT_SOUND_DEFINITIONS,
  MultiplayerAudioManager,
  extractSoundTrimBounds
} from '../js/multiplayer/audio_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readWavToBufferLike(wavPath) {
  const buf = fs.readFileSync(wavPath);
  let offset = 12;
  let sampleRate = 48000;
  let numChannels = 2;
  let bitsPerSample = 24;
  let dataStart = -1;
  let dataLen = 0;

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      numChannels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      dataStart = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }

  assert.ok(dataStart > 0 && dataLen > 0, `WAV data chunk found in ${wavPath}`);
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataLen / (bytesPerSample * numChannels));
  const channels = Array.from({ length: numChannels }, () => new Float32Array(frameCount));

  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < numChannels; c++) {
      const p = dataStart + (i * numChannels + c) * bytesPerSample;
      if (bitsPerSample === 16) {
        channels[c][i] = buf.readInt16LE(p) / 32768;
      } else if (bitsPerSample === 24) {
        let v = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
        if (v & 0x800000) v |= 0xff000000;
        channels[c][i] = v / 8388608;
      }
    }
  }

  return {
    sampleRate,
    numberOfChannels: numChannels,
    length: frameCount,
    duration: frameCount / sampleRate,
    getChannelData: (c) => channels[c]
  };
}

function makeMockAudioContext() {
  const createdGains = [];
  const createdPanners = [];
  const createdSources = [];

  class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 1.0;
      this.destination = { _isDestination: true };
      this.listener = {
        positionX: { value: 0, setValueAtTime(v) { this.value = v; } },
        positionY: { value: 0, setValueAtTime(v) { this.value = v; } },
        positionZ: { value: 0, setValueAtTime(v) { this.value = v; } },
        forwardX: { value: 0, setValueAtTime(v) { this.value = v; } },
        forwardY: { value: 0, setValueAtTime(v) { this.value = v; } },
        forwardZ: { value: -1, setValueAtTime(v) { this.value = v; } },
        upX: { value: 0, setValueAtTime(v) { this.value = v; } },
        upY: { value: 1, setValueAtTime(v) { this.value = v; } },
        upZ: { value: 0, setValueAtTime(v) { this.value = v; } }
      };
    }

    resume() {
      this.state = 'running';
      return Promise.resolve();
    }

    createGain() {
      const node = {
        _connectedTo: [],
        _disconnected: false,
        gain: {
          value: 1.0,
          maxRamped: 1.0,
          setValueAtTime(v) { this.value = v; },
          linearRampToValueAtTime(v) {
            this.value = v;
            if (v > this.maxRamped || this.maxRamped === 1.0) {
              this.maxRamped = v;
            }
          },
          setTargetAtTime(v) { this.value = v; },
          cancelScheduledValues() {}
        },
        connect(target) {
          this._connectedTo.push(target);
          return target;
        },
        disconnect() {
          this._disconnected = true;
        }
      };
      createdGains.push(node);
      return node;
    }

    createPanner() {
      const node = {
        _connectedTo: [],
        _disconnected: false,
        panningModel: 'equalpower',
        distanceModel: 'inverse',
        refDistance: 1,
        maxDistance: 10000,
        rolloffFactor: 1,
        positionX: { value: 0, setValueAtTime(v) { this.value = v; } },
        positionY: { value: 0, setValueAtTime(v) { this.value = v; } },
        positionZ: { value: 0, setValueAtTime(v) { this.value = v; } },
        connect(target) {
          this._connectedTo.push(target);
          return target;
        },
        disconnect() {
          this._disconnected = true;
        }
      };
      createdPanners.push(node);
      return node;
    }

    decodeAudioData(arrBuf) {
      return Promise.resolve(arrBuf._decoded);
    }

    createBufferSource() {
      const src = {
        buffer: null,
        loop: false,
        playbackRate: { value: 1.0 },
        started: false,
        startArgs: null,
        stopped: false,
        onended: null,
        _connectedTo: [],
        connect(target) {
          this._connectedTo.push(target);
          return target;
        },
        disconnect() {},
        start(when, offset, duration) {
          this.started = true;
          this.startArgs = { when, offset, duration };
        },
        stop() {
          this.stopped = true;
        }
      };
      createdSources.push(src);
      return src;
    }
  }

  return { MockAudioContext, createdGains, createdPanners, createdSources };
}

function setupMinimalGlobalsForPlayerController() {
  class Vec3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x; this.y = y; this.z = z;
    }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
    clone() { return new Vec3(this.x, this.y, this.z); }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    addScaledVector(v, s) {
      this.x += v.x * s; this.y += v.y * s; this.z += v.z * s;
      return this;
    }
  }
  class Group {
    constructor() {
      this.position = new Vec3();
      this.rotation = { x: 0, y: 0, z: 0, order: 'XYZ', set() {} };
      this.scale = new Vec3(1, 1, 1);
      this.quaternion = { x: 0, y: 0, z: 0, w: 1 };
      this.children = [];
      this.visible = true;
    }
    add(c) { this.children.push(c); }
    remove(c) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) this.children.splice(idx, 1);
    }
  }
  globalThis.THREE = {
    Vector3: Vec3,
    Group,
    Mesh: class extends Group {},
    Sprite: class extends Group { constructor(mat) { super(); this.material = mat; } },
    BoxGeometry: class {},
    CylinderGeometry: class {},
    SphereGeometry: class {},
    Color: class {},
    CanvasTexture: class {},
    SpriteMaterial: class {},
    AdditiveBlending: 2,
    MeshBasicMaterial: class { constructor() { this.color = { setHex() {} }; } },
    MeshStandardMaterial: class { constructor() { this.color = { setHex() {} }; } },
    PointLight: class extends Group { constructor() { super(); this.intensity = 0; } },
    SpotLight: class extends Group { constructor() { super(); this.intensity = 0; this.target = new Group(); } },
    GLTFLoader: class { load() {} },
    Box3: class {
      setFromObject() { return this; }
      getCenter(t = new Vec3()) { return t; }
      getSize(t = new Vec3()) { return t.set(1, 1, 1); }
    },
    Raycaster: class { set() {} intersectObjects() { return []; } },
    Matrix3: class { getNormalMatrix() { return this; } },
    Matrix4: class { multiplyMatrices() { return this; } }
  };
  globalThis.document = {
    pointerLockElement: null,
    body: { addEventListener() {}, removeEventListener() {} },
    createElement() {
      return {
        width: 64,
        height: 64,
        getContext() {
          return {
            createRadialGradient() { return { addColorStop() {} }; },
            fillRect() {}
          };
        }
      };
    },
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; },
    exitPointerLock() {}
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    mpManager: null
  };
}

test('1. pistolFire.wav exists in assets/audio/, trims ~100ms leading silence, and defines weapons category bus routing', () => {
  const wavPath = path.join(__dirname, '../assets/audio/pistolFire.wav');
  assert.equal(fs.existsSync(wavPath), true, 'pistolFire.wav exists in assets/audio/');
  const buf = readWavToBufferLike(wavPath);
  const bounds = extractSoundTrimBounds(buf);

  assert.ok(bounds.startSec >= 0.08 && bounds.startSec <= 0.11, `Expected trimmed lead silence near 0.10s, got ${bounds.startSec}`);
  assert.ok(bounds.durationSec >= 0.5 && bounds.durationSec <= buf.duration, `Expected valid duration, got ${bounds.durationSec}`);
  assert.equal(DEFAULT_SOUND_DEFINITIONS.weapon_pistol_fire.category, AUDIO_CATEGORIES.WEAPONS);
});

test('2. LocalPlayerController plays pistol fire only on valid Beretta Px4 shots, attaches to weapon/camera, rejects cooldown/empty/other weapons', async () => {
  setupMinimalGlobalsForPlayerController();
  const { LocalPlayerController } = await import('../js/multiplayer/player_controller.js');

  const pistolBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/pistolFire.wav'));
  const mock = makeMockAudioContext();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => ({ _decoded: pistolBuf })
  });

  const ctx = new mock.MockAudioContext();
  const audioManager = new MultiplayerAudioManager({ audioContext: ctx });
  await audioManager.loadSound('weapon_pistol_fire');

  const camera = {
    position: new globalThis.THREE.Vector3(48.69, 1.62, -187.65),
    rotation: { x: 0, y: 0, z: 0, order: 'YXZ' },
    getWorldDirection(target) { return target.set(0, 0, -1); },
    add() {}
  };
  const scene = new globalThis.THREE.Group();
  const fireCalls = [];
  const net = {
    isConnected: true,
    fireWeapon: (weaponType, origin, dir, extra) => fireCalls.push({ weaponType, origin, dir, extra }),
    attackMonster: () => {}
  };

  const controller = new LocalPlayerController(camera, scene, net, null);
  controller.setAudioManager(audioManager);
  controller.weapon = 0; // PISTOL
  controller.mag.bullets = 3;
  controller.bullets = 0; // no reserve so empty mag won't auto-reload

  // Shot 1 succeeds -> immediate pistol sound attached near weapon/camera position + weapons bus
  assert.equal(controller.fire(), true);
  assert.equal(audioManager.getStatus().totalWeaponVoicesCreated, 1);
  assert.equal(audioManager.getStatus().activeWeaponVoiceCount, 1);
  assert.equal(fireCalls.length, 1);
  assert.equal(mock.createdPanners.length, 1);
  assert.ok(
    mock.createdPanners[0]._connectedTo.includes(audioManager.getCategoryBus(AUDIO_CATEGORIES.WEAPONS)),
    'Local pistol shot routes through weapons bus'
  );
  assert.ok(mock.createdSources[0].startArgs.offset >= 0.08, 'Trimmed silence lead-in skipped on playback');

  // Verify weapon attachment tracks moving camera/weapon world position
  const initialPannerX = mock.createdPanners[0].positionX.value;
  camera.position.x += 2.5;
  audioManager.updateListener(camera);
  assert.ok(Math.abs(mock.createdPanners[0].positionX.value - (initialPannerX + 2.5)) < 1e-5, 'Attached local pistol panner follows player weapon/camera movement');

  // Rapid fire BEFORE 0.21s cooldown elapses -> rejected cleanly, NO firing sound
  assert.equal(controller.fire(), false);
  assert.match(controller.firingDiagnostics.lastRejectionReason, /COOLDOWN_ACTIVE/);
  assert.equal(audioManager.getStatus().totalWeaponVoicesCreated, 1);

  // Advance past 0.21s cooldown -> Shot 2 and Shot 3 succeed (allow overlapping gunshot tails cleanly)
  controller.cool = 0;
  ctx.currentTime += 0.22;
  assert.equal(controller.fire(), true);
  controller.cool = 0;
  ctx.currentTime += 0.22;
  assert.equal(controller.fire(), true);
  assert.equal(audioManager.getStatus().totalWeaponVoicesCreated, 3);
  assert.equal(audioManager.getStatus().activeWeaponVoiceCount, 3);

  // Magazine now 0 with 0 reserve -> empty mag click rejected, NO firing sound
  controller.cool = 0;
  ctx.currentTime += 0.25;
  assert.equal(controller.fire(), false);
  assert.equal(controller.firingDiagnostics.lastRejectionReason, 'OUT_OF_AMMO');
  assert.equal(audioManager.getStatus().totalWeaponVoicesCreated, 3);

  // Reloading, downed, editor active, staging lobby all reject cleanly without playing pistol audio
  controller.mag.bullets = 5;
  controller.reloadT = 0.8;
  assert.equal(controller.fire(), false);
  controller.reloadT = 0;
  controller.setState('DOWNED');
  assert.equal(controller.fire(), false);
  controller.setState('ACTIVE');
  globalThis.window.mpManager = { isInStagingLobby: true };
  assert.equal(controller.fire(), false);
  globalThis.window.mpManager = null;

  // Switching to Shotgun or Torch does NOT play pistol sound
  controller.weapon = 1;
  controller.mag.shells = 2;
  controller.cool = 0;
  assert.equal(controller.fire(), true);
  controller.weapon = 2;
  controller.cool = 0;
  assert.equal(controller.fire(), true);
  assert.equal(audioManager.getStatus().totalWeaponVoicesCreated, 3, 'Shotgun/Torch must not play pistol sound');

  audioManager.dispose();
});

test('3. Configurable master, weapons bus, and pistol individual volumes plus remote positional playback without self-duplication', async () => {
  const pistolBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/pistolFire.wav'));
  const mock = makeMockAudioContext();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => ({ _decoded: pistolBuf })
  });

  const ctx = new mock.MockAudioContext();
  const audioManager = new MultiplayerAudioManager({ audioContext: ctx });
  await audioManager.loadSound('weapon_pistol_fire');

  // Volume hierarchy checks
  audioManager.setMasterVolume(0.5);
  audioManager.setCategoryVolume(AUDIO_CATEGORIES.WEAPONS, 0.8);
  audioManager.setSoundVolume('weapon_pistol_fire', 0.4);
  assert.equal(audioManager.getSoundVolume('weapon_pistol_fire'), 0.4);
  assert.ok(Math.abs(audioManager.getEffectiveVolume('weapon_pistol_fire') - (0.5 * 0.8 * 0.4)) < 1e-6);

  // Play remote pistol shot positionally via PannerNode routed through weapons bus
  const ok = audioManager.playWeaponFire('player_2', 'weapon_pistol_fire', {
    positional: true,
    position: { x: 64, y: 1.5, z: -175 }
  });
  assert.equal(ok, true);
  assert.equal(mock.createdPanners.length, 1);
  assert.equal(mock.createdPanners[0].panningModel, 'HRTF');
  assert.equal(mock.createdPanners[0].positionX.value, 64);
  assert.equal(mock.createdPanners[0].positionZ.value, -175);
  assert.ok(
    mock.createdPanners[0]._connectedTo.includes(audioManager.getCategoryBus(AUDIO_CATEGORIES.WEAPONS)),
    'Remote positional pistol shot routes into weapons bus'
  );

  // Near-simultaneous duplicate event for same emitter is suppressed (< 0.04s)
  const dup = audioManager.playWeaponFire('player_2', 'weapon_pistol_fire', {
    positional: true,
    position: { x: 64, y: 1.5, z: -175 }
  });
  assert.equal(dup, false, 'Duplicate simultaneous broadcast for same shooter suppressed');

  audioManager.stopAllAudio();
  assert.equal(audioManager.getStatus().activeWeaponVoiceCount, 0);
  audioManager.dispose();
});
