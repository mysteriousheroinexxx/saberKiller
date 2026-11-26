import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_CATEGORIES,
  DEFAULT_SOUND_DEFINITIONS,
  MultiplayerAudioManager,
  computeSanityHeartbeatIntensity
} from '../js/multiplayer/audio_manager.js';
import { SanityController } from '../js/multiplayer/sanity_controller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readWavToBufferLike(wavPath) {
  const buf = fs.readFileSync(wavPath);
  let offset = 12;
  let sampleRate = 44100;
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
  const createdSources = [];

  class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 1.0;
      this.destination = { _isDestination: true };
      this.listener = {};
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

  return { MockAudioContext, createdGains, createdSources };
}

test('1. heartbeat.wav exists and computeSanityHeartbeatIntensity matches Budget Backrooms P_Player formula', () => {
  const wavPath = path.join(__dirname, '../assets/audio/heartbeat.wav');
  assert.equal(fs.existsSync(wavPath), true, 'heartbeat.wav exists in assets/audio/');
  assert.equal(DEFAULT_SOUND_DEFINITIONS.sanity_heartbeat.category, AUDIO_CATEGORIES.ENVIRONMENT);

  // High sanity (> 80.0): silent
  assert.deepEqual(computeSanityHeartbeatIntensity(100), {
    active: true, shouldPlay: false, intensity: 0, state: 'NORMAL'
  });
  assert.deepEqual(computeSanityHeartbeatIntensity(80.1), {
    active: true, shouldPlay: false, intensity: 0, state: 'NORMAL'
  });

  // Boundary 80.0 -> 0 weight, drops below 80 -> positive continuous intensity 1 - (clamp(sanity, 0, 80) / 80)
  assert.equal(computeSanityHeartbeatIntensity(80).shouldPlay, false);
  const medium = computeSanityHeartbeatIntensity(50);
  assert.equal(medium.shouldPlay, true);
  assert.equal(medium.state, 'MILD_PARANOIA');
  assert.ok(Math.abs(medium.intensity - 0.375) < 1e-6);

  const half = computeSanityHeartbeatIntensity(40);
  assert.ok(Math.abs(half.intensity - 0.5) < 1e-6);

  // Panic threshold (<= 10.0) and zero sanity (0.0)
  const low = computeSanityHeartbeatIntensity(10);
  assert.equal(low.shouldPlay, true);
  assert.equal(low.state, 'PANIC');
  assert.ok(Math.abs(low.intensity - 0.875) < 1e-6);

  const zero = computeSanityHeartbeatIntensity(0);
  assert.equal(zero.shouldPlay, true);
  assert.equal(zero.state, 'DEPLETED');
  assert.equal(zero.intensity, 1.0);
});

test('2. Heartbeat plays single seamless loop, responds continuously to sanity, fades out on recovery, and cleans up on stopAllAudio', async () => {
  const heartBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/heartbeat.wav'));
  const mock = makeMockAudioContext();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => ({ _decoded: heartBuf })
  });

  const ctx = new mock.MockAudioContext();
  const audioManager = new MultiplayerAudioManager({ audioContext: ctx });
  await audioManager.loadSound('sanity_heartbeat');

  // High sanity (100, 85) -> must NOT start heartbeat
  audioManager.updateSanityHeartbeat(100, { active: true });
  audioManager.updateSanityHeartbeat(85, { active: true });
  assert.equal(audioManager.getStatus().heartbeatIsPlaying, false);
  assert.equal(audioManager.getStatus().heartbeatTotalInstances, 0);

  // Drop into medium sanity (60 -> 0.25, then 40 -> 0.5) -> starts ONCE, intensifies continuously without duplicates
  audioManager.updateSanityHeartbeat(60, { active: true });
  assert.equal(audioManager.getStatus().heartbeatIsPlaying, true);
  assert.equal(audioManager.getStatus().heartbeatTotalInstances, 1);
  assert.equal(mock.createdSources[0].loop, true);
  assert.ok(Math.abs(audioManager.getStatus().heartbeatIntensity - 0.25) < 1e-6);

  audioManager.updateSanityHeartbeat(40, { active: true });
  audioManager.updateSanityHeartbeat(8, { active: true });
  audioManager.updateSanityHeartbeat(0, { active: true });
  assert.equal(audioManager.getStatus().heartbeatTotalInstances, 1, 'Never creates overlapping/duplicate heartbeat sources');
  assert.equal(audioManager.getStatus().heartbeatIntensity, 1.0);
  assert.equal(audioManager.getStatus().heartbeatState, 'DEPLETED');

  // Verify configurable master, environment bus, and sanity_heartbeat individual volumes
  audioManager.setMasterVolume(0.5);
  audioManager.setCategoryVolume(AUDIO_CATEGORIES.ENVIRONMENT, 0.5);
  audioManager.setSoundVolume('sanity_heartbeat', 0.4);
  assert.ok(Math.abs(audioManager.getEffectiveVolume('sanity_heartbeat') - 0.1) < 1e-6);

  // Recover sanity back > 80 -> fades out and stops cleanly
  audioManager.updateSanityHeartbeat(90, { active: true });
  assert.equal(audioManager.getStatus().heartbeatIsPlaying, false);
  assert.equal(audioManager.getStatus().heartbeatIntensity, 0);

  // Re-enter low sanity, then test match-end / leave / restart immediate stopAllAudio()
  audioManager.updateSanityHeartbeat(15, { active: true });
  assert.equal(audioManager.getStatus().heartbeatIsPlaying, true);
  assert.equal(audioManager.getStatus().heartbeatTotalInstances, 2);

  audioManager.stopAllAudio({ immediate: true });
  assert.equal(audioManager.getStatus().heartbeatIsPlaying, false);
  assert.equal(mock.createdSources[1].stopped, true);

  audioManager.dispose();
});

test('3. Two independent local sanity instances never cross-contaminate and preserve zero-sanity gameplay', async () => {
  const heartBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/heartbeat.wav'));
  const mock1 = makeMockAudioContext();
  const mock2 = makeMockAudioContext();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => ({ _decoded: heartBuf })
  });

  const am1 = new MultiplayerAudioManager({ audioContext: new mock1.MockAudioContext() });
  const am2 = new MultiplayerAudioManager({ audioContext: new mock2.MockAudioContext() });
  await Promise.all([am1.loadSound('sanity_heartbeat'), am2.loadSound('sanity_heartbeat')]);

  const sc1 = new SanityController();
  const sc2 = new SanityController();

  // Client 1 drops to 0% sanity (blackout), Client 2 stays healthy at 95%
  sc1.applyServerState({ sanity: 0, maxSanity: 100 });
  sc2.applyServerState({ sanity: 95, maxSanity: 100 });

  am1.updateSanityHeartbeat(sc1.getSnapshot().currentSanity, { active: true });
  am2.updateSanityHeartbeat(sc2.getSnapshot().currentSanity, { active: true });

  assert.equal(am1.getStatus().heartbeatIsPlaying, true);
  assert.equal(am1.getStatus().heartbeatIntensity, 1.0);
  assert.equal(am2.getStatus().heartbeatIsPlaying, false);
  assert.equal(am2.getStatus().heartbeatIntensity, 0);

  am1.dispose();
  am2.dispose();
});
