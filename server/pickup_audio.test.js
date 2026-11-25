import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIO_CATEGORIES,
  DEFAULT_SOUND_DEFINITIONS,
  MultiplayerAudioManager
} from '../js/multiplayer/audio_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readWavToBufferLike(wavPath) {
  const buf = fs.readFileSync(wavPath);
  let offset = 12;
  let sampleRate = 48000;
  let numChannels = 1;
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

function makeMockAudioContext() {
  const createdPanners = [];
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
      return {
        _connectedTo: [],
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
        disconnect() {}
      };
    }

    createPanner() {
      const node = {
        _connectedTo: [],
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
        disconnect() {}
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

  return { MockAudioContext, createdPanners, createdSources };
}

test('1. pickingUp.wav exists in assets/audio/ and defines interactions bus routing', () => {
  const wavPath = path.join(__dirname, '../assets/audio/pickingUp.wav');
  assert.equal(fs.existsSync(wavPath), true, 'pickingUp.wav exists in assets/audio/');
  assert.equal(DEFAULT_SOUND_DEFINITIONS.interaction_pickup.category, AUDIO_CATEGORIES.INTERACTIONS);
});

test('2. Local and remote item pickups deduplicate across ITEM_PICKUP_RESPONSE & ITEM_COLLECTED and route via interactions bus', async () => {
  const pickupBuf = readWavToBufferLike(path.join(__dirname, '../assets/audio/pickingUp.wav'));
  const mock = makeMockAudioContext();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => ({ _decoded: pickupBuf })
  });

  const ctx = new mock.MockAudioContext();
  const am = new MultiplayerAudioManager({ audioContext: ctx });
  await am.loadSound('interaction_pickup');

  // Local picker receives ITEM_PICKUP_RESPONSE then ITEM_COLLECTED for the same requestId -> plays strictly ONCE
  assert.equal(
    am.playItemPickup('pistol_spawn_1', { requestId: 'req_1', emitterId: 'p_1', positional: false }),
    true
  );
  assert.equal(
    am.playItemPickup('pistol_spawn_1', { requestId: 'req_1', emitterId: 'p_1', positional: false }),
    false,
    'Duplicate ITEM_COLLECTED/ITEM_PICKUP_RESPONSE for same pickup must be suppressed'
  );
  assert.equal(am.getStatus().totalInteractionVoicesCreated, 1);

  // Supports all world item categories (ammo, key, health pack, battery, consumable) cleanly
  for (const [idx, itemId] of ['ammo_1', 'key_1', 'hp_1', 'batt_1', 'almond_1'].entries()) {
    ctx.currentTime += 0.1;
    assert.equal(am.playItemPickup(itemId, { requestId: `req_${idx + 2}`, emitterId: 'p_1', positional: false }), true);
  }
  assert.equal(am.getStatus().totalInteractionVoicesCreated, 6);

  // Nearby remote player pickup uses HRTF PannerNode at world coordinates routed into interactions bus
  ctx.currentTime += 0.1;
  assert.equal(
    am.playItemPickup('key_remote_9', {
      requestId: 'req_remote_9',
      emitterId: 'p_2',
      positional: true,
      position: { x: 61, y: 0.8, z: -180 }
    }),
    true
  );
  assert.equal(mock.createdPanners.length, 1);
  assert.equal(mock.createdPanners[0].panningModel, 'HRTF');
  assert.equal(mock.createdPanners[0].positionX.value, 61);
  assert.equal(mock.createdPanners[0].positionZ.value, -180);
  assert.ok(
    mock.createdPanners[0]._connectedTo.includes(am.getCategoryBus(AUDIO_CATEGORIES.INTERACTIONS)),
    'Pickup audio routes through interactions bus'
  );

  // Volume scaling & lifecycle cleanup
  am.setMasterVolume(0.5);
  am.setCategoryVolume(AUDIO_CATEGORIES.INTERACTIONS, 0.5);
  am.setSoundVolume('interaction_pickup', 0.4);
  assert.ok(Math.abs(am.getEffectiveVolume('interaction_pickup') - 0.1) < 1e-6);

  am.stopAllAudio({ immediate: true });
  assert.equal(am.getStatus().activeInteractionVoiceCount, 0);
  am.dispose();
});
