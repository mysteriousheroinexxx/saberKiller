/**
 * Saber Killer — Survival Mode Sanity Controller
 *
 * Dedicated logical controller for player sanity in Survival Mode.
 * Compatible with both solo and cooperative multiplayer sessions.
 *
 * Source reference: Budget-Backrooms (UE4.27) P_Player.uasset & BPFL_OtherBP.uasset
 * - Baseline passive decay: 0.00035 per 0.01s (0.035 / sec)
 * - Visual effects threshold (Mild Paranoia): <= 80.0
 * - Panic threshold: <= 10.0
 * - Critical threshold (Depleted): 0.0
 * - Rapid consumable recovery (Almond Water): +0.5 per 0.01s (50.0 / sec)
 */

export const SANITY_STATE = Object.freeze({
  NORMAL: 'NORMAL',               // Sanity > 80.0
  MILD_PARANOIA: 'MILD_PARANOIA', // Sanity <= 80.0 && > 10.0
  PANIC: 'PANIC',                 // Sanity <= 10.0 && > 0.0
  DEPLETED: 'DEPLETED'            // Sanity === 0.0
});

export const SANITY_EVENTS = Object.freeze({
  CHANGED: 'SANITY_CHANGED',
  THRESHOLD_CHANGED: 'SANITY_THRESHOLD_CHANGED',
  PAUSED: 'SANITY_PAUSED',
  RESUMED: 'SANITY_RESUMED',
  RESTORED: 'SANITY_RESTORED',
  DRAINED: 'SANITY_DRAINED',
  DEPLETED: 'SANITY_DEPLETED'
});

export const DEFAULT_SANITY_CONFIG = Object.freeze({
  initialSanity: 100.0,
  maxSanity: 100.0,
  minSanity: 0.0,
  // 0.00035 per 0.01s in Budget-Backrooms P_Player.uasset = 0.035 per second (~47.6 minutes from 100 to 0)
  passiveDrainPerSecond: 0.035,
  // Hardcore mode triples baseline drain in Budget-Backrooms (0.105 / sec)
  hardcorePassiveDrainPerSecond: 0.105,
  // Active enemy chase/encounter drain in Budget-Backrooms Howler.uasset:
  // 0.0025 per 0.01s = 0.25 per second (~7.14x normal passive drain)
  chaseDrainPerSecond: 0.25,
  // Hardcore active chase drain in Budget-Backrooms Howler.uasset (0.0075 per 0.01s = 0.75 / sec)
  hardcoreChaseDrainPerSecond: 0.75,
  // Pessi_Almond.uasset pauses sanity drain for 4.0 seconds upon consumption
  almondPauseDurationSeconds: 4.0,
  visualFxThreshold: 80.0,
  panicThreshold: 10.0,
  depletedThreshold: 0.0,
  // Almond Water rapid regeneration (+0.5 per 0.01s = 50.0 / sec)
  rapidRegenRatePerSecond: 50.0
});

export class SanityController {
  /**
   * @param {Partial<typeof DEFAULT_SANITY_CONFIG>} [options]
   */
  constructor(options = {}) {
    this.config = { ...DEFAULT_SANITY_CONFIG, ...options };

    this.currentSanity = this.config.initialSanity;
    this.maxSanity = this.config.maxSanity;
    this.minSanity = this.config.minSanity;

    this.isPaused = false;
    this.isRegenerating = false;
    this.isDepleted = false;
    this.isChased = false;
    this.hasServerSync = false;

    this.state = this._calculateState(this.currentSanity);

    /** @type {((event: { state: string, previousState: string, currentSanity: number }) => void) | null} */
    this.onSanityDepleted = null;

    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  // --- Event Emitter ---

  /**
   * Subscribe to a sanity lifecycle event.
   * @param {string} event
   * @param {Function} handler
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Unsubscribe from a sanity lifecycle event.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Dispatch an event to all subscribers.
   * @param {string} event
   * @param {any} [payload]
   */
  emit(event, payload) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[SANITY] Error in event listener for ${event}:`, err);
        }
      }
    }
  }

  // --- Public Control API ---

  /**
   * Pauses passive sanity decay (e.g., during safe zones, dialogues).
   */
  pauseSanity() {
    if (!this.isPaused) {
      this.isPaused = true;
      this.emit(SANITY_EVENTS.PAUSED, { currentSanity: this.currentSanity });
    }
  }

  /**
   * Resumes passive sanity decay.
   */
  resumeSanity() {
    if (this.isPaused) {
      this.isPaused = false;
      this.emit(SANITY_EVENTS.RESUMED, { currentSanity: this.currentSanity });
    }
  }

  /**
   * Toggles pause state.
   */
  togglePause() {
    if (this.isPaused) {
      this.resumeSanity();
    } else {
      this.pauseSanity();
    }
  }

  /**
   * Triggers rapid continuous recovery (equivalent to Budget-Backrooms RegenSanity mode from Almond Water).
   */
  startRapidRegen() {
    this.isPaused = false;
    this.isRegenerating = true;
  }

  /**
   * Stops rapid continuous recovery.
   */
  stopRapidRegen() {
    this.isRegenerating = false;
  }

  /**
   * Restores a discrete amount of sanity (clamped to maxSanity).
   * @param {number} amount
   */
  restoreSanity(amount) {
    if (amount <= 0) return;
    const prev = this.currentSanity;
    this.currentSanity = Math.min(this.maxSanity, this.currentSanity + amount);
    const restored = this.currentSanity - prev;

    if (this.currentSanity > this.config.depletedThreshold) {
      this.isDepleted = false;
    }

    this._evaluateState(prev);

    this.emit(SANITY_EVENTS.RESTORED, {
      amountRestored: restored,
      currentSanity: this.currentSanity,
      maxSanity: this.maxSanity
    });

    this.emit(SANITY_EVENTS.CHANGED, this.getSnapshot());
  }

  /**
   * Drains a discrete amount of sanity from an external source (e.g. enemy gaze, environmental trauma).
   * @param {number} amount
   * @param {string} [source='generic']
   */
  drainSanity(amount, source = 'generic') {
    if (amount <= 0) return;
    const prev = this.currentSanity;
    this.currentSanity = Math.max(this.minSanity, this.currentSanity - amount);
    const drained = prev - this.currentSanity;

    this._evaluateState(prev);

    this.emit(SANITY_EVENTS.DRAINED, {
      amountDrained: drained,
      source,
      currentSanity: this.currentSanity,
      maxSanity: this.maxSanity
    });

    this.emit(SANITY_EVENTS.CHANGED, this.getSnapshot());
  }

  /**
   * Directly sets the current sanity value (clamped strictly between 0 and maxSanity).
   * @param {number} value
   */
  setSanity(value) {
    const prev = this.currentSanity;
    this.currentSanity = Math.max(this.minSanity, Math.min(this.maxSanity, value));

    if (this.currentSanity > this.config.depletedThreshold) {
      this.isDepleted = false;
    }

    this._evaluateState(prev);
    this.emit(SANITY_EVENTS.CHANGED, this.getSnapshot());
  }

  /**
   * Marks whether this player is currently actively chased by a Saber.
   * @param {boolean} chased
   */
  setChased(chased) {
    const next = Boolean(chased);
    if (this.isChased !== next) {
      this.isChased = next;
      this.emit(SANITY_EVENTS.CHANGED, this.getSnapshot());
    }
  }

  /**
   * Applies an authoritative sanity update snapshot from the server.
   * @param {Object} payload
   */
  applyServerState(payload) {
    if (!payload || typeof payload !== 'object') return;
    this.hasServerSync = true;
    const prev = this.currentSanity;
    if (typeof payload.maxSanity === 'number' && Number.isFinite(payload.maxSanity) && payload.maxSanity > 0) {
      this.maxSanity = payload.maxSanity;
    }
    if (typeof payload.isPaused === 'boolean') {
      this.isPaused = payload.isPaused;
    }
    if (typeof payload.isChased === 'boolean') {
      this.isChased = payload.isChased;
    }
    if (typeof payload.sanity === 'number' && Number.isFinite(payload.sanity)) {
      this.currentSanity = Math.max(this.minSanity, Math.min(this.maxSanity, payload.sanity));
    }
    if (this.currentSanity > this.config.depletedThreshold) {
      this.isDepleted = false;
    }
    this._evaluateState(prev);
    this.emit(SANITY_EVENTS.CHANGED, this.getSnapshot());
  }

  /**
   * Resets sanity to maximum baseline.
   */
  reset() {
    this.isPaused = false;
    this.isRegenerating = false;
    this.isDepleted = false;
    this.isChased = false;
    this.hasServerSync = false;
    this.setSanity(this.config.initialSanity);
  }

  // --- Frame-Rate Independent Simulation Update ---

  /**
   * Advances sanity simulation by delta time (in seconds).
   * @param {number} dt Delta time in seconds
   */
  update(dt) {
    if (dt <= 0) return;

    const prev = this.currentSanity;

    if (this.isRegenerating) {
      // Rapid consumable recovery (Almond Water)
      const regenStep = this.config.rapidRegenRatePerSecond * dt;
      this.currentSanity = Math.min(this.maxSanity, this.currentSanity + regenStep);
      if (this.currentSanity >= this.maxSanity) {
        this.currentSanity = this.maxSanity;
        this.isRegenerating = false;
      }
    } else if (!this.isPaused) {
      // Passive atmospheric decay or elevated active-chase drain
      const rate = this.isChased
        ? this.config.chaseDrainPerSecond
        : this.config.passiveDrainPerSecond;
      const drainStep = rate * dt;
      this.currentSanity = Math.max(this.minSanity, this.currentSanity - drainStep);
    }

    this._evaluateState(prev);

    if (this.currentSanity !== prev) {
      this.emit(SANITY_EVENTS.CHANGED, this.getSnapshot());
    }
  }

  // --- State Evaluation & Thresholds ---

  /**
   * Calculates the discrete state for a given sanity value.
   * @private
   * @param {number} sanity
   * @returns {string}
   */
  _calculateState(sanity) {
    if (sanity <= this.config.depletedThreshold) {
      return SANITY_STATE.DEPLETED;
    }
    if (sanity <= this.config.panicThreshold) {
      return SANITY_STATE.PANIC;
    }
    if (sanity <= this.config.visualFxThreshold) {
      return SANITY_STATE.MILD_PARANOIA;
    }
    return SANITY_STATE.NORMAL;
  }

  /**
   * Evaluates state changes and triggers depletion events.
   * @private
   * @param {number} previousSanity
   */
  _evaluateState(previousSanity) {
    const newState = this._calculateState(this.currentSanity);
    const prevState = this.state;

    if (newState !== prevState) {
      this.state = newState;
      this.emit(SANITY_EVENTS.THRESHOLD_CHANGED, {
        state: newState,
        previousState: prevState,
        currentSanity: this.currentSanity,
        maxSanity: this.maxSanity
      });
    }

    // Critical depletion trigger (fires exactly once upon reaching zero)
    if (this.currentSanity <= this.config.depletedThreshold && !this.isDepleted) {
      this.isDepleted = true;
      const payload = {
        state: SANITY_STATE.DEPLETED,
        previousState: prevState,
        currentSanity: 0.0
      };

      if (typeof this.onSanityDepleted === 'function') {
        try {
          this.onSanityDepleted(payload);
        } catch (err) {
          console.error('[SANITY] Error in onSanityDepleted hook:', err);
        }
      }

      this.emit(SANITY_EVENTS.DEPLETED, payload);
    }
  }

  /**
   * Returns a clean, immutable state snapshot.
   */
  getSnapshot() {
    return {
      currentSanity: this.currentSanity,
      maxSanity: this.maxSanity,
      percentage: (this.currentSanity / this.maxSanity) * 100,
      state: this.state,
      isPaused: this.isPaused,
      isRegenerating: this.isRegenerating,
      isDepleted: this.isDepleted,
      isChased: this.isChased
    };
  }
}
