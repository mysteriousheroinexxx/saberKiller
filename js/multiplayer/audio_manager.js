/**
 * Shared Multiplayer Audio Management Layer
 *
 * Single shared Web Audio AudioContext with category buses and hierarchical gain routing:
 *   Voice Gain -> Category Bus -> Master Bus -> AudioContext.destination
 *
 * Categories:
 *   - master (Master)
 *   - environment (Environment)
 *   - playerMovement (Player movement)
 *   - weapons (Weapons)
 *   - interactions (Interactions and consumables)
 *   - enemies (Enemies)
 *   - ui (UI)
 *
 * Ready for individual sound volume controls, category sliders, master volume,
 * and persistent client-side audio preferences.
 */

import { buildSeamlessLoopBuffer } from './ambient_audio.js';

export const AUDIO_CATEGORIES = Object.freeze({
  MASTER: 'master',
  ENVIRONMENT: 'environment',
  PLAYER_MOVEMENT: 'playerMovement',
  WEAPONS: 'weapons',
  INTERACTIONS: 'interactions',
  ENEMIES: 'enemies',
  UI: 'ui'
});

export const AUDIO_BUS_NAMES = Object.freeze([
  AUDIO_CATEGORIES.ENVIRONMENT,
  AUDIO_CATEGORIES.PLAYER_MOVEMENT,
  AUDIO_CATEGORIES.WEAPONS,
  AUDIO_CATEGORIES.INTERACTIONS,
  AUDIO_CATEGORIES.ENEMIES,
  AUDIO_CATEGORIES.UI
]);

export const DEFAULT_SOUND_DEFINITIONS = Object.freeze({
  level0_hum: {
    id: 'level0_hum',
    category: AUDIO_CATEGORIES.ENVIRONMENT,
    url: 'assets/audio/background60HzElectricHum.wav',
    defaultVolume: 0.14
  },
  player_walk: {
    id: 'player_walk',
    category: AUDIO_CATEGORIES.PLAYER_MOVEMENT,
    url: 'assets/audio/walking.wav',
    defaultVolume: 0.34,
    minIntervalSeconds: 0.34,
    fadeInSeconds: 0.008,
    fadeOutSeconds: 0.03
  },
  player_run: {
    id: 'player_run',
    category: AUDIO_CATEGORIES.PLAYER_MOVEMENT,
    url: 'assets/audio/running.wav',
    defaultVolume: 0.42,
    minIntervalSeconds: 0.22,
    fadeInSeconds: 0.006,
    fadeOutSeconds: 0.025
  },
  weapon_pistol_fire: {
    id: 'weapon_pistol_fire',
    category: AUDIO_CATEGORIES.WEAPONS,
    url: 'assets/audio/pistolFire.wav',
    defaultVolume: 0.62,
    minIntervalSeconds: 0.04,
    fadeInSeconds: 0.003,
    fadeOutSeconds: 0.03
  },
  weapon_reload: {
    id: 'weapon_reload',
    category: AUDIO_CATEGORIES.WEAPONS,
    url: 'assets/audio/reload.wav',
    defaultVolume: 0.56,
    minIntervalSeconds: 0.2,
    fadeInSeconds: 0.004,
    fadeOutSeconds: 0.03
  },
  sanity_heartbeat: {
    id: 'sanity_heartbeat',
    category: AUDIO_CATEGORIES.ENVIRONMENT,
    url: 'assets/audio/heartbeat.wav',
    defaultVolume: 0.72,
    fadeInSeconds: 1.5,
    fadeOutSeconds: 1.2
  },
  interaction_pickup: {
    id: 'interaction_pickup',
    category: AUDIO_CATEGORIES.INTERACTIONS,
    url: 'assets/audio/pickingUp.wav',
    defaultVolume: 0.6,
    minIntervalSeconds: 0.04,
    fadeInSeconds: 0.004,
    fadeOutSeconds: 0.03
  },
  interaction_drink: {
    id: 'interaction_drink',
    category: AUDIO_CATEGORIES.INTERACTIONS,
    url: 'assets/audio/drinkingDrink.wav',
    defaultVolume: 0.62,
    minIntervalSeconds: 0.1,
    fadeInSeconds: 0.004,
    fadeOutSeconds: 0.035
  }
});

export const AUDIO_PREFERENCES_STORAGE_KEY = 'saberKiller_audioPreferences_v1';

/**
 * Evaluates sanity heartbeat activation & intensity using the exact Budget-Backrooms
 * P_Player.uasset formula:
 *   Clamped = Clamp(LocalSanity, 0, SanityPercentFXThreshold [80.0])
 *   BlendWeight = 1.0 - (Clamped / 80.0)
 * Active while sanity <= 80.0 (intensity > 0); 0.0 above 80%.
 */
export function computeSanityHeartbeatIntensity(sanity, options = {}) {
  const threshold = (typeof options.threshold === 'number' && options.threshold > 0)
    ? options.threshold
    : 80.0;
  const panicThreshold = (typeof options.panicThreshold === 'number' && options.panicThreshold >= 0)
    ? options.panicThreshold
    : 10.0;

  if (typeof sanity !== 'number' || !Number.isFinite(sanity) || options.active === false || options.bypass === true) {
    return {
      active: false,
      shouldPlay: false,
      intensity: 0.0,
      state: 'NORMAL'
    };
  }

  const clamped = Math.max(0, Math.min(threshold, sanity));
  const intensity = +(1.0 - (clamped / threshold)).toFixed(6);
  const state = sanity <= 0
    ? 'DEPLETED'
    : (sanity <= panicThreshold ? 'PANIC' : (sanity <= threshold ? 'MILD_PARANOIA' : 'NORMAL'));
  const shouldPlay = sanity <= threshold && intensity > 0;

  return {
    active: true,
    shouldPlay,
    intensity: shouldPlay ? intensity : 0.0,
    state
  };
}

function clampGain(v, fallback = 1.0) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

/**
 * Finds the onset trim window [{ startSec, durationSec }] of a single-shot sound buffer
 * so leading dead silence is skipped while preserving a short clean pre-roll ramp.
 */
export function extractSoundTrimBounds(audioBuffer, options = {}) {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function' || audioBuffer.length <= 0) {
    return { startSec: 0, durationSec: 0.5 };
  }
  const sampleRate = audioBuffer.sampleRate || 48000;
  const ch0 = audioBuffer.getChannelData(0);
  const totalSamples = audioBuffer.length;
  const totalDuration = totalSamples / sampleRate;
  const threshold = options.threshold ?? 0.004;
  const preRollSec = options.preRollSeconds ?? 0.004;

  let firstIdx = -1;
  for (let i = 0; i < totalSamples; i++) {
    if (Math.abs(ch0[i]) >= threshold) {
      firstIdx = i;
      break;
    }
  }
  if (firstIdx < 0) {
    return { startSec: 0, durationSec: totalDuration };
  }

  let lastIdx = firstIdx;
  for (let i = totalSamples - 1; i > firstIdx; i--) {
    if (Math.abs(ch0[i]) >= threshold * 0.25) {
      lastIdx = i;
      break;
    }
  }

  const startSec = Math.max(0, (firstIdx / sampleRate) - preRollSec);
  const endSec = Math.min(totalDuration, (lastIdx / sampleRate) + 0.05);
  const durationSec = Math.max(0.1, endSec - startSec);
  return {
    startSec: +startSec.toFixed(4),
    durationSec: +durationSec.toFixed(4)
  };
}

/**
 * Extracts individual clean footstep burst windows [{ startSec, durationSec }]
 * from a multi-step AudioBuffer so steps trigger immediately on stride with zero silence delay.
 */
export function extractFootstepSlices(audioBuffer, options = {}) {
  if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function' || audioBuffer.length <= 0) {
    return [{ startSec: 0, durationSec: 0.3 }];
  }

  const sampleRate = audioBuffer.sampleRate || 44100;
  const ch0 = audioBuffer.getChannelData(0);
  const totalSamples = audioBuffer.length;
  const totalDuration = totalSamples / sampleRate;

  const winSamples = Math.max(128, Math.floor(sampleRate * 0.02)); // 20ms RMS window
  const rmsWindows = [];
  let maxRms = 0;

  for (let i = 0; i < totalSamples; i += winSamples) {
    const end = Math.min(totalSamples, i + winSamples);
    let sumSq = 0;
    for (let j = i; j < end; j++) {
      const s = ch0[j];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, end - i));
    rmsWindows.push(rms);
    if (rms > maxRms) maxRms = rms;
  }

  if (maxRms < 0.0005) {
    return [{ startSec: 0, durationSec: Math.min(0.35, totalDuration) }];
  }

  const threshold = Math.max(0.003, maxRms * 0.18);
  const minGapSec = options.minGapSeconds ?? 0.18;
  const minSliceSec = options.minSliceSeconds ?? 0.16;
  const maxSliceSec = options.maxSliceSeconds ?? 0.34;

  const slices = [];
  for (let w = 1; w < rmsWindows.length - 1; w++) {
    const val = rmsWindows[w];
    if (val >= threshold && val >= rmsWindows[w - 1] && val >= rmsWindows[w + 1]) {
      const peakSec = (w * winSamples) / sampleRate;
      const prevEnd = slices.length > 0 ? (slices[slices.length - 1].startSec + minGapSec) : -1;
      if (peakSec < prevEnd) continue;

      const startSec = Math.max(0, peakSec - 0.035);
      // Scan forward until tail drops quietly or maxSliceSec reached
      let endWin = w + 1;
      const maxEndWin = Math.min(rmsWindows.length, w + Math.ceil((maxSliceSec - 0.035) / 0.02));
      while (endWin < maxEndWin && rmsWindows[endWin] > threshold * 0.35) {
        endWin++;
      }
      const rawDur = (endWin * winSamples) / sampleRate - startSec + 0.04;
      const durationSec = Math.max(minSliceSec, Math.min(maxSliceSec, rawDur, totalDuration - startSec));
      if (durationSec >= 0.08) {
        slices.push({
          startSec: +startSec.toFixed(4),
          durationSec: +durationSec.toFixed(4)
        });
      }
    }
  }

  if (slices.length === 0) {
    slices.push({ startSec: 0, durationSec: Math.min(0.32, totalDuration) });
  }
  return slices;
}

export class MultiplayerAudioManager {
  constructor(options = {}) {
    this.ctx = options.audioContext || null;
    this.camera = options.camera || null;
    this.storageKey = options.storageKey || AUDIO_PREFERENCES_STORAGE_KEY;

    this.masterVolume = clampGain(options.masterVolume, 1.0);
    this.categoryVolumes = {};
    for (const bus of AUDIO_BUS_NAMES) {
      this.categoryVolumes[bus] = clampGain(options.categoryVolumes?.[bus], 1.0);
    }

    this.soundDefs = new Map();
    this.soundVolumes = {};
    for (const [id, def] of Object.entries(DEFAULT_SOUND_DEFINITIONS)) {
      this.soundDefs.set(id, { ...def });
      this.soundVolumes[id] = clampGain(options.soundVolumes?.[id], def.defaultVolume);
    }

    this.masterGain = null;
    this.categoryBuses = new Map(); // category -> GainNode
    this.buffers = new Map(); // soundId -> AudioBuffer
    this.bufferLoads = new Map(); // soundId -> Promise<AudioBuffer|null>
    this.footstepSlices = new Map(); // soundId -> [{ startSec, durationSec }]
    this.soundTrimBounds = new Map(); // soundId -> { startSec, durationSec }

    // Active single-voice slots per emitterId (prevents overlapping/duplicate footsteps)
    this.activeVoices = new Map(); // emitterId -> { source, gain, panner, soundId, stopTimer }
    this.activeWeaponVoices = new Set(); // Set<{ emitterId, soundId, positional, position, attachTarget, source, gain, panner, stopTimer }>
    this.activeInteractionVoices = new Set(); // Set<{ emitterId, soundId, positional, position, attachTarget, source, gain, panner, stopTimer }>
    this.lastEmitterPlayTime = new Map(); // `${emitterId}:${soundId}` -> seconds
    this.lastWeaponFireTime = new Map(); // `${emitterId}:${soundId}` -> seconds
    this.lastInteractionTime = new Map(); // `${emitterId}:${soundId}` -> seconds
    this._playedPickupKeys = new Set(); // `${itemId}::${requestId}` deduplication
    this._lastPickupItemTimes = new Map(); // itemId -> ctx time
    this.lastSliceIndex = new Map(); // soundId -> index
    this.totalVoicesCreated = 0;
    this.totalWeaponVoicesCreated = 0;
    this.totalInteractionVoicesCreated = 0;
    this._soundVolumeListeners = new Map();

    // Dynamic sanity heartbeat state (single looping local instance)
    this._heartbeatEntry = null;
    this._heartbeatShouldPlay = false;
    this._heartbeatToken = 0;
    this._heartbeatIntensity = 0.0;
    this._heartbeatSanity = 100.0;
    this._heartbeatState = 'NORMAL';
    this._heartbeatTotalInstances = 0;
    this._heartbeatLoopBuffer = null;

    this._unlockBound = false;
    this._unlockHandler = null;
  }

  onSoundVolumeChange(soundId, handler) {
    if (!this._soundVolumeListeners.has(soundId)) {
      this._soundVolumeListeners.set(soundId, new Set());
    }
    this._soundVolumeListeners.get(soundId).add(handler);
    return () => this._soundVolumeListeners.get(soundId)?.delete(handler);
  }

  getContext() {
    if (!this.ctx) {
      const AudioCtx = (typeof window !== 'undefined')
        ? (window.AudioContext || window.webkitAudioContext)
        : (globalThis.AudioContext || globalThis.webkitAudioContext);
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    this._ensureBuses();
    return this.ctx;
  }

  _ensureBuses() {
    if (!this.ctx || typeof this.ctx.createGain !== 'function') return;
    if (!this.masterGain) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.ctx.destination);
    }
    for (const bus of AUDIO_BUS_NAMES) {
      if (!this.categoryBuses.has(bus)) {
        const g = this.ctx.createGain();
        g.gain.value = this.categoryVolumes[bus] ?? 1.0;
        g.connect(this.masterGain);
        this.categoryBuses.set(bus, g);
      }
    }
  }

  getCategoryBus(category) {
    this.getContext();
    return this.categoryBuses.get(category) || this.masterGain || this.ctx?.destination || null;
  }

  setMasterVolume(volume) {
    const next = clampGain(volume, this.masterVolume);
    this.masterVolume = next;
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime || 0;
      if (typeof this.masterGain.gain?.setTargetAtTime === 'function') {
        this.masterGain.gain.setTargetAtTime(next, now, 0.03);
      } else if (this.masterGain.gain) {
        this.masterGain.gain.value = next;
      }
    }
    return this.masterVolume;
  }

  getMasterVolume() {
    return this.masterVolume;
  }

  setCategoryVolume(category, volume) {
    if (!(category in this.categoryVolumes)) return null;
    const next = clampGain(volume, this.categoryVolumes[category]);
    this.categoryVolumes[category] = next;
    const bus = this.categoryBuses.get(category);
    if (bus && this.ctx) {
      const now = this.ctx.currentTime || 0;
      if (typeof bus.gain?.setTargetAtTime === 'function') {
        bus.gain.setTargetAtTime(next, now, 0.03);
      } else if (bus.gain) {
        bus.gain.value = next;
      }
    }
    return next;
  }

  getCategoryVolume(category) {
    return this.categoryVolumes[category] ?? 1.0;
  }

  setSoundVolume(soundId, volume) {
    const def = this.soundDefs.get(soundId);
    const fallback = def ? def.defaultVolume : 1.0;
    const next = clampGain(volume, this.soundVolumes[soundId] ?? fallback);
    this.soundVolumes[soundId] = next;
    if (soundId === 'sanity_heartbeat' && this._heartbeatEntry?.soundGain?.gain && this.ctx) {
      const now = this.ctx.currentTime || 0;
      if (typeof this._heartbeatEntry.soundGain.gain.setTargetAtTime === 'function') {
        this._heartbeatEntry.soundGain.gain.setTargetAtTime(next, now, 0.03);
      } else {
        this._heartbeatEntry.soundGain.gain.value = next;
      }
    }
    const listeners = this._soundVolumeListeners.get(soundId);
    if (listeners) {
      for (const fn of listeners) {
        try { fn(next); } catch {}
      }
    }
    return next;
  }

  getSoundVolume(soundId) {
    if (typeof this.soundVolumes[soundId] === 'number') return this.soundVolumes[soundId];
    return this.soundDefs.get(soundId)?.defaultVolume ?? 1.0;
  }

  getEffectiveVolume(soundId, categoryOverride = null) {
    const def = this.soundDefs.get(soundId);
    const cat = categoryOverride || def?.category || AUDIO_CATEGORIES.UI;
    return this.getSoundVolume(soundId) * this.getCategoryVolume(cat) * this.getMasterVolume();
  }

  exportPreferences() {
    return {
      masterVolume: this.masterVolume,
      categoryVolumes: { ...this.categoryVolumes },
      soundVolumes: { ...this.soundVolumes }
    };
  }

  importPreferences(prefs) {
    if (!prefs || typeof prefs !== 'object') return;
    if (typeof prefs.masterVolume === 'number') {
      this.setMasterVolume(prefs.masterVolume);
    }
    if (prefs.categoryVolumes && typeof prefs.categoryVolumes === 'object') {
      for (const [cat, vol] of Object.entries(prefs.categoryVolumes)) {
        if (typeof vol === 'number') this.setCategoryVolume(cat, vol);
      }
    }
    if (prefs.soundVolumes && typeof prefs.soundVolumes === 'object') {
      for (const [id, vol] of Object.entries(prefs.soundVolumes)) {
        if (typeof vol === 'number') this.setSoundVolume(id, vol);
      }
    }
  }

  savePreferences(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!storage || typeof storage.setItem !== 'function') return false;
    try {
      storage.setItem(this.storageKey, JSON.stringify(this.exportPreferences()));
      return true;
    } catch {
      return false;
    }
  }

  loadPreferences(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!storage || typeof storage.getItem !== 'function') return false;
    try {
      const raw = storage.getItem(this.storageKey);
      if (!raw) return false;
      this.importPreferences(JSON.parse(raw));
      return true;
    } catch {
      return false;
    }
  }

  resetPreferences() {
    this.setMasterVolume(1.0);
    for (const bus of AUDIO_BUS_NAMES) {
      this.setCategoryVolume(bus, 1.0);
    }
    for (const [id, def] of this.soundDefs) {
      this.setSoundVolume(id, def.defaultVolume);
    }
  }

  registerSound(def) {
    if (!def || !def.id) return;
    this.soundDefs.set(def.id, { ...def });
    if (typeof this.soundVolumes[def.id] !== 'number') {
      this.soundVolumes[def.id] = clampGain(def.defaultVolume, 1.0);
    }
  }

  _bindAutoplayUnlock() {
    if (this._unlockBound || typeof window === 'undefined') return;
    this._unlockBound = true;
    this._unlockHandler = () => {
      if (this.ctx && this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
        this.ctx.resume().then(() => {
          if (this.ctx && this.ctx.state === 'running') {
            this._unbindAutoplayUnlock();
          }
        }).catch(() => {});
      } else {
        this._unbindAutoplayUnlock();
      }
    };
    window.addEventListener('pointerdown', this._unlockHandler, { passive: true });
    window.addEventListener('keydown', this._unlockHandler, { passive: true });
    window.addEventListener('mousedown', this._unlockHandler, { passive: true });
    window.addEventListener('touchstart', this._unlockHandler, { passive: true });
  }

  _unbindAutoplayUnlock() {
    if (!this._unlockBound || typeof window === 'undefined' || !this._unlockHandler) return;
    window.removeEventListener('pointerdown', this._unlockHandler);
    window.removeEventListener('keydown', this._unlockHandler);
    window.removeEventListener('mousedown', this._unlockHandler);
    window.removeEventListener('touchstart', this._unlockHandler);
    this._unlockBound = false;
    this._unlockHandler = null;
  }

  resumeIfSuspended() {
    const ctx = this.getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      this._bindAutoplayUnlock();
      if (typeof ctx.resume === 'function') {
        ctx.resume().catch(() => {});
      }
    }
  }

  async loadSound(soundId) {
    if (this.buffers.has(soundId)) return this.buffers.get(soundId);
    if (this.bufferLoads.has(soundId)) return this.bufferLoads.get(soundId);

    const def = this.soundDefs.get(soundId);
    const ctx = this.getContext();
    if (!def || !def.url || !ctx) return null;

    const promise = (async () => {
      try {
        const res = await fetch(def.url);
        if (!res || !res.ok) {
          throw new Error(`HTTP ${res ? res.status : 'ERR'} loading ${def.url}`);
        }
        const arrBuf = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrBuf);
        this.buffers.set(soundId, decoded);
        if (soundId === 'player_walk' || soundId === 'player_run') {
          this.footstepSlices.set(
            soundId,
            extractFootstepSlices(decoded, {
              minGapSeconds: soundId === 'player_run' ? 0.16 : 0.22,
              minSliceSeconds: soundId === 'player_run' ? 0.15 : 0.18,
              maxSliceSeconds: soundId === 'player_run' ? 0.27 : 0.35
            })
          );
        } else if (soundId === 'weapon_pistol_fire' || soundId === 'weapon_reload' || soundId === 'interaction_pickup' || soundId === 'interaction_drink') {
          this.soundTrimBounds.set(soundId, extractSoundTrimBounds(decoded));
        } else if (soundId === 'sanity_heartbeat') {
          this._heartbeatLoopBuffer = buildSeamlessLoopBuffer(ctx, decoded, 0.12);
        }
        return decoded;
      } catch (err) {
        this.bufferLoads.delete(soundId);
        console.warn(`[AudioManager] Failed to load '${soundId}':`, err?.message || err);
        return null;
      }
    })();

    this.bufferLoads.set(soundId, promise);
    return promise;
  }

  preloadMovementAudio() {
    return Promise.all([
      this.loadSound('player_walk'),
      this.loadSound('player_run')
    ]);
  }

  preloadMatchAudio() {
    return Promise.all([
      this.loadSound('player_walk'),
      this.loadSound('player_run'),
      this.loadSound('weapon_pistol_fire'),
      this.loadSound('weapon_reload'),
      this.loadSound('sanity_heartbeat'),
      this.loadSound('interaction_pickup'),
      this.loadSound('interaction_drink')
    ]);
  }

  _setPannerPosition(panner, position, now = 0) {
    if (!panner || !position) return;
    const px = position.x || 0;
    const py = position.y || 0;
    const pz = position.z || 0;
    if (panner.positionX && typeof panner.positionX.setValueAtTime === 'function') {
      panner.positionX.setValueAtTime(px, now);
      panner.positionY.setValueAtTime(py, now);
      panner.positionZ.setValueAtTime(pz, now);
    } else if (typeof panner.setPosition === 'function') {
      panner.setPosition(px, py, pz);
    }
  }

  updateListener(camera = this.camera) {
    if (!camera || !this.ctx || !this.ctx.listener) return;
    const listener = this.ctx.listener;
    const pos = camera.position;
    if (!pos) return;

    let fwd = { x: 0, y: 0, z: -1 };
    let up = { x: 0, y: 1, z: 0 };

    if (typeof camera.getWorldDirection === 'function' && pos && typeof pos.clone === 'function') {
      const dir = pos.clone();
      camera.getWorldDirection(dir);
      fwd = { x: dir.x, y: dir.y, z: dir.z };
      if (camera.up) {
        up = { x: camera.up.x || 0, y: camera.up.y ?? 1, z: camera.up.z || 0 };
      }
    } else if (camera.quaternion) {
      const qx = camera.quaternion.x || 0;
      const qy = camera.quaternion.y || 0;
      const qz = camera.quaternion.z || 0;
      const qw = camera.quaternion.w ?? 1;
      // Rotate local forward (0, 0, -1) by camera quaternion
      const ix = qw * 0 + qy * (-1) - qz * 0;
      const iy = qw * 0 + qz * 0 - qx * (-1);
      const iz = qw * (-1) + qx * 0 - qy * 0;
      const iw = -qx * 0 - qy * 0 - qz * (-1);
      fwd = {
        x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
        y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
        z: iz * qw + iw * -qz + ix * -qy - iy * -qx
      };
    }

    const now = this.ctx.currentTime || 0;
    if (listener.positionX && typeof listener.positionX.setValueAtTime === 'function') {
      listener.positionX.setValueAtTime(pos.x || 0, now);
      listener.positionY.setValueAtTime(pos.y || 0, now);
      listener.positionZ.setValueAtTime(pos.z || 0, now);
      listener.forwardX.setValueAtTime(fwd.x, now);
      listener.forwardY.setValueAtTime(fwd.y, now);
      listener.forwardZ.setValueAtTime(fwd.z, now);
      listener.upX.setValueAtTime(up.x, now);
      listener.upY.setValueAtTime(up.y, now);
      listener.upZ.setValueAtTime(up.z, now);
    } else if (typeof listener.setPosition === 'function') {
      listener.setPosition(pos.x || 0, pos.y || 0, pos.z || 0);
      if (typeof listener.setOrientation === 'function') {
        listener.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
      }
    }

    for (const entry of this.activeWeaponVoices) {
      if (entry.panner && typeof entry.attachTarget === 'function') {
        const nextPos = entry.attachTarget();
        if (nextPos) {
          entry.position = { ...nextPos };
          this._setPannerPosition(entry.panner, nextPos, now);
        }
      }
    }
  }

  _pickSlice(soundId) {
    const slices = this.footstepSlices.get(soundId);
    if (!slices || slices.length === 0) return { startSec: 0, durationSec: 0.3 };
    if (slices.length === 1) return slices[0];
    const prev = this.lastSliceIndex.get(soundId) ?? -1;
    let idx = (prev + 1) % slices.length;
    if (slices.length > 2) {
      const candidate = Math.floor(Math.random() * slices.length);
      if (candidate !== prev) idx = candidate;
    }
    this.lastSliceIndex.set(soundId, idx);
    return slices[idx];
  }

  /**
   * Plays a walking or running footstep for an emitter ('local' or remote playerId).
   * Enforces single non-overlapping voice per emitter and applies category/master buses.
   */
  playFootstep(emitterId, mode = 'walk', options = {}) {
    const soundId = (mode === 'run' || mode === 'sprint' || mode === 'FOOTSTEP_SPRINT')
      ? 'player_run'
      : 'player_walk';
    const def = this.soundDefs.get(soundId);
    if (!def) return false;

    const ctx = this.getContext();
    if (!ctx) return false;
    this.resumeIfSuspended();

    const buffer = this.buffers.get(soundId);
    if (!buffer) {
      // Trigger async preload for upcoming footsteps without queuing stale burst
      this.loadSound(soundId);
      return false;
    }

    const now = ctx.currentTime || 0;
    const minInterval = (typeof options.minIntervalSeconds === 'number')
      ? options.minIntervalSeconds
      : (def.minIntervalSeconds ?? 0.22);
    const rateKey = `${emitterId}:${soundId}`;
    const lastT = this.lastEmitterPlayTime.get(rateKey) ?? -Infinity;
    if (!options.ignoreRateLimit && (now - lastT) < minInterval) {
      return false;
    }

    // Stop any currently playing voice on this emitter to prevent overlap/duplicates
    this.stopEmitter(emitterId, { immediate: Boolean(options.immediateSwitch) });

    const slice = this._pickSlice(soundId);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.96 + Math.random() * 0.08;

    const voiceGain = ctx.createGain();
    const indVol = this.getSoundVolume(soundId) * (typeof options.volumeScale === 'number' ? options.volumeScale : 1.0);
    const fadeIn = Math.max(0.004, def.fadeInSeconds ?? 0.008);
    const fadeOut = Math.max(0.015, def.fadeOutSeconds ?? 0.025);
    const dur = Math.min(slice.durationSec, Math.max(0.05, (buffer.duration || 1) - slice.startSec));

    if (typeof voiceGain.gain?.setValueAtTime === 'function') {
      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.linearRampToValueAtTime(Math.max(0.0001, indVol), now + fadeIn);
      const fadeOutStart = now + Math.max(fadeIn, dur - fadeOut);
      voiceGain.gain.setValueAtTime(Math.max(0.0001, indVol), fadeOutStart);
      voiceGain.gain.linearRampToValueAtTime(0.0001, now + dur);
    } else if (voiceGain.gain) {
      voiceGain.gain.value = indVol;
    }

    let panner = null;
    const categoryBus = this.getCategoryBus(def.category);

    if (options.positional && options.position && typeof ctx.createPanner === 'function') {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 2.0;
      panner.maxDistance = 28.0;
      panner.rolloffFactor = 1.35;

      const px = options.position.x || 0;
      const py = (options.position.y || 0) + 0.15;
      const pz = options.position.z || 0;
      if (panner.positionX && typeof panner.positionX.setValueAtTime === 'function') {
        panner.positionX.setValueAtTime(px, now);
        panner.positionY.setValueAtTime(py, now);
        panner.positionZ.setValueAtTime(pz, now);
      } else if (typeof panner.setPosition === 'function') {
        panner.setPosition(px, py, pz);
      }

      source.connect(voiceGain);
      voiceGain.connect(panner);
      panner.connect(categoryBus);
    } else {
      source.connect(voiceGain);
      voiceGain.connect(categoryBus);
    }

    const entry = {
      emitterId,
      soundId,
      mode: soundId === 'player_run' ? 'run' : 'walk',
      positional: Boolean(panner),
      position: options.position ? { ...options.position } : null,
      source,
      gain: voiceGain,
      panner,
      stopTimer: null
    };

    this.activeVoices.set(emitterId, entry);
    this.lastEmitterPlayTime.set(rateKey, now);
    this.totalVoicesCreated++;

    const cleanup = () => {
      if (entry.stopTimer) {
        clearTimeout(entry.stopTimer);
        entry.stopTimer = null;
      }
      if (this.activeVoices.get(emitterId) === entry) {
        this.activeVoices.delete(emitterId);
      }
      try { source.disconnect(); } catch {}
      try { voiceGain.disconnect(); } catch {}
      if (panner) {
        try { panner.disconnect(); } catch {}
      }
    };

    source.onended = cleanup;
    source.start(now, slice.startSec, dur);
    entry.stopTimer = setTimeout(cleanup, Math.ceil((dur + 0.06) * 1000));
    if (typeof entry.stopTimer.unref === 'function') {
      entry.stopTimer.unref();
    }
    return true;
  }

  stopEmitter(emitterId, { immediate = false } = {}) {
    const entry = this.activeVoices.get(emitterId);
    if (!entry) return;
    this.activeVoices.delete(emitterId);

    const finalize = () => {
      if (entry.stopTimer) {
        clearTimeout(entry.stopTimer);
        entry.stopTimer = null;
      }
      try { entry.source.stop(); } catch {}
      try { entry.source.disconnect(); } catch {}
      try { entry.gain.disconnect(); } catch {}
      if (entry.panner) {
        try { entry.panner.disconnect(); } catch {}
      }
    };

    if (immediate || !this.ctx || typeof entry.gain?.gain?.linearRampToValueAtTime !== 'function') {
      finalize();
      return;
    }

    const now = this.ctx.currentTime || 0;
    try {
      entry.gain.gain.cancelScheduledValues?.(now);
      entry.gain.gain.setValueAtTime(entry.gain.gain.value || 0.1, now);
      entry.gain.gain.linearRampToValueAtTime(0.0001, now + 0.025);
      entry.source.stop(now + 0.03);
    } catch {
      finalize();
      return;
    }

    if (entry.stopTimer) clearTimeout(entry.stopTimer);
    entry.stopTimer = setTimeout(finalize, 45);
    if (typeof entry.stopTimer.unref === 'function') {
      entry.stopTimer.unref();
    }
  }

  /**
   * Plays a one-shot weapon discharge sound (e.g. 'weapon_pistol_fire') routed through the
   * 'weapons' category bus -> Master bus.
   */
  playWeaponFire(emitterId, soundId = 'weapon_pistol_fire', options = {}) {
    return this._playOneShotWeaponSound(emitterId, soundId, {
      ...options,
      replaceSameSound: false,
      pitchVariance: options.pitchVariance ?? 0.04
    });
  }

  /**
   * Plays a weapon reload sound ('weapon_reload') routed through the 'weapons' category bus.
   * Ensures at most one active reload sound per emitter and cleans up cleanly if interrupted.
   */
  playWeaponReload(emitterId, options = {}) {
    return this._playOneShotWeaponSound(emitterId, 'weapon_reload', {
      ...options,
      replaceSameSound: true,
      pitchVariance: options.pitchVariance ?? 0.02,
      weaponType: options.weaponType || null
    });
  }

  stopEmitterWeaponReload(emitterId) {
    if (!emitterId) return;
    for (const entry of [...this.activeWeaponVoices]) {
      if (entry.emitterId === emitterId && entry.soundId === 'weapon_reload') {
        this._stopVoiceSetEntry(this.activeWeaponVoices, entry);
      }
    }
  }

  /**
   * Plays item pickup audio once per item pickup event (deduplicating ITEM_PICKUP_RESPONSE
   * and ITEM_COLLECTED notifications for the same pickup) through the 'interactions' bus.
   */
  playItemPickup(itemId, options = {}) {
    if (!itemId) return false;
    const reqKey = options.requestId ? `${itemId}::${options.requestId}` : null;
    if (reqKey && this._playedPickupKeys.has(reqKey)) {
      return false;
    }

    const ctx = this.getContext();
    const now = ctx ? (ctx.currentTime || 0) : 0;
    const prevT = this._lastPickupItemTimes.get(itemId) ?? -Infinity;
    if (!options.ignoreDedupe && (now - prevT) < 0.25) {
      return false;
    }

    const played = this.playInteractionSound('interaction_pickup', {
      emitterId: options.emitterId || 'local',
      positional: Boolean(options.positional),
      position: options.position || null,
      attachTarget: options.attachTarget || null,
      ignoreRateLimit: Boolean(options.ignoreRateLimit),
      minIntervalSeconds: options.minIntervalSeconds ?? 0.03,
      pitchVariance: 0.03,
      refDistance: 2.0,
      maxDistance: 32.0,
      rolloffFactor: 1.25
    });

    if (played) {
      this._lastPickupItemTimes.set(itemId, now);
      if (reqKey) {
        this._playedPickupKeys.add(reqKey);
        if (this._playedPickupKeys.size > 256) {
          this._playedPickupKeys.delete(this._playedPickupKeys.values().next().value);
        }
      }
    }
    return played;
  }

  /**
   * Plays drinking audio for Almond Water ('almond_can') or Energy Drink ('energy_drink')
   * through the 'interactions' bus. Explicitly ignores 'sanity_pill' and non-drink items,
   * and deduplicates across accepted responses / retries via requestId.
   */
  playDrinkConsumable(itemType, options = {}) {
    if (itemType !== 'almond_can' && itemType !== 'energy_drink') {
      return false;
    }
    if (!this._playedDrinkKeys) {
      this._playedDrinkKeys = new Set();
    }
    const reqKey = options.requestId ? `${itemType}::${options.requestId}` : null;
    if (reqKey && this._playedDrinkKeys.has(reqKey)) {
      return false;
    }

    const played = this.playInteractionSound('interaction_drink', {
      emitterId: options.emitterId || 'local',
      positional: Boolean(options.positional),
      position: options.position || null,
      attachTarget: options.attachTarget || null,
      ignoreRateLimit: Boolean(options.ignoreRateLimit),
      minIntervalSeconds: options.minIntervalSeconds ?? 0.08,
      pitchVariance: 0.03,
      refDistance: 2.0,
      maxDistance: 28.0,
      rolloffFactor: 1.25
    });

    if (played && reqKey) {
      this._playedDrinkKeys.add(reqKey);
      if (this._playedDrinkKeys.size > 256) {
        this._playedDrinkKeys.delete(this._playedDrinkKeys.values().next().value);
      }
    }
    return played;
  }

  /**
   * Plays a one-shot interaction/consumable sound routed through the 'interactions' bus.
   */
  playInteractionSound(soundId, options = {}) {
    const emitterId = options.emitterId || 'local';
    return this._playOneShotBusSound({
      voiceSet: this.activeInteractionVoices,
      lastTimeMap: this.lastInteractionTime,
      counterKey: 'totalInteractionVoicesCreated',
      maxVoices: 6,
      emitterId,
      soundId,
      options
    });
  }

  _playOneShotWeaponSound(emitterId, soundId, options = {}) {
    return this._playOneShotBusSound({
      voiceSet: this.activeWeaponVoices,
      lastTimeMap: this.lastWeaponFireTime,
      counterKey: 'totalWeaponVoicesCreated',
      maxVoices: 8,
      emitterId,
      soundId,
      options
    });
  }

  _playOneShotBusSound({ voiceSet, lastTimeMap, counterKey, maxVoices, emitterId, soundId, options = {} }) {
    const def = this.soundDefs.get(soundId);
    if (!def) return false;

    const ctx = this.getContext();
    if (!ctx) return false;
    this.resumeIfSuspended();

    const buffer = this.buffers.get(soundId);
    if (!buffer) {
      // Trigger async preload for upcoming actions without queuing delayed playback
      this.loadSound(soundId);
      return false;
    }

    const now = ctx.currentTime || 0;
    const minInterval = (typeof options.minIntervalSeconds === 'number')
      ? options.minIntervalSeconds
      : (def.minIntervalSeconds ?? 0.04);
    const rateKey = `${emitterId}:${soundId}`;
    const lastT = lastTimeMap.get(rateKey) ?? -Infinity;
    if (!options.ignoreRateLimit && (now - lastT) < minInterval) {
      return false;
    }

    if (options.replaceSameSound) {
      for (const existing of [...voiceSet]) {
        if (existing.emitterId === emitterId && existing.soundId === soundId) {
          this._stopVoiceSetEntry(voiceSet, existing);
        }
      }
    }

    if (voiceSet.size >= maxVoices) {
      const oldest = voiceSet.values().next().value;
      if (oldest) this._stopVoiceSetEntry(voiceSet, oldest);
    }

    const bounds = this.soundTrimBounds.get(soundId) || {
      startSec: 0,
      durationSec: buffer.duration || 1.0
    };
    const dur = Math.min(bounds.durationSec, Math.max(0.08, (buffer.duration || 1.0) - bounds.startSec));

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (source.playbackRate) {
      const variance = options.pitchVariance ?? 0.04;
      source.playbackRate.value = (1 - variance * 0.5) + Math.random() * variance;
    }

    const voiceGain = ctx.createGain();
    const indVol = this.getSoundVolume(soundId) * (typeof options.volumeScale === 'number' ? options.volumeScale : 1.0);
    const fadeIn = Math.max(0.002, def.fadeInSeconds ?? 0.003);
    const fadeOut = Math.max(0.02, def.fadeOutSeconds ?? 0.03);

    if (typeof voiceGain.gain?.setValueAtTime === 'function') {
      voiceGain.gain.setValueAtTime(0.0001, now);
      voiceGain.gain.linearRampToValueAtTime(Math.max(0.0001, indVol), now + fadeIn);
      const fadeOutStart = now + Math.max(fadeIn, dur - fadeOut);
      voiceGain.gain.setValueAtTime(Math.max(0.0001, indVol), fadeOutStart);
      voiceGain.gain.linearRampToValueAtTime(0.0001, now + dur);
    } else if (voiceGain.gain) {
      voiceGain.gain.value = indVol;
    }

    let panner = null;
    const categoryBus = this.getCategoryBus(def.category);
    const initialPos = options.position || (typeof options.attachTarget === 'function' ? options.attachTarget() : null);

    if (options.positional !== false && initialPos && typeof ctx.createPanner === 'function') {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = options.refDistance ?? (emitterId === 'local' ? 1.8 : 2.5);
      panner.maxDistance = options.maxDistance ?? 55.0;
      panner.rolloffFactor = options.rolloffFactor ?? 1.1;

      this._setPannerPosition(panner, initialPos, now);
      source.connect(voiceGain);
      voiceGain.connect(panner);
      panner.connect(categoryBus);
    } else {
      source.connect(voiceGain);
      voiceGain.connect(categoryBus);
    }

    const entry = {
      emitterId,
      soundId,
      weaponType: options.weaponType || null,
      positional: Boolean(panner),
      position: initialPos ? { ...initialPos } : null,
      attachTarget: typeof options.attachTarget === 'function' ? options.attachTarget : null,
      source,
      gain: voiceGain,
      panner,
      stopTimer: null
    };

    voiceSet.add(entry);
    lastTimeMap.set(rateKey, now);
    this[counterKey] = (this[counterKey] || 0) + 1;

    const cleanup = () => {
      if (entry.stopTimer) {
        clearTimeout(entry.stopTimer);
        entry.stopTimer = null;
      }
      voiceSet.delete(entry);
      try { source.disconnect(); } catch {}
      try { voiceGain.disconnect(); } catch {}
      if (panner) {
        try { panner.disconnect(); } catch {}
      }
    };

    source.onended = cleanup;
    source.start(now, bounds.startSec, dur);
    entry.stopTimer = setTimeout(cleanup, Math.ceil((dur + 0.08) * 1000));
    if (typeof entry.stopTimer.unref === 'function') {
      entry.stopTimer.unref();
    }
    return true;
  }

  _stopVoiceSetEntry(voiceSet, entry) {
    if (!entry) return;
    voiceSet.delete(entry);
    if (entry.stopTimer) {
      clearTimeout(entry.stopTimer);
      entry.stopTimer = null;
    }
    try { entry.source.stop(); } catch {}
    try { entry.source.disconnect(); } catch {}
    try { entry.gain.disconnect(); } catch {}
    if (entry.panner) {
      try { entry.panner.disconnect(); } catch {}
    }
  }

  stopAllWeaponAudio({ immediate = true } = {}) {
    for (const entry of [...this.activeWeaponVoices]) {
      this._stopVoiceSetEntry(this.activeWeaponVoices, entry);
    }
    this.lastWeaponFireTime.clear();
  }

  stopAllInteractionAudio() {
    for (const entry of [...this.activeInteractionVoices]) {
      this._stopVoiceSetEntry(this.activeInteractionVoices, entry);
    }
    this.lastInteractionTime.clear();
    this._playedPickupKeys.clear();
    this._playedDrinkKeys?.clear();
    this._lastPickupItemTimes.clear();
  }

  stopAllMovementAudio({ immediate = true } = {}) {
    for (const emitterId of [...this.activeVoices.keys()]) {
      this.stopEmitter(emitterId, { immediate });
    }
    this.lastEmitterPlayTime.clear();
  }

  /**
   * Drives local sanity heartbeat audio continuously using the Budget Backrooms model:
   * silent above 80% sanity, scaling continuously via 1 - clamp(sanity, 0, 80) / 80
   * down to 1.0 at 0% sanity, smoothly fading in/out with strictly one active loop.
   */
  updateSanityHeartbeat(sanity, options = {}) {
    const evalRes = computeSanityHeartbeatIntensity(sanity, options);
    this._heartbeatSanity = typeof sanity === 'number' && Number.isFinite(sanity) ? sanity : this._heartbeatSanity;
    this._heartbeatState = evalRes.state;
    this._heartbeatIntensity = evalRes.intensity;

    if (!evalRes.shouldPlay) {
      this.stopSanityHeartbeat({ immediate: Boolean(options.immediate) });
      return evalRes;
    }

    this._heartbeatShouldPlay = true;
    const ctx = this.getContext();
    if (!ctx) return evalRes;
    this.resumeIfSuspended();

    const now = ctx.currentTime || 0;
    if (this._heartbeatEntry) {
      const { envGain, soundGain } = this._heartbeatEntry;
      const targetInd = this.getSoundVolume('sanity_heartbeat');
      if (typeof envGain.gain?.setTargetAtTime === 'function') {
        envGain.gain.setTargetAtTime(evalRes.intensity, now, 0.25);
      } else if (envGain.gain) {
        envGain.gain.value = evalRes.intensity;
      }
      if (soundGain?.gain) {
        if (typeof soundGain.gain.setTargetAtTime === 'function') {
          soundGain.gain.setTargetAtTime(targetInd, now, 0.04);
        } else {
          soundGain.gain.value = targetInd;
        }
      }
      return evalRes;
    }

    const token = ++this._heartbeatToken;
    const readyBuffer = this._heartbeatLoopBuffer || this.buffers.get('sanity_heartbeat');
    if (readyBuffer) {
      this._startHeartbeatInstance(readyBuffer, token);
    } else if (!this.bufferLoads.has('sanity_heartbeat')) {
      this.loadSound('sanity_heartbeat').then((decoded) => {
        if (!decoded) return;
        const buf = this._heartbeatLoopBuffer || decoded;
        if (this._heartbeatShouldPlay && this._heartbeatToken === token && !this._heartbeatEntry) {
          this._startHeartbeatInstance(buf, token);
        }
      });
    }
    return evalRes;
  }

  _startHeartbeatInstance(buffer, token) {
    if (!this._heartbeatShouldPlay || this._heartbeatToken !== token || this._heartbeatEntry) return false;
    const ctx = this.getContext();
    if (!ctx) return false;

    const def = this.soundDefs.get('sanity_heartbeat');
    const bus = this.getCategoryBus(def ? def.category : AUDIO_CATEGORIES.ENVIRONMENT);
    const now = ctx.currentTime || 0;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const envGain = ctx.createGain();
    const soundGain = ctx.createGain();
    const indVol = this.getSoundVolume('sanity_heartbeat');

    if (typeof soundGain.gain?.setValueAtTime === 'function') {
      soundGain.gain.setValueAtTime(indVol, now);
    } else if (soundGain.gain) {
      soundGain.gain.value = indVol;
    }

    // Smooth fade-in from near-zero to current sanity intensity
    if (typeof envGain.gain?.setValueAtTime === 'function' && typeof envGain.gain?.setTargetAtTime === 'function') {
      envGain.gain.setValueAtTime(0.0001, now);
      envGain.gain.setTargetAtTime(Math.max(0.0001, this._heartbeatIntensity), now, 0.35);
    } else if (envGain.gain) {
      envGain.gain.value = this._heartbeatIntensity;
    }

    source.connect(envGain);
    envGain.connect(soundGain);
    soundGain.connect(bus);

    const entry = {
      source,
      envGain,
      soundGain,
      stopTimer: null
    };
    this._heartbeatEntry = entry;
    this._heartbeatTotalInstances++;

    source.onended = () => {
      if (this._heartbeatEntry === entry) {
        this._heartbeatEntry = null;
      }
      try { source.disconnect(); } catch {}
      try { envGain.disconnect(); } catch {}
      try { soundGain.disconnect(); } catch {}
    };

    source.start(0);
    return true;
  }

  stopSanityHeartbeat({ immediate = false } = {}) {
    this._heartbeatShouldPlay = false;
    this._heartbeatToken++;
    this._heartbeatIntensity = 0.0;

    const entry = this._heartbeatEntry;
    if (!entry) return;
    this._heartbeatEntry = null;

    const finalize = () => {
      if (entry.stopTimer) {
        clearTimeout(entry.stopTimer);
        entry.stopTimer = null;
      }
      try { entry.source.stop(); } catch {}
      try { entry.source.disconnect(); } catch {}
      try { entry.envGain.disconnect(); } catch {}
      try { entry.soundGain.disconnect(); } catch {}
    };

    if (immediate || !this.ctx || typeof entry.envGain?.gain?.linearRampToValueAtTime !== 'function') {
      finalize();
      return;
    }

    const fadeSec = 0.65;
    const now = this.ctx.currentTime || 0;
    try {
      entry.envGain.gain.cancelScheduledValues?.(now);
      entry.envGain.gain.setValueAtTime(Math.max(0.0001, entry.envGain.gain.value || 0.1), now);
      entry.envGain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
      entry.source.stop(now + fadeSec + 0.03);
    } catch {
      finalize();
      return;
    }

    entry.stopTimer = setTimeout(finalize, Math.ceil((fadeSec + 0.08) * 1000));
    if (typeof entry.stopTimer.unref === 'function') {
      entry.stopTimer.unref();
    }
  }

  stopAllAudio({ immediate = true } = {}) {
    this.stopAllMovementAudio({ immediate });
    this.stopAllWeaponAudio({ immediate });
    this.stopAllInteractionAudio();
    this.stopSanityHeartbeat({ immediate });
  }

  getStatus() {
    const activeEmitters = {};
    for (const [id, v] of this.activeVoices) {
      activeEmitters[id] = {
        soundId: v.soundId,
        mode: v.mode,
        positional: v.positional,
        position: v.position
      };
    }
    const activeWeaponEmitters = [...this.activeWeaponVoices].map((v) => ({
      emitterId: v.emitterId,
      soundId: v.soundId,
      positional: v.positional,
      position: v.position
    }));
    const activeInteractionEmitters = [...this.activeInteractionVoices].map((v) => ({
      emitterId: v.emitterId,
      soundId: v.soundId,
      positional: v.positional,
      position: v.position
    }));
    return {
      contextState: this.ctx ? this.ctx.state : 'uninitialized',
      masterVolume: this.masterVolume,
      categoryVolumes: { ...this.categoryVolumes },
      soundVolumes: { ...this.soundVolumes },
      loadedSounds: [...this.buffers.keys()],
      activeVoiceCount: this.activeVoices.size,
      activeEmitters,
      totalVoicesCreated: this.totalVoicesCreated,
      activeWeaponVoiceCount: this.activeWeaponVoices.size,
      activeWeaponEmitters,
      totalWeaponVoicesCreated: this.totalWeaponVoicesCreated,
      activeInteractionVoiceCount: this.activeInteractionVoices.size,
      activeInteractionEmitters,
      totalInteractionVoicesCreated: this.totalInteractionVoicesCreated,
      pistolTrimBounds: this.soundTrimBounds.get('weapon_pistol_fire') || null,
      reloadTrimBounds: this.soundTrimBounds.get('weapon_reload') || null,
      heartbeatIsPlaying: Boolean(this._heartbeatEntry),
      heartbeatIntensity: this._heartbeatIntensity,
      heartbeatSanity: this._heartbeatSanity,
      heartbeatState: this._heartbeatState,
      heartbeatTotalInstances: this._heartbeatTotalInstances,
      walkSlicesCount: this.footstepSlices.get('player_walk')?.length || 0,
      runSlicesCount: this.footstepSlices.get('player_run')?.length || 0
    };
  }

  dispose() {
    this._unbindAutoplayUnlock();
    this.stopAllAudio({ immediate: true });
    for (const g of this.categoryBuses.values()) {
      try { g.disconnect(); } catch {}
    }
    this.categoryBuses.clear();
    if (this.masterGain) {
      try { this.masterGain.disconnect(); } catch {}
      this.masterGain = null;
    }
  }
}
