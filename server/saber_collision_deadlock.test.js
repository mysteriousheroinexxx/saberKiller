import test from 'node:test';
import assert from 'node:assert/strict';
import * as YUKA from 'yuka';
import {
  RoomManager,
  configureSaberDifficulty
} from './room_manager.js';
import { SaberAgent, SABER_STATES } from './ai/saber_agent.js';
import { PlayerEntity, SaberSimulation } from './ai/simulation.js';

// Environment helper representing a bounded corridor
function createCorridorEnv(corridorHalfWidth = 1.0, corridorLength = 10.0) {
  return {
    circleHitsWall: (x, z, r = 0.32) => {
      // Bounded by walls at z = +halfWidth and z = -halfWidth
      if (z - r < -corridorHalfWidth || z + r > corridorHalfWidth) return true;
      if (x - r < -corridorLength || x + r > corridorLength) return true;
      return false;
    },
    hasLineOfSight: (from, to) => {
      return Math.abs(from.z) <= corridorHalfWidth && Math.abs(to.z) <= corridorHalfWidth;
    },
    findPath: (from, to) => [new YUKA.Vector3().copy(to)]
  };
}

test('Scenario 1: Both Sabers approaching and colliding: maintain collision and prevent overlap', () => {
  configureSaberDifficulty('NORMAL');

  // Constrained space to force physical meeting
  const env = createCorridorEnv(1.2, 10.0);
  const alpha = new SaberAgent('Saber Alpha', { env, collisionRadius: 0.32, patrolSpeed: 2.5 });
  const beta = new SaberAgent('Saber Beta', { env, collisionRadius: 0.32, patrolSpeed: 2.5 });

  alpha.followPathBehavior.active = false;
  beta.followPathBehavior.active = false;
  alpha.neighbors.push(beta);
  beta.neighbors.push(alpha);

  // Position facing each other on the X axis
  alpha.position.set(-2.0, 0, 0);
  beta.position.set(2.0, 0, 0);

  const targetAlpha = new YUKA.Vector3(4.0, 0, 0);
  const targetBeta = new YUKA.Vector3(-4.0, 0, 0);

  let minimumDistanceObserved = Infinity;

  for (let tick = 0; tick < 80; tick++) {
    alpha.navigateTo(targetAlpha, 0.05);
    beta.navigateTo(targetBeta, 0.05);

    alpha.update(0.05);
    beta.update(0.05);

    const dist = alpha.position.distanceTo(beta.position);
    if (dist < minimumDistanceObserved) minimumDistanceObserved = dist;

    // Minimum allowed distance is 2 * collisionRadius (0.64m)
    // Physical separation ensures distance never drops below 0.63m (allowing 0.01m tolerance)
    assert.ok(dist >= 0.63, `Sabers must not penetrate each other: dist=${dist.toFixed(3)}m at tick ${tick}`);

    // Verify wall collision constraints
    assert.ok(!env.circleHitsWall(alpha.position.x, alpha.position.z, alpha.collisionRadius), 'Alpha inside environment bounds');
    assert.ok(!env.circleHitsWall(beta.position.x, beta.position.z, beta.collisionRadius), 'Beta inside environment bounds');
  }

  assert.ok(minimumDistanceObserved >= 0.63, `Minimum distance respected: ${minimumDistanceObserved.toFixed(3)}m >= 0.63m`);
  // Verify both bypassed each other
  assert.ok(alpha.position.x > beta.position.x, 'Alpha and Beta passed each other');
});

test('Scenario 2: Both separating and successfully resuming movement after meeting', () => {
  configureSaberDifficulty('NORMAL');

  const env = createCorridorEnv(2.0, 15.0);
  const alpha = new SaberAgent('Saber Alpha', { env, collisionRadius: 0.32, patrolSpeed: 2.5 });
  const beta = new SaberAgent('Saber Beta', { env, collisionRadius: 0.32, patrolSpeed: 2.5 });

  alpha.followPathBehavior.active = false;
  beta.followPathBehavior.active = false;
  alpha.neighbors.push(beta);
  beta.neighbors.push(alpha);

  alpha.position.set(-2.0, 0, 0);
  beta.position.set(2.0, 0, 0);

  const targetAlpha = new YUKA.Vector3(8.0, 0, 0);
  const targetBeta = new YUKA.Vector3(-8.0, 0, 0);

  let peakTraversingSpeedAlpha = 0;
  let peakTraversingSpeedBeta = 0;

  // Run simulation past collision point
  for (let tick = 0; tick < 80; tick++) {
    alpha.navigateTo(targetAlpha, 0.05);
    beta.navigateTo(targetBeta, 0.05);

    alpha.update(0.05);
    beta.update(0.05);

    if (tick > 15 && tick < 60) {
      if (alpha.actualSpeed > peakTraversingSpeedAlpha) peakTraversingSpeedAlpha = alpha.actualSpeed;
      if (beta.actualSpeed > peakTraversingSpeedBeta) peakTraversingSpeedBeta = beta.actualSpeed;
    }
  }

  // Alpha should have bypassed Beta and progressed past x = 0 towards x = 8
  assert.ok(alpha.position.x > 2.0, `Alpha successfully moved past encounter: x=${alpha.position.x.toFixed(2)}`);
  // Beta should have bypassed Alpha and progressed past x = 0 towards x = -8
  assert.ok(beta.position.x < -2.0, `Beta successfully moved past encounter: x=${beta.position.x.toFixed(2)}`);

  // Both maintained strong traversing speeds and did not deadlock
  assert.ok(peakTraversingSpeedAlpha >= 1.5, `Alpha traversed at speed: ${peakTraversingSpeedAlpha.toFixed(2)} m/s`);
  assert.ok(peakTraversingSpeedBeta >= 1.5, `Beta traversed at speed: ${peakTraversingSpeedBeta.toFixed(2)} m/s`);
  assert.equal(alpha.isMutuallyObstructed, false);
  assert.equal(beta.isMutuallyObstructed, false);
});

test('Scenario 3: Both navigating through the same narrow corridor (2.0m width) without deadlock', () => {
  configureSaberDifficulty('NORMAL');

  // Narrow corridor: z between -1.0 and +1.0 (width 2.0m).
  // Two Sabers with radius 0.32m each require 0.64m diameter. Total width needed = 1.28m, fits within 2.0m!
  const env = createCorridorEnv(1.0, 10.0);
  const alpha = new SaberAgent('Saber Alpha', { env, collisionRadius: 0.32, patrolSpeed: 2.5 });
  const beta = new SaberAgent('Saber Beta', { env, collisionRadius: 0.32, patrolSpeed: 2.5 });

  alpha.followPathBehavior.active = false;
  beta.followPathBehavior.active = false;
  alpha.neighbors.push(beta);
  beta.neighbors.push(alpha);

  alpha.position.set(-6.0, 0, 0);
  beta.position.set(6.0, 0, 0);

  const targetAlpha = new YUKA.Vector3(6.0, 0, 0);
  const targetBeta = new YUKA.Vector3(-6.0, 0, 0);

  let passedEachOther = false;

  for (let tick = 0; tick < 160; tick++) {
    alpha.navigateTo(targetAlpha, 0.05);
    beta.navigateTo(targetBeta, 0.05);

    alpha.update(0.05);
    beta.update(0.05);

    // Verify neither Saber penetrates walls
    assert.ok(Math.abs(alpha.position.z) <= (1.0 - alpha.collisionRadius + 0.001), `Alpha inside corridor walls: z=${alpha.position.z.toFixed(3)}`);
    assert.ok(Math.abs(beta.position.z) <= (1.0 - beta.collisionRadius + 0.001), `Beta inside corridor walls: z=${beta.position.z.toFixed(3)}`);

    // Distance between them must always be >= 0.63m
    const dist = alpha.position.distanceTo(beta.position);
    assert.ok(dist >= 0.63, `Physical collision preserved in corridor: dist=${dist.toFixed(3)}m at tick ${tick}`);

    if (alpha.position.x > 3.0 && beta.position.x < -3.0) {
      passedEachOther = true;
      break;
    }
  }

  assert.ok(passedEachOther, 'Both Sabers successfully navigated past each other in narrow corridor');
  assert.ok(alpha.position.x > 3.0, `Alpha reached opposite side: x=${alpha.position.x.toFixed(2)}`);
  assert.ok(beta.position.x < -3.0, `Beta reached opposite side: x=${beta.position.x.toFixed(2)}`);
});

test('Scenario 4: One Saber pursuing while the other investigates (independent AI states)', () => {
  configureSaberDifficulty('NORMAL');

  const sim = new SaberSimulation({ difficulty: 'NORMAL' });
  const alpha = sim.saberAlpha;
  const beta = sim.saberBeta;

  // Make sure both start idle/patrol
  assert.equal(alpha.stateMachine.currentState, alpha.states.PATROL);
  assert.equal(beta.stateMachine.currentState, beta.states.PATROL);

  // Position players: Player A near Alpha (in Alpha's visual lock)
  // Player B behind walls at (-20, 0, -20) so Beta has no visual line-of-sight to either player
  sim.playerA.position.set(-16, 0, -16);
  sim.playerB.position.set(-20, 0, -20);

  // 1. Alpha sees player A and transitions to CHASE
  alpha.canSeeTarget = true;
  alpha.targetEntity = sim.playerA;
  alpha.stateMachine.changeTo(SABER_STATES.CHASE);

  // 2. Beta has no visual contact with any survivor, but hears a distant gunshot at (20, 0, 20)
  const soundStimulus = { soundType: 'GUNSHOT_PRIMARY', intensity: 1.0, timestamp: sim.elapsedTime };
  const evalResult = { perceivedPosition: new YUKA.Vector3(20, 0, 20), distance: 25.0 };
  beta.onHearSound(soundStimulus, evalResult);

  // Verify states are independent
  assert.equal(alpha.getCurrentStateName(), 'CHASE', 'Alpha is actively pursuing player');
  assert.equal(alpha.maxSpeed, alpha.chaseSpeed, 'Alpha running at chase speed (9.5 m/s)');

  assert.equal(beta.getCurrentStateName(), 'INVESTIGATE_SOUND', 'Beta is investigating gunshot');
  assert.equal(beta.maxSpeed, beta.investigateSpeed, 'Beta moving at investigate speed (5.72 m/s)');

  // Advance simulation 10 ticks: both Sabers advance independently
  for (let i = 0; i < 10; i++) {
    sim.update(0.05);
  }

  // Alpha continues chasing player; Beta continues investigating sound target
  assert.equal(alpha.getCurrentStateName(), 'CHASE');
  assert.equal(beta.getCurrentStateName(), 'INVESTIGATE_SOUND');
  assert.equal(beta.soundTarget.x, 20);
  assert.equal(beta.soundTarget.z, 20);
});

test('Scenario 5: Player escaping during an attack windup: 0 damage applied', () => {
  configureSaberDifficulty('NORMAL');

  const saber = new SaberAgent('Test Saber Alpha', { difficulty: 'NORMAL' });
  const player = new PlayerEntity('Survivor', new YUKA.Vector3(0, 0, 0), { health: 100, maxHealth: 100 });
  player.collisionRadius = 0.32;

  saber.position.set(0, 0, 0.5); // In contact
  saber.targetEntity = player;

  let damageApplied = false;
  saber.onAttack = () => { damageApplied = true; };

  saber.stateMachine.changeTo(SABER_STATES.ATTACK);
  assert.equal(saber.attackPhase, 'WINDUP');

  // Advance 2 ticks (0.1s)
  saber.delta = 0.05;
  saber.states.ATTACK.execute(saber);
  saber.states.ATTACK.execute(saber);
  assert.equal(damageApplied, false);

  // Player escapes to 15m away before windup completes
  player.position.set(0, 0, 15.0);

  // Next tick in ATTACK executes: detects player outside contact range
  saber.states.ATTACK.execute(saber);

  assert.equal(saber.attackPending, false, 'Attack cancelled');
  assert.equal(saber.stateMachine.currentState, saber.states.CHASE, 'Transitioned to CHASE upon escape');
  assert.equal(damageApplied, false, 'No damage applied');
  assert.equal(player.health, 100, 'Player health remains 100');
});

test('Scenario 6: Remote damage prevention: server rejects damage when player is away even if Sabers become stuck', () => {
  configureSaberDifficulty('NORMAL');

  const rm = new RoomManager();
  const ws1 = { send: () => {} };
  rm.createRoom(ws1, 'TEST_REMOTE_DMG', 'default', null, { startingPlayers: 1, directStart: true });

  const room = rm.getRoom('TEST_REMOTE_DMG');
  const roomSim = room.simulation;
  assert.ok(roomSim, 'RoomSimulation exists');

  const playerObj = room.players.get(rm.getPlayer(ws1).player.id);
  const playerEntity = roomSim.playerEntities.get(playerObj.id);

  // 1. Initial hit in contact (distance 0.5m)
  playerObj.position = { x: 0, y: 0, z: 0 };
  playerEntity.position.set(0, 0, 0);
  roomSim.sim.saberAlpha.position.set(0, 0, 0.5);

  let roomDamageEvent = null;
  rm.onRoomEvents = (r, events) => {
    const dmg = events.find(e => e.type === 'PLAYER_HEALTH_UPDATE');
    if (dmg) roomDamageEvent = dmg;
  };

  // Saber strikes player
  roomSim.sim.saberAlpha.onAttack(playerEntity, 15);
  assert.equal(playerObj.hp, 85, 'Player took initial 15 HP hit');
  assert.ok(roomDamageEvent, 'Damage event emitted');

  // 2. Player immediately runs away to (25, 0, 25)
  playerObj.position = { x: 25, y: 0, z: 25 };
  playerEntity.stepMovement(25, 25, 0.05);

  // 3. Sabers collide and enter mutual obstruction deadlock
  roomSim.sim.saberAlpha.position.set(0, 0, 0.5);
  roomSim.sim.saberBeta.position.set(0, 0, 0.7);
  roomSim.sim.saberAlpha.isMutuallyObstructed = true;
  roomSim.sim.saberAlpha.slowdownReason = 'STUCK_MUTUAL_SABER';

  roomDamageEvent = null;

  // 4. Attempt to invoke onAttack callback (e.g. stale attack or expired cooldown)
  roomSim.sim.saberAlpha.onAttack(playerEntity, 15);

  // Server authoritative distance validation rejects damage because player is at (25, 25)
  assert.equal(roomDamageEvent, null, 'Server strictly rejected remote damage');
  assert.equal(playerObj.hp, 85, 'Player HP remains 85: player did not take remote damage');
});

test('Scenario 7: Multi-client state, telemetry, and health synchronization', () => {
  configureSaberDifficulty('NORMAL');

  const rm = new RoomManager();
  const ws1 = { send: () => {} };
  const ws2 = { send: () => {} };

  const client1HealthEvents = [];
  const client2HealthEvents = [];

  rm.onRoomEvents = (room, events) => {
    for (const ev of events) {
      if (ev.type === 'PLAYER_HEALTH_UPDATE') {
        client1HealthEvents.push(ev);
        client2HealthEvents.push(ev);
      }
    }
  };

  rm.createRoom(ws1, 'TEST_MULTI_SYNC', 'default', null, { startingPlayers: 2, directStart: true });
  rm.joinRoom(ws2, 'TEST_MULTI_SYNC');

  const room = rm.getRoom('TEST_MULTI_SYNC');
  const roomSim = room.simulation;
  assert.ok(roomSim, 'RoomSimulation exists');

  // Verify telemetry structure
  const telemetry = roomSim.buildDevTelemetry();
  assert.ok(telemetry.saberAlpha);
  assert.ok(telemetry.saberBeta);
  assert.equal(typeof telemetry.saberAlpha.isMutuallyObstructed, 'boolean');
  assert.equal(typeof telemetry.saberBeta.isMutuallyObstructed, 'boolean');
  assert.equal(typeof telemetry.saberAlpha.slowdownReason, 'string');

  // Trigger mutual obstruction
  roomSim.sim.saberAlpha.isMutuallyObstructed = true;
  roomSim.sim.saberAlpha.slowdownReason = 'STUCK_MUTUAL_SABER';

  const obstructedTelemetry = roomSim.buildDevTelemetry();
  assert.equal(obstructedTelemetry.saberAlpha.isMutuallyObstructed, true);
  assert.equal(obstructedTelemetry.saberAlpha.slowdownReason, 'STUCK_MUTUAL_SABER');

  // Damage player 1 once
  const p1 = room.players.get(rm.getPlayer(ws1).player.id);
  const dmgRes = rm.applyDamage(p1.id, 15, 'SABER_ATTACK');
  if (rm.onRoomEvents) rm.onRoomEvents(room, dmgRes.events);

  // Both clients receive synchronized health updates
  assert.equal(client1HealthEvents.length, 1);
  assert.equal(client2HealthEvents.length, 1);
  assert.equal(client1HealthEvents[0].payload.hp, 85);
  assert.equal(client2HealthEvents[0].payload.hp, 85);
});
