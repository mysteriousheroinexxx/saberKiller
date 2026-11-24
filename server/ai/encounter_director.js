import * as YUKA from '../../yuka/build/yuka.module.js';

export const DIRECTOR_PHASES = {
  RELEASE: 'RELEASE',
  BUILD_UP: 'BUILD_UP',
  MENACE: 'MENACE',
  CLIMAX: 'CLIMAX'
};

export const LEVEL0_SECTORS = {
  WEST_ROOM: {
    id: 'WEST_ROOM',
    name: 'West Gallery (Room 1)',
    bounds: { minX: -26, maxX: -6, minZ: -22, maxZ: -2 },
    center: new YUKA.Vector3(-16, 0, -12),
    gateway: new YUKA.Vector3(-10, 0, -10)
  },
  EAST_ROOM: {
    id: 'EAST_ROOM',
    name: 'East Office (Room 2)',
    bounds: { minX: 6, maxX: 26, minZ: -22, maxZ: -2 },
    center: new YUKA.Vector3(16, 0, -12),
    gateway: new YUKA.Vector3(10, 0, -10)
  },
  JUNCTION: {
    id: 'JUNCTION',
    name: 'Central Corridor Junction',
    bounds: { minX: -6, maxX: 6, minZ: -22, maxZ: 2 },
    center: new YUKA.Vector3(0, 0, -10),
    gateway: new YUKA.Vector3(0, 0, -6)
  },
  SOUTH_HALL: {
    id: 'SOUTH_HALL',
    name: 'South Hall (Room 3)',
    bounds: { minX: -26, maxX: 26, minZ: 2, maxZ: 24 },
    center: new YUKA.Vector3(0, 0, 12),
    gateway: new YUKA.Vector3(0, 0, 4)
  }
};

/**
 * EncounterDirector orchestrates macro encounter pacing for Level 0
 * inspired by the Alien: Isolation two-tier architecture.
 *
 * Tier 1 (Macro): Tracks tension, pacing, player activity, and selects high-level sector objectives.
 * Tier 2 (Micro): Autonomous Saber agents with independent vision, hearing, memory, and navigation.
 *
 * Invariants:
 * - Director never forces an attack or overrides local micro-combat.
 * - Director never transmits continuously updated exact player coordinates to agents.
 * - Director NEVER suppresses genuine auditory or visual responses.
 */

export const LEVEL0_PRODUCTION_SECTORS = {
  SPAWN_WING: {
    id: 'SPAWN_WING',
    name: 'Spawn Wing (West Hall)',
    bounds: { minX: 10, maxX: 80, minZ: -220, maxZ: -150 },
    center: new YUKA.Vector3(48, 0, -185),
    gateway: new YUKA.Vector3(45, 0, -175)
  },
  NORTH_HALL: {
    id: 'NORTH_HALL',
    name: 'North Corridor',
    bounds: { minX: -10, maxX: 120, minZ: -150, maxZ: -30 },
    center: new YUKA.Vector3(50, 0, -90),
    gateway: new YUKA.Vector3(50, 0, -90)
  },
  CENTRAL_ZONE: {
    id: 'CENTRAL_ZONE',
    name: 'Central Gallery',
    bounds: { minX: -10, maxX: 150, minZ: -30, maxZ: 90 },
    center: new YUKA.Vector3(60, 0, 30),
    gateway: new YUKA.Vector3(60, 0, 30)
  },
  EXIT_CORRIDOR: {
    id: 'EXIT_CORRIDOR',
    name: 'Exit Corridor',
    bounds: { minX: 30, maxX: 150, minZ: 90, maxZ: 250 },
    center: new YUKA.Vector3(79.55, 0, 180),
    gateway: new YUKA.Vector3(79.55, 0, 207)
  }
};

export class EncounterDirector {
  constructor(options = {}) {
    this.phase = DIRECTOR_PHASES.BUILD_UP;
    this.threatIntensity = 10.0; // 0.0 to 100.0 scale
    this.phaseTimer = 0;
    this.isPaused = false;

    // Configurable Pacing Parameters (scaled to Level 0 macro map dimensions ~270x640m)
    this.buildUpDuration = options.buildUpDuration ?? 30.0; // Scaled tension accumulation
    this.menaceDuration = options.menaceDuration ?? 45.0;   // Sustained macro pressure window
    this.releaseDuration = options.releaseDuration ?? 15.0; // Cooldown relief window
    this.phaseTransitionReason = 'Initial BUILD_UP phase';

    // Macro Tracking
    this.activeMenace = null; // Reference to Saber Alpha or Saber Beta
    this.currentSector = null;
    this.hintTargetSector = null;
    this.lastHintTime = -999;
    this.hintInterval = options.hintInterval ?? 6.0;

    // Decision & Explainability Log
    this.recentDecisions = [];
    this.maxDecisions = 30;

    this.logDecision('DIRECTOR_INIT', 'Encounter Director initialized in BUILD_UP phase (scaled to Level 0)');
  }

  logDecision(action, reason) {
    const entry = {
      timestamp: Date.now(),
      phase: this.phase,
      threatIntensity: Math.round(this.threatIntensity),
      action,
      reason
    };
    this.recentDecisions.unshift(entry);
    if (this.recentDecisions.length > this.maxDecisions) {
      this.recentDecisions.pop();
    }
  }

  /**
   * Identifies which sector the player is currently in.
   * @param {YUKA.Vector3} playerPos
   * @returns {typeof LEVEL0_SECTORS.JUNCTION}
   */
  getSectorForPosition(playerPos) {
    for (const sector of Object.values(LEVEL0_SECTORS)) {
      if (playerPos.x >= sector.bounds.minX && playerPos.x <= sector.bounds.maxX &&
          playerPos.z >= sector.bounds.minZ && playerPos.z <= sector.bounds.maxZ) {
        return sector;
      }
    }
    for (const sector of Object.values(LEVEL0_PRODUCTION_SECTORS)) {
      if (playerPos.x >= sector.bounds.minX && playerPos.x <= sector.bounds.maxX &&
          playerPos.z >= sector.bounds.minZ && playerPos.z <= sector.bounds.maxZ) {
        return sector;
      }
    }
    return LEVEL0_SECTORS.JUNCTION;
  }

  /**
   * Main simulation step for the Encounter Director.
   * @param {number} delta - Delta time in seconds
   * @param {import('./simulation.js').SaberSimulation} sim
   */
  update(delta, sim) {
    if (this.isPaused) return;

    this.phaseTimer += delta;
    const activePlayers = (sim.players || [sim.player]).filter(p => !p.isDead);
    const focusPlayer = activePlayers.length > 0 ? activePlayers[0] : sim.player;
    this.currentSector = this.getSectorForPosition(focusPlayer.position);

    const alphaState = sim.saberAlpha?.getCurrentStateName() || 'PATROL';
    const betaState = sim.saberBeta?.getCurrentStateName() || 'PATROL';

    const isAnySaberInCombat = (
      alphaState === 'CHASE' || alphaState === 'ATTACK' ||
      betaState === 'CHASE' || betaState === 'ATTACK'
    );

    const isAnySaberStalkingOrInvestigating = (
      alphaState === 'STALK' || alphaState === 'INVESTIGATE_SOUND' || alphaState === 'SEARCH' ||
      betaState === 'STALK' || betaState === 'INVESTIGATE_SOUND' || betaState === 'SEARCH'
    );

    const isAnySaberNavigatingHint = Boolean(
      (sim.saberAlpha?.hasDirectorHint && sim.saberAlpha.currentNavPath?.length > 0) ||
      (sim.saberBeta?.hasDirectorHint && sim.saberBeta.currentNavPath?.length > 0)
    );

    // Measure proximity to nearest Saber from all active survivors
    let closestDist = Infinity;
    for (const p of activePlayers) {
      if (sim.saberAlpha) closestDist = Math.min(closestDist, sim.saberAlpha.position.distanceTo(p.position));
      if (sim.saberBeta) closestDist = Math.min(closestDist, sim.saberBeta.position.distanceTo(p.position));
    }
    if (closestDist === Infinity) closestDist = 100.0;

    // 1. Calculate dynamic threat intensity
    this.evaluateThreat(delta, sim, isAnySaberInCombat);

    // 2. State Machine Transitions based on Pacing, Proximity & Tension
    if (isAnySaberInCombat) {
      if (this.phase !== DIRECTOR_PHASES.CLIMAX) {
        this.transitionTo(DIRECTOR_PHASES.CLIMAX, 'Saber acquired player visual lock or entered combat');
      }
    } else {
      // Not in active direct combat
      if (this.phase === DIRECTOR_PHASES.CLIMAX) {
        // Line-of-sight broken: check if Sabers are still actively stalking or searching
        if (isAnySaberStalkingOrInvestigating || isAnySaberNavigatingHint) {
          this.transitionTo(DIRECTOR_PHASES.MENACE, 'Combat LoS lost, actively searching/stalking', sim);
        } else {
          this.transitionTo(DIRECTOR_PHASES.RELEASE, 'Combat concluded and area sweep completed; granting relief pacing');
        }
      } else if (this.phase === DIRECTOR_PHASES.RELEASE) {
        // Pacing Cooldown before rebuilding tension
        if (this.phaseTimer >= this.releaseDuration) {
          this.transitionTo(DIRECTOR_PHASES.BUILD_UP, 'Relief cooldown completed. Rebuilding tension.');
        }
      } else if (this.phase === DIRECTOR_PHASES.BUILD_UP) {
        // Tension accumulation: scale with map travel times
        if (this.threatIntensity >= 45.0 || this.phaseTimer >= this.buildUpDuration) {
          this.transitionTo(DIRECTOR_PHASES.MENACE, 'Tension threshold reached. Menace phase initiated.', sim);
          this.considerMacroHint(sim);
        } else if (this.phaseTimer >= 10.0) {
          // Provide early ambient hint so Sabers begin traversing towards survivors across Level 0
          this.considerMacroHint(sim);
        }
      } else if (this.phase === DIRECTOR_PHASES.MENACE) {
        // Active menace pressure
        if (this.phaseTimer >= this.menaceDuration) {
          // Do NOT prematurely release pressure if Sabers are actively tracking, investigating, or near survivors
          if (isAnySaberStalkingOrInvestigating || isAnySaberNavigatingHint || closestDist < 25.0) {
            this.phaseTimer = Math.max(0, this.menaceDuration - 15.0);
            this.phaseTransitionReason = `Sustaining MENACE: Sabers actively tracking/investigating (closest ${closestDist.toFixed(1)}m)`;
            this.logDecision('MENACE_EXTENDED', `Pressure sustained: Sabers actively tracking/investigating (closest ${closestDist.toFixed(1)}m)`);
            this.considerMacroHint(sim);
          } else {
            // Truly disengaged and far away -> relief pacing
            this.transitionTo(DIRECTOR_PHASES.RELEASE, 'Menace phase expired without player contact. Granting relief pacing.');
          }
        } else {
          // In MENACE phase, issue periodic macro hints to both Sabers
          this.considerMacroHint(sim);
        }
      }
    }
  }

  evaluateThreat(delta, sim, isAnySaberInCombat) {
    if (isAnySaberInCombat) {
      this.threatIntensity = Math.min(100.0, this.threatIntensity + delta * 25.0);
      return;
    }

    if (this.phase === DIRECTOR_PHASES.RELEASE) {
      // Pacing relief: threat decays toward 10%
      this.threatIntensity = Math.max(10.0, this.threatIntensity - delta * 6.0);
      return;
    }

    // Measure proximity to nearest Saber from all active survivors
    const activeSurvivors = (sim.players || [sim.player]).filter(p => !p.isDead);
    let closestDist = Infinity;
    let anySprinting = false;

    for (const p of activeSurvivors) {
      if (p.isSprinting) anySprinting = true;
      const distAlpha = sim.saberAlpha.position.distanceTo(p.position);
      const distBeta = sim.saberBeta.position.distanceTo(p.position);
      closestDist = Math.min(closestDist, distAlpha, distBeta);
    }
    if (closestDist === Infinity) closestDist = 20.0;

    let threatDelta = 0;
    if (closestDist < 12.0) {
      threatDelta += (12.0 - closestDist) * 1.5; // High proximity tension
    }

    // Survivor running or sprinting adds tension
    if (anySprinting) {
      threatDelta += 4.0;
    }

    // Baseline build-up rate
    threatDelta += 2.0;

    this.threatIntensity = Math.min(85.0, Math.max(10.0, this.threatIntensity + threatDelta * delta));
  }

  transitionTo(newPhase, reason, sim = null) {
    const oldPhase = this.phase;
    this.phase = newPhase;
    this.phaseTimer = 0;
    this.phaseTransitionReason = reason;
    if (newPhase === DIRECTOR_PHASES.MENACE && sim) {
      const distAlpha = sim.saberAlpha.position.distanceTo(sim.player.position);
      const distBeta = sim.saberBeta.position.distanceTo(sim.player.position);
      this.activeMenace = distAlpha <= distBeta ? sim.saberAlpha : sim.saberBeta;
    } else if (newPhase === DIRECTOR_PHASES.RELEASE) {
      this.activeMenace = null;
    }
    this.logDecision(`PHASE_CHANGE: ${oldPhase} -> ${newPhase}`, reason);
  }

  /**
   * Generates independent approximate intuition hints for each Saber.
   * For each Saber:
   * 1. Identify closest eligible player.
   * 2. Generate randomized 5-10m positional offset.
   * 3. Provide approximate location as an investigative hint.
   * Never transmits exact player coordinates to agents or client telemetry.
   */
  considerMacroHint(sim) {
    if (!sim) return;
    if ((sim.elapsedTime - this.lastHintTime) < this.hintInterval) {
      return;
    }
    this.lastHintTime = sim.elapsedTime;

    const sabers = [sim.saberAlpha, sim.saberBeta].filter(Boolean);
    const activeSurvivors = (sim.players || [sim.player]).filter(p => p && !p.isDead);
    if (activeSurvivors.length === 0) return;

    for (const saber of sabers) {
      // 1. Identify closest eligible player for this specific Saber
      let closestPlayer = null;
      let minDistance = Infinity;
      for (const player of activeSurvivors) {
        const dist = saber.position.distanceTo(player.position);
        if (dist < minDistance) {
          minDistance = dist;
          closestPlayer = player;
        }
      }

      if (!closestPlayer) continue;

      // 2. Generate randomized 5-10m positional offset
      const offsetRadius = 5.0 + Math.random() * 5.0; // 5.0 to 10.0m
      const offsetAngle = Math.random() * Math.PI * 2;
      const offsetX = Math.cos(offsetAngle) * offsetRadius;
      const offsetZ = Math.sin(offsetAngle) * offsetRadius;

      // 3. Approximate location
      const approximatePos = new YUKA.Vector3(
        closestPlayer.position.x + offsetX,
        0,
        closestPlayer.position.z + offsetZ
      );

      const estimatedPlayerPos = new YUKA.Vector3(
        closestPlayer.position.x,
        0,
        closestPlayer.position.z
      );

      // 4. Dispatch approximate intuition hint to Saber with estimated target metadata
      if (typeof saber.onReceiveIntuitionHint === 'function') {
        saber.onReceiveIntuitionHint(approximatePos, offsetRadius, estimatedPlayerPos, closestPlayer.name || closestPlayer.id);
      } else if (typeof saber.onReceiveDirectorHint === 'function') {
        saber.onReceiveDirectorHint(approximatePos, `Intuition (${offsetRadius.toFixed(1)}m offset)`);
      }

      this.logDecision(
        `INTUITION_HINT -> ${saber.name}`,
        `Provided approximate hint for ${closestPlayer.name || closestPlayer.id} with ${offsetRadius.toFixed(1)}m offset`
      );
    }

    if (sabers.length > 0) {
      this.activeMenace = sabers[0];
    }
  }

  forcePhase(newPhase, reason = 'Developer override', sim = null) {
    if (DIRECTOR_PHASES[newPhase]) {
      this.transitionTo(newPhase, reason, sim);
    }
  }

  pause() {
    this.isPaused = true;
    this.logDecision('DIRECTOR_PAUSE', 'Director paused by user');
  }

  resume() {
    this.isPaused = false;
    this.logDecision('DIRECTOR_RESUME', 'Director resumed by user');
  }

  reset() {
    this.phase = DIRECTOR_PHASES.BUILD_UP;
    this.threatIntensity = 10.0;
    this.phaseTimer = 0;
    this.phaseTransitionReason = 'Reset to BUILD_UP';
    this.isPaused = false;
    this.activeMenace = null;
    this.currentSector = null;
    this.hintTargetSector = null;
    this.lastHintTime = -999;
    this.recentDecisions = [];
    this.logDecision('DIRECTOR_RESET', 'Director reset to initial state');
  }

  getTelemetry() {
    return {
      phase: this.phase,
      threatIntensity: this.threatIntensity,
      phaseTimer: this.phaseTimer,
      phaseElapsed: this.phaseTimer,
      phaseDuration: this.phase === DIRECTOR_PHASES.BUILD_UP ? this.buildUpDuration : (this.phase === DIRECTOR_PHASES.MENACE ? this.menaceDuration : this.releaseDuration),
      phaseTransitionReason: this.phaseTransitionReason || 'Initial BUILD_UP phase',
      isPaused: this.isPaused,
      activeMenace: this.activeMenace ? this.activeMenace.name : 'None (Independent)',
      currentSector: this.currentSector ? this.currentSector.name : 'Unknown',
      hintTargetSector: this.hintTargetSector ? this.hintTargetSector.name : 'None',
      latestDecision: this.recentDecisions[0] || null,
      recentDecisions: this.recentDecisions.slice(0, 10)
    };
  }
}
