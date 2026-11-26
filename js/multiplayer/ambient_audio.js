/**
 * Multiplayer Survival Mode Level 0 Ambient Audio Controller
 *
 * Uses Web Audio API with phase-aligned equal-power loop crossfading so
 * background60HzElectricHum.wav loops seamlessly without gaps or clicks.
 * Strictly enforces a single active source instance per client.
 */

export const DEFAULT_AMBIENT_AUDIO_CONFIG = Object.freeze({
  url: 'assets/audio/background60HzElectricHum.wav',
  volume: 0.14, // Subtle atmospheric background hum (~-17 dB gain)
  fadeInSeconds: 0.35,
  fadeOutSeconds: 0.2,
  crossfadeSeconds: 0.25
});

function clampVolume(v, fallback = DEFAULT_AMBIENT_AUDIO_CONFIG.volume) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

/**
 * Produces a phase-aligned, equal-power crossfaded seamless loop buffer
 * from a raw decoded AudioBuffer so periodic waveforms wrap without clicks.
 */
export function buildSeamlessLoopBuffer(ctx, rawBuffer, crossfadeSeconds = 0.25) {
  if (!ctx || !rawBuffer || typeof ctx.createBuffer !== 'function') return rawBuffer;

  const numChannels = rawBuffer.numberOfChannels || 1;
  const sampleRate = rawBuffer.sampleRate || 48000;
  const totalFrames = rawBuffer.length || 0;

  const fadeFrames = Math.min(
    Math.floor(sampleRate * Math.max(0.02, crossfadeSeconds)),
    Math.floor(totalFrames / 4)
  );
  if (fadeFrames < 64 || totalFrames <= fadeFrames * 2) {
    return rawBuffer;
  }

  // Search up to ~1 fundamental 60Hz cycle (or 25ms) for best waveform phase alignment
  const searchWindow = Math.min(Math.floor(sampleRate / 40), totalFrames - fadeFrames * 2 - 1);
  const ch0 = rawBuffer.getChannelData(0);
  const baseStart = totalFrames - fadeFrames - Math.max(0, searchWindow);
  const corrLen = Math.min(1600, fadeFrames);

  let bestLen = totalFrames - fadeFrames;
  let bestScore = -Infinity;
  for (let lag = 0; lag <= Math.max(0, searchWindow); lag++) {
    const pos = baseStart + lag;
    let score = 0;
    for (let i = 0; i < corrLen; i += 4) {
      score += ch0[pos + i] * ch0[i];
    }
    if (score > bestScore) {
      bestScore = score;
      bestLen = pos;
    }
  }

  if (bestLen <= fadeFrames || bestLen + fadeFrames > totalFrames) {
    bestLen = totalFrames - fadeFrames;
  }

  const loopBuffer = ctx.createBuffer(numChannels, bestLen, sampleRate);
  for (let c = 0; c < numChannels; c++) {
    const src = rawBuffer.getChannelData(c);
    const dst = loopBuffer.getChannelData(c);
    dst.set(src.subarray(0, bestLen));

    // Equal-power crossfade tail [bestLen .. bestLen + fadeFrames) over head [0 .. fadeFrames)
    for (let i = 0; i < fadeFrames; i++) {
      const t = i / fadeFrames;
      const headWeight = Math.sin(t * Math.PI * 0.5);
      const tailWeight = Math.cos(t * Math.PI * 0.5);
      dst[i] = src[i] * headWeight + src[bestLen + i] * tailWeight;
    }
  }

  return loopBuffer;
}

export class MultiplayerAmbientAudio {
  constructor(options = {}) {
    this.audioManager = options.audioManager || null;
    this.soundId = options.soundId || 'level0_hum';
    this.category = options.category || 'environment';

    const hasExplicitVolume = typeof options.volume === 'number' && Number.isFinite(options.volume);
    const managerInitialVol = (this.audioManager && typeof this.audioManager.getSoundVolume === 'function')
      ? this.audioManager.getSoundVolume(this.soundId)
      : DEFAULT_AMBIENT_AUDIO_CONFIG.volume;

    this.config = {
      ...DEFAULT_AMBIENT_AUDIO_CONFIG,
      ...options,
      volume: clampVolume(
        hasExplicitVolume ? options.volume : managerInitialVol,
        DEFAULT_AMBIENT_AUDIO_CONFIG.volume
      )
    };

    if (this.audioManager && typeof this.audioManager.setSoundVolume === 'function') {
      if (hasExplicitVolume) {
        this.audioManager.setSoundVolume(this.soundId, this.config.volume);
      }
      if (typeof this.audioManager.onSoundVolumeChange === 'function') {
        this.audioManager.onSoundVolumeChange(this.soundId, (v) => {
          this.config.volume = v;
          if (this.masterGain && this.ctx) {
            const now = this.ctx.currentTime || 0;
            if (typeof this.masterGain.gain?.setTargetAtTime === 'function') {
              this.masterGain.gain.setTargetAtTime(v, now, 0.04);
            } else if (this.masterGain.gain) {
              this.masterGain.gain.value = v;
            }
          }
        });
      }
    }

    this.ctx = options.audioContext || (this.audioManager ? this.audioManager.getContext() : null);
    this.masterGain = null;
    this.loopBuffer = null;
    this._loadPromise = null;

    this.shouldPlay = false;
    this._desiredToken = 0;
    this._activeEntry = null; // { source, gain, stopTimer }
    this._retiredEntries = new Set();
    this._totalCreatedInstances = 0;

    this._unlockHandler = null;
    this._unlockBound = false;
  }

  getVolume() {
    if (this.audioManager && typeof this.audioManager.getSoundVolume === 'function') {
      return this.audioManager.getSoundVolume(this.soundId);
    }
    return this.config.volume;
  }

  setVolume(volume) {
    const next = clampVolume(volume, this.config.volume);
    this.config.volume = next;
    if (this.audioManager && typeof this.audioManager.setSoundVolume === 'function') {
      this.audioManager.setSoundVolume(this.soundId, next);
    }
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime || 0;
      if (typeof this.masterGain.gain?.setTargetAtTime === 'function') {
        this.masterGain.gain.setTargetAtTime(next, now, 0.04);
      } else if (this.masterGain.gain) {
        this.masterGain.gain.value = next;
      }
    }
    return this.config.volume;
  }

  configure(opts = {}) {
    if (typeof opts.url === 'string' && opts.url.trim() && opts.url !== this.config.url) {
      this.config.url = opts.url.trim();
      this.loopBuffer = null;
      this._loadPromise = null;
    }
    if (typeof opts.volume === 'number') {
      this.setVolume(opts.volume);
    }
    if (typeof opts.fadeInSeconds === 'number' && opts.fadeInSeconds >= 0) {
      this.config.fadeInSeconds = opts.fadeInSeconds;
    }
    if (typeof opts.fadeOutSeconds === 'number' && opts.fadeOutSeconds >= 0) {
      this.config.fadeOutSeconds = opts.fadeOutSeconds;
    }
    if (typeof opts.crossfadeSeconds === 'number' && opts.crossfadeSeconds > 0) {
      this.config.crossfadeSeconds = opts.crossfadeSeconds;
    }
    return { ...this.config };
  }

  _ensureContext() {
    if (!this.ctx) {
      if (this.audioManager && typeof this.audioManager.getContext === 'function') {
        this.ctx = this.audioManager.getContext();
      } else {
        const AudioCtx = (typeof window !== 'undefined')
          ? (window.AudioContext || window.webkitAudioContext)
          : (globalThis.AudioContext || globalThis.webkitAudioContext);
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
    }
    if (!this.ctx) return null;
    if (!this.masterGain && typeof this.ctx.createGain === 'function') {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.getVolume();
      const targetNode = (this.audioManager && typeof this.audioManager.getCategoryBus === 'function')
        ? this.audioManager.getCategoryBus(this.category)
        : this.ctx.destination;
      this.masterGain.connect(targetNode);
    }
    return this.ctx;
  }

  async _ensureBuffer() {
    if (this.loopBuffer) return this.loopBuffer;
    if (this._loadPromise) return this._loadPromise;

    const ctx = this._ensureContext();
    if (!ctx) return null;

    this._loadPromise = (async () => {
      try {
        const res = await fetch(this.config.url);
        if (!res || !res.ok) {
          throw new Error(`HTTP ${res ? res.status : 'ERR'} fetching ${this.config.url}`);
        }
        const arrBuf = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrBuf);
        this.loopBuffer = buildSeamlessLoopBuffer(ctx, decoded, this.config.crossfadeSeconds);
        return this.loopBuffer;
      } catch (err) {
        this._loadPromise = null;
        console.warn('[AmbientAudio] Failed to load ambient audio:', err?.message || err);
        return null;
      }
    })();

    return this._loadPromise;
  }

  _bindUnlockListeners() {
    if (this._unlockBound || typeof window === 'undefined') return;
    this._unlockBound = true;
    this._unlockHandler = () => {
      if (!this.shouldPlay) {
        this._unbindUnlockListeners();
        return;
      }
      if (this.ctx && this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
        this.ctx.resume().then(() => {
          if (this.shouldPlay && !this._activeEntry) {
            this.start();
          }
          if (this.ctx && this.ctx.state === 'running') {
            this._unbindUnlockListeners();
          }
        }).catch(() => {});
      } else {
        this._unbindUnlockListeners();
      }
    };
    window.addEventListener('pointerdown', this._unlockHandler, { passive: true });
    window.addEventListener('keydown', this._unlockHandler, { passive: true });
    window.addEventListener('mousedown', this._unlockHandler, { passive: true });
    window.addEventListener('touchstart', this._unlockHandler, { passive: true });
  }

  _unbindUnlockListeners() {
    if (!this._unlockBound || typeof window === 'undefined' || !this._unlockHandler) return;
    window.removeEventListener('pointerdown', this._unlockHandler);
    window.removeEventListener('keydown', this._unlockHandler);
    window.removeEventListener('mousedown', this._unlockHandler);
    window.removeEventListener('touchstart', this._unlockHandler);
    this._unlockBound = false;
    this._unlockHandler = null;
  }

  async start() {
    this.shouldPlay = true;
    const token = ++this._desiredToken;

    const ctx = this._ensureContext();
    if (!ctx) return false;

    if (ctx.state === 'suspended') {
      this._bindUnlockListeners();
      if (typeof ctx.resume === 'function') {
        ctx.resume().catch(() => {});
      }
    }

    // Never spawn a second active source if one is already running
    if (this._activeEntry) {
      return true;
    }

    const buffer = await this._ensureBuffer();
    if (!buffer || !this.shouldPlay || token !== this._desiredToken || this._activeEntry) {
      return false;
    }

    if (ctx.state === 'suspended') {
      this._bindUnlockListeners();
    } else {
      this._unbindUnlockListeners();
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const sourceGain = ctx.createGain();
    const now = ctx.currentTime || 0;
    const fadeIn = Math.max(0.01, this.config.fadeInSeconds);
    if (typeof sourceGain.gain?.setValueAtTime === 'function') {
      sourceGain.gain.setValueAtTime(0.0001, now);
      sourceGain.gain.linearRampToValueAtTime(1.0, now + fadeIn);
    } else if (sourceGain.gain) {
      sourceGain.gain.value = 1.0;
    }

    source.connect(sourceGain);
    sourceGain.connect(this.masterGain || ctx.destination);

    const entry = { source, gain: sourceGain, stopTimer: null };
    this._activeEntry = entry;
    this._totalCreatedInstances++;

    source.onended = () => {
      if (this._activeEntry === entry) {
        this._activeEntry = null;
      }
      this._retiredEntries.delete(entry);
      try { source.disconnect(); } catch {}
      try { sourceGain.disconnect(); } catch {}
    };

    source.start(0);
    return true;
  }

  stop({ immediate = false } = {}) {
    this.shouldPlay = false;
    this._desiredToken++;
    this._unbindUnlockListeners();

    const entry = this._activeEntry;
    if (!entry) return;
    this._activeEntry = null;

    const ctx = this.ctx;
    const fadeOut = immediate ? 0 : Math.max(0, this.config.fadeOutSeconds);
    const cleanupEntry = () => {
      if (entry.stopTimer) {
        clearTimeout(entry.stopTimer);
        entry.stopTimer = null;
      }
      this._retiredEntries.delete(entry);
      try { entry.source.stop(); } catch {}
      try { entry.source.disconnect(); } catch {}
      try { entry.gain.disconnect(); } catch {}
    };

    if (!ctx || fadeOut <= 0 || typeof entry.gain?.gain?.linearRampToValueAtTime !== 'function') {
      cleanupEntry();
      return;
    }

    this._retiredEntries.add(entry);
    const now = ctx.currentTime || 0;
    try {
      entry.gain.gain.cancelScheduledValues?.(now);
      entry.gain.gain.setValueAtTime(entry.gain.gain.value || 1.0, now);
      entry.gain.gain.linearRampToValueAtTime(0.0001, now + fadeOut);
      entry.source.stop(now + fadeOut + 0.02);
    } catch {
      cleanupEntry();
      return;
    }

    entry.stopTimer = setTimeout(cleanupEntry, Math.ceil((fadeOut + 0.05) * 1000));
    if (typeof entry.stopTimer.unref === 'function') {
      entry.stopTimer.unref();
    }
  }

  dispose() {
    this.stop({ immediate: true });
    for (const entry of [...this._retiredEntries]) {
      if (entry.stopTimer) clearTimeout(entry.stopTimer);
      try { entry.source.stop(); } catch {}
      try { entry.source.disconnect(); } catch {}
      try { entry.gain.disconnect(); } catch {}
    }
    this._retiredEntries.clear();
    if (this.masterGain) {
      try { this.masterGain.disconnect(); } catch {}
      this.masterGain = null;
    }
  }

  getStatus() {
    return {
      shouldPlay: this.shouldPlay,
      isPlaying: Boolean(this._activeEntry),
      activeInstanceCount: this._activeEntry ? 1 : 0,
      retiredCount: this._retiredEntries.size,
      totalCreatedInstances: this._totalCreatedInstances,
      volume: this.getVolume(),
      contextState: this.ctx ? this.ctx.state : 'uninitialized',
      bufferLoaded: Boolean(this.loopBuffer),
      loopDurationSeconds: this.loopBuffer ? +(this.loopBuffer.duration || 0).toFixed(4) : 0,
      url: this.config.url
    };
  }
}
