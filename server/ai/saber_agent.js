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
    this.fieldOfView = options.fieldOfView ?? Math.PI; // ~180 degrees horizontal FOV
    this.range = options.range ?? 500.0; // Unlimited range across Level 0, bounded only by walls

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
        // Reached hint area -> initiate focused local search
        saber.hasDirectorHint = false;
        saber.searchCenter.copy(saber.directorHintTarget);
        saber.generateSearchSubPoints(saber.directorHintTarget);
        saber.logState('Reached Director hint area. Initiating focused SEARCH.');
        saber.stateMachine.changeTo(SABER_STATES.SEARCH);
        return;
      } else {
        // Continuously navigate toward hint target around geometry
        saber.navigateTo(saber.directorHintTarget, saber.delta);
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
    saber.maxSpeed = saber.investigateSpeed;
    saber.seekBehavior.active = true;
    saber.seekBehavior.target.copy(saber.soundTarget);
    saber.followPathBehavior.active = false;
    saber.separationBehavior.active = true;
    saber.currentNavPath = [];
    saber.navPathIndex = 0;
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
      saber.currentNavPath = [];
      saber.navPathIndex = 0;
      saber.logState('Updated sound target to (' +
        saber.soundTarget.x.toFixed(1) + ', ' + saber.soundTarget.z.toFixed(1) + ')');
    }

    // 3. Navigate toward sound coordinates around walls
    saber.navigateTo(saber.soundTarget, saber.delta);

    // 4. Check arrival at sound coordinates
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
    saber.currentNavPath = [];
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
      }
      saber.navigateTo(saber.searchSubPoints[saber.searchIndex], saber.delta);
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
    saber.currentNavPath = [];
    saber.navPathIndex = 0;
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
      saber.navigateTo(player.position, saber.delta);
      if (saber.targetDistance <= 10.0) {
        saber.stateMachine.changeTo(SABER_STATES.CHASE);
        return;
      }
    } else {
      // Grace buffer before giving up stalk: continue navigating to last sensed position
      saber.stalkLostSightTimer += saber.delta;
      const record = saber.memorySystem.getRecord(player);
      if (record && record.timeLastSensed > 0) {
        saber.navigateTo(record.lastSensedPosition, saber.delta);
      }
      if (saber.stalkLostSightTimer >= 3.0) {
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
    saber.currentNavPath = [];
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
    saber.currentNavPath = [];
    saber.navPathIndex = 0;
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
      saber.navigateTo(player.position, saber.delta);

      const distToPlayer = saber.position.distanceTo(player.position);
      const contactDist = saber.getContactDistance ? saber.getContactDistance(player) : 0.64;
      const attackThreshold = (saber.difficulty === 'HARD') ? saber.attackRange : contactDist;

      // Melee attack range:
      // In NORMAL mode: strikes ONLY when physically touching player (distance <= 0.64m) AND attack cooldown expired
      // In HARD mode: uses attack range (1.8m) AND attack cooldown expired
      if (distToPlayer <= attackThreshold && saber.attackCooldownTimer <= 0) {
        saber.stateMachine.changeTo(SABER_STATES.ATTACK);
        return;
      }
    } else {
      // Line of sight lost! Pursue to last sensed position
      saber.lostSightTimer += saber.delta;
      const record = saber.memorySystem.getRecord(player);

      if (record && record.timeLastSensed > 0) {
        saber.navigateTo(record.lastSensedPosition, saber.delta);
        const distToLastSeen = saber.position.distanceTo(record.lastSensedPosition);

        // Require reaching last seen position AND spending a minimum lost-sight timer
        // before giving up chase. This prevents circling behind or doorway cuts from
        // causing instant drops to SEARCH.
        if ((distToLastSeen <= 1.2 && saber.lostSightTimer >= 2.0) || saber.lostSightTimer >= 6.0) {
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
    saber.currentNavPath = [];
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

    const player = saber.targetEntity;
    if (!player) return;

    // Reject attack initiation if cooldown is currently active
    if (saber.attackCooldownTimer > 0) {
      saber.logState(`Attack entry rejected: cooldown active (${saber.attackCooldownTimer.toFixed(2)}s remaining)`);
      saber.attackPending = false;
      saber.attackPhase = 'IDLE';
      saber.stateMachine.changeTo(SABER_STATES.CHASE);
      return;
    }

    const dist = saber.position.distanceTo(player.position);
    const contactDist = saber.getContactDistance ? saber.getContactDistance(player) : 0.64;
    const inRange = (saber.difficulty === 'HARD') ? (dist <= saber.attackRange) : (dist <= contactDist + 0.001);

    if (!inRange) {
      saber.logState(`Attack aborted: target out of physical contact range (${dist.toFixed(2)}m > ${contactDist.toFixed(2)}m)`);
      saber.attackPending = false;
      saber.attackPhase = 'IDLE';
      saber.stateMachine.changeTo(SABER_STATES.CHASE);
      return;
    }

    // In HARD difficulty or 0-windup mode: strike immediately (preserves lethal behavior)
    if (saber.difficulty === 'HARD' || saber.attackWindup <= 0) {
      saber.logState('Entered ATTACK (striking player for ' + saber.damage + ' damage)');
      saber.attackPending = false;
      saber.attackPhase = 'COOLDOWN';
      saber.attackCooldownTimer = saber.attackCooldown;
      saber.attackTimer = 0;

      if (typeof player.takeDamage === 'function') {
        player.takeDamage(saber.damage);
      }
      if (typeof saber.onAttack === 'function') {
        saber.onAttack(player, saber.damage);
      }
    } else {
      // In NORMAL difficulty: initiate windup; damage is strictly applied ONLY when windup completes
      // and player is STILL in physical contact at that exact moment.
      saber.logState(`Entered ATTACK (winding up strike for ${saber.attackWindup}s)`);
      saber.attackPhase = 'WINDUP';
      saber.attackTimer = 0;
      saber.attackPending = true;
    }
  }

  execute(saber) {
    saber.velocity.set(0, 0, 0);
    const player = saber.targetEntity;

    if (!player || player.isDead) {
      saber.attackPending = false;
      saber.attackPhase = 'IDLE';
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

    // If execute is run independently without saber.update(delta), tick cooldown
    if (!saber._tickedCooldownInUpdate && saber.attackCooldownTimer > 0) {
      saber.attackCooldownTimer = Math.max(0, saber.attackCooldownTimer - saber.delta);
    }
    saber.attackTimer += saber.delta;

    // Contact detection on EVERY tick
    const dist = saber.position.distanceTo(player.position);
    const contactDist = saber.getContactDistance ? saber.getContactDistance(player) : 0.64;
    const inRange = (saber.difficulty === 'HARD') ? (dist <= saber.attackRange) : (dist <= contactDist + 0.001);

    // 1. WINDUP PHASE
    if (saber.attackPhase === 'WINDUP') {
      // If player moves out of physical contact range during windup: CANCEL ATTACK IMMEDIATELY!
      if (!inRange) {
        saber.logState(`Attack cancelled: player escaped contact during windup (${dist.toFixed(2)}m > ${contactDist.toFixed(2)}m)`);
        saber.attackPending = false;
        saber.attackPhase = 'IDLE';
        saber.attackTimer = 0;
        saber.stateMachine.changeTo(SABER_STATES.CHASE);
        return;
      }

      // Windup duration reached -> validate physical contact at exact moment of damage
      if (saber.attackTimer >= saber.attackWindup) {
        if (inRange) {
          saber.logState(`Attack strike connected for ${saber.damage} damage`);
          saber.attackPending = false;
          saber.attackPhase = 'COOLDOWN';
          saber.attackCooldownTimer = saber.attackCooldown;
          saber.attackTimer = 0;

          if (typeof player.takeDamage === 'function') {
            player.takeDamage(saber.damage);
          }
          if (typeof saber.onAttack === 'function') {
            saber.onAttack(player, saber.damage);
          }
        } else {
          saber.logState(`Attack missed: player out of range at strike moment (${dist.toFixed(2)}m > ${contactDist.toFixed(2)}m)`);
          saber.attackPending = false;
          saber.attackPhase = 'IDLE';
          saber.attackTimer = 0;
          saber.stateMachine.changeTo(SABER_STATES.CHASE);
          return;
        }
      }
      return;
    }

    // 2. COOLDOWN PHASE
    if (saber.attackPhase === 'COOLDOWN') {
      // If player has moved out of physical contact range: transition back to CHASE immediately!
      // Do NOT remain frozen in ATTACK facing empty air while player runs away.
      if (!inRange) {
        saber.logState(`Player left contact range during cooldown (${dist.toFixed(2)}m > ${contactDist.toFixed(2)}m). Transitioning to CHASE.`);
        saber.attackPhase = 'IDLE';
        saber.attackTimer = 0;
        saber.stateMachine.changeTo(SABER_STATES.CHASE);
        return;
      }

      // Continuous contact: player remains within physical contact range.
      // Must respect 2-second cooldown before another strike can occur.
      if (saber.attackCooldownTimer <= 0) {
        if (saber.attackWindup <= 0) {
          saber.attackCooldownTimer = saber.attackCooldown;
          saber.attackTimer = 0;
          if (typeof player.takeDamage === 'function') {
            player.takeDamage(saber.damage);
          }
          if (typeof saber.onAttack === 'function') {
            saber.onAttack(player, saber.damage);
          }
        } else {
          saber.attackPhase = 'WINDUP';
          saber.attackTimer = 0;
          saber.attackPending = true;
          saber.logState(`Continuous contact: initiating next strike (windup ${saber.attackWindup}s)`);
        }
      }
      return;
    }
  }

  exit(saber) {
    saber.attackTimer = 0;
    saber.attackPending = false;
    if (saber.attackPhase === 'WINDUP') {
      saber.attackPhase = 'IDLE';
    }
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
    this.neighbors = this.neighbors || [];
    this.isMutuallyObstructed = false;

    // Difficulty Setting: 'NORMAL' (default) vs 'HARD'
    this.difficulty = (options.difficulty && options.difficulty.toUpperCase() === 'HARD') ? 'HARD' : 'NORMAL';

    // Collision & Environmental Navigation (0.32m radius matching player)
    this.collisionRadius = options.collisionRadius ?? 0.32;
    this.boundingRadius = this.collisionRadius;
    this.env = options.env || null;

    // Health & Combat
    // NORMAL mode: 15 HP per strike, physical contact (<= 0.64m) required
    // HARD mode: 100 HP lethal damage, 1.8m attack range
    this.health = options.health ?? 100;
    this.maxHealth = options.maxHealth ?? 100;
    if (options.damage !== undefined) {
      this.damage = options.damage;
    } else {
      this.damage = (this.difficulty === 'HARD') ? 100 : 15;
    }

    if (options.attackRange !== undefined) {
      this.attackRange = options.attackRange;
    } else {
      this.attackRange = (this.difficulty === 'HARD') ? 1.8 : (this.collisionRadius * 2); // 0.64m
    }
    this.attackCooldown = options.attackCooldown ?? 2.0; // 2.0s attack cooldown + escape opportunity
    this.attackWindup = (this.difficulty === 'HARD') ? 0 : (options.attackWindup ?? 0.3);
    this.attackCooldownTimer = 0;
    this.attackTimer = 0;
    this.attackPending = false;
    this.attackPhase = 'IDLE'; // 'IDLE' | 'WINDUP' | 'COOLDOWN'
    this._tickedCooldownInUpdate = false;

    // Movement Speeds (Overhauled relative to player walk 5.2 and sprint 7.6)
    this.patrolSpeed = options.patrolSpeed ?? 2.5;
    this.searchSpeed = options.searchSpeed ?? 2.5;
    this.investigateSpeed = options.investigateSpeed ?? 5.72; // ~1.1x player walk speed
    this.stalkSpeed = options.stalkSpeed ?? 7.6; // Equal to player sprint speed
    this.chaseSpeed = options.chaseSpeed ?? 9.5; // 1.25x player max sprint speed (7.6 * 1.25)
    this.maxSpeed = this.patrolSpeed;
    this.maxForce = options.maxForce ?? 150;
    this.mass = options.mass ?? 1.5;
    this.maxTurnRate = options.maxTurnRate ?? (Math.PI * 1.5); // Fast, responsive turning

    // Dijkstra Navigation Path state
    this.currentNavPath = [];
    this.navPathIndex = 0;
    this.navTargetPos = new YUKA.Vector3();
    this.lastNavCalcTime = -999;

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
      fieldOfView: options.visionFOV ?? Math.PI, // 180 degrees horizontal FOV
      range: options.visionRange ?? 500.0, // Unlimited range across Level 0, bounded only by walls
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

    // Encounter Director Macro Guidance State & Explainability
    this.hasDirectorHint = false;
    this.directorHintTarget = new YUKA.Vector3();
    this.directorHintSectorName = '';
    this.directorHintDistance = 7.5;
    this.directorHintState = {
      lastReceivedTime: null,
      hintPosition: null,       // { x, z }
      offsetDistance: 0,
      accepted: false,
      reason: 'NONE',
      estimatedTargetPosition: null, // { x, z }
      targetPlayerName: 'None'
    };

    // Movement Diagnostics, Stuck Detection & Progress Tracking
    this.actualSpeed = 0;
    this.desiredSpeed = this.patrolSpeed;
    this.stuckTimer = 0;
    this.timeSpentStuck = 0;
    this.pathRecalculationCount = 0;
    this.slowdownReason = 'NONE_AT_SPEED';

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

  getContactDistance(target = null) {
    const t = target || this.targetEntity;
    const targetRadius = (t && typeof t.collisionRadius === 'number')
      ? t.collisionRadius
      : ((t && typeof t.boundingRadius === 'number' && t.boundingRadius > 0)
        ? t.boundingRadius
        : 0.32);
    return (this.collisionRadius || 0.32) + targetRadius; // 0.32 + 0.32 = 0.64m
  }

  setDifficulty(difficulty) {
    const diff = (typeof difficulty === 'string' && difficulty.toUpperCase() === 'HARD') ? 'HARD' : 'NORMAL';
    this.difficulty = diff;
    if (diff === 'HARD') {
      this.damage = 100;
      this.attackRange = 1.8;
      this.attackWindup = 0;
    } else {
      this.damage = 15;
      this.attackRange = this.getContactDistance();
      this.attackWindup = 0.3;
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
   * Receives an independent approximate intuition hint from the Encounter Director.
   * Macro hints only influence ambient states (PATROL, SEARCH).
   * Intuition hints NEVER override active visual contact, melee combat, or gunshot responses.
   * @param {YUKA.Vector3} hintTarget - Approximate location with randomized 5-10m offset
   * @param {number} [offsetDistance=7.5] - Positional offset radius
   * @param {YUKA.Vector3} [estimatedPlayerPos=null] - Approximate estimated player position
   * @param {string} [targetPlayerName='Survivor'] - Name of hinted survivor
   */
  onReceiveIntuitionHint(hintTarget, offsetDistance = 7.5, estimatedPlayerPos = null, targetPlayerName = 'Survivor') {
    const curr = this.stateMachine.currentState;
    const hintPosObj = { x: +hintTarget.x.toFixed(2), z: +hintTarget.z.toFixed(2) };
    const estPosObj = estimatedPlayerPos ? { x: +estimatedPlayerPos.x.toFixed(2), z: +estimatedPlayerPos.z.toFixed(2) } : null;

    let accepted = false;
    let reason = 'NONE';

    if (curr === this.states.STAGGERED || curr === this.states.RECOVER) {
      accepted = false;
      reason = 'REJECTED_INCAPACITATED';
    } else if (curr === this.states.CHASE || curr === this.states.ATTACK) {
      accepted = false;
      reason = 'IGNORED_ACTIVE_COMBAT';
    } else if (curr === this.states.STALK && this.canSeeTarget) {
      accepted = false;
      reason = 'IGNORED_HAS_DIRECT_LOS';
    } else if (curr === this.states.INVESTIGATE_SOUND) {
      const soundAge = this.lastSoundStimulus ? (this.currentTime - this.lastSoundStimulus.timestamp) : 999;
      const soundDist = this.position.distanceTo(this.soundTarget);
      const hintDist = this.position.distanceTo(hintTarget);
      if (soundAge < 3.0 && soundDist < hintDist) {
        accepted = false;
        reason = 'IGNORED_PRIORITY_GUNSHOT';
      } else {
        accepted = true;
        reason = 'REPLACED_STALE_SOUND';
      }
    } else if (curr === this.states.PATROL) {
      accepted = true;
      reason = 'ACCEPTED_PATROL';
    } else if (curr === this.states.SEARCH) {
      accepted = true;
      reason = 'ACCEPTED_SEARCH';
    } else {
      accepted = true;
      reason = 'ACCEPTED_AMBIENT';
    }

    this.directorHintState = {
      lastReceivedTime: +this.currentTime.toFixed(1),
      hintPosition: hintPosObj,
      offsetDistance: +offsetDistance.toFixed(1),
      accepted,
      reason,
      estimatedTargetPosition: estPosObj,
      targetPlayerName
    };

    if (accepted) {
      this.directorHintTarget.copy(hintTarget);
      this.directorHintDistance = offsetDistance;
      this.hasDirectorHint = true;

      if (curr === this.states.PATROL || curr === this.states.INVESTIGATE_SOUND) {
        this.followPathBehavior.active = false;
        this.seekBehavior.active = true;
        this.navigateTo(hintTarget, this.delta);
        this.logState(`Accepted Encounter Director hint for ${targetPlayerName} (${reason}, ~${offsetDistance.toFixed(1)}m offset)`);
      } else if (curr === this.states.SEARCH) {
        this.searchCenter.copy(hintTarget);
        this.generateSearchSubPoints(hintTarget);
        this.navigateTo(hintTarget, this.delta);
        this.logState(`Redirected SEARCH to Encounter Director hint for ${targetPlayerName} (${reason}, ~${offsetDistance.toFixed(1)}m offset)`);
      }
    } else {
      this.logState(`Ignored Encounter Director hint for ${targetPlayerName} (${reason})`);
    }
  }

  getInvestigationDestination() {
    const curr = this.stateMachine.currentState;
    if (this.hasDirectorHint) {
      return this.directorHintTarget;
    }
    if (curr === this.states.INVESTIGATE_SOUND) {
      return this.soundTarget;
    }
    if (curr === this.states.SEARCH) {
      return (this.searchSubPoints && this.searchSubPoints[this.searchIndex]) || this.searchCenter;
    }
    if (curr === this.states.CHASE || curr === this.states.STALK) {
      if (this.targetEntity && !this.targetEntity.isDead) {
        return this.targetEntity.position;
      }
    }
    if (curr === this.states.PATROL) {
      if (this.currentNavPath && this.currentNavPath.length > 0) {
        return this.currentNavPath[this.currentNavPath.length - 1];
      }
      return this.patrolPath.current() || null;
    }
    return null;
  }

  getPathRemainingDistance() {
    if (!this.currentNavPath || this.currentNavPath.length === 0) return 0;
    let dist = 0;
    const startIdx = Math.min(this.navPathIndex, this.currentNavPath.length - 1);
    let prev = this.position;
    for (let i = startIdx; i < this.currentNavPath.length; i++) {
      const wp = this.currentNavPath[i];
      dist += Math.hypot(wp.x - prev.x, wp.z - prev.z);
      prev = wp;
    }
    return dist;
  }

  /**
   * Backwards-compatible sector guidance hint wrapper.
   */
  onReceiveDirectorHint(sectorTarget, sectorName = 'Sector') {
    this.directorHintSectorName = sectorName;
    return this.onReceiveIntuitionHint(sectorTarget, 7.5);
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

  /**
   * Evaluates if a neighbor Saber obstructs the direct line segment to targetPos.
   * @param {YUKA.Vector3} targetPos
   * @returns {Object|null}
   */
  isDirectPathBlockedByNeighbor(targetPos) {
    if (!this.neighbors || this.neighbors.length === 0) return null;
    const ax = this.position.x, az = this.position.z;
    const bx = targetPos.x, bz = targetPos.z;
    const abx = bx - ax, abz = bz - az;
    const abLen = Math.hypot(abx, abz);
    if (abLen < 0.6) return null;

    for (const neighbor of this.neighbors) {
      if (!neighbor || neighbor.isDead) continue;
      const cx = neighbor.position.x, cz = neighbor.position.z;
      const acx = cx - ax, acz = cz - az;
      const t = (acx * abx + acz * abz) / (abLen * abLen);
      if (t > 0.05 && t < 0.95) {
        const projX = ax + abx * t;
        const projZ = az + abz * t;
        const perpDist = Math.hypot(cx - projX, cz - projZ);
        const clearanceNeeded = this.collisionRadius * 2 + 0.35; // ~0.99m
        if (perpDist < clearanceNeeded) {
          return { neighbor, perpDist, t, projX, projZ };
        }
      }
    }
    return null;
  }

  /**
   * Intelligently steers toward targetPos, using direct line-of-sight when unobstructed,
   * or Dijkstra pathfinding around walls/pillars with string-pulling lookahead when line of sight is broken.
   */
  navigateTo(targetPos, delta) {
    if (!this.env) {
      this.seekBehavior.active = true;
      this.seekBehavior.target.copy(targetPos);
      return;
    }

    // Dynamic obstacle avoidance: route laterally around blocking neighbor Saber
    const neighborBlock = this.isDirectPathBlockedByNeighbor(targetPos);
    if (neighborBlock) {
      const neighbor = neighborBlock.neighbor;
      const dx = neighbor.position.x - this.position.x;
      const dz = neighbor.position.z - this.position.z;
      const dist = Math.hypot(dx, dz) || 0.001;

      // Perpendicular vectors
      const rightX = dz / dist, rightZ = -dx / dist;
      const leftX = -dz / dist, leftZ = dx / dist;

      // Right-hand rule by default; fall back to left if right hits a wall
      const clearanceOffset = this.collisionRadius * 2 + 0.20; // 0.84m
      let chosenX = rightX, chosenZ = rightZ;

      if (this.env && typeof this.env.circleHitsWall === 'function') {
        const rightHit = this.env.circleHitsWall(neighbor.position.x + rightX * clearanceOffset, neighbor.position.z + rightZ * clearanceOffset, this.collisionRadius);
        const leftHit = this.env.circleHitsWall(neighbor.position.x + leftX * clearanceOffset, neighbor.position.z + leftZ * clearanceOffset, this.collisionRadius);
        if (rightHit && !leftHit) {
          chosenX = leftX;
          chosenZ = leftZ;
        }
      }

      this.seekBehavior.active = true;
      this.seekBehavior.target.set(
        neighbor.position.x + chosenX * clearanceOffset,
        0,
        neighbor.position.z + chosenZ * clearanceOffset
      );
      this.currentNavPath = [];
      this.navPathIndex = 0;
      return;
    }

    // Direct line-of-sight optimization: skip Dijkstra (0ms overhead)
    if (this.env.hasLineOfSight(this.position, targetPos)) {
      this.seekBehavior.active = true;
      this.seekBehavior.target.copy(targetPos);
      this.currentNavPath = [];
      this.navPathIndex = 0;
      return;
    }

    // Line of sight obstructed: check if cached Dijkstra path is still valid
    const targetMoved = this.navTargetPos.distanceTo(targetPos) > 3.0;
    const timeToRecalc = (this.currentTime - this.lastNavCalcTime) > 1.0;
    const hasActivePath = Array.isArray(this.currentNavPath) && this.currentNavPath.length > 0 && this.navPathIndex < this.currentNavPath.length;
    const needNewPath = !hasActivePath || targetMoved || (timeToRecalc && this.navPathIndex >= this.currentNavPath.length - 1);

    if (needNewPath) {
      if (typeof this.env.findPath === 'function') {
        const path = this.env.findPath(this.position, targetPos);
        if (path && path.length > 0) {
          this.currentNavPath = path;
          this.navPathIndex = 0;
          this.navTargetPos.copy(targetPos);
          this.lastNavCalcTime = this.currentTime;
        }
      }
    }

    if (this.currentNavPath && this.currentNavPath.length > 0) {
      // String-pulling lookahead: advance navPathIndex directly to furthest waypoint with clear line-of-sight
      let furthestVisibleIdx = this.navPathIndex;
      for (let i = this.currentNavPath.length - 1; i > this.navPathIndex; i--) {
        const wp = this.currentNavPath[i];
        if (this.env.hasLineOfSight(this.position, wp)) {
          furthestVisibleIdx = i;
          break;
        }
      }
      this.navPathIndex = furthestVisibleIdx;

      // Advance past completed waypoints
      while (this.navPathIndex < this.currentNavPath.length - 1) {
        const wp = this.currentNavPath[this.navPathIndex];
        const distToWp = Math.hypot(this.position.x - wp.x, this.position.z - wp.z);
        if (distToWp <= 1.2) {
          this.navPathIndex++;
        } else {
          break;
        }
      }
      const targetWp = this.currentNavPath[this.navPathIndex];
      this.seekBehavior.active = true;
      this.seekBehavior.target.copy(targetWp);
    } else {
      this.seekBehavior.active = true;
      this.seekBehavior.target.copy(targetPos);
    }
  }

  /**
   * Applies predictive lateral steering when another Saber is in front of our travel path.
   * Uses right-hand rule with wall clearance checks to ensure smooth passing.
   */
  applyDynamicAvoidance(delta) {
    if (!this.neighbors || this.neighbors.length === 0) return;
    for (const neighbor of this.neighbors) {
      if (!neighbor || neighbor.isDead) continue;
      const dx = neighbor.position.x - this.position.x;
      const dz = neighbor.position.z - this.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 3.0 && dist > 0.001) {
        const spd = Math.hypot(this.velocity.x, this.velocity.z);
        let fx = 1, fz = 0;
        if (spd > 0.1) {
          fx = this.velocity.x / spd;
          fz = this.velocity.z / spd;
        } else if (this.seekBehavior.active) {
          const sx = this.seekBehavior.target.x - this.position.x;
          const sz = this.seekBehavior.target.z - this.position.z;
          const sLen = Math.hypot(sx, sz) || 1;
          fx = sx / sLen;
          fz = sz / sLen;
        }

        const dot = fx * (dx / dist) + fz * (dz / dist);
        // Only steer away if neighbor is in front of our travel vector
        if (dot > 0.05) {
          const rightX = fz;
          const rightZ = -fx;
          const leftX = -fz;
          const leftZ = fx;

          let steerX = rightX, steerZ = rightZ;
          if (this.env && typeof this.env.circleHitsWall === 'function') {
            const probeDist = 0.4;
            const rightHit = this.env.circleHitsWall(this.position.x + rightX * probeDist, this.position.z + rightZ * probeDist, this.collisionRadius);
            const leftHit = this.env.circleHitsWall(this.position.x + leftX * probeDist, this.position.z + leftZ * probeDist, this.collisionRadius);
            if (rightHit && !leftHit) {
              steerX = leftX;
              steerZ = leftZ;
            }
          }

          const factor = (3.0 - dist) / 3.0;
          const strength = 35.0;
          this.velocity.x += steerX * strength * factor * delta;
          this.velocity.z += steerZ * strength * factor * delta;
        }
      }
    }
  }

  /**
   * Enforces physical circle-circle collision resolution between Sabers.
   * Prevents overlap (minDist = 2 * collisionRadius = 0.64m) and applies tangential sliding.
   */
  resolveNeighborCollisions(delta) {
    if (!this.neighbors || this.neighbors.length === 0) return;
    const minDist = this.collisionRadius * 2; // 0.64m

    for (const neighbor of this.neighbors) {
      if (!neighbor || neighbor.isDead) continue;
      const dx = this.position.x - neighbor.position.x;
      const dz = this.position.z - neighbor.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < minDist) {
        const overlap = minDist - dist;
        let nx = 0, nz = 0;
        if (dist > 0.0001) {
          nx = dx / dist;
          nz = dz / dist;
        } else {
          nx = (this.name < neighbor.name) ? 1 : -1;
          nz = 0;
        }

        const isNeighborStationary = (
          neighbor.stateMachine &&
          (neighbor.stateMachine.currentState === neighbor.states.STAGGERED ||
           neighbor.stateMachine.currentState === neighbor.states.RECOVER ||
           neighbor.stateMachine.currentState === neighbor.states.ATTACK)
        );

        const isSelfStationary = (
          this.stateMachine &&
          (this.stateMachine.currentState === this.states.STAGGERED ||
           this.stateMachine.currentState === this.states.RECOVER ||
           this.stateMachine.currentState === this.states.ATTACK)
        );

        let selfShare = 0.5;
        let neighborShare = 0.5;
        if (isNeighborStationary && !isSelfStationary) {
          selfShare = 1.0;
          neighborShare = 0.0;
        } else if (isSelfStationary && !isNeighborStationary) {
          selfShare = 0.0;
          neighborShare = 1.0;
        }

        const pushAmount = overlap + 0.004;
        const selfPushX = nx * (pushAmount * selfShare);
        const selfPushZ = nz * (pushAmount * selfShare);
        const nbPushX = -nx * (pushAmount * neighborShare);
        const nbPushZ = -nz * (pushAmount * neighborShare);

        if (selfShare > 0) {
          if (this.env && typeof this.env.circleHitsWall === 'function') {
            if (!this.env.circleHitsWall(this.position.x + selfPushX, this.position.z, this.collisionRadius)) {
              this.position.x += selfPushX;
            }
            if (!this.env.circleHitsWall(this.position.x, this.position.z + selfPushZ, this.collisionRadius)) {
              this.position.z += selfPushZ;
            }
          } else {
            this.position.x += selfPushX;
            this.position.z += selfPushZ;
          }
        }

        if (neighborShare > 0) {
          if (this.env && typeof this.env.circleHitsWall === 'function') {
            if (!this.env.circleHitsWall(neighbor.position.x + nbPushX, neighbor.position.z, neighbor.collisionRadius)) {
              neighbor.position.x += nbPushX;
            }
            if (!this.env.circleHitsWall(neighbor.position.x, neighbor.position.z + nbPushZ, neighbor.collisionRadius)) {
              neighbor.position.z += nbPushZ;
            }
          } else {
            neighbor.position.x += nbPushX;
            neighbor.position.z += nbPushZ;
          }
        }

        // Tangential impulse along tangent vector (-nz, nx) to convert head-on contact into mutual slide
        const tangentX = -nz;
        const tangentZ = nx;
        if (!isSelfStationary) {
          this.velocity.x += tangentX * 2.0;
          this.velocity.z += tangentZ * 2.0;
        }
        if (!isNeighborStationary) {
          neighbor.velocity.x -= tangentX * 2.0;
          neighbor.velocity.z -= tangentZ * 2.0;
        }
      }
    }
  }

  handleStuckRecovery(delta) {
    this.pathRecalculationCount = (this.pathRecalculationCount || 0) + 1;

    let nearNeighbor = null;
    if (this.neighbors && this.neighbors.length > 0) {
      for (const nb of this.neighbors) {
        if (nb && !nb.isDead && this.position.distanceTo(nb.position) <= 1.2) {
          nearNeighbor = nb;
          break;
        }
      }
    }

    if (nearNeighbor) {
      this.slowdownReason = 'STUCK_MUTUAL_SABER';
      this.isMutuallyObstructed = true;
      this.logState(`Mutually obstructed by ${nearNeighbor.name} (${this.position.distanceTo(nearNeighbor.position).toFixed(2)}m). Executing lateral evasion.`);

      // Clear Dijkstra / nav path to force recalculation around neighbor
      this.lastNavCalcTime = -999;
      this.currentNavPath = [];
      this.navPathIndex = 0;

      // Find lateral evasion direction perpendicular to vector between Sabers
      const dx = nearNeighbor.position.x - this.position.x;
      const dz = nearNeighbor.position.z - this.position.z;
      const dist = Math.hypot(dx, dz) || 0.001;

      // Perpendiculars
      const rightX = dz / dist, rightZ = -dx / dist;
      const leftX = -dz / dist, leftZ = dx / dist;

      // Use consistent side based on name comparison so they don't both evade in the same direction
      const preferRight = (this.name < nearNeighbor.name);
      let evadeX = preferRight ? rightX : leftX;
      let evadeZ = preferRight ? rightZ : leftZ;

      if (this.env && typeof this.env.circleHitsWall === 'function') {
        const probeDist = 0.6;
        const preferHit = this.env.circleHitsWall(this.position.x + evadeX * probeDist, this.position.z + evadeZ * probeDist, this.collisionRadius);
        if (preferHit) {
          // Try opposite side
          const altX = preferRight ? leftX : rightX;
          const altZ = preferRight ? leftZ : rightZ;
          const altHit = this.env.circleHitsWall(this.position.x + altX * probeDist, this.position.z + altZ * probeDist, this.collisionRadius);
          if (!altHit) {
            evadeX = altX;
            evadeZ = altZ;
          } else {
            // Both sides blocked! Back up away from neighbor
            evadeX = -dx / dist;
            evadeZ = -dz / dist;
          }
        }
      }

      // Apply strong lateral impulse to break deadlock
      this.velocity.x = evadeX * 5.0;
      this.velocity.z = evadeZ * 5.0;
      this.stuckTimer = 0;
      return;
    }

    this.isMutuallyObstructed = false;
    this.slowdownReason = 'STUCK_GEOMETRY';
    this.logState(`Stuck against obstruction for ${this.stuckTimer.toFixed(1)}s. Triggering recovery recalculation #${this.pathRecalculationCount}.`);

    // 1. Advance waypoint if currently following a path
    if (this.currentNavPath && this.currentNavPath.length > 0 && this.navPathIndex < this.currentNavPath.length - 1) {
      this.navPathIndex++;
      const nextWp = this.currentNavPath[this.navPathIndex];
      this.seekBehavior.target.copy(nextWp);
    } else {
      // 2. Clear path to force fresh recalculation from clearance position
      this.lastNavCalcTime = -999;
      this.currentNavPath = [];
      this.navPathIndex = 0;
    }

    // 3. Radial clearance probe: find open angle to nudge out of corner vertex
    if (this.env && typeof this.env.circleHitsWall === 'function') {
      const probeDist = 0.5;
      const angles = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI * 3 / 4, -Math.PI * 3 / 4, Math.PI];
      for (const a of angles) {
        const testX = this.position.x + Math.cos(a) * probeDist;
        const testZ = this.position.z + Math.sin(a) * probeDist;
        if (!this.env.circleHitsWall(testX, testZ, this.collisionRadius)) {
          this.velocity.x += Math.cos(a) * 3.5;
          this.velocity.z += Math.sin(a) * 3.5;
          break;
        }
      }
    }

    this.stuckTimer = 0;
  }

  update(delta) {
    this.delta = delta;
    this.currentTime += delta;

    // Cooldown countdown across all states
    if (this.attackCooldownTimer > 0) {
      this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - delta);
    }
    this._tickedCooldownInUpdate = true;

    // 1. Perform sensory evaluation with current orientation and position
    this.updateSensory(delta);

    // 2. Update finite state machine logic (handles sensory triggers & state transitions)
    this.stateMachine.update();
    this._tickedCooldownInUpdate = false;

    // 3. Dynamic Avoidance & Advance vehicle locomotion
    const isStationaryState = (
      this.stateMachine.currentState === this.states.STAGGERED ||
      this.stateMachine.currentState === this.states.RECOVER ||
      this.stateMachine.currentState === this.states.ATTACK
    );

    const prevX = this.position.x;
    const prevZ = this.position.z;

    this.desiredSpeed = isStationaryState ? 0 : this.maxSpeed;

    if (!isStationaryState) {
      this.applyDynamicAvoidance(delta);
      super.update(delta);
    } else {
      // In stationary states, stop all linear momentum
      this.velocity.set(0, 0, 0);
    }

    // 4. Enforce authoritative wall sliding collision (player dimensions: radius 0.32m)
    let collisionOccurredX = false;
    let collisionOccurredZ = false;

    if (this.env && typeof this.env.circleHitsWall === 'function') {
      const radius = this.collisionRadius;
      const newX = this.position.x;
      const newZ = this.position.z;

      let finalX = prevX;
      if (!this.env.circleHitsWall(newX, prevZ, radius)) {
        finalX = newX;
      } else {
        this.velocity.x = 0;
        collisionOccurredX = true;
      }

      let finalZ = prevZ;
      if (!this.env.circleHitsWall(finalX, newZ, radius)) {
        finalZ = newZ;
      } else {
        this.velocity.z = 0;
        collisionOccurredZ = true;
      }

      this.position.x = finalX;
      this.position.z = finalZ;
    }

    // 5. Enforce mutual Saber-on-Saber physical collision separation
    this.resolveNeighborCollisions(delta);

    // 6. Measure actual displacement speed
    const movedDist = Math.hypot(this.position.x - prevX, this.position.z - prevZ);
    const instantSpeed = delta > 0 ? (movedDist / delta) : 0;
    this.actualSpeed = instantSpeed;

    // 7. Stuck Detection & Diagnostic Reason Tracking
    let nearNeighbor = null;
    if (this.neighbors && this.neighbors.length > 0) {
      for (const nb of this.neighbors) {
        if (nb && !nb.isDead && this.position.distanceTo(nb.position) <= 1.2) {
          nearNeighbor = nb;
          break;
        }
      }
    }

    if (isStationaryState) {
      this.stuckTimer = 0;
      this.slowdownReason = 'STATIONARY_STATE';
      this.isMutuallyObstructed = false;
    } else if (this.desiredSpeed > 1.0) {
      if (instantSpeed < 0.25) {
        this.stuckTimer = (this.stuckTimer || 0) + delta;
        this.timeSpentStuck = (this.timeSpentStuck || 0) + delta;
        if (nearNeighbor) {
          this.slowdownReason = 'STUCK_MUTUAL_SABER';
          this.isMutuallyObstructed = true;
        } else {
          this.slowdownReason = (collisionOccurredX && collisionOccurredZ) ? 'STUCK_GEOMETRY' : 'WALL_SLIDING';
          this.isMutuallyObstructed = false;
        }

        if (this.stuckTimer >= 0.4) {
          this.handleStuckRecovery(delta);
        }
      } else {
        this.stuckTimer = Math.max(0, (this.stuckTimer || 0) - delta * 2.0);
        this.isMutuallyObstructed = false;
        if (collisionOccurredX || collisionOccurredZ) {
          this.slowdownReason = 'WALL_SLIDING';
        } else if (instantSpeed < this.desiredSpeed * 0.7) {
          this.slowdownReason = 'TURNING_DECELERATION';
        } else {
          this.slowdownReason = 'NONE_AT_SPEED';
        }
      }
    } else {
      this.stuckTimer = 0;
      this.slowdownReason = 'NONE_AT_SPEED';
      this.isMutuallyObstructed = false;
    }

    return this;
  }
}
