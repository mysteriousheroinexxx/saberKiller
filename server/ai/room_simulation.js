import * as YUKA from '../../yuka/build/yuka.module.js';
import { SaberSimulation, PlayerEntity } from './simulation.js';
import { Level0Environment, Level0PrototypeMap } from './environment.js';
import { SABER_STATES } from './saber_agent.js';
import { SoundStimulus } from './sound_system.js';

export const AI_PACKET_TYPES = {
  MONSTER_SNAPSHOT: 'MONSTER_SNAPSHOT',
  SOUND_EVENT_BROADCAST: 'SOUND_EVENT_BROADCAST',
  DEV_AI_TELEMETRY: 'DEV_AI_TELEMETRY',
  FIRE_WEAPON: 'FIRE_WEAPON',
  ATTACK_MONSTER: 'ATTACK_MONSTER'
};

/**
 * RoomSimulation executes the server-authoritative 20Hz Saber AI simulation
 * for a specific multiplayer room.
 */
export class RoomSimulation {
  /**
   * @param {Object} room - The room instance from RoomManager
   * @param {Object} [options]
   */
  constructor(room, options = {}) {
    this.room = room;
    this.roomCode = room?.code || 'LOCAL';
    this.tickRate = options.tickRate ?? 20; // 20 Hz fixed interval
    this.tickDelta = 1.0 / this.tickRate; // 0.05 seconds
    this.sequence = 0;
    this.timerId = null;
    this.destroyed = false;

    // Callbacks to communicate with RoomManager and Network Server
    this.onPlayerDamaged = options.onPlayerDamaged || null;
    this.broadcastMessage = options.broadcastMessage || null;
    this.sendDevMessage = options.sendDevMessage || null;

    // Map & Environment resolution
    const useProto = options.usePrototypeMap ?? false;
    this.env = useProto ? new Level0PrototypeMap() : new Level0Environment({ usePrototypeMap: false });

    // Determine starting positions based on environment mode
    const spawnAlpha = useProto ? new YUKA.Vector3(-16, 0, -18) : new YUKA.Vector3(38.0, 0, -180.0);
    const spawnBeta = useProto ? new YUKA.Vector3(16, 0, -18) : new YUKA.Vector3(60.0, 0, -160.0);

    this.sim = new SaberSimulation({
      map: this.env,
      spawnAlpha,
      spawnBeta,
      waypointsAlpha: this.env.saberAlphaWaypoints,
      waypointsBeta: this.env.saberBetaWaypoints
    });

    // Player entities registry: playerId -> PlayerEntity
    this.playerEntities = new Map();

    // Hook Saber attack strikes to server damage authority
    const handleSaberAttack = (saber, targetEntity, damage) => {
      if (!targetEntity) return;
      const targetId = targetEntity.id || targetEntity.name;
      if (this.onPlayerDamaged) {
        this.onPlayerDamaged(targetId, damage, 'SABER_ATTACK');
      }
    };
    this.sim.saberAlpha.onAttack = (target, dmg) => handleSaberAttack(this.sim.saberAlpha, target, dmg);
    this.sim.saberBeta.onAttack = (target, dmg) => handleSaberAttack(this.sim.saberBeta, target, dmg);

    // Hook Sound Stimulus System to broadcast auditory events
    this.sim.soundSystem.registerListener((stimulus) => {
      this.broadcastSoundEvent(stimulus);
    });

    // Register any existing players in the room
    if (room && room.players) {
      for (const [id, player] of room.players) {
        this.addPlayer(player);
      }
    }

    // Auto-start 20Hz simulation tick loop
    if (options.autoStart !== false) {
      this.start();
    }
  }

  /**
   * Registers a player in the AI simulation.
   */
  addPlayer(player) {
    if (!player || !player.id) return;
    const existing = this.playerEntities.get(player.id);
    if (existing) {
      existing.isDead = (player.state === 'DOWNED' || player.state === 'ELIMINATED');
      return existing;
    }

    const startPos = player.position
      ? new YUKA.Vector3(player.position.x || 0, player.position.y || 0, player.position.z || 0)
      : new YUKA.Vector3(0, 0, 0);

    const entity = new PlayerEntity(player.name || `Player_${player.id}`, startPos, {
      id: player.id,
      health: player.hp ?? 100,
      maxHealth: player.maxHp ?? 100
    });
    entity.isDead = (player.state === 'DOWNED' || player.state === 'ELIMINATED');

    // Hook movement footstep sound emission
    entity.onFootstepGenerated = (soundData) => {
      return this.sim.emitFootstepStimulus(soundData, entity);
    };

    this.playerEntities.set(player.id, entity);
    this.sim.entityManager.add(entity);

    // Update potential targets list in both Sabers
    this.updateSaberTargetPool();
    return entity;
  }

  /**
   * Updates player state when downed, revived, or eliminated.
   */
  setPlayerState(playerId, state, hp = null) {
    const entity = this.playerEntities.get(playerId);
    if (!entity) return;

    if (typeof hp === 'number') {
      entity.health = hp;
    }

    if (state === 'DOWNED' || state === 'ELIMINATED') {
      entity.isDead = true;
    } else if (state === 'ALIVE' || state === 'ACTIVE') {
      entity.isDead = false;
    }

    this.updateSaberTargetPool();
  }

  /**
   * Removes a player on disconnect.
   */
  removePlayer(playerId) {
    const entity = this.playerEntities.get(playerId);
    if (!entity) return;

    entity.isDead = true;
    this.sim.entityManager.remove(entity);
    this.playerEntities.delete(playerId);

    this.updateSaberTargetPool();
  }

  /**
   * Refreshes the active survivor target pool for both Sabers.
   */
  updateSaberTargetPool() {
    const activeSurvivors = Array.from(this.playerEntities.values()).filter(p => !p.isDead);
    const pool = activeSurvivors.length > 0 ? activeSurvivors : Array.from(this.playerEntities.values());

    if (pool.length > 0) {
      this.sim.players = pool;
      this.sim.player = pool[0];
      this.sim.saberAlpha.setPotentialTargets(pool);
      this.sim.saberBeta.setPotentialTargets(pool);

      // Point targets to real registered players
      if (!this.sim.saberAlpha.targetEntity || !pool.includes(this.sim.saberAlpha.targetEntity) || this.sim.saberAlpha.targetEntity.isDead) {
        this.sim.saberAlpha.targetEntity = activeSurvivors[0] || pool[0];
      }
      if (!this.sim.saberBeta.targetEntity || !pool.includes(this.sim.saberBeta.targetEntity) || this.sim.saberBeta.targetEntity.isDead) {
        this.sim.saberBeta.targetEntity = activeSurvivors.length > 1 ? activeSurvivors[1] : (activeSurvivors[0] || pool[0]);
      }
    }
  }

  /**
   * Updates player coordinates and strides for automatic footstep perception.
   */
  updatePlayerMovement(playerId, x, y, z, isSprinting = false, isGrounded = true, delta = 0.05) {
    let entity = this.playerEntities.get(playerId);
    if (!entity) {
      entity = this.addPlayer({ id: playerId, position: { x, y, z } });
    }
    if (!entity) return;

    entity.stepMovement(x, z, delta, isSprinting, isGrounded);
  }

  /**
   * Handles authoritative weapon discharge sound emission.
   */
  handleWeaponFired(playerId, weaponType = 'PISTOL') {
    const entity = this.playerEntities.get(playerId);
    const pos = entity ? entity.position : new YUKA.Vector3();

    if (weaponType === 'SHOTGUN') {
      this.sim.fireShotgun({
        shooter: entity || this.sim.playerA,
        worldPosition: pos.clone()
      });
    } else {
      this.sim.fireGunshot({
        shooter: entity || this.sim.playerA,
        worldPosition: pos.clone()
      });
    }
  }

  /**
   * Handles player attack / hitscan against a Saber.
   */
  handleAttackMonster(playerId, targetSaberId = 'saber_alpha', damage = 25) {
    const target = (targetSaberId === 'saber_beta' || targetSaberId === 'Saber Beta')
      ? this.sim.saberBeta
      : this.sim.saberAlpha;

    const entity = this.playerEntities.get(playerId);
    if (entity) {
      const dist = entity.position.distanceTo(target.position);
      // Validate weapon distance (up to 25m)
      if (dist > 30.0) {
        return { success: false, reason: 'Out of weapon range' };
      }
    }

    const res = target.takeDamage(damage);
    return {
      success: true,
      monsterId: targetSaberId,
      damageDealt: res.damageDealt,
      staggered: res.staggered,
      health: target.health,
      state: target.getCurrentStateName()
    };
  }

  /**
   * Broadcasts sound stimulus to room clients.
   */
  broadcastSoundEvent(stimulus) {
    if (!this.broadcastMessage) return;
    this.broadcastMessage(AI_PACKET_TYPES.SOUND_EVENT_BROADCAST, {
      soundType: stimulus.soundType,
      position: {
        x: stimulus.worldPosition.x,
        y: stimulus.worldPosition.y,
        z: stimulus.worldPosition.z
      },
      detectionRadius: stimulus.detectionRadius,
      loudness: stimulus.loudness,
      sourceEntityId: stimulus.sourceEntityId,
      timestamp: this.sim.elapsedTime
    });
  }

  /**
   * Starts the 20 Hz simulation loop.
   */
  start() {
    if (this.timerId) return;
    this.timerId = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        console.error(`[RoomSimulation ${this.roomCode}] Tick error:`, err);
      }
    }, Math.round(1000 / this.tickRate));
    if (this.timerId && typeof this.timerId.unref === 'function') {
      this.timerId.unref();
    }
  }

  /**
   * Stops the 20 Hz simulation loop.
   */
  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Advances the simulation by one authoritative tick and broadcasts snapshots.
   */
  tick(customDelta) {
    if (this.destroyed) return;
    const delta = customDelta ?? this.tickDelta;
    this.sequence++;

    // 1. Advance Yuka spatial simulation, sensory checks, FSMs, and Director
    this.sim.update(delta);

    // 2. Build authoritative monster snapshot
    const monsterSnapshot = this.buildMonsterSnapshot();

    // 3. Broadcast snapshot to room players
    if (this.broadcastMessage) {
      this.broadcastMessage(AI_PACKET_TYPES.MONSTER_SNAPSHOT, monsterSnapshot);
    }

    // 4. If developer telemetry handler is wired, build and dispatch diagnostic telemetry
    if (this.sendDevMessage) {
      const devTelemetry = this.buildDevTelemetry();
      this.sendDevMessage(AI_PACKET_TYPES.DEV_AI_TELEMETRY, devTelemetry);
    }
  }

  buildMonsterSnapshot() {
    const alpha = this.sim.saberAlpha;
    const beta = this.sim.saberBeta;

    const yawAlpha = alpha.rotation ? 2 * Math.atan2(alpha.rotation.y || 0, alpha.rotation.w ?? 1) : 0;
    const yawBeta = beta.rotation ? 2 * Math.atan2(beta.rotation.y || 0, beta.rotation.w ?? 1) : 0;

    return {
      sequence: this.sequence,
      timestamp: this.sim.elapsedTime,
      monsters: [
        {
          id: 'saber_alpha',
          name: alpha.name,
          state: alpha.getCurrentStateName(),
          health: alpha.health,
          speed: alpha.getSpeed(),
          currentSpeed: alpha.getSpeed(),
          isInvulnerable: alpha.isInvulnerable,
          targetId: alpha.targetEntity ? (alpha.targetEntity.id || alpha.targetEntity.name) : null,
          canSeeTarget: alpha.canSeeTarget,
          x: +alpha.position.x.toFixed(3),
          y: +alpha.position.y.toFixed(3),
          z: +alpha.position.z.toFixed(3),
          yaw: +yawAlpha.toFixed(4),
          position: { x: alpha.position.x, y: alpha.position.y, z: alpha.position.z },
          rotation: { x: alpha.rotation.x, y: alpha.rotation.y, z: alpha.rotation.z, w: alpha.rotation.w }
        },
        {
          id: 'saber_beta',
          name: beta.name,
          state: beta.getCurrentStateName(),
          health: beta.health,
          speed: beta.getSpeed(),
          currentSpeed: beta.getSpeed(),
          isInvulnerable: beta.isInvulnerable,
          targetId: beta.targetEntity ? (beta.targetEntity.id || beta.targetEntity.name) : null,
          canSeeTarget: beta.canSeeTarget,
          x: +beta.position.x.toFixed(3),
          y: +beta.position.y.toFixed(3),
          z: +beta.position.z.toFixed(3),
          yaw: +yawBeta.toFixed(4),
          position: { x: beta.position.x, y: beta.position.y, z: beta.position.z },
          rotation: { x: beta.rotation.x, y: beta.rotation.y, z: beta.rotation.z, w: beta.rotation.w }
        }
      ]
    };
  }

  buildDevTelemetry() {
    const alpha = this.sim.saberAlpha;
    const beta = this.sim.saberBeta;
    const director = this.sim.director;

    return {
      sequence: this.sequence,
      timestamp: this.sim.elapsedTime,
      roomCode: this.roomCode,
      saberAlpha: {
        id: 'saber_alpha',
        name: alpha.name,
        state: alpha.getCurrentStateName(),
        health: alpha.health,
        speed: alpha.getSpeed(),
        position: { x: alpha.position.x, y: alpha.position.y, z: alpha.position.z },
        rotation: { x: alpha.rotation.x, y: alpha.rotation.y, z: alpha.rotation.z, w: alpha.rotation.w },
        isInvulnerable: alpha.isInvulnerable,
        staggerTimer: alpha.staggerTimer,
        recoveryTimer: alpha.recoveryTimer,
        seesPlayer: alpha.canSeeTarget,
        targetId: alpha.targetEntity ? (alpha.targetEntity.id || alpha.targetEntity.name) : null,
        targetName: alpha.targetEntity ? (alpha.targetEntity.name || alpha.targetEntity.id) : 'None',
        targetDistance: alpha.targetDistance,
        hasDirectorHint: alpha.hasDirectorHint,
        visionCheck: alpha.lastVisionCheck || null,
        lastLog: alpha.logHistory[0]?.entry || ''
      },
      saberBeta: {
        id: 'saber_beta',
        name: beta.name,
        state: beta.getCurrentStateName(),
        health: beta.health,
        speed: beta.getSpeed(),
        position: { x: beta.position.x, y: beta.position.y, z: beta.position.z },
        rotation: { x: beta.rotation.x, y: beta.rotation.y, z: beta.rotation.z, w: beta.rotation.w },
        isInvulnerable: beta.isInvulnerable,
        staggerTimer: beta.staggerTimer,
        recoveryTimer: beta.recoveryTimer,
        seesPlayer: beta.canSeeTarget,
        targetId: beta.targetEntity ? (beta.targetEntity.id || beta.targetEntity.name) : null,
        targetName: beta.targetEntity ? (beta.targetEntity.name || beta.targetEntity.id) : 'None',
        targetDistance: beta.targetDistance,
        hasDirectorHint: beta.hasDirectorHint,
        visionCheck: beta.lastVisionCheck || null,
        lastLog: beta.logHistory[0]?.entry || ''
      },
      director: director.getTelemetry(),
      activeSoundsCount: this.sim.soundSystem.activeStimuli.length
    };
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    this.playerEntities.clear();
    this.sim.soundSystem.clear();
    this.sim.entityManager.clear();
  }
}
