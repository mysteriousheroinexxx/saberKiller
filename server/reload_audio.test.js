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
  let sampleRate = 44100;
  let numChannels = 1;
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
          setValueAtTime(v) { this.value = v; },
          linearRampToValueAtTime(v) { this.value = v; },
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
        stopped: false,
        onended: null,
        _connectedTo: [],
        connect(target) {
          this._connectedTo.push(target);
          return target;
        },
        disconnect() {},
        start() {
          this.started = true;
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

test('1. reload.wav exists in assets/audio/, computes onset bounds, and routes through weapons category bus', () => {
  const wavPath = path.join(__dirname, '../assets/audio/reload.wav');
  assert.equal(fs.existsSync(wavPath), true, 'reload.wav exists in assets/audio/');
  const buf = readWavToBufferLike(wavPath);
  const bounds = extractSoundTrimBounds(buf);

  assert.ok(bounds.startSec >= 0 && bounds.startSec <= 0.05);
  assert.ok(bounds.durationSec >= 0.9 && bounds.durationSec <= buf.duration + 0.05);
  assert.equal(DEFAULT_SOUND_DEFINITIONS.weapon_reload.category, AUDIO_CATEGORIES.WEAPONS);
});

test('2. LocalPlayerController plays weapon reload audio on valid pistol & shotgun reloads, attaches to weapon, broadcasts, and rejects invalid reloads', async () => {
  setupMinimalGlobalsForPlayerController();
  const { LocalPlayerController } = await import('../js/multiplayer/player_controller.js');

  const reloadBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/reload.wav'));
  const mock = makeMockAudioContext();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => ({ _decoded: reloadBuf })
  });

  const ctx = new mock.MockAudioContext();
  const audioManager = new MultiplayerAudioManager({ audioContext: ctx });
  await audioManager.loadSound('weapon_reload');

  const camera = {
    position: new globalThis.THREE.Vector3(48.69, 1.62, -187.65),
    rotation: { x: 0, y: 0, z: 0, order: 'YXZ' },
    add() {}
  };
  const scene = new globalThis.THREE.Group();
  const reloadPackets = [];
  const net = {
    isConnected: true,
    fireWeapon: () => {},
    attackMonster: () => {},
    reloadWeapon: (weaponType, origin) => reloadPackets.push({ weaponType, origin })
  };

  const controller = new LocalPlayerController(camera, scene, net, null);
  controller.setAudioManager(audioManager);

  // Pistol full mag -> rejected, no audio, no packet
  controller.weapon = 0;
  controller.mag.bullets = 12;
  controller.bullets = 12;
  assert.equal(controller.startReload(), false);
  assert.equal(controller.firingDiagnostics.lastRejectionReason, 'MAGAZINE_ALREADY_FULL');
  assert.equal(audioManager.getStatus().totalWeaponVoicesCreated, 0);
  assert.equal(reloadPackets.length, 0);

  // Pistol missing reserve ammo -> rejected
  controller.mag.bullets = 5;
  controller.bullets = 0;
  assert.equal(controller.startReload(), false);
  assert.equal(controller.firingDiagnostics.lastRejectionReason, 'NO_RESERVE_AMMO');
  assert.equal(audioManager.getStatus().totalWeaponVoicesCreated, 0);

  // Valid pistol reload -> plays attached weapon_reload via weapons bus, preserves 1.15s timer, sends packet
  controller.bullets = 10;
  assert.equal(controller.startReload(), true);
  assert.equal(controller.reloadT, 1.15);
  assert.equal(audioManager.getStatus().totalWeaponVoicesCreated, 1);
  assert.equal(audioManager.getStatus().activeWeaponVoiceCount, 1);
  assert.equal(reloadPackets.length, 1);
  assert.equal(reloadPackets[0].weaponType, 'PISTOL');
  assert.ok(
    mock.createdPanners[0]._connectedTo.includes(audioManager.getCategoryBus(AUDIO_CATEGORIES.WEAPONS)),
    'Pistol reload routes through weapons bus'
  );

  // Camera/player moves -> attached local reload voice panner moves with weapon
  const initX = mock.createdPanners[0].positionX.value;
  camera.position.x += 1.5;
  audioManager.updateListener(camera);
  assert.ok(Math.abs(mock.createdPanners[0].positionX.value - (initX + 1.5)) < 1e-5);

  // Duplicate reload while already reloading -> rejected, no duplicate sound
  assert.equal(controller.startReload(), false);
  assert.match(controller.firingDiagnostics.lastRejectionReason, /RELOAD_ALREADY_IN_PROGRESS/);
  assert.equal(audioManager.getStatus().totalWeaponVoicesCreated, 1);
  assert.equal(reloadPackets.length, 1);

  // Switching weapon cancels local reload voice cleanly, then valid shotgun reload preserves 1.6s timer & plays reload sound
  controller.setWeapon(1);
  assert.equal(audioManager.getStatus().activeWeaponVoiceCount, 0);
  controller.mag.shells = 2;
  controller.shells = 6;
  ctx.currentTime += 0.3;
  assert.equal(controller.startReload(), true);
  assert.equal(controller.reloadT, 1.6);
  assert.equal(audioManager.getStatus().totalWeaponVoicesCreated, 2);
  assert.equal(reloadPackets.length, 2);
  assert.equal(reloadPackets[1].weaponType, 'SHOTGUN');

  // Torch / unarmed / downed / editor / staging lobby reject reload
  controller.setWeapon(2);
  assert.equal(controller.startReload(), false);
  controller.setWeapon(0);
  controller.mag.bullets = 4;
  controller.setState('DOWNED');
  assert.equal(controller.startReload(), false);
  controller.setState('ACTIVE');
  globalThis.window.mpManager = { isInStagingLobby: true };
  assert.equal(controller.startReload(), false);
  globalThis.window.mpManager = null;

  audioManager.dispose();
});

test('3. Volume controls, remote positional reload playback, and server RoomManager.handleWeaponReload without altering Saber AI stimuli', async () => {
  const { RoomManager } = await import('./room_manager.js');
  const reloadBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/reload.wav'));
  const mock = makeMockAudioContext();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => ({ _decoded: reloadBuf })
  });

  const ctx = new mock.MockAudioContext();
  const audioManager = new MultiplayerAudioManager({ audioContext: ctx });
  await audioManager.loadSound('weapon_reload');

  // Master, weapons category, and individual sound volume multiplication
  audioManager.setMasterVolume(0.5);
  audioManager.setCategoryVolume(AUDIO_CATEGORIES.WEAPONS, 0.5);
  audioManager.setSoundVolume('weapon_reload', 0.8);
  assert.equal(audioManager.getSoundVolume('weapon_reload'), 0.8);
  assert.ok(Math.abs(audioManager.getEffectiveVolume('weapon_reload') - 0.2) < 1e-6);

  // Remote player reload uses positional HRTF PannerNode routed through weapons bus
  assert.equal(
    audioManager.playWeaponReload('player_2', {
      weaponType: 'SHOTGUN',
      positional: true,
      position: { x: 55, y: 1.5, z: -182 }
    }),
    true
  );
  assert.equal(mock.createdPanners[0].panningModel, 'HRTF');
  assert.equal(mock.createdPanners[0].positionX.value, 55);
  assert.equal(mock.createdPanners[0].positionZ.value, -182);
  assert.ok(
    mock.createdPanners[0]._connectedTo.includes(audioManager.getCategoryBus(AUDIO_CATEGORIES.WEAPONS)),
    'Remote reload routes through weapons bus'
  );

  // Verify RoomManager.handleWeaponReload builds reloadEvent without emitting any Saber AI sound stimuli
  const rm = new RoomManager();
  const ws1 = { send() {}, readyState: 1 };
  const ws2 = { send() {}, readyState: 1 };
  rm.createRoom(ws1, 'RLD1');
  rm.joinRoom(ws2, 'RLD1');
  const room = rm.rooms.get('RLD1');
  room.runState = 'IN_PROGRESS';
  const stimuliBefore = [];
  room.simulation = {
    sim: {
      soundSystem: {
        emit: (s) => stimuliBefore.push(s)
      }
    }
  };
  const reloadRes = rm.handleWeaponReload(ws2, 'SHOTGUN');
  assert.equal(reloadRes.success, true);
  assert.equal(reloadRes.reloadEvent.type, 'WEAPON_RELOAD');
  assert.equal(reloadRes.reloadEvent.payload.weaponType, 'SHOTGUN');
  assert.equal(reloadRes.reloadEvent.payload.sourceEntityId, reloadRes.player.id);
  assert.equal(stimuliBefore.length, 0, 'Reload does NOT emit or alter Saber AI sound stimuli');

  audioManager.dispose();
});
