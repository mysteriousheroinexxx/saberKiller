import * as YUKA from '../../yuka/build/yuka.module.js';
import { SoundStimulusSystem, SoundStimulus } from './sound_system.js';
import { Level0PrototypeMap } from './environment.js';
import { SaberAgent, SABER_STATES } from './saber_agent.js';
import { EncounterDirector, DIRECTOR_PHASES, LEVEL0_SECTORS } from './encounter_director.js';

/**
 * PlayerEntity represents the human survivor in the Level 0 test environment.
 * Features:
 * - 100 HP health pool (4 hits of 25 damage eliminate)
 * - Permanent health elimination (no revival)
 * - Separate Sanity system (sanity collapse, recoverable)
 * - 2.0s player stagger upon being hit
 * - 1 fixed simulation tick escape opportunity after stagger ends
 * - 30 round hard ammunition budget (starting ammo counts toward room limit)
 * - Automatic movement-based footstep generation (cadence & loudness scale with speed)
 * - Grounded-only footstep emission (airborne or stationary player emits zero footsteps)
 */
export class PlayerEntity extends YUKA.GameEntity {
  constructor(name = 'Survivor', startPos = new YUKA.Vector3(0, 0, -8), options = {}) {
    super();
    this.name = name;
    this.id = options.id || name.toLowerCase().replace(/\s+/g, '_');
    this.position.copy(startPos);

    // Health System (100 max)
    this.health = options.health ?? 100;
    this.maxHealth = options.maxHealth ?? 100;
    this.isDead = false; // Permanent elimination on health 0
    this.collisionRadius = options.collisionRadius ?? 0.32;
    this.boundingRadius = this.collisionRadius;

    // Sanity System (Separate failure condition: collapses at 0, recoverable by teammate)
    this.sanity = options.sanity ?? 100;
    this.maxSanity = options.maxSanity ?? 100;
    this.isSanityCollapsed = false; // Recoverable collapse

    // Stamina System (100 max, drains during sprint, regenerates during walk/stop)
    this.stamina = options.stamina ?? 100;
    this.maxStamina = options.maxStamina ?? 100;
    this.staminaDrainRate = options.staminaDrainRate ?? 25.0; // units/sec while sprinting
    this.staminaRegenRate = options.staminaRegenRate ?? 15.0; // units/sec while walking/stopped

    // Combat & Stagger Responses
    this.isStaggered = false;
    this.staggerDuration = options.staggerDuration ?? 2.0; // 2.0s initial player stagger on hit
    this.staggerTimer = 0;
    this.escapeWindowTicks = options.escapeWindowTicks ?? 1; // 1 fixed-simulation-tick escape opportunity after stagger
    this.escapeTicksRemaining = 0;

    // Movement Speeds
    this.moveSpeed = options.moveSpeed ?? 5.2;
    this.sprintSpeed = options.sprintSpeed ?? 7.6;

    // Fixed Ammunition Economy: Hard room budget of 30 rounds
    this.ammo = options.ammo ?? 30;

    // Automatic Footstep Generation & Grounded Movement
    this.isGrounded = true;
    this.isSprinting = false;
    this.isMoving = false;
    this.currentVelocity = new YUKA.Vector3();
    this.distanceTraveledSinceStep = 0;

    this.footstepConfig = {
      walkStride: 1.6,         // meters per step when walking (~0.45s cadence at 3.5m/s)
      sprintStride: 1.4,       // meters per step when sprinting (more frequent, ~0.25s cadence at 5.5m/s)
      walkRadius: 5.0,         // audible radius in meters when walking (configurable)
      sprintRadius: 8.0,       // audible radius in meters when sprinting (louder, 8m)
      walkLoudness: 0.25,      // relative amplitude
      sprintLoudness: 0.50,    // relative amplitude
      lifetime: 0.8            // sound duration before expiration
    };

    /** Callback invoked whenever a footstep threshold is crossed */
    this.onFootstepGenerated = null;
  }

  takeDamage(amount) {
    if (this.isDead) return { eliminated: true, staggered: false };

    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.health = 0;
      this.isDead = true;
      this.isStaggered = false;
      this.isMoving = false;
      this.distanceTraveledSinceStep = 0;
      return { eliminated: true, staggered: false };
    }

    // Trigger player stagger upon taking damage
    this.isStaggered = true;
    this.staggerTimer = this.staggerDuration;
    this.isMoving = false;
    this.distanceTraveledSinceStep = 0;
    return { eliminated: false, staggered: true };
  }

  takeSanityDamage(amount) {
    if (this.isDead) return;
    this.sanity = Math.max(0, this.sanity - amount);
    if (this.sanity <= 0) {
      this.sanity = 0;
      this.isSanityCollapsed = true;
    }
  }

  recoverSanity(amount) {
    if (this.isDead) return;
    this.sanity = Math.min(this.maxSanity, this.sanity + amount);
    if (this.sanity > 0) {
      this.isSanityCollapsed = false;
    }
  }

  heal(amount) {
    if (this.isDead) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /**
   * Cooperative recovery mechanic: Recovers an incapacitated teammate within range.
   * @param {PlayerEntity} targetSurvivor - Incapacitated teammate to recover
   * @param {number} [amount=50] - Sanity amount to restore
   * @returns {boolean} Whether recovery succeeded
   */
  recoverTeammate(targetSurvivor, amount = 50) {
    if (this.isDead || this.isSanityCollapsed) return false;
    if (!targetSurvivor || targetSurvivor.isDead || !targetSurvivor.isSanityCollapsed) return false;

    const dist = this.position.distanceTo(targetSurvivor.position);
    if (dist <= 3.0) {
      targetSurvivor.recoverSanity(amount);
      return true;
    }
    return false;
  }

  /**
   * Advances player position and handles automatic footstep generation.
   * Footsteps are strictly grounded and cease immediately when movement stops.
   * @param {number} newX - Target X
   * @param {number} newZ - Target Z
   * @param {number} delta - Delta time
   * @param {boolean} [isSprinting=false] - Whether player is sprinting
   * @param {boolean} [isGrounded=true] - Whether player is touching ground
   * @returns {Object|null} Emitted footstep sound event or null
   */
  stepMovement(newX, newZ, delta, isSprinting = false, isGrounded = true) {
    if (this.isDead || this.isStaggered || this.isSanityCollapsed) {
      this.isMoving = false;
      this.distanceTraveledSinceStep = 0;
      return null;
    }

    this.isGrounded = isGrounded;

    const dx = newX - this.position.x;
    const dz = newZ - this.position.z;
    const distMoved = Math.hypot(dx, dz);

    this.position.x = newX;
    this.position.z = newZ;

    // Stamina drain and regeneration dynamics
    if (isSprinting && distMoved > 0.0001) {
      if (this.stamina > 0) {
        this.stamina = Math.max(0, this.stamina - this.staminaDrainRate * delta);
        this.isSprinting = true;
      } else {
        // Stamina depleted: drop to walking cadence
        this.isSprinting = false;
        isSprinting = false;
      }
    } else {
      this.isSprinting = false;
      this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegenRate * delta);
    }

    // If movement is negligible or player is airborne, emit zero footsteps
    if (distMoved < 0.0001 || !this.isGrounded) {
      this.isMoving = false;
      this.distanceTraveledSinceStep = 0;
      return null;
    }

    this.isMoving = true;
    this.distanceTraveledSinceStep += distMoved;

    const stride = isSprinting ? this.footstepConfig.sprintStride : this.footstepConfig.walkStride;
    if (this.distanceTraveledSinceStep >= stride) {
      this.distanceTraveledSinceStep = 0;
      const soundData = {
        worldPosition: this.position.clone(),
        soundType: isSprinting ? 'FOOTSTEP_SPRINT' : 'FOOTSTEP_WALK',
        loudness: isSprinting ? this.footstepConfig.sprintLoudness : this.footstepConfig.walkLoudness,
        detectionRadius: isSprinting ? this.footstepConfig.sprintRadius : this.footstepConfig.walkRadius,
        lifetime: this.footstepConfig.lifetime,
        sourceEntityId: this.id || this.uuid
      };
      if (this.onFootstepGenerated) {
        return this.onFootstepGenerated(soundData);
      }
      return soundData;
    }

    return null;
  }

  update(delta) {
    if (this.isStaggered) {
      this.staggerTimer -= delta;
      if (this.staggerTimer <= 0) {
        this.isStaggered = false;
        this.staggerTimer = 0;
        this.escapeTicksRemaining = this.escapeWindowTicks;
      }
    } else if (this.escapeTicksRemaining > 0) {
      this.escapeTicksRemaining--;
    }
    super.update(delta);
  }
}

/**
 * SaberSimulation orchestrates the entire Level 0 prototype environment:
 * - 1 Player Survivor (100 HP, 30 ammo, automatic grounded footsteps)
 * - 2 Persistent Saber Monsters (Saber Alpha, Saber Beta)
 * - Map geometry and obstacle line-of-sight
 * - Sound stimulus system with independent perception
 * - Encounter Director macro pacing & menace management
 * - Fixed update loop and diagnostic telemetry
 */
export class SaberSimulation {
  constructor(options = {}) {
    this.entityManager = new YUKA.EntityManager();
    this.time = new YUKA.Time();
    this.soundSystem = new SoundStimulusSystem();
    this.map = options.map || new Level0PrototypeMap();
    this.elapsedTime = 0;

    // 1. Setup Cooperative Players (Survivor A & Survivor B)
    this.playerA = new PlayerEntity('Survivor A', new YUKA.Vector3(-4, 0, -10), { id: 'player_a' });
    this.playerB = new PlayerEntity('Survivor B', new YUKA.Vector3(4, 0, -10), { id: 'player_b' });
    this.players = [this.playerA, this.playerB];
    this.player = this.playerA; // Full backward compatibility

    this.entityManager.add(this.playerA);
    this.entityManager.add(this.playerB);

    // 2. Setup Obstacles
    for (const obstacle of this.map.obstacles) {
      this.entityManager.add(obstacle);
    }

    // Difficulty Settings ('NORMAL' | 'HARD')
    this.difficulty = (options.difficulty && options.difficulty.toUpperCase() === 'HARD') ? 'HARD' : 'NORMAL';

    // 3. Setup Persistent Monsters: Saber Alpha & Saber Beta
    this.saberAlpha = new SaberAgent('Saber Alpha', {
      env: this.map,
      health: 100,
      difficulty: this.difficulty,
      damage: options.damage,
      attackRange: options.attackRange,
      patrolSpeed: options.patrolSpeed ?? 2.5,
      searchSpeed: options.searchSpeed ?? 2.5,
      investigateSpeed: options.investigateSpeed ?? 5.72,
      stalkSpeed: options.stalkSpeed ?? 7.6,
      chaseSpeed: options.chaseSpeed ?? 9.5,
      collisionRadius: 0.32,
      staggerDuration: 10.0,
      recoveryWindow: 2.5
    });
    if (options.spawnAlpha) {
      this.saberAlpha.position.copy(options.spawnAlpha);
    } else {
      this.saberAlpha.position.set(-16, 0, -18);
    }
    this.saberAlpha.setPatrolWaypoints(options.waypointsAlpha || this.map.saberAlphaWaypoints);
    this.saberAlpha.setPotentialTargets(this.players);
    this.saberAlpha.targetEntity = this.playerA;

    this.saberBeta = new SaberAgent('Saber Beta', {
      env: this.map,
      health: 100,
      difficulty: this.difficulty,
      damage: options.damage,
      attackRange: options.attackRange,
      patrolSpeed: options.patrolSpeed ?? 2.5,
      searchSpeed: options.searchSpeed ?? 2.5,
      investigateSpeed: options.investigateSpeed ?? 5.72,
      stalkSpeed: options.stalkSpeed ?? 7.6,
      chaseSpeed: options.chaseSpeed ?? 9.5,
      collisionRadius: 0.32,
      staggerDuration: 10.0,
      recoveryWindow: 2.5
    });
    if (options.spawnBeta) {
      this.saberBeta.position.copy(options.spawnBeta);
    } else {
      this.saberBeta.position.set(16, 0, -18);
    }
    this.saberBeta.setPatrolWaypoints(options.waypointsBeta || this.map.saberBetaWaypoints);
    this.saberBeta.setPotentialTargets(this.players);
    this.saberBeta.targetEntity = this.playerA;

    // Register obstacles to each Saber's Vision
    for (const obstacle of this.map.obstacles) {
      this.saberAlpha.vision.addObstacle(obstacle);
      this.saberBeta.vision.addObstacle(obstacle);
    }

    // Cross-configure separation behavior so they avoid clumping together
    this.saberAlpha.neighbors.push(this.saberBeta);
    this.saberBeta.neighbors.push(this.saberAlpha);

    this.entityManager.add(this.saberAlpha);
    this.entityManager.add(this.saberBeta);

    // 4. Hook Auditory System to both Sabers
    this.soundSystem.registerListener((stimulus) => {
      this.dispatchSoundToSabers(stimulus);
    });

    // 5. Hook Player Movement Footstep Sound Generator for both survivors
    for (const p of this.players) {
      p.onFootstepGenerated = (soundData) => {
        return this.emitFootstepStimulus(soundData, p);
      };
    }

    // 6. Instantiate Macro Encounter Director
    this.director = new EncounterDirector();

    // Event bus / telemetry callbacks
    this.onEventLog = null;
    this.onFootstepEvent = null;
    this.lastFootstepAudit = null;
  }

  setDifficulty(difficulty) {
    this.difficulty = (typeof difficulty === 'string' && difficulty.toUpperCase() === 'HARD') ? 'HARD' : 'NORMAL';
    if (this.saberAlpha) this.saberAlpha.setDifficulty(this.difficulty);
    if (this.saberBeta) this.saberBeta.setDifficulty(this.difficulty);
  }

  /**
   * Emits an automatic footstep sound stimulus and dispatches it to both Sabers.
   * @param {Object} soundData
   * @param {PlayerEntity} [sourceEntity]
   * @returns {{ stimulus: SoundStimulus, audit: Object }}
   */
  emitFootstepStimulus(soundData, sourceEntity = this.player) {
    const stimulus = this.soundSystem.emit({
      worldPosition: soundData.worldPosition,
      soundType: soundData.soundType,
      loudness: soundData.loudness,
      detectionRadius: soundData.detectionRadius,
      timestamp: this.elapsedTime,
      lifetime: soundData.lifetime ?? 0.8,
      sourceEntityId: sourceEntity.id || sourceEntity.uuid
    });

    const isSprint = soundData.soundType === 'FOOTSTEP_SPRINT';
    const audit = this.dispatchFootstepToSabers(stimulus, isSprint);
    this.lastFootstepAudit = audit;

    if (this.onFootstepEvent) {
      this.onFootstepEvent({
        stimulus,
        isSprint,
        sourceEntity,
        audit
      });
    }

    return { stimulus, audit };
  }

  /**
   * Dispatches a footstep event to both Sabers and returns diagnostic evaluation audit.
   * @param {SoundStimulus} stimulus
   * @param {boolean} isSprint
   * @returns {Object}
   */
  dispatchFootstepToSabers(stimulus, isSprint) {
    const sabers = [this.saberAlpha, this.saberBeta];
    const audit = {};

    for (const saber of sabers) {
      const occlusion = this.map.getSoundOcclusionFactor(stimulus.worldPosition, saber.position);
      const evalResult = stimulus.evaluateAudibility(saber.position, occlusion);

      audit[saber.name] = {
        heard: evalResult.audible,
        distance: evalResult.distance,
        effectiveRadius: evalResult.effectiveRadius,
        reason: evalResult.audible
          ? `Audible (${evalResult.distance.toFixed(1)}m <= ${evalResult.effectiveRadius.toFixed(1)}m)`
          : (evalResult.distance > stimulus.detectionRadius
              ? `Out of range (${evalResult.distance.toFixed(1)}m > ${stimulus.detectionRadius.toFixed(1)}m)`
              : `Muffled by walls (${evalResult.distance.toFixed(1)}m > ${evalResult.effectiveRadius.toFixed(1)}m eff)`)
      };

      if (evalResult.audible) {
        saber.onHearSound(stimulus, evalResult);
        this.emitLog(`[FOOTSTEP] ${saber.name} heard ${stimulus.soundType} at ${evalResult.distance.toFixed(1)}m`);
      }
    }

    return audit;
  }

  /**
   * Dispatches a sound event independently to both Sabers.
   * Calculates attenuation through walls for each agent.
   * Gunfire attracts both monsters without supernatural coordinate knowledge.
   * Visual contact takes precedence over sound investigation.
   * @param {SoundStimulus} stimulus
   */
  dispatchSoundToSabers(stimulus) {
    const sabers = [this.saberAlpha, this.saberBeta];

    for (const saber of sabers) {
      const occlusion = this.map.getSoundOcclusionFactor(stimulus.worldPosition, saber.position);
      const evalResult = stimulus.evaluateAudibility(saber.position, occlusion);

      if (evalResult.audible) {
        saber.onHearSound(stimulus, evalResult);
        this.emitLog(`[HEARING] ${saber.name} heard ${stimulus.soundType} at ${evalResult.distance.toFixed(1)}m (effective radius: ${evalResult.effectiveRadius.toFixed(1)}m)`);
      } else {
        this.emitLog(`[HEARING] ${saber.name} is OUT OF RANGE (${evalResult.distance.toFixed(1)}m > ${evalResult.effectiveRadius.toFixed(1)}m) for ${stimulus.soundType}`);
      }
    }
  }

  /**
   * Fires a pistol discharge from the player position.
   * @param {Object} [overrideOptions]
   * @returns {SoundStimulus}
   */
  fireGunshot(overrideOptions = {}) {
    const shooter = overrideOptions.shooter || this.player;
    if (shooter.ammo > 0) {
      shooter.ammo--;
    }

    const stimulus = this.soundSystem.emit({
      worldPosition: overrideOptions.worldPosition || shooter.position.clone(),
      soundType: overrideOptions.soundType || 'GUNSHOT',
      loudness: overrideOptions.loudness ?? 0.8,
      detectionRadius: overrideOptions.detectionRadius ?? 35.0, // 35m unsuppressed pistol
      timestamp: this.elapsedTime,
      lifetime: overrideOptions.lifetime ?? 3.0,
      sourceEntityId: shooter.id || shooter.uuid
    });

    this.emitLog(`[GUNSHOT] ${shooter.name} discharged pistol at (${stimulus.worldPosition.x.toFixed(1)}, ${stimulus.worldPosition.z.toFixed(1)}). Sound radius: ${stimulus.detectionRadius}m`);
    return stimulus;
  }

  /**
   * Fires a shotgun blast from the player position.
   * @param {Object} [overrideOptions]
   * @returns {SoundStimulus}
   */
  fireShotgun(overrideOptions = {}) {
    const shooter = overrideOptions.shooter || this.player;
    if (shooter.ammo > 0) {
      shooter.ammo--;
    }

    const stimulus = this.soundSystem.emit({
      worldPosition: overrideOptions.worldPosition || shooter.position.clone(),
      soundType: 'SHOTGUN',
      loudness: 1.0,
      detectionRadius: 50.0, // 50m powerful blast
      timestamp: this.elapsedTime,
      lifetime: 3.5,
      sourceEntityId: shooter.id || shooter.uuid
    });

    this.emitLog(`[SHOTGUN] ${shooter.name} blasted shotgun at (${stimulus.worldPosition.x.toFixed(1)}, ${stimulus.worldPosition.z.toFixed(1)}). Sound radius: ${stimulus.detectionRadius}m`);
    return stimulus;
  }

  /**
   * Emits sprint footstep noise manually (legacy/button helper).
   * @param {Object} [overrideOptions]
   * @returns {SoundStimulus}
   */
  emitFootsteps(overrideOptions = {}) {
    const shooter = overrideOptions.shooter || this.player;
    const stimulus = this.soundSystem.emit({
      worldPosition: overrideOptions.worldPosition || shooter.position.clone(),
      soundType: overrideOptions.soundType || 'FOOTSTEP',
      loudness: overrideOptions.loudness ?? 0.5,
      detectionRadius: overrideOptions.detectionRadius ?? 8.0, // 8m audible footstep radius
      timestamp: this.elapsedTime,
      lifetime: 0.8,
      sourceEntityId: shooter.id || shooter.uuid
    });

    return stimulus;
  }

  /**
   * Advances the simulation by delta seconds.
   * @param {number} delta
   */
  update(delta) {
    this.elapsedTime += delta;
    this.soundSystem.update(this.elapsedTime);
    this.entityManager.update(delta);
    // Advance Encounter Director macro pacing
    this.director.update(delta, this);
  }

  emitLog(message) {
    if (this.onEventLog) {
      this.onEventLog({ time: this.elapsedTime, message });
    }
  }

  formatPlayerTelemetry(p) {
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      x: p.position.x,
      z: p.position.z,
      health: p.health,
      maxHealth: p.maxHealth,
      sanity: p.sanity,
      maxSanity: p.maxSanity,
      stamina: Math.round(p.stamina),
      maxStamina: p.maxStamina,
      ammo: p.ammo,
      isDead: p.isDead,
      isSanityCollapsed: p.isSanityCollapsed,
      isStaggered: p.isStaggered,
      isGrounded: p.isGrounded,
      isSprinting: p.isSprinting,
      isMoving: p.isMoving,
      staggerTimer: p.staggerTimer
    };
  }

  getTelemetry() {
    return {
      elapsedTime: this.elapsedTime,
      player: this.formatPlayerTelemetry(this.playerA),
      playerA: this.formatPlayerTelemetry(this.playerA),
      playerB: this.formatPlayerTelemetry(this.playerB),
      players: this.players.map(p => this.formatPlayerTelemetry(p)),
      saberAlpha: {
        name: this.saberAlpha.name,
        state: this.saberAlpha.getCurrentStateName(),
        health: this.saberAlpha.health,
        speed: this.saberAlpha.getSpeed(),
        x: this.saberAlpha.position.x,
        z: this.saberAlpha.position.z,
        staggerTimer: this.saberAlpha.staggerTimer,
        recoveryTimer: this.saberAlpha.recoveryTimer,
        isInvulnerable: this.saberAlpha.isInvulnerable,
        seesPlayer: this.saberAlpha.canSeeTarget,
        targetId: this.saberAlpha.targetEntity?.id || 'none',
        targetName: this.saberAlpha.targetEntity?.name || 'None',
        hasDirectorHint: this.saberAlpha.hasDirectorHint,
        visionCheck: this.saberAlpha.lastVisionCheck,
        lastLog: this.saberAlpha.logHistory[0]?.entry || ''
      },
      saberBeta: {
        name: this.saberBeta.name,
        state: this.saberBeta.getCurrentStateName(),
        health: this.saberBeta.health,
        speed: this.saberBeta.getSpeed(),
        x: this.saberBeta.position.x,
        z: this.saberBeta.position.z,
        staggerTimer: this.saberBeta.staggerTimer,
        recoveryTimer: this.saberBeta.recoveryTimer,
        isInvulnerable: this.saberBeta.isInvulnerable,
        seesPlayer: this.saberBeta.canSeeTarget,
        targetId: this.saberBeta.targetEntity?.id || 'none',
        targetName: this.saberBeta.targetEntity?.name || 'None',
        hasDirectorHint: this.saberBeta.hasDirectorHint,
        visionCheck: this.saberBeta.lastVisionCheck,
        lastLog: this.saberBeta.logHistory[0]?.entry || ''
      },
      activeSoundsCount: this.soundSystem.activeStimuli.length,
      director: this.director.getTelemetry(),
      lastFootstepAudit: this.lastFootstepAudit
    };
  }
}
