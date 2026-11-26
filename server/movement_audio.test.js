import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_CATEGORIES,
  AUDIO_BUS_NAMES,
  DEFAULT_SOUND_DEFINITIONS,
  MultiplayerAudioManager,
  extractFootstepSlices
} from '../js/multiplayer/audio_manager.js';
import { MultiplayerAmbientAudio } from '../js/multiplayer/ambient_audio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readWavToBufferLike(wavPath) {
  const buf = fs.readFileSync(wavPath);
  let offset = 12;
  let sampleRate = 44100;
  let numChannels = 2;
  let bitsPerSample = 16;
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

function makeMockAudioContext(buffersByUrl = {}) {
  let ctxCount = 0;
  const createdGains = [];
  const createdPanners = [];
  const createdSources = [];

  class MockAudioContext {
    constructor() {
      ctxCount++;
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

    createBuffer(ch, len, rate) {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return {
        numberOfChannels: ch,
        length: len,
        sampleRate: rate,
        duration: len / rate,
        getChannelData: (c) => data[c]
      };
    }

    decodeAudioData(arrBuf) {
      return Promise.resolve(arrBuf._decoded || buffersByUrl.default);
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

  return {
    MockAudioContext,
    getContextCount: () => ctxCount,
    createdGains,
    createdPanners,
    createdSources
  };
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

test('1. Walking and running WAV assets exist in assets/audio/ and slice cleanly into step bursts', () => {
  const walkPath = path.join(__dirname, '../assets/audio/walking.wav');
  const runPath = path.join(__dirname, '../assets/audio/running.wav');
  assert.equal(fs.existsSync(walkPath), true, 'walking.wav exists in assets/audio/');
  assert.equal(fs.existsSync(runPath), true, 'running.wav exists in assets/audio/');

  const walkBuf = readWavToBufferLike(walkPath);
  const runBuf = readWavToBufferLike(runPath);

  const walkSlices = extractFootstepSlices(walkBuf, {
    minGapSeconds: 0.22,
    minSliceSeconds: 0.18,
    maxSliceSeconds: 0.35
  });
  const runSlices = extractFootstepSlices(runBuf, {
    minGapSeconds: 0.16,
    minSliceSeconds: 0.15,
    maxSliceSeconds: 0.27
  });

  assert.ok(walkSlices.length >= 10, `Expected >=10 walk slices, got ${walkSlices.length}`);
  assert.ok(runSlices.length >= 15, `Expected >=15 run slices, got ${runSlices.length}`);
  for (const s of walkSlices) {
    assert.ok(s.startSec >= 0 && s.durationSec >= 0.08 && s.startSec + s.durationSec <= walkBuf.duration + 0.01);
  }
  for (const s of runSlices) {
    assert.ok(s.startSec >= 0 && s.durationSec >= 0.08 && s.startSec + s.durationSec <= runBuf.duration + 0.01);
  }
});

test('2. Shared MultiplayerAudioManager uses one AudioContext, 7 buses, routes ambient hum, and persists preferences', async () => {
  const walkBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/walking.wav'));
  const runBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/running.wav'));
  const humBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/background60HzElectricHum.wav'));

  const mock = makeMockAudioContext();
  globalThis.AudioContext = mock.MockAudioContext;
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => ({
      _decoded: url.includes('walking') ? walkBuf : (url.includes('running') ? runBuf : humBuf)
    })
  });

  const audioManager = new MultiplayerAudioManager();
  const ambientAudio = new MultiplayerAmbientAudio({ audioManager });

  // Single shared AudioContext across both controllers
  assert.equal(mock.getContextCount(), 1, 'Exactly one AudioContext created');
  assert.equal(ambientAudio.ctx, audioManager.getContext());

  // Verify all 7 category namespaces exist and all 6 child buses connect to masterGain -> destination
  assert.equal(Object.keys(AUDIO_CATEGORIES).length, 7);
  assert.deepEqual(
    [...AUDIO_BUS_NAMES],
    ['environment', 'playerMovement', 'weapons', 'interactions', 'enemies', 'ui']
  );
  assert.ok(audioManager.masterGain._connectedTo.includes(audioManager.ctx.destination));
  for (const busName of AUDIO_BUS_NAMES) {
    const bus = audioManager.getCategoryBus(busName);
    assert.ok(bus._connectedTo.includes(audioManager.masterGain), `${busName} routes into masterGain`);
  }

  // Ambient hum starts and routes into environment bus cleanly without creating duplicate contexts
  await ambientAudio.start();
  assert.equal(mock.getContextCount(), 1);
  assert.ok(
    ambientAudio.masterGain._connectedTo.includes(audioManager.getCategoryBus(AUDIO_CATEGORIES.ENVIRONMENT)),
    'Ambient hum connects to environment category bus'
  );
  assert.equal(ambientAudio.getStatus().isPlaying, true);

  // Bidirectional volume sync & effective volume computation
  audioManager.setMasterVolume(0.5);
  audioManager.setCategoryVolume(AUDIO_CATEGORIES.ENVIRONMENT, 0.8);
  audioManager.setSoundVolume('level0_hum', 0.25);
  assert.equal(ambientAudio.getVolume(), 0.25);
  assert.ok(Math.abs(audioManager.getEffectiveVolume('level0_hum') - (0.5 * 0.8 * 0.25)) < 1e-6);

  // Persistent client preferences export/save/load/reset round-trip
  const memStore = new Map();
  const fakeStorage = {
    setItem: (k, v) => memStore.set(k, v),
    getItem: (k) => memStore.get(k) ?? null
  };
  audioManager.setCategoryVolume(AUDIO_CATEGORIES.PLAYER_MOVEMENT, 0.7);
  audioManager.setSoundVolume('player_walk', 0.45);
  assert.equal(audioManager.savePreferences(fakeStorage), true);

  const restored = new MultiplayerAudioManager({ audioContext: audioManager.getContext() });
  assert.equal(restored.loadPreferences(fakeStorage), true);
  assert.equal(restored.getMasterVolume(), 0.5);
  assert.equal(restored.getCategoryVolume(AUDIO_CATEGORIES.PLAYER_MOVEMENT), 0.7);
  assert.equal(restored.getSoundVolume('player_walk'), 0.45);
  assert.equal(restored.getSoundVolume('level0_hum'), 0.25);

  restored.resetPreferences();
  assert.equal(restored.getMasterVolume(), 1.0);
  assert.equal(restored.getCategoryVolume(AUDIO_CATEGORIES.PLAYER_MOVEMENT), 1.0);
  assert.equal(restored.getSoundVolume('player_walk'), DEFAULT_SOUND_DEFINITIONS.player_walk.defaultVolume);

  ambientAudio.dispose();
  audioManager.dispose();
  restored.dispose();
});

test('3. LocalPlayerController plays walking/running steps cleanly, switches modes, and stops on idle, wall collision, downed, and eliminated', async () => {
  setupMinimalGlobalsForPlayerController();
  const { LocalPlayerController } = await import('../js/multiplayer/player_controller.js');

  const walkBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/walking.wav'));
  const runBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/running.wav'));
  const mock = makeMockAudioContext();
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => ({
      _decoded: url.includes('running') ? runBuf : walkBuf
    })
  });

  const ctx = new mock.MockAudioContext();
  const audioManager = new MultiplayerAudioManager({ audioContext: ctx });
  await audioManager.preloadMovementAudio();

  const camera = {
    position: new globalThis.THREE.Vector3(),
    rotation: { x: 0, y: 0, z: 0, order: 'YXZ' },
    add() {}
  };
  const scene = new globalThis.THREE.Group();
  let blocked = false;
  const controller = new LocalPlayerController(camera, scene, null, {
    circleHitsWall: () => blocked
  });
  controller.setAudioManager(audioManager);

  // Idle -> no movement audio triggered
  controller.update(0.05);
  assert.equal(audioManager.getStatus().activeVoiceCount, 0);
  assert.equal(audioManager.getStatus().totalVoicesCreated, 0);

  // Walk forward -> triggers immediate walk footstep without duplicate overlapping voices
  controller.keys['KeyW'] = true;
  controller.update(0.1);
  assert.equal(audioManager.getStatus().activeVoiceCount, 1);
  assert.equal(audioManager.getStatus().activeEmitters.local.soundId, 'player_walk');

  // Continue walking past stride threshold -> advances time & plays next single step replacing old voice
  ctx.currentTime += 0.45;
  controller.update(0.5);
  assert.equal(audioManager.getStatus().activeVoiceCount, 1);
  assert.ok(audioManager.getStatus().totalVoicesCreated >= 2);

  // Switch cleanly walk -> run while holding ShiftLeft
  controller.keys['ShiftLeft'] = true;
  ctx.currentTime += 0.05; // immediateSwitch bypasses stale cooldown
  controller.update(0.1);
  assert.equal(audioManager.getStatus().activeVoiceCount, 1);
  assert.equal(audioManager.getStatus().activeEmitters.local.soundId, 'player_run');

  // Stop moving -> active emitter stopped immediately
  controller.keys = {};
  controller.update(0.05);
  assert.equal(audioManager.getStatus().activeVoiceCount, 0);

  // Running directly against a wall (no actual displacement) -> no phantom footsteps
  const voicesBeforeWall = audioManager.getStatus().totalVoicesCreated;
  blocked = true;
  controller.keys['KeyW'] = true;
  controller.keys['ShiftLeft'] = true;
  ctx.currentTime += 0.5;
  controller.update(0.1);
  assert.equal(audioManager.getStatus().totalVoicesCreated, voicesBeforeWall);
  assert.equal(audioManager.getStatus().activeVoiceCount, 0);

  // Unblocked movement then DOWNED -> stops movement audio and stays silent
  blocked = false;
  ctx.currentTime += 0.5;
  controller.update(0.1);
  assert.equal(audioManager.getStatus().activeVoiceCount, 1);

  controller.setState('DOWNED');
  assert.equal(audioManager.getStatus().activeVoiceCount, 0);
  const voicesWhileDowned = audioManager.getStatus().totalVoicesCreated;
  ctx.currentTime += 0.5;
  controller.update(0.1);
  assert.equal(audioManager.getStatus().totalVoicesCreated, voicesWhileDowned);

  controller.setState('ELIMINATED');
  assert.equal(audioManager.getStatus().activeVoiceCount, 0);
  audioManager.dispose();
});

test('4. Positional remote footsteps work via PannerNode, exclude own playerId to avoid duplicate playback, and reset cleanly on lifecycle events', async () => {
  const walkBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/walking.wav'));
  const runBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/running.wav'));
  const mock = makeMockAudioContext();
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => ({
      _decoded: url.includes('running') ? runBuf : walkBuf
    })
  });

  const ctx = new mock.MockAudioContext();
  const camera = {
    position: { x: 10, y: 1.62, z: -20, clone() { return { x: this.x, y: this.y, z: this.z }; } },
    quaternion: { x: 0, y: 0, z: 0, w: 1 }
  };
  const audioManager = new MultiplayerAudioManager({ audioContext: ctx, camera });
  await audioManager.preloadMovementAudio();
  audioManager.updateListener();

  assert.equal(ctx.listener.positionX.value, 10);
  assert.equal(ctx.listener.positionZ.value, -20);
  assert.equal(ctx.listener.forwardZ.value, -1);

  // Remote player step triggers positional HRTF PannerNode routed into playerMovement bus
  const playedRemote = audioManager.playFootstep('player_remote_2', 'run', {
    positional: true,
    position: { x: 18, y: 0, z: -25 }
  });
  assert.equal(playedRemote, true);
  assert.equal(mock.createdPanners.length, 1);
  assert.equal(mock.createdPanners[0].panningModel, 'HRTF');
  assert.equal(mock.createdPanners[0].positionX.value, 18);
  assert.equal(mock.createdPanners[0].positionZ.value, -25);
  assert.ok(
    mock.createdPanners[0]._connectedTo.includes(audioManager.getCategoryBus(AUDIO_CATEGORIES.PLAYER_MOVEMENT)),
    'Positional PannerNode routes into playerMovement bus'
  );

  // Stopping one emitter only stops that emitter
  audioManager.playFootstep('local', 'walk', { positional: false });
  assert.equal(audioManager.getStatus().activeVoiceCount, 2);
  audioManager.stopEmitter('player_remote_2', { immediate: true });
  assert.equal(audioManager.getStatus().activeVoiceCount, 1);
  assert.ok(audioManager.getStatus().activeEmitters.local);

  // Match leave / Game Over / Restart stops all movement audio cleanly
  audioManager.stopAllMovementAudio({ immediate: true });
  assert.equal(audioManager.getStatus().activeVoiceCount, 0);

  audioManager.dispose();
});
