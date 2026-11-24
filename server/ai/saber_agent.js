import * as YUKA from '../../yuka/build/yuka.module.js';

export const SABER_STATES = {
  PATROL: 'PATROL',
  INVESTIGATE_SOUND: 'INVESTIGATE_SOUND',
  SEARCH: 'SEARCH',
  STALK: 'STALK',
  CHASE: 'CHASE',
  ATTACK: 'ATTACK',
  STAGGERED: 'STAGGERED',
  RECOVER: 'RECOVER'
};

// -----------------------------------------------------------------------------
// ENHANCED VISION COMPONENT WITH EYE-HEIGHT & DIAGNOSTIC REASONING
// -----------------------------------------------------------------------------
export class SaberVision extends YUKA.Vision {
  /**
   * @param {YUKA.GameEntity} owner
   * @param {Object} [options]
   */
  constructor(owner, options = {}) {
    super(owner);
    this.fieldOfView = options.fieldOfView ?? (Math.PI * 0.61); // ~110 degrees
    this.range = options.range ?? 22.0;

    // Realistic character heights (meters)
    this.eyeHeight = options.eyeHeight ?? 1.8;
    this.targetHeight = options.targetHeight ?? 1.4;

    // Reusable internal math vectors
    this._worldPosition = new YUKA.Vector3();
    this._targetPosition = new YUKA.Vector3();
    this._toPoint = new YUKA.Vector3();
    this._direction = new YUKA.Vector3();
    this._ray = new YUKA.Ray();
    this._intersectionPoint = new YUKA.Vector3();

    /**
     * Cached detailed result from the latest visibility evaluation.
     */
    this.lastCheck = {
      visible: false,
      inRange: false,
      inFOV: false,
      unoccluded: false,
      distance: 0,
      angleDeg: 0,
      maxHalfAngleDeg: (this.fieldOfView * 0.5 * 180 / Math.PI),
      reason: 'No check performed yet',
      obstacleHitName: null,
      hitPoint: new YUKA.Vector3(),
      eyeOrigin: new YUKA.Vector3(),
      targetTested: new YUKA.Vector3()
    };
  }

  /**
   * Performs an exhaustive line-of-sight check with detailed diagnostic metadata.
   * @param {YUKA.Vector3} targetPoint - World position of target
   * @returns {typeof this.lastCheck}
   */
  checkVisibilityDetailed(targetPoint) {
    const owner = this.owner;
    const obstacles = this.obstacles;

    const result = {
      visible: false,
      inRange: false,
      inFOV: false,
      unoccluded: false,
      distance: 0,
      angleDeg: 0,
      maxHalfAngleDeg: (this.fieldOfView * 0.5 * 180 / Math.PI),
      reason: 'No check performed yet',
      obstacleHitName: null,
      hitPoint: new YUKA.Vector3(),
      eyeOrigin: new YUKA.Vector3(),
      targetTested: new YUKA.Vector3()
    };

    // 1. Calculate eye origin in world coordinates
    owner.getWorldPosition(this._worldPosition);
    this._worldPosition.y += this.eyeHeight;
    result.eyeOrigin.copy(this._worldPosition);

    // 2. Calculate target sample point in world coordinates
    this._targetPosition.copy(targetPoint);
    if (this._targetPosition.y < 0.5) {
      this._targetPosition.y += this.targetHeight;
    }
    result.targetTested.copy(this._targetPosition);

    // 3. Distance & Visual Range Check
    this._toPoint.subVectors(this._targetPosition, this._worldPosition);
    const distanceToPoint = this._toPoint.length();
    result.distance = distanceToPoint;
    result.maxHalfAngleDeg = (this.fieldOfView * 0.5 * 180 / Math.PI);

    if (distanceToPoint > this.range) {
      result.inRange = false;
      result.inFOV = false;
      result.unoccluded = false;
      result.visible = false;
      result.obstacleHitName = null;
      result.reason = `Outside vision range (${distanceToPoint.toFixed(1)}m > ${this.range.toFixed(1)}m)`;
      this.lastCheck = result;
      return result;
    }
    result.inRange = true;

    // 4. Field of View Check (Horizontal plane projection to avoid vertical pitch distortion)
    owner.getWorldDirection(this._direction);
    const horizontalDir = new YUKA.Vector3(this._direction.x, 0, this._direction.z).normalize();
    const horizontalToPoint = new YUKA.Vector3(this._toPoint.x, 0, this._toPoint.z).normalize();
    const angle = horizontalDir.angleTo(horizontalToPoint);
    const angleDeg = angle * 180 / Math.PI;
    result.angleDeg = angleDeg;

    const halfFov = this.fieldOfView * 0.5;
    if (angle > halfFov) {
      result.inFOV = false;
      result.unoccluded = false;
      result.visible = false;
      result.obstacleHitName = null;
      result.reason = `Outside vision cone (${angleDeg.toFixed(1)}° > ${(halfFov * 180 / Math.PI).toFixed(1)}°)`;
      this.lastCheck = result;
      return result;
    }
    result.inFOV = true;

    // 5. Obstacle Line-of-Sight Check
    this._ray.origin.copy(this._worldPosition);
    this._ray.direction.copy(this._toPoint).divideScalar(distanceToPoint || 1);

    let closestHitDistSq = Infinity;
    let closestObstacle = null;
    const hitPointCandidate = new YUKA.Vector3();

    for (let i = 0, l = obstacles.length; i < l; i++) {
      const obstacle = obstacles[i];
      if (obstacle === owner) continue; // Ignore self
      if (obstacle.active === false) continue; // Allow toggling obstacles for testing

      const hit = obstacle.lineOfSightTest(this._ray, hitPointCandidate);
      if (hit !== null) {
        const hitDistSq = hitPointCandidate.squaredDistanceTo(this._worldPosition);
        // Ensure hit is in front of origin and before target
        if (hitDistSq < (distanceToPoint * distanceToPoint - 0.05) && hitDistSq < closestHitDistSq) {
          closestHitDistSq = hitDistSq;
          closestObstacle = obstacle;
          result.hitPoint.copy(hitPointCandidate);
        }
      }
    }

    if (closestObstacle !== null) {
      result.unoccluded = false;
      result.visible = false;
      result.obstacleHitName = closestObstacle.name || 'Wall';
      result.reason = `Line of sight blocked by ${result.obstacleHitName}`;
      this.lastCheck = result;
      return result;
    }

    // 6. Target is fully visible
    result.unoccluded = true;
    result.visible = true;
    result.obstacleHitName = null;
    result.reason = `Visible (in FOV ${angleDeg.toFixed(1)}°, dist ${distanceToPoint.toFixed(1)}m, clear LoS)`;
    this.lastCheck = result;
    return result;
  }

  /**
   * Standard Yuka API compatibility method.
   * @param {YUKA.Vector3} point
   * @returns {boolean}
   */
  visible(point) {
    return this.checkVisibilityDetailed(point).visible;
  }
}

// -----------------------------------------------------------------------------
// 1. PATROL STATE
// -----------------------------------------------------------------------------
export class PatrolState extends YUKA.State {
  enter(saber) {
    saber.maxSpeed = saber.patrolSpeed;
    saber.followPathBehavior.active = true;
    saber.seekBehavior.active = false;
    saber.separationBehavior.active = true;
    saber.logState('Entered PATROL (base speed: ' + saber.patrolSpeed + ' m/s)');
  }

  execute(saber) {
    // 1. Sensory Check: Vision
    const player = saber.targetEntity;
    if (player && !player.isDead) {
      if (saber.canSeeTarget) {
        saber.hasDirectorHint = false;
        const dist = saber.targetDistance;
        if (dist <= 12.0) {
          saber.stateMachine.changeTo(SABER_STATES.CHASE);
          return;
        } else {
          saber.stateMachine.changeTo(SABER_STATES.STALK);
          return;
        }
      }
    }

    // 2. Sensory Check: Auditory Stimulus (Gunshots & Footsteps)
    if (saber.hasNewSoundAlert) {
      saber.hasDirectorHint = false;
      saber.hasNewSoundAlert = false;
      saber.stateMachine.changeTo(SABER_STATES.INVESTIGATE_SOUND);
      return;
    }

    // 3. Macro Encounter Director Hint Handling
    if (saber.hasDirectorHint) {
      const distToHint = saber.position.distanceTo(saber.directorHintTarget);
      if (distToHint <= 2.5) {
        // Reached sector gateway -> resume normal waypoint path
        saber.hasDirectorHint = false;
        saber.seekBehavior.active = false;
        saber.followPathBehavior.active = true;
        saber.logState('Reached Director sector gateway. Resuming standard patrol.');
      }
    }
  }

  exit(saber) {
    saber.followPathBehavior.active = false;
    saber.hasDirectorHint = false;
  }
}

// -----------------------------------------------------------------------------
// 2. INVESTIGATE_SOUND STATE
// -----------------------------------------------------------------------------
export class InvestigateSoundState extends YUKA.State {
  enter(saber) {
    saber.maxSpeed = saber.stalkSpeed;
    saber.seekBehavior.active = true;
    saber.seekBehavior.target.copy(saber.soundTarget);
    saber.followPathBehavior.active = false;
    saber.separationBehavior.active = true;
    saber.logState('Entered INVESTIGATE_SOUND at (' +
      saber.soundTarget.x.toFixed(1) + ', ' + saber.soundTarget.z.toFixed(1) + ')');
  }

  execute(saber) {
    // 1. Sensory Check: Vision overrides sound investigation
    const player = saber.targetEntity;
    if (player && !player.isDead && saber.canSeeTarget) {
      saber.stateMachine.changeTo(SABER_STATES.CHASE);
      return;
    }

    // 2. Check if a newer sound arrived
    if (saber.hasNewSoundAlert) {
      saber.hasNewSoundAlert = false;
      saber.seekBehavior.target.copy(saber.soundTarget);
      saber.logState('Updated sound target to (' +
        saber.soundTarget.x.toFixed(1) + ', ' + saber.soundTarget.z.toFixed(1) + ')');
    }

    // 3. Check arrival at sound coordinates
    const distToSound = saber.position.distanceTo(saber.soundTarget);
    if (distToSound <= 1.8) {
      // Reached sound origin without spotting player -> start area search
      saber.searchCenter.copy(saber.soundTarget);
      saber.stateMachine.changeTo(SABER_STATES.SEARCH);
      return;
    }
  }

  exit(saber) {
    saber.seekBehavior.active = false;
  }
}

// -----------------------------------------------------------------------------
// 3. SEARCH STATE
// -----------------------------------------------------------------------------
export class SearchState extends YUKA.State {
  enter(saber) {
    saber.maxSpeed = saber.searchSpeed;
    saber.searchTimer = 0;
    saber.searchIndex = 0;
    saber.generateSearchSubPoints(saber.searchCenter);
    saber.seekBehavior.active = true;
    if (saber.searchSubPoints.length > 0) {
      saber.seekBehavior.target.copy(saber.searchSubPoints[0]);
    }
    saber.separationBehavior.active = true;
    saber.logState('Entered SEARCH (duration: ' + saber.searchDuration + 's)');
  }

  execute(saber) {
    saber.searchTimer += saber.delta;

    // 1. Sensory Check: Vision
    const player = saber.targetEntity;
    if (player && !player.isDead && saber.canSeeTarget) {
      saber.stateMachine.changeTo(SABER_STATES.CHASE);
      return;
    }

    // 2. Sensory Check: New sound stimulus
    if (saber.hasNewSoundAlert) {
      saber.hasNewSoundAlert = false;
      saber.stateMachine.changeTo(SABER_STATES.INVESTIGATE_SOUND);
      return;
    }

    // 3. Search patrol sub-points
    if (saber.searchSubPoints.length > 0) {
      const currentSubPoint = saber.searchSubPoints[saber.searchIndex];
      const dist = saber.position.distanceTo(currentSubPoint);
      if (dist < 1.5) {
        saber.searchIndex = (saber.searchIndex + 1) % saber.searchSubPoints.length;
        saber.seekBehavior.target.copy(saber.searchSubPoints[saber.searchIndex]);
      }
    }

    // 4. Search expiration -> resume patrol
    if (saber.searchTimer >= saber.searchDuration) {
      saber.logState('Search timer expired. Resuming PATROL.');
      saber.stateMachine.changeTo(SABER_STATES.PATROL);
      return;
    }
  }

  exit(saber) {
    saber.seekBehavior.active = false;
  }
}

// -----------------------------------------------------------------------------
// 4. STALK STATE
// -----------------------------------------------------------------------------
export class StalkState extends YUKA.State {
  enter(saber) {
    saber.maxSpeed = saber.stalkSpeed;
    saber.seekBehavior.active = true;
    saber.seekBehavior.target.copy(saber.targetEntity.position);
    saber.separationBehavior.active = true;
    saber.stalkLostSightTimer = 0;
    saber.logState('Entered STALK (approaching stealthily at ' + saber.stalkSpeed + ' m/s)');
  }

  execute(saber) {
    const player = saber.targetEntity;
    if (!player || player.isDead) {
      if (saber.potentialTargets && saber.potentialTargets.some(t => !t.isDead)) {
        saber.searchCenter.copy(saber.position);
        saber.stateMachine.changeTo(SABER_STATES.SEARCH);
      } else {
        saber.stateMachine.changeTo(SABER_STATES.PATROL);
      }
      return;
    }

    if (saber.canSeeTarget) {
      saber.stalkLostSightTimer = 0;
      saber.seekBehavior.target.copy(player.position);
      if (saber.targetDistance <= 10.0) {
        saber.stateMachine.changeTo(SABER_STATES.CHASE);
        return;
      }
    } else {
      // Grace buffer before giving up stalk
      saber.stalkLostSightTimer += saber.delta;
      if (saber.stalkLostSightTimer >= 2.0) {
        const record = saber.memorySystem.getRecord(player);
        if (record && record.timeLastSensed > 0) {
          saber.searchCenter.copy(record.lastSensedPosition);
          saber.stateMachine.changeTo(SABER_STATES.SEARCH);
        } else {
          saber.stateMachine.changeTo(SABER_STATES.PATROL);
        }
        return;
      }
    }
  }

  exit(saber) {
    saber.seekBehavior.active = false;
    saber.stalkLostSightTimer = 0;
  }
}

// -----------------------------------------------------------------------------
// 5. CHASE STATE
// -----------------------------------------------------------------------------
export class ChaseState extends YUKA.State {
  enter(saber) {
    saber.maxSpeed = saber.chaseSpeed; // RUNNING speed during pursuit
    saber.seekBehavior.active = true;
    if (saber.targetEntity) {
      saber.seekBehavior.target.copy(saber.targetEntity.position);
    }
    saber.followPathBehavior.active = false;
    saber.separationBehavior.active = true;
    saber.lostSightTimer = 0;
    saber.logState('Entered CHASE (RUNNING at ' + saber.chaseSpeed + ' m/s)');
  }

  execute(saber) {
    const player = saber.targetEntity;
    if (!player || player.isDead) {
      if (saber.potentialTargets && saber.potentialTargets.some(t => !t.isDead)) {
        saber.searchCenter.copy(saber.position);
        saber.stateMachine.changeTo(SABER_STATES.SEARCH);
      } else {
        saber.stateMachine.changeTo(SABER_STATES.PATROL);
      }
      return;
    }

    if (saber.canSeeTarget) {
      saber.lostSightTimer = 0;
      saber.seekBehavior.target.copy(player.position);

      // Melee attack range
      if (saber.targetDistance <= saber.attackRange) {
        saber.stateMachine.changeTo(SABER_STATES.ATTACK);
        return;
      }
    } else {
      // Line of sight lost! Pursue to last sensed position
      saber.lostSightTimer += saber.delta;
      const record = saber.memorySystem.getRecord(player);

      if (record && record.timeLastSensed > 0) {
        saber.seekBehavior.target.copy(record.lastSensedPosition);
        const distToLastSeen = saber.position.distanceTo(record.lastSensedPosition);

        // Require reaching last seen position AND spending a minimum lost-sight timer
        // before giving up chase. This prevents circling behind or doorway cuts from
        // causing instant drops to SEARCH.
        if ((distToLastSeen <= 1.2 && saber.lostSightTimer >= 2.0) || saber.lostSightTimer >= 5.0) {
          saber.searchCenter.copy(record.lastSensedPosition);
          saber.logState('Lost sight of player. Transitioning to SEARCH at last seen position.');
          saber.stateMachine.changeTo(SABER_STATES.SEARCH);
          return;
        }
      } else {
        if (saber.lostSightTimer >= 2.0) {
          saber.searchCenter.copy(saber.position);
          saber.stateMachine.changeTo(SABER_STATES.SEARCH);
          return;
        }
      }
    }
  }

  exit(saber) {
    saber.seekBehavior.active = false;
    saber.lostSightTimer = 0;
  }
}

// -----------------------------------------------------------------------------
// 6. ATTACK STATE
// -----------------------------------------------------------------------------
export class AttackState extends YUKA.State {
  enter(saber) {
    saber.velocity.set(0, 0, 0);
    saber.seekBehavior.active = false;
    saber.attackTimer = 0;
    saber.logState('Entered ATTACK (striking player for ' + saber.damage + ' damage)');

    // Execute initial attack strike
    if (saber.targetEntity && typeof saber.targetEntity.takeDamage === 'function') {
      saber.targetEntity.takeDamage(saber.damage);
    }
    if (typeof saber.onAttack === 'function') {
      saber.onAttack(saber.targetEntity, saber.damage);
    }
  }

  execute(saber) {
    saber.velocity.set(0, 0, 0);
    saber.attackTimer += saber.delta;
    const player = saber.targetEntity;

    if (!player || player.isDead) {
      if (saber.potentialTargets && saber.potentialTargets.some(t => !t.isDead)) {
        saber.searchCenter.copy(saber.position);
        saber.stateMachine.changeTo(SABER_STATES.SEARCH);
      } else {
        saber.stateMachine.changeTo(SABER_STATES.PATROL);
      }
      return;
    }

    // Keep facing the player while attacking
    saber.rotateTo(player.position, saber.delta);

    // After attack cooldown has elapsed, check if player is still in range
    if (saber.attackTimer >= saber.attackCooldown) {
      const dist = saber.position.distanceTo(player.position);
      if (dist <= saber.attackRange) {
        saber.attackTimer = 0;
        if (typeof player.takeDamage === 'function') {
          player.takeDamage(saber.damage);
        }
        if (typeof saber.onAttack === 'function') {
          saber.onAttack(player, saber.damage);
        }
      } else {
        saber.stateMachine.changeTo(SABER_STATES.CHASE);
        return;
      }
    }
  }

  exit(saber) {
    saber.attackTimer = 0;
  }
}

// -----------------------------------------------------------------------------
// 7. STAGGERED STATE
// -----------------------------------------------------------------------------
export class StaggeredState extends YUKA.State {
  enter(saber) {
    saber.velocity.set(0, 0, 0);
    saber.seekBehavior.active = false;
    saber.followPathBehavior.active = false;
    saber.separationBehavior.active = false;
    saber.staggerTimer = saber.staggerDuration;
    saber.isInvulnerable = true;
    saber.hasNewSoundAlert = false;
    saber.logState('Entered STAGGERED (incapacitated for ' + saber.staggerDuration + 's)');
  }

  execute(saber) {
    saber.velocity.set(0, 0, 0);
    saber.staggerTimer -= saber.delta;

    if (saber.staggerTimer <= 0) {
      saber.stateMachine.changeTo(SABER_STATES.RECOVER);
      return;
    }
  }

  exit(saber) {
    saber.staggerTimer = 0;
  }
}

// -----------------------------------------------------------------------------
// 8. RECOVER STATE
// -----------------------------------------------------------------------------
export class RecoverState extends YUKA.State {
  enter(saber) {
    saber.velocity.set(0, 0, 0);
    saber.recoveryTimer = saber.recoveryWindow;
    saber.health = saber.maxHealth;
    saber.isInvulnerable = true;
    saber.logState('Entered RECOVER (invulnerability window: ' + saber.recoveryWindow + 's, HP restored to ' + saber.health + ')');
  }

  execute(saber) {
    saber.velocity.set(0, 0, 0);
    saber.recoveryTimer -= saber.delta;

    if (saber.recoveryTimer <= 0) {
      saber.isInvulnerable = false;
      saber.logState('Recovery complete. Resuming hunting.');

      const player = saber.targetEntity;
      if (player && !player.isDead && saber.canSeeTarget) {
        saber.stateMachine.changeTo(SABER_STATES.CHASE);
      } else {
        saber.searchCenter.copy(saber.position);
        saber.stateMachine.changeTo(SABER_STATES.SEARCH);
      }
      return;
    }
  }

  exit(saber) {
    saber.isInvulnerable = false;
    saber.recoveryTimer = 0;
  }
}

// -----------------------------------------------------------------------------
// SABER AGENT VEHICLE
// -----------------------------------------------------------------------------
export class SaberAgent extends YUKA.Vehicle {
  constructor(name = 'Saber', options = {}) {
    super();
    this.name = name;
    this.isSaber = true;
    this.isPersistent = true;

    // Health & Combat (25 HP damage, 4 hits eliminate 100 HP player)
    this.health = options.health ?? 100;
    this.maxHealth = options.maxHealth ?? 100;
    this.damage = options.damage ?? 25;
    this.attackRange = options.attackRange ?? 1.8;
    this.attackCooldown = options.attackCooldown ?? 2.0; // 2.0s attack cooldown + escape opportunity
    this.attackTimer = 0;

    // Movement Speeds
    this.patrolSpeed = options.patrolSpeed ?? 1.8;
    this.searchSpeed = options.searchSpeed ?? 1.5;
    this.stalkSpeed = options.stalkSpeed ?? 2.2;
    this.chaseSpeed = options.chaseSpeed ?? 4.2; // RUNNING speed during pursuit
    this.maxSpeed = this.patrolSpeed;
    this.maxForce = options.maxForce ?? 150;
    this.mass = options.mass ?? 1.5;
    this.maxTurnRate = options.maxTurnRate ?? (Math.PI * 1.5); // Fast, responsive turning

    // Timers & Windows
    this.staggerDuration = options.staggerDuration ?? 10.0;
    this.staggerTimer = 0;
    this.recoveryWindow = options.recoveryWindow ?? 2.5;
    this.recoveryTimer = 0;
    this.isInvulnerable = false;

    this.searchDuration = options.searchDuration ?? 7.0;
    this.searchTimer = 0;
    this.searchIndex = 0;
    this.lostSightTimer = 0;
    this.stalkLostSightTimer = 0;

    this.currentTime = 0;
    this.delta = 0.016;

    // Perception & Memory
    this.vision = new SaberVision(this, {
      fieldOfView: options.visionFOV ?? (Math.PI * 0.61), // ~110 degrees
      range: options.visionRange ?? 22.0,
      eyeHeight: options.eyeHeight ?? 1.8,
      targetHeight: options.targetHeight ?? 1.4
    });

    this.memorySystem = new YUKA.MemorySystem(this);
    this.memorySystem.memorySpan = options.memorySpan ?? 6.0;

    // Sensory Evaluation Cache for Current Tick
    this.canSeeTarget = false;
    this.targetDistance = Infinity;
    this.targetAngleDeg = 0;
    this.lastVisionCheck = this.vision.lastCheck;

    // Sound alert state
    this.soundTarget = new YUKA.Vector3();
    this.hasNewSoundAlert = false;
    this.lastSoundStimulus = null;

    // Encounter Director Macro Guidance State
    this.hasDirectorHint = false;
    this.directorHintTarget = new YUKA.Vector3();
    this.directorHintSectorName = '';

    // Spatial Targets & Multi-Survivor Target Candidates
    this.searchCenter = new YUKA.Vector3();
    this.searchSubPoints = [];
    this.targetEntity = null;
    this.potentialTargets = [];
    this.targetAudits = {};

    // Steering Behaviors
    this.patrolPath = new YUKA.Path();
    this.patrolPath.loop = true;

    this.followPathBehavior = new YUKA.FollowPathBehavior(this.patrolPath, 1.5);
    this.followPathBehavior.active = false;
    this.steering.add(this.followPathBehavior);

    this.seekBehavior = new YUKA.SeekBehavior();
    this.seekBehavior.active = false;
    this.steering.add(this.seekBehavior);

    this.separationBehavior = new YUKA.SeparationBehavior();
    this.separationBehavior.active = true;
    this.steering.add(this.separationBehavior);

    this.logHistory = [];

    // Finite State Machine
    this.stateMachine = new YUKA.StateMachine(this);
    this.states = {
      PATROL: new PatrolState(),
      INVESTIGATE_SOUND: new InvestigateSoundState(),
      SEARCH: new SearchState(),
      STALK: new StalkState(),
      CHASE: new ChaseState(),
      ATTACK: new AttackState(),
      STAGGERED: new StaggeredState(),
      RECOVER: new RecoverState()
    };

    for (const [key, state] of Object.entries(this.states)) {
      this.stateMachine.add(key, state);
    }
    this.stateMachine.changeTo(SABER_STATES.PATROL);
  }

  setPotentialTargets(targets) {
    this.potentialTargets = Array.isArray(targets) ? targets.slice() : [targets];
    if (this.potentialTargets.length > 0 && (!this.targetEntity || this.targetEntity.isDead)) {
      this.targetEntity = this.potentialTargets.find(t => !t.isDead) || this.potentialTargets[0];
    }
  }

  setPatrolWaypoints(waypoints) {
    this.patrolPath.clear();
    for (const wp of waypoints) {
      this.patrolPath.add(new YUKA.Vector3().copy(wp));
    }
    this.patrolPath.loop = true;
  }

  generateSearchSubPoints(center) {
    this.searchSubPoints = [
      new YUKA.Vector3(center.x + 4.0, center.y, center.z + 1.5),
      new YUKA.Vector3(center.x - 3.5, center.y, center.z + 3.0),
      new YUKA.Vector3(center.x - 2.0, center.y, center.z - 4.0),
      new YUKA.Vector3(center.x + 3.0, center.y, center.z - 2.5)
    ];
  }

  logState(message) {
    const entry = '[' + this.name + ' | ' + this.getCurrentStateName() + '] ' + message;
    this.logHistory.unshift({ time: this.currentTime, entry });
    if (this.logHistory.length > 50) this.logHistory.pop();
  }

  getCurrentStateName() {
    for (const [name, state] of Object.entries(this.states)) {
      if (this.stateMachine.currentState === state) return name;
    }
    return 'UNKNOWN';
  }

  onHearSound(stimulus, evalResult) {
    // Staggered agents cannot process sound alerts
    if (this.stateMachine.currentState === this.states.STAGGERED) {
      return;
    }

    this.soundTarget.copy(evalResult.perceivedPosition);
    this.lastSoundStimulus = stimulus;
    this.hasNewSoundAlert = true;

    this.logState('Heard ' + stimulus.soundType + ' at ' + evalResult.distance.toFixed(1) + 'm');

    const curr = this.stateMachine.currentState;
    // Gunfire draws Sabers that are not already actively locked in combat or chase
    if (curr === this.states.PATROL || curr === this.states.SEARCH || curr === this.states.STALK) {
      // If we don't have direct line-of-sight visual lock, investigate sound
      if (!this.canSeeTarget) {
        this.hasNewSoundAlert = false;
        this.hasDirectorHint = false;
        this.stateMachine.changeTo(SABER_STATES.INVESTIGATE_SOUND);
      }
    }
  }

  /**
   * Receives a high-level sector guidance hint from the Encounter Director.
   * Macro hints only influence macro pathing when in ambient states (PATROL, SEARCH).
   * Director hints NEVER override active visual contact, melee combat, or gunshot responses.
   * @param {YUKA.Vector3} sectorTarget - Broad gateway or sector center
   * @param {string} sectorName - Human-readable sector identifier
   */
  onReceiveDirectorHint(sectorTarget, sectorName) {
    const curr = this.stateMachine.currentState;
    if (curr === this.states.PATROL) {
      this.directorHintTarget.copy(sectorTarget);
      this.directorHintSectorName = sectorName;
      this.hasDirectorHint = true;
      this.followPathBehavior.active = false;
      this.seekBehavior.active = true;
      this.seekBehavior.target.copy(sectorTarget);
      this.logState('Encounter Director nudged patrol route toward ' + sectorName);
    } else if (curr === this.states.SEARCH) {
      this.directorHintTarget.copy(sectorTarget);
      this.directorHintSectorName = sectorName;
      this.hasDirectorHint = true;
      this.searchCenter.copy(sectorTarget);
      this.generateSearchSubPoints(sectorTarget);
      this.logState('Encounter Director redirected search area toward ' + sectorName);
    }
  }

  takeDamage(amount) {
    if (this.isInvulnerable) {
      this.logState('Damage resisted (' + amount + ' damage ignored due to invulnerability)');
      return { damageDealt: 0, staggered: false, health: this.health };
    }

    this.health = Math.max(0, this.health - amount);
    this.logState('Took ' + amount + ' damage. Current HP: ' + this.health);

    if (this.health <= 0) {
      this.stateMachine.changeTo(SABER_STATES.STAGGERED);
      return { damageDealt: amount, staggered: true, health: 0 };
    }

    const curr = this.stateMachine.currentState;
    if (curr === this.states.PATROL || curr === this.states.SEARCH || curr === this.states.INVESTIGATE_SOUND) {
      if (this.targetEntity) {
        this.seekBehavior.target.copy(this.targetEntity.position);
        this.stateMachine.changeTo(SABER_STATES.CHASE);
      }
    }

    return { damageDealt: amount, staggered: false, health: this.health };
  }

  updateSensory(delta) {
    // 1. Gather all candidate targets to evaluate
    let candidates = [];
    if (this.potentialTargets && this.potentialTargets.length > 0) {
      candidates = this.potentialTargets;
    } else if (this.targetEntity) {
      candidates = [this.targetEntity];
    }

    if (candidates.length === 0) {
      this.canSeeTarget = false;
      this.targetDistance = Infinity;
      return;
    }

    // 2. Evaluate visibility and update short-term memory for every candidate
    const visibleCandidates = [];
    this.targetAudits = {};

    for (const candidate of candidates) {
      if (!this.memorySystem.hasRecord(candidate)) {
        this.memorySystem.createRecord(candidate);
      }
      const record = this.memorySystem.getRecord(candidate);

      // Dead / eliminated survivors are never active targets
      if (candidate.isDead) {
        record.visible = false;
        continue;
      }

      const check = this.vision.checkVisibilityDetailed(candidate.position);
      this.targetAudits[candidate.id || candidate.name] = check;

      if (check.visible) {
        record.timeLastSensed = this.currentTime;
        record.lastSensedPosition.copy(candidate.position);
        record.visible = true;
        visibleCandidates.push({ candidate, check, distance: check.distance });
      } else {
        record.visible = false;
      }
    }

    // 3. Autonomous Target Selection
    let chosenCandidate = null;
    let chosenCheck = null;

    const currState = this.stateMachine.currentState;
    const isPursuitState = (
      currState === this.states.CHASE ||
      currState === this.states.ATTACK ||
      currState === this.states.STALK
    );

    if (visibleCandidates.length > 0) {
      // Sort visible survivors by Euclidean distance
      visibleCandidates.sort((a, b) => a.distance - b.distance);

      if (isPursuitState && this.targetEntity && !this.targetEntity.isDead) {
        const currentTargetVis = visibleCandidates.find(v => v.candidate === this.targetEntity);
        if (currentTargetVis) {
          // If current target is still visible, maintain pursuit lock unless another survivor is in point-blank melee (< 2.0m)
          const closest = visibleCandidates[0];
          if (closest.candidate !== this.targetEntity && closest.distance <= 2.0 && currentTargetVis.distance > 5.0) {
            chosenCandidate = closest.candidate;
            chosenCheck = closest.check;
            this.logState(`Switched target from ${this.targetEntity.name} to point-blank ${chosenCandidate.name} (${closest.distance.toFixed(1)}m)`);
          } else {
            chosenCandidate = this.targetEntity;
            chosenCheck = currentTargetVis.check;
          }
        } else {
          // Current target broke LoS, but another survivor is visible! Switch target immediately
          chosenCandidate = visibleCandidates[0].candidate;
          chosenCheck = visibleCandidates[0].check;
          this.logState(`Lost sight of ${this.targetEntity.name}, acquired visible ${chosenCandidate.name} (${chosenCheck.distance.toFixed(1)}m)`);
        }
      } else {
        // Not in pursuit or no current target: lock onto closest visible survivor
        chosenCandidate = visibleCandidates[0].candidate;
        chosenCheck = visibleCandidates[0].check;
      }
    } else {
      // No survivors currently visible: evaluate short-term memory
      if (this.targetEntity && !this.targetEntity.isDead && this.memorySystem.hasRecord(this.targetEntity)) {
        const rec = this.memorySystem.getRecord(this.targetEntity);
        if ((this.currentTime - rec.timeLastSensed) <= this.memorySystem.memorySpan) {
          chosenCandidate = this.targetEntity;
        }
      }

      // If no valid memory for current target, check other candidates for recent memory
      if (!chosenCandidate) {
        let bestRecordTime = -Infinity;
        for (const candidate of candidates) {
          if (candidate.isDead) continue;
          const rec = this.memorySystem.getRecord(candidate);
          if (rec && (this.currentTime - rec.timeLastSensed) <= this.memorySystem.memorySpan) {
            if (rec.timeLastSensed > bestRecordTime) {
              bestRecordTime = rec.timeLastSensed;
              chosenCandidate = candidate;
            }
          }
        }
      }

      if (!chosenCandidate) {
        // Default to first alive candidate
        chosenCandidate = candidates.find(c => !c.isDead) || this.targetEntity || candidates[0];
      }

      chosenCheck = (chosenCandidate && this.targetAudits[chosenCandidate.id || chosenCandidate.name])
        || (chosenCandidate ? this.vision.checkVisibilityDetailed(chosenCandidate.position) : null);
    }

    this.targetEntity = chosenCandidate;
    if (chosenCheck) {
      this.lastVisionCheck = chosenCheck;
      this.canSeeTarget = chosenCheck.visible;
      this.targetDistance = chosenCheck.distance;
      this.targetAngleDeg = chosenCheck.angleDeg;
    } else {
      this.canSeeTarget = false;
      this.targetDistance = Infinity;
    }
  }

  update(delta) {
    this.delta = delta;
    this.currentTime += delta;

    // 1. Perform sensory evaluation with current orientation and position
    this.updateSensory(delta);

    // 2. Update finite state machine logic (handles sensory triggers & state transitions)
    this.stateMachine.update();

    // 3. Advance vehicle locomotion (steering, displacement, velocity)
    const isStationaryState = (
      this.stateMachine.currentState === this.states.STAGGERED ||
      this.stateMachine.currentState === this.states.RECOVER ||
      this.stateMachine.currentState === this.states.ATTACK
    );

    if (!isStationaryState) {
      super.update(delta);
    } else {
      // In stationary states, stop all linear momentum
      this.velocity.set(0, 0, 0);
    }

    return this;
  }
}
