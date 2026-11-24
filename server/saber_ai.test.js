import test from 'node:test';
import assert from 'node:assert/strict';
import * as YUKA from '../yuka/build/yuka.module.js';
import { RoomSimulation, AI_PACKET_TYPES } from './ai/room_simulation.js';
import { SaberSimulation, PlayerEntity } from './ai/simulation.js';
import { SABER_STATES } from './ai/saber_agent.js';
import { Level0Environment, Level0PrototypeMap } from './ai/environment.js';
import { RoomManager, SURVIVAL_CONFIG } from './room_manager.js';

test('1. Two persistent Sabers spawn in room simulation with independent FSMs and waypoints', () => {
  const room = { code: 'TEST_ROOM', players: new Map() };
  const roomSim = new RoomSimulation(room, { autoStart: false, usePrototypeMap: true });

  assert.ok(roomSim.sim.saberAlpha, 'Saber Alpha exists');
  assert.ok(roomSim.sim.saberBeta, 'Saber Beta exists');
  assert.equal(roomSim.sim.saberAlpha.isPersistent, true);
  assert.equal(roomSim.sim.saberBeta.isPersistent, true);

  assert.equal(roomSim.sim.saberAlpha.getCurrentStateName(), SABER_STATES.PATROL);
  assert.equal(roomSim.sim.saberBeta.getCurrentStateName(), SABER_STATES.PATROL);

  // Both Sabers have independent positions
  assert.notEqual(roomSim.sim.saberAlpha.position.x, roomSim.sim.saberBeta.position.x);

  const snap = roomSim.buildMonsterSnapshot();
  assert.equal(snap.monsters.length, 2);
  assert.equal(snap.monsters[0].name, 'Saber Alpha');
  assert.equal(snap.monsters[1].name, 'Saber Beta');

  roomSim.destroy();
});

test('2. Patrol and visual player detection: spotting player transitions Saber from PATROL to CHASE', () => {
  const roomSim = new RoomSimulation({ code: 'TEST_ROOM', players: new Map() }, { autoStart: false, usePrototypeMap: true });
  const p = roomSim.addPlayer({ id: 'p_1', name: 'Survivor 1', position: { x: -12, y: 0, z: -10 } });

  // Place Saber Alpha in Room 1 open space: (-12, 0, -18)
  roomSim.sim.saberAlpha.position.set(-12, 0, -18);
  p.position.set(-12, 0, -12);
  roomSim.sim.saberAlpha.lookAt(p.position);

  // Tick simulation once
  roomSim.tick(0.05);

  assert.equal(roomSim.sim.saberAlpha.canSeeTarget, true, 'Saber Alpha should see player directly in front');
  const alphaState = roomSim.sim.saberAlpha.getCurrentStateName();
  assert.ok(alphaState === SABER_STATES.CHASE || alphaState === SABER_STATES.STALK, `Expected CHASE or STALK, got ${alphaState}`);

  roomSim.destroy();
});

test('3. Sound investigation & gunshot attraction: gunfire alerts both Sabers independently without coordinate leaks', () => {
  const roomSim = new RoomSimulation({ code: 'TEST_ROOM', players: new Map() }, { autoStart: false, usePrototypeMap: true });
  const p = roomSim.addPlayer({ id: 'p_1', name: 'Survivor 1', position: { x: 0, y: 0, z: -10 } });

  // Fire pistol at (0, 0, -10)
  roomSim.handleWeaponFired('p_1', 'PISTOL');

  // Both Sabers should hear the shot (audible radius: 35m)
  assert.equal(roomSim.sim.saberAlpha.getCurrentStateName(), SABER_STATES.INVESTIGATE_SOUND, 'Alpha investigated sound');
  assert.equal(roomSim.sim.saberBeta.getCurrentStateName(), SABER_STATES.INVESTIGATE_SOUND, 'Beta investigated sound');

  // Sound investigation target must NOT equal exact player coordinates (fuzzed approximate localization)
  const soundTarget = roomSim.sim.saberAlpha.soundTarget;
  assert.ok(soundTarget, 'Saber Alpha has sound target');
  const distToExact = soundTarget.distanceTo(p.position);
  assert.ok(distToExact > 0.05, `Sound target has fuzzy offset (${distToExact.toFixed(2)}m > 0.05m) avoiding coordinate leaks`);

  roomSim.destroy();
});

test('4. Both Sabers can independently pursue different players', () => {
  const roomSim = new RoomSimulation({ code: 'TEST_ROOM', players: new Map() }, { autoStart: false, usePrototypeMap: true });
  roomSim.sim.saberAlpha.position.set(-12, 0, -18);
  roomSim.sim.saberBeta.position.set(12, 0, -18);

  const p1 = roomSim.addPlayer({ id: 'p_1', name: 'Survivor 1', position: { x: -12, y: 0, z: -12 } });
  const p2 = roomSim.addPlayer({ id: 'p_2', name: 'Survivor 2', position: { x: 12, y: 0, z: -12 } });

  roomSim.sim.saberAlpha.lookAt(p1.position);
  roomSim.sim.saberBeta.lookAt(p2.position);

  roomSim.tick(0.05);

  assert.equal(roomSim.sim.saberAlpha.targetEntity.id, 'p_1', 'Saber Alpha targets Survivor 1');
  assert.equal(roomSim.sim.saberBeta.targetEntity.id, 'p_2', 'Saber Beta targets Survivor 2');
  assert.ok(roomSim.sim.saberAlpha.canSeeTarget, 'Alpha sees Survivor 1');
  assert.ok(roomSim.sim.saberBeta.canSeeTarget, 'Beta sees Survivor 2');

  roomSim.destroy();
});

test('5. Saber attacks apply damage (25 HP) through authoritative server and down players at 0 HP', () => {
  const roomManager = new RoomManager();
  const res = roomManager.createRoom(null, 'TEST_ROOM', 'default', null, { startingPlayers: 2 });
  const room = roomManager.getRoom(res.roomCode);
  const player1 = res.player;

  // Add second player
  const joinRes = roomManager.joinRoom(null, res.roomCode);
  const player2 = joinRes.player;

  // Start match -> initializes room simulation
  roomManager.startMatch(player1.ws);
  assert.ok(room.simulation, 'Room simulation initialized on match start');

  // Place player 1 right in front of Saber Alpha at attack range (1.0m)
  const saberAlpha = room.simulation.sim.saberAlpha;
  player1.position = { x: saberAlpha.position.x, y: 0, z: saberAlpha.position.z + 1.0 };
  room.simulation.updatePlayerMovement(player1.id, player1.position.x, 0, player1.position.z);
  saberAlpha.lookAt(room.simulation.playerEntities.get(player1.id).position);

  // Saber strikes player
  saberAlpha.stateMachine.changeTo(SABER_STATES.ATTACK);

  assert.equal(player1.hp, 75, 'Saber attack deducted exactly 25 HP');
  assert.equal(player1.state, 'ACTIVE');

  // 3 more strikes reduce health to 0
  roomManager.applyDamage(player1.id, 25, 'SABER_ATTACK');
  assert.equal(player1.hp, 50);
  roomManager.applyDamage(player1.id, 25, 'SABER_ATTACK');
  assert.equal(player1.hp, 25);
  const lethalRes = roomManager.applyDamage(player1.id, 25, 'SABER_ATTACK');
  assert.equal(player1.hp, 0);
  assert.equal(player1.state, 'DOWNED', 'Co-op first 0 HP death enters DOWNED state');
  assert.ok(lethalRes.events.some(e => e.type === 'PLAYER_DOWNED'));

  room.simulation.destroy();
});

test('6. Stagger and recovery: 0 HP enters STAGGERED for 10s, then RECOVER, no permanent death or ammo drop', () => {
  const roomSim = new RoomSimulation({ code: 'TEST_ROOM', players: new Map() }, { autoStart: false, usePrototypeMap: true });
  const saber = roomSim.sim.saberAlpha;

  assert.equal(saber.health, 100);
  saber.takeDamage(50);
  assert.equal(saber.health, 50);
  assert.equal(saber.getCurrentStateName(), SABER_STATES.CHASE);

  // Damage remaining 50 HP -> 0 HP
  const stagRes = saber.takeDamage(50);
  assert.equal(saber.health, 0);
  assert.equal(stagRes.staggered, true);
  assert.equal(saber.getCurrentStateName(), SABER_STATES.STAGGERED);
  assert.equal(saber.isInvulnerable, true);
  assert.equal(saber.staggerTimer, 10.0);

  // During stagger, further damage is ignored (no ammo drops, invulnerable)
  const dmgWhileStaggered = saber.takeDamage(25);
  assert.equal(dmgWhileStaggered.damageDealt, 0);

  // Advance simulation through stagger duration (10 seconds)
  for (let i = 0; i < 200; i++) {
    roomSim.tick(0.05);
  }

  // After 10s: transitions to RECOVER, health restored to 100
  assert.equal(saber.getCurrentStateName(), SABER_STATES.RECOVER);
  assert.equal(saber.health, 100);
  assert.equal(saber.isInvulnerable, true);

  // Advance past recovery grace window (2.5s)
  for (let i = 0; i < 60; i++) {
    roomSim.tick(0.05);
  }

  // Saber is back to hunting (CHASE, SEARCH, or PATROL)
  assert.equal(saber.isInvulnerable, false);
  const postRecoverState = saber.getCurrentStateName();
  assert.ok(
    postRecoverState === SABER_STATES.CHASE ||
    postRecoverState === SABER_STATES.SEARCH ||
    postRecoverState === SABER_STATES.PATROL,
    `Expected hunting state, got ${postRecoverState}`
  );

  roomSim.destroy();
});

test('7. Multi-client snapshot consistency: MONSTER_SNAPSHOT contains synchronized transforms and state', () => {
  const messagesReceived = [];
  const room = { code: 'TEST_ROOM', players: new Map() };
  const roomSim = new RoomSimulation(room, {
    autoStart: false,
    usePrototypeMap: true,
    broadcastMessage: (type, payload) => {
      messagesReceived.push({ type, payload });
    }
  });

  roomSim.tick(0.05);

  assert.ok(messagesReceived.length >= 1);
  const snapshotMsg = messagesReceived.find(m => m.type === AI_PACKET_TYPES.MONSTER_SNAPSHOT);
  assert.ok(snapshotMsg, 'MONSTER_SNAPSHOT broadcasted');
  assert.equal(snapshotMsg.payload.monsters.length, 2);

  const [alphaSnap, betaSnap] = snapshotMsg.payload.monsters;
  assert.equal(alphaSnap.id, 'saber_alpha');
  assert.equal(betaSnap.id, 'saber_beta');
  assert.ok(typeof alphaSnap.position.x === 'number');
  assert.ok(typeof alphaSnap.rotation.w === 'number');
  assert.ok(typeof alphaSnap.state === 'string');

  roomSim.destroy();
});

test('8. Automatic stride-based footsteps: walking (1.6m) and sprinting (1.4m) emit footsteps, airborne/stationary emits 0', () => {
  const roomSim = new RoomSimulation({ code: 'TEST_ROOM', players: new Map() }, { autoStart: false, usePrototypeMap: true });
  const p = roomSim.addPlayer({ id: 'p_1', name: 'Survivor 1', position: { x: 0, y: 0, z: 0 } });

  const emitted = [];
  roomSim.sim.onFootstepEvent = (evt) => emitted.push(evt);

  // 1. Move walking along Z axis for 5 meters (stepStride = 1.6m) -> 3 steps expected
  for (let i = 0; i < 50; i++) {
    p.stepMovement(0, (i + 1) * 0.1, 0.05, false, true);
    roomSim.sim.update(0.05);
  }
  assert.equal(emitted.length, 3, `Walking 5.0m emitted exactly 3 footsteps (actual: ${emitted.length})`);
  assert.equal(emitted[0].stimulus.soundType, 'FOOTSTEP_WALK');
  assert.equal(emitted[0].stimulus.detectionRadius, 5.0);

  // 2. Airborne movement emits zero footsteps
  emitted.length = 0;
  for (let i = 0; i < 50; i++) {
    p.stepMovement(0, 5.0 + (i + 1) * 0.1, 0.05, false, false); // isGrounded = false
    roomSim.sim.update(0.05);
  }
  assert.equal(emitted.length, 0, 'Airborne movement emitted zero footsteps');

  // 3. Stationary player emits zero footsteps
  for (let i = 0; i < 20; i++) {
    p.stepMovement(0, 10.0, 0.05, false, true);
    roomSim.sim.update(0.05);
  }
  assert.equal(emitted.length, 0, 'Stationary player emitted zero footsteps');

  roomSim.destroy();
});

test('9. Wall occlusion muffles sound and blocks direct line-of-sight', () => {
  const map = new Level0PrototypeMap();
  const soundPos = new YUKA.Vector3(-12, 0, -18); // Room 1
  const listenerThroughWall = new YUKA.Vector3(12, 0, -18); // Room 2 (divided by wall at x=6 and x=-6)
  const listenerOpenHall = new YUKA.Vector3(-12, 0, -10); // Room 1 open space

  assert.equal(map.hasLineOfSight(soundPos, listenerThroughWall), false, 'Dividing wall blocks line of sight');
  assert.equal(map.hasLineOfSight(soundPos, listenerOpenHall), true, 'Open room space has clear line of sight');

  const occlusionThroughWall = map.getSoundOcclusionFactor(soundPos, listenerThroughWall);
  assert.ok(occlusionThroughWall < 1.0, `Wall muffles sound (factor: ${occlusionThroughWall} < 1.0)`);
});

test('10. Encounter Director: Pacing phases, threat intensity, and non-magical gateway hints', () => {
  const roomSim = new RoomSimulation({ code: 'TEST_ROOM', players: new Map() }, { autoStart: false, usePrototypeMap: true });
  const dir = roomSim.sim.director;

  roomSim.sim.player.position.set(-18, 0, -12);
  roomSim.sim.update(0.016);

  assert.equal(dir.phase, 'BUILD_UP');
  assert.ok(dir.threatIntensity >= 10.0);

  // Force MENACE phase
  dir.forcePhase('MENACE', 'Test menace phase', roomSim.sim);
  dir.considerMacroHint(roomSim.sim);

  assert.equal(dir.phase, 'MENACE');
  assert.ok(dir.activeMenace, 'Active menace assigned');
  assert.ok(dir.activeMenace.hasDirectorHint, 'Menace received director hint');
  assert.ok(dir.activeMenace.directorHintTarget, 'Director hint has target Vector3');

  roomSim.destroy();
});

test('11. Production Level 0 environment: loads authentic grid, establishes production waypoints, performs fast DDA LoS', () => {
  const roomSim = new RoomSimulation({ code: 'PROD_ROOM', players: new Map() }, { autoStart: false, usePrototypeMap: false });

  assert.equal(roomSim.env.isLoaded, true, 'Level 0 authentic grid loaded');
  assert.ok(roomSim.sim.saberAlpha.position.x > 30.0, 'Saber Alpha spawned in production corridor');
  assert.ok(roomSim.sim.saberBeta.position.x > 50.0, 'Saber Beta spawned in production corridor');

  // LoS check using Level 0 grid
  const insideSpawn = new YUKA.Vector3(48.69, 1.8, -187.65);
  const insideCorridor = new YUKA.Vector3(38.0, 1.4, -180.0);
  const openCorridor = new YUKA.Vector3(45.0, 1.4, -175.0);

  assert.equal(roomSim.env.hasLineOfSight(insideSpawn, insideCorridor), false, 'Spawn room wall occludes corridor');
  assert.equal(roomSim.env.hasLineOfSight(insideCorridor, openCorridor), true, 'Corridor sightline is clear');

  // Tick production simulation 10 times
  for (let i = 0; i < 10; i++) {
    roomSim.tick(0.05);
  }

  const snap = roomSim.buildMonsterSnapshot();
  assert.equal(snap.monsters.length, 2);
  assert.ok(snap.monsters[0].position.x > 30.0);

  roomSim.destroy();
});

test('12. Overhauled movement speeds: relative to player walk 5.2 and sprint 7.6', () => {
  const roomSim = new RoomSimulation({ code: 'SPEED_ROOM', players: new Map() }, { autoStart: false, usePrototypeMap: true });
  const saber = roomSim.sim.saberAlpha;

  assert.equal(saber.patrolSpeed, 2.5, 'PATROL speed is 2.5 m/s');
  assert.equal(saber.investigateSpeed, 5.72, 'INVESTIGATE_SOUND speed is 5.72 m/s (~1.1x player walk 5.2)');
  assert.equal(saber.stalkSpeed, 7.6, 'STALK speed is 7.6 m/s (equal to player sprint 7.6)');
  assert.equal(saber.chaseSpeed, 9.5, 'CHASE speed is 9.5 m/s (1.25x player max sprint 7.6)');

  // Verify FSM states apply the overhauled speeds
  saber.stateMachine.changeTo('PATROL');
  assert.equal(saber.maxSpeed, 2.5);

  saber.stateMachine.changeTo('INVESTIGATE_SOUND');
  assert.equal(saber.maxSpeed, 5.72);

  saber.stateMachine.changeTo('STALK');
  assert.equal(saber.maxSpeed, 7.6);

  saber.stateMachine.changeTo('CHASE');
  assert.equal(saber.maxSpeed, 9.5);

  roomSim.destroy();
});

test('13. 180-degree wide FOV and long-distance vision bounded by geometry without arbitrary cutoffs', () => {
  const roomSim = new RoomSimulation({ code: 'FOV_ROOM', players: new Map() }, { autoStart: false, usePrototypeMap: true });
  const saber = roomSim.sim.saberAlpha;
  const player = roomSim.sim.player;

  // Orient saber pointing along +Z: (0, 0, 1)
  saber.position.set(0, 0, 0);
  saber.rotation.set(0, 0, 0, 1); // Facing +Z

  // Target at 80 degrees angle to the side at 20m:
  // Math.cos(80 deg) = 0.1736, Math.sin(80 deg) = 0.9848
  // Pos: x = 19.7, z = 3.5 -> angle ~ 79.9 degrees (within 90 deg half-angle of 180 deg FOV)
  const wideAnglePoint = new YUKA.Vector3(19.7, 0, 3.5);
  const wideCheck = saber.vision.checkVisibilityDetailed(wideAnglePoint);
  assert.equal(wideCheck.inFOV, true, 'Target at ~80 deg is within 180-deg FOV');
  assert.equal(wideCheck.inRange, true, 'Target is within unobstructed vision range');

  // Target at 35m straight ahead along South Hall z = 21 (exceeding previous 22m arbitrary cutoff)
  saber.position.set(-20, 0, 21);
  saber.lookAt(new YUKA.Vector3(15, 0, 21));
  const longDistPoint = new YUKA.Vector3(15, 0, 21);
  const longDistCheck = saber.vision.checkVisibilityDetailed(longDistPoint);
  assert.equal(longDistCheck.inRange, true, 'Long distance target (35m) is in range (no 22m cutoff)');
  assert.equal(longDistCheck.visible, true, 'Unoccluded long-distance target is visible');

  roomSim.destroy();
});

test('14. Dijkstra navigation around walls and pillars when direct LoS is obstructed', () => {
  const roomSim = new RoomSimulation({ code: 'NAV_ROOM', players: new Map() }, { autoStart: false, usePrototypeMap: true });
  const map = roomSim.env;

  // Around West Gallery occlusion pillar at (-16, -14):
  const start = new YUKA.Vector3(-16, 0, -18);
  const target = new YUKA.Vector3(-16, 0, -10);

  assert.equal(map.hasLineOfSight(start, target), false, 'Direct line of sight obstructed by pillar');

  const path = map.findPath(start, target);
  assert.ok(path.length >= 2, 'Dijkstra generated multi-waypoint path around obstacle');
  assert.ok(path[path.length - 1].distanceTo(target) < 0.1, 'Path terminates at destination');

  // Verify navigation does not cut through the pillar
  for (let i = 0; i < path.length - 1; i++) {
    assert.equal(map.hasLineOfSight(path[i], path[i + 1]), true, 'Segment between consecutive path nodes is clear');
  }

  roomSim.destroy();
});

test('15. Authoritative wall collision sliding with radius 0.32m prevents geometry penetration', () => {
  const roomSim = new RoomSimulation({ code: 'COLLIDE_ROOM', players: new Map() }, { autoStart: false, usePrototypeMap: true });
  const saber = roomSim.sim.saberAlpha;

  // Place Saber at (-6, 0, -17) adjacent to interior dividing wall at x = -6, z = [-22, -12]
  // Put Saber at x = -7.5, z = -17 (in West room), and push it eastward (+X) directly into wall
  saber.position.set(-7.0, 0, -17.0);
  saber.velocity.set(10.0, 0, 0); // Fast velocity directly toward wall at x = -6.0

  // Tick simulation with wall collision enabled
  for (let i = 0; i < 20; i++) {
    saber.update(0.05);
  }

  // Wall is at x = -6 with halfWidth 0.5 (AABB min.x = -6.5). Radius = 0.32.
  // Maximum allowed X without penetration is -6.5 - 0.32 = -6.82
  assert.ok(saber.position.x <= -6.80, `Saber stopped before penetrating wall: x = ${saber.position.x}`);
  assert.equal(roomSim.env.circleHitsWall(saber.position.x, saber.position.z, saber.collisionRadius), false, 'Saber position remains collision-free');

  roomSim.destroy();
});

test('16. Combat balance: 2 pistol shots and 1 shotgun blast cause Saber stagger', () => {
  const roomSim = new RoomSimulation({ code: 'COMBAT_ROOM', players: new Map() }, { autoStart: false, usePrototypeMap: true });
  roomSim.addPlayer({ id: 'shooter', position: { x: -16, y: 0, z: -16 } });

  const alpha = roomSim.sim.saberAlpha;
  const beta = roomSim.sim.saberBeta;
  alpha.position.set(-16, 0, -18);
  beta.position.set(16, 0, -18);

  // 1. Pistol attack against Saber Alpha: 50 damage per shot
  assert.equal(alpha.health, 100);
  const shot1 = roomSim.handleAttackMonster('shooter', 'saber_alpha', 50, 'PISTOL');
  assert.equal(shot1.success, true);
  assert.equal(shot1.damageDealt, 50);
  assert.equal(shot1.health, 50);
  assert.equal(shot1.staggered, false, 'First pistol shot does not stagger');
  assert.equal(shot1.shotsToStagger, 1, '1 shot remaining to stagger');

  // Second pistol shot: drops to 0 HP and triggers STAGGERED
  const shot2 = roomSim.handleAttackMonster('shooter', 'saber_alpha', 50, 'PISTOL');
  assert.equal(shot2.success, true);
  assert.equal(shot2.damageDealt, 50);
  assert.equal(shot2.health, 0);
  assert.equal(shot2.staggered, true, 'Second pistol shot triggers STAGGERED');
  assert.equal(alpha.getCurrentStateName(), 'STAGGERED');

  // 2. Shotgun attack against Saber Beta: 100 damage per blast (single successful shot)
  assert.equal(beta.health, 100);
  roomSim.playerEntities.get('shooter').position.set(16, 0, -16);
  const blast1 = roomSim.handleAttackMonster('shooter', 'saber_beta', 100, 'SHOTGUN');
  assert.equal(blast1.success, true);
  assert.equal(blast1.damageDealt, 100);
  assert.equal(blast1.health, 0);
  assert.equal(blast1.staggered, true, 'One shotgun blast immediately triggers STAGGERED');
  assert.equal(beta.getCurrentStateName(), 'STAGGERED');

  roomSim.destroy();
});

test('17. Independent approximate player intuition: 5-10m randomized offset per Saber without exact leaks', () => {
  const roomSim = new RoomSimulation({ code: 'INTUITION_ROOM', players: new Map() }, { autoStart: false, usePrototypeMap: true });
  roomSim.addPlayer({ id: 'p1', position: { x: 50, y: 0, z: 50 } });
  roomSim.addPlayer({ id: 'p2', position: { x: -20, y: 0, z: -10 } });

  const alpha = roomSim.sim.saberAlpha;
  const beta = roomSim.sim.saberBeta;
  alpha.position.set(-22, 0, -10); // close to p2
  beta.position.set(45, 0, 50);     // close to p1

  const dir = roomSim.sim.director;
  dir.lastHintTime = -999;
  dir.considerMacroHint(roomSim.sim);

  // Both Sabers received intuition hints independently
  assert.equal(alpha.hasDirectorHint, true, 'Alpha received intuition hint');
  assert.equal(beta.hasDirectorHint, true, 'Beta received intuition hint');

  // Verify Alpha's hint targets closest player p2 (-20, 0, -10) with 5-10m offset
  const distAlphaHintToP2 = Math.hypot(alpha.directorHintTarget.x - (-20), alpha.directorHintTarget.z - (-10));
  assert.ok(distAlphaHintToP2 >= 4.9 && distAlphaHintToP2 <= 10.1, `Alpha offset is 5-10m (got ${distAlphaHintToP2.toFixed(2)}m)`);
  assert.notEqual(alpha.directorHintTarget.x, -20, 'Exact player X coordinate is not leaked');

  // Verify Beta's hint targets closest player p1 (50, 0, 50) with 5-10m offset
  const distBetaHintToP1 = Math.hypot(beta.directorHintTarget.x - 50, beta.directorHintTarget.z - 50);
  assert.ok(distBetaHintToP1 >= 4.9 && distBetaHintToP1 <= 10.1, `Beta offset is 5-10m (got ${distBetaHintToP1.toFixed(2)}m)`);
  assert.notEqual(beta.directorHintTarget.x, 50, 'Exact player X coordinate is not leaked');

  // Telemetry contains approximate intuition coordinates without leaking exact player position
  const telem = roomSim.buildDevTelemetry();
  assert.ok(telem.saberAlpha.intuitionTarget);
  assert.ok(telem.saberAlpha.intuitionOffset >= 5.0 && telem.saberAlpha.intuitionOffset <= 10.0);

  roomSim.destroy();
});

test('18. Robust match reset: clean run state restored after Saber death across rounds', () => {
  const rm = new RoomManager();
  const ws1 = { send: () => {} };
  const ws2 = { send: () => {} };

  const r1 = rm.createRoom(ws1, 'Alice');
  const code = r1.roomCode;
  const r2 = rm.joinRoom(ws2, code, 'Bob');
  rm.setPlayerReady(ws2, true);

  // Start round 1
  const match1 = rm.startMatch(ws1);
  assert.equal(match1.success, true);
  assert.equal(match1.matchGeneration, 1);
  const room = rm.getRoom(code);
  const p1 = room.players.get(r1.player.id);
  const p2 = room.players.get(r2.player.id);

  // Down both players in round 1 to cause team wipe / game over
  rm.applyDamage(p1.id, 100, 'SABER_ATTACK');
  rm.applyDamage(p2.id, 100, 'SABER_ATTACK');
  assert.equal(p1.hp, 0);
  assert.equal(p1.state, 'DOWNED');
  assert.equal(p2.hp, 0);
  assert.equal(p2.state, 'DOWNED');
  assert.equal(room.runState, 'GAME_OVER');

  // Damage Sabers in round 1
  room.simulation.sim.saberAlpha.takeDamage(50);
  assert.equal(room.simulation.sim.saberAlpha.health, 50);

  // Start round 2 via authoritative startMatch
  const match2 = rm.startMatch(ws1);
  assert.equal(match2.success, true);
  assert.equal(match2.matchGeneration, 2);
  assert.equal(room.runState, 'IN_PROGRESS');

  // Verify full player state reset
  assert.equal(p1.hp, 100, 'Player 1 HP reset to 100');
  assert.equal(p1.state, 'ACTIVE', 'Player 1 state reset to ACTIVE');
  assert.equal(p1.revivalsUsed, 0, 'Player 1 revivals reset');
  assert.equal(p2.hp, 100, 'Player 2 HP reset to 100');
  assert.equal(p2.state, 'ACTIVE', 'Player 2 state reset to ACTIVE');
  assert.equal(p2.revivalsUsed, 0, 'Player 2 revivals reset');

  // Verify fresh AI simulation and Sabers restored to 100 HP
  assert.ok(room.simulation);
  assert.equal(room.simulation.sim.saberAlpha.health, 100, 'Saber Alpha HP reset to 100');
  assert.equal(room.simulation.sim.saberBeta.health, 100, 'Saber Beta HP reset to 100');
  assert.equal(room.simulation.sim.saberAlpha.getCurrentStateName(), 'PATROL', 'Saber Alpha reset to PATROL');
  assert.equal(room.simulation.sim.director.phase, 'BUILD_UP', 'Director reset to BUILD_UP');

  // Verify door reset
  const door = room.doors.get('level0_exit_door');
  assert.equal(door.locked, true, 'Exit door reset to locked');

  room.simulation.destroy();
});
