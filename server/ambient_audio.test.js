import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MultiplayerAmbientAudio,
  DEFAULT_AMBIENT_AUDIO_CONFIG,
  buildSeamlessLoopBuffer
} from '../js/multiplayer/ambient_audio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readWavChannel0Float32(wavPath) {
  const buf = fs.readFileSync(wavPath);
  // Standard RIFF/WAVE header scan for 'fmt ' & 'data' chunks
  let offset = 12;
  let sampleRate = 48000;
  let numChannels = 2;
  let dataStart = -1;
  let dataLen = 0;

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      numChannels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
    } else if (id === 'data') {
      dataStart = offset + 8;
      dataLen = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }

  assert.ok(dataStart > 0 && dataLen > 0, 'WAV data chunk found');
  const frameCount = Math.floor(dataLen / (2 * numChannels));
  const channels = Array.from({ length: numChannels }, () => new Float32Array(frameCount));

  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = buf.readInt16LE(dataStart + (i * numChannels + c) * 2);
      channels[c][i] = sample / 32768;
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

function makeMockAudioContext(decodedBuffer) {
  const createdSources = [];
  const createGainNode = (initVal = 1.0) => ({
    gain: {
      value: initVal,
      setValueAtTime(v) { this.value = v; },
      linearRampToValueAtTime(v) { this.value = v; },
      setTargetAtTime(v) { this.value = v; },
      cancelScheduledValues() {}
    },
    connect() {},
    disconnect() {}
  });

  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: async () => { ctx.state = 'running'; },
    createGain: () => createGainNode(1.0),
    createBuffer: (ch, len, rate) => {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return {
        numberOfChannels: ch,
        length: len,
        sampleRate: rate,
        duration: len / rate,
        getChannelData: (c) => data[c]
      };
    },
    decodeAudioData: async () => decodedBuffer,
    createBufferSource: () => {
      const src = {
        buffer: null,
        loop: false,
        started: false,
        stopped: false,
        onended: null,
        connect() {},
        disconnect() {},
        start() { src.started = true; },
        stop() { src.stopped = true; }
      };
      createdSources.push(src);
      return src;
    }
  };
  return { ctx, createdSources };
}

test('1. Asset exists in game audio dir and seamless loop builder removes tail-to-head discontinuity', () => {
  const wavPath = path.join(__dirname, '../assets/audio/background60HzElectricHum.wav');
  assert.equal(fs.existsSync(wavPath), true, 'background60HzElectricHum.wav copied to assets/audio/');

  const raw = readWavChannel0Float32(wavPath);
  const { ctx } = makeMockAudioContext(raw);
  const looped = buildSeamlessLoopBuffer(ctx, raw, 0.25);

  assert.ok(looped.length < raw.length && looped.length > raw.length * 0.8);
  const ch0 = looped.getChannelData(0);
  const wrapJump = Math.abs(ch0[0] - ch0[looped.length - 1]);
  // Verify loop seam step matches smooth 60Hz cycle delta (zero click discontinuity)
  const rawJump = Math.abs(raw.getChannelData(0)[0] - raw.getChannelData(0)[raw.length - 1]);
  assert.ok(wrapJump < 0.02, `Loop boundary jump must be smooth (<0.02), got ${wrapJump.toFixed(5)}`);
  assert.ok(wrapJump < rawJump * 0.25, `Seamless loop boundary jump (${wrapJump.toFixed(5)}) is far cleaner than raw WAV seam (${rawJump.toFixed(5)})`);
});

test('2. Ambient audio controller enforces subtle configurable volume, single instance, and clean start/stop/restart lifecycle', async () => {
  const wavPath = path.join(__dirname, '../assets/audio/background60HzElectricHum.wav');
  const raw = readWavChannel0Float32(wavPath);
  const { ctx, createdSources } = makeMockAudioContext(raw);

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(8)
  });

  const audio = new MultiplayerAmbientAudio({ audioContext: ctx });
  assert.equal(audio.getVolume(), DEFAULT_AMBIENT_AUDIO_CONFIG.volume);
  assert.ok(audio.getVolume() > 0 && audio.getVolume() <= 0.25, 'Default volume is subtle');

  // Volume configuration & clamping
  assert.equal(audio.setVolume(0.22), 0.22);
  assert.equal(audio.setVolume(2.0), 1.0);
  assert.equal(audio.setVolume(-1.0), 0.0);
  assert.equal(audio.setVolume(0.14), 0.14);

  // Rapid concurrent starts must only create 1 active looping BufferSource
  await Promise.all([audio.start(), audio.start(), audio.start()]);
  assert.equal(createdSources.length, 1, 'Exactly one AudioBufferSourceNode created');
  assert.equal(createdSources[0].loop, true, 'Loop enabled on Web Audio BufferSourceNode');
  assert.equal(audio.getStatus().activeInstanceCount, 1);

  // Calling start() again while active must NOT spawn a duplicate instance
  await audio.start();
  assert.equal(createdSources.length, 1);
  assert.equal(audio.getStatus().activeInstanceCount, 1);

  // Stop (e.g. Game Over / Return to Lobby / Disconnect)
  audio.stop({ immediate: true });
  assert.equal(createdSources[0].stopped, true);
  assert.equal(audio.getStatus().activeInstanceCount, 0);
  assert.equal(audio.getStatus().isPlaying, false);

  // Match restart: starts fresh single instance (never leaves 2 active instances)
  await audio.start();
  assert.equal(createdSources.length, 2);
  assert.equal(createdSources[0].stopped, true);
  assert.equal(createdSources[1].stopped, false);
  assert.equal(audio.getStatus().activeInstanceCount, 1);

  audio.dispose();
  assert.equal(audio.getStatus().activeInstanceCount, 0);
});
