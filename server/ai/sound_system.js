import * as YUKA from '../../yuka/build/yuka.module.js';

/**
 * SoundStimulus represents an auditory event in the environment.
 */
export class SoundStimulus {
  /**
   * @param {Object} options
   * @param {string} options.id - Unique ID of the sound event.
   * @param {YUKA.Vector3} options.worldPosition - World coordinates where the sound originated.
   * @param {string} options.soundType - Sound type: 'GUNSHOT' | 'FOOTSTEP' | 'IMPACT' | 'ALARM'.
   * @param {number} options.loudness - Relative amplitude (0.0 to 1.0+).
   * @param {number} options.detectionRadius - Maximum audible distance in meters.
   * @param {number} options.timestamp - Simulation timestamp when sound occurred.
   * @param {number} options.lifetime - Expiration lifetime in seconds (decay duration).
   * @param {string} [options.sourceEntityId] - Optional source entity identifier.
   */
  constructor({
    id = 'sound_' + Math.random().toString(36).substring(2, 9),
    worldPosition = new YUKA.Vector3(),
    soundType = 'GUNSHOT',
    loudness = 1.0,
    detectionRadius = 35.0,
    timestamp = 0,
    lifetime = 3.0,
    sourceEntityId = null
  }) {
    this.id = id;
    this.worldPosition = new YUKA.Vector3().copy(worldPosition);
    this.soundType = soundType;
    this.loudness = loudness;
    this.detectionRadius = detectionRadius;
    this.timestamp = timestamp;
    this.lifetime = lifetime;
    this.sourceEntityId = sourceEntityId;
    this.isExpired = false;
  }

  /**
   * Evaluates if this sound is audible at a given listener position.
   * Takes into account distance and optional occlusion attenuation factor.
   *
   * @param {YUKA.Vector3} listenerPosition
   * @param {number} [occlusionFactor=1.0] - 1.0 = direct air line of sight, 0.6 = muffled through wall.
   * @returns {{ audible: boolean, distance: number, effectiveRadius: number, perceivedPosition: YUKA.Vector3 }}
   */
  evaluateAudibility(listenerPosition, occlusionFactor = 1.0) {
    const distance = this.worldPosition.distanceTo(listenerPosition);
    const effectiveRadius = this.detectionRadius * Math.max(0.2, occlusionFactor);
    const audible = distance <= effectiveRadius && !this.isExpired;

    // A sound stimulus does NOT yield the shooter's exact coordinates.
    // We add an auditory localization fuzz / uncertainty inversely proportional to proximity.
    // The closer the listener, the more accurate the perceived origin.
    const fuzzRadius = Math.min(2.5, Math.max(0.4, (distance / effectiveRadius) * 2.5));
    const angle = Math.random() * Math.PI * 2;
    const minFuzz = 0.15;
    const offsetMag = minFuzz + Math.random() * Math.max(0.1, fuzzRadius - minFuzz);
    const perceivedPosition = new YUKA.Vector3(
      this.worldPosition.x + Math.cos(angle) * offsetMag,
      this.worldPosition.y,
      this.worldPosition.z + Math.sin(angle) * offsetMag
    );

    return {
      audible,
      distance,
      effectiveRadius,
      perceivedPosition
    };
  }
}

/**
 * SoundStimulusSystem manages active sound events, decay/expiration, and spatial querying.
 */
export class SoundStimulusSystem {
  constructor() {
    /** @type {Array<SoundStimulus>} */
    this.activeStimuli = [];
    /** @type {Array<Function>} */
    this.listeners = [];
    this.history = [];
    this.maxHistory = 50;
  }

  /**
   * Emits a new sound stimulus into the environment.
   * @param {SoundStimulus|Object} stimulusData
   * @returns {SoundStimulus}
   */
  emit(stimulusData) {
    const stimulus = stimulusData instanceof SoundStimulus
      ? stimulusData
      : new SoundStimulus(stimulusData);

    this.activeStimuli.push(stimulus);
    this.history.unshift({
      id: stimulus.id,
      soundType: stimulus.soundType,
      worldPosition: { x: stimulus.worldPosition.x, y: stimulus.worldPosition.y, z: stimulus.worldPosition.z },
      detectionRadius: stimulus.detectionRadius,
      loudness: stimulus.loudness,
      timestamp: stimulus.timestamp
    });
    if (this.history.length > this.maxHistory) this.history.pop();

    // Notify registered sensor callbacks immediately
    for (const listener of this.listeners) {
      try {
        listener(stimulus);
      } catch (e) {
        console.error('[SoundStimulusSystem] Listener error:', e);
      }
    }

    return stimulus;
  }

  /**
   * Registers a callback for real-time sound event broadcast.
   * @param {Function} callback - Function(stimulus)
   */
  registerListener(callback) {
    this.listeners.push(callback);
  }

  /**
   * Unregisters a callback.
   * @param {Function} callback
   */
  unregisterListener(callback) {
    const idx = this.listeners.indexOf(callback);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }

  /**
   * Updates stimuli decay and purges expired events.
   * @param {number} currentTime
   */
  update(currentTime) {
    for (let i = this.activeStimuli.length - 1; i >= 0; i--) {
      const stimulus = this.activeStimuli[i];
      if (currentTime - stimulus.timestamp >= stimulus.lifetime) {
        stimulus.isExpired = true;
        this.activeStimuli.splice(i, 1);
      }
    }
  }

  /**
   * Queries active stimuli audible from a specific position.
   * @param {YUKA.Vector3} listenerPosition
   * @param {Function} [occlusionChecker] - Optional fn(from, to) returning occlusion factor (0.0 to 1.0).
   * @returns {Array<{ stimulus: SoundStimulus, distance: number, perceivedPosition: YUKA.Vector3 }>}
   */
  queryAudible(listenerPosition, occlusionChecker = null) {
    const results = [];
    for (const stimulus of this.activeStimuli) {
      if (stimulus.isExpired) continue;
      const occlusion = occlusionChecker
        ? occlusionChecker(stimulus.worldPosition, listenerPosition)
        : 1.0;

      const evalResult = stimulus.evaluateAudibility(listenerPosition, occlusion);
      if (evalResult.audible) {
        results.push({
          stimulus,
          distance: evalResult.distance,
          effectiveRadius: evalResult.effectiveRadius,
          perceivedPosition: evalResult.perceivedPosition
        });
      }
    }
    // Sort by proximity (loudest/closest sound first)
    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  clear() {
    this.activeStimuli.length = 0;
  }
}
