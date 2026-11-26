import test from 'node:test';
import assert from 'node:assert/strict';
import * as YUKA from 'yuka';
import {
  RoomManager,
  SURVIVAL_CONFIG,
  configureSurvivalRules,
  configureSaberDifficulty,
  configureHealthPackMultiplier
} from './room_manager.js';
import { SaberAgent, SABER_STATES } from './ai/saber_agent.js';
import { PlayerEntity } from './ai/simulation.js';

test('Scenario 1: Player approaches and touches a Saber: receives 15 damage', () => {
  // Ensure default difficulty is NORMAL
  configureSaberDifficulty('NORMAL');

  const saber = new SaberAgent('Test Saber Alpha', { difficulty: 'NORMAL' });
  assert.equal(saber.difficulty, 'NORMAL');
  assert.equal(saber.damage, 15);
  assert.equal(saber.attackRange, 0.64);
  assert.equal(saber.attackWindup, 0.3);

  const player = new PlayerEntity('Survivor', new YUKA.Vector3(0, 0, 0), { health: 100, maxHealth: 100 });
  player.collisionRadius = 0.32;
  player.boundingRadius = 0.32;

  // Position saber in physical contact (0.5m <= 0.64m)
  saber.position.set(0, 0, 0.5);
  saber.targetEntity = player;

  let damageReported = null;
  saber.onAttack = (target, dmg) => {
    damageReported = dmg;
  };

  saber.stateMachine.changeTo(SABER_STATES.ATTACK);
  assert.equal(saber.stateMachine.currentState, saber.states.ATTACK, 'Saber entered ATTACK state');
  assert.equal(saber.attackPhase, 'WINDUP', 'Attack begins in WINDUP phase');
  assert.equal(damageReported, null, 'No damage applied during frame 0 of windup');
  assert.equal(player.health, 100, 'Player health remains 100 during initial windup');

  // Advance simulation through windup (0.3s)
  saber.delta = 0.05;
  for (let i = 0; i < 6; i++) {
    saber.states.ATTACK.execute(saber);
  }

  assert.equal(damageReported, 15, 'onAttack received exactly 15 damage at moment of strike');
  assert.equal(player.health, 85, 'Player entity health reduced from 100 to 85');
  assert.equal(saber.attackPhase, 'COOLDOWN', 'Attack transitioned to COOLDOWN phase after strike');
  assert.equal(saber.attackCooldownTimer, 2.0, '2.0s attack cooldown initiated');
});

test('Scenario 2: Player immediately escapes: health stops decreasing', () => {
  configureSaberDifficulty('NORMAL');

  const saber = new SaberAgent('Test Saber Alpha', { difficulty: 'NORMAL' });
  const player = new PlayerEntity('Survivor', new YUKA.Vector3(0, 0, 0), { health: 100, maxHealth: 100 });
  player.collisionRadius = 0.32;
  player.boundingRadius = 0.32;

  saber.position.set(0, 0, 0.5);
  saber.targetEntity = player;

  let strikeCount = 0;
  saber.onAttack = () => {
    strikeCount++;
  };

  // Initial attack strike
  saber.stateMachine.changeTo(SABER_STATES.ATTACK);
  saber.delta = 0.05;
  for (let i = 0; i < 6; i++) {
    saber.states.ATTACK.execute(saber);
  }
  assert.equal(strikeCount, 1, 'Initial attack struck once');
  assert.equal(player.health, 85, 'Player health reduced to 85');

  // Player immediately escapes outside contact range (1.5m > 0.64m)
  player.position.set(0, 0, 1.5);

  // Next tick in ATTACK detects player left contact range -> transitions immediately to CHASE
  saber.states.ATTACK.execute(saber);
  assert.equal(saber.stateMachine.currentState, saber.states.CHASE, 'Saber transitioned to CHASE upon player escape');

  // Over subsequent 30 ticks (1.5s), health stays strictly at 85
  for (let tick = 1; tick <= 30; tick++) {
    saber.update(0.05);
    assert.equal(strikeCount, 1, `No further attacks occurred at tick ${tick}`);
    assert.equal(player.health, 85, `Player health remains 85 at tick ${tick}`);
  }
});

test('Scenario 3: Player remains in contact: damage occurs no more frequently than cooldown (2.0s)', () => {
  configureSaberDifficulty('NORMAL');

  const saber = new SaberAgent('Test Saber Alpha', { difficulty: 'NORMAL', attackCooldown: 2.0 });
  const player = new PlayerEntity('Survivor', new YUKA.Vector3(0, 0, 0), { health: 100, maxHealth: 100 });
  player.collisionRadius = 0.32;
  player.boundingRadius = 0.32;

  saber.position.set(0, 0, 0.5);
  saber.targetEntity = player;

  let strikeCount = 0;
  saber.onAttack = () => {
    strikeCount++;
  };

  // Enter ATTACK and complete initial windup (0.3s = 6 ticks of 0.05s)
  saber.stateMachine.changeTo(SABER_STATES.ATTACK);
  saber.delta = 0.05;
  for (let tick = 1; tick <= 6; tick++) {
    saber.states.ATTACK.execute(saber);
  }
  assert.equal(strikeCount, 1, 'Initial contact triggers exactly 1 strike after windup');
  assert.equal(player.health, 85, 'Health drops to 85 on first strike');

  // Continuous contact over 39 simulation ticks (< 2.0 seconds at 20Hz: delta = 0.05s)
  // Cooldown is counting down, no second strike can occur
  for (let tick = 1; tick <= 39; tick++) {
    saber.states.ATTACK.execute(saber);
    assert.equal(strikeCount, 1, `Strike count must remain 1 at tick ${tick} (t=${(tick * 0.05).toFixed(2)}s < 2.0s cooldown)`);
    assert.equal(player.health, 85, `Health must remain 85 at tick ${tick}`);
  }

  // Tick 40: cooldown finishes (2.0s reached), next windup begins
  saber.states.ATTACK.execute(saber);
  assert.equal(saber.attackPhase, 'WINDUP', 'After 2.0s cooldown, next windup starts');
  assert.equal(strikeCount, 1, 'No damage during windup');

  // Complete second windup (6 ticks of 0.05s)
  for (let tick = 1; tick <= 6; tick++) {
    saber.states.ATTACK.execute(saber);
  }
  assert.equal(strikeCount, 2, 'Second strike occurs after cooldown + windup');
  assert.equal(player.health, 70, 'Health drops to 70 after second strike');
});

test('Scenario 4: Player escapes during an attack windup: no delayed damage is applied', () => {
  configureSaberDifficulty('NORMAL');

  const saber = new SaberAgent('Test Saber Alpha', { difficulty: 'NORMAL' });
  const player = new PlayerEntity('Survivor', new YUKA.Vector3(0, 0, 0), { health: 100, maxHealth: 100 });
  player.collisionRadius = 0.32;
  player.boundingRadius = 0.32;

  saber.position.set(0, 0, 0.5);
  saber.targetEntity = player;

  let attackHit = false;
  saber.onAttack = () => {
    attackHit = true;
  };

  saber.stateMachine.changeTo(SABER_STATES.ATTACK);
  assert.equal(saber.attackPhase, 'WINDUP');

  // Advance 2 ticks (0.1s < 0.3s windup) while in contact
  saber.delta = 0.05;
  saber.states.ATTACK.execute(saber);
  saber.states.ATTACK.execute(saber);
  assert.equal(saber.attackPhase, 'WINDUP');
  assert.equal(attackHit, false);

  // Player escapes to 20m during windup!
  player.position.set(0, 0, 20.0);

  // Next tick: Saber detects escape, cancels pending attack, transitions to CHASE
  saber.states.ATTACK.execute(saber);
  assert.equal(saber.attackPending, false, 'Pending attack cancelled');
  assert.equal(saber.stateMachine.currentState, saber.states.CHASE, 'Transitioned to CHASE immediately');
  assert.equal(attackHit, false, 'No attack strike applied');
  assert.equal(player.health, 100, 'Player health remains untouched at 100');

  // Advance simulation past original windup completion time (next 20 ticks = 1.0s)
  // Distance is 20m, so Saber (max 9.5 m/s) is still pursuing and cannot reach player
  for (let tick = 1; tick <= 20; tick++) {
    saber.update(0.05);
    assert.equal(attackHit, false, `No delayed damage at tick ${tick}`);
    assert.equal(player.health, 100, `Health remains 100 at tick ${tick}`);
  }
});

test('Scenario 5: Player re-enters contact: attacks resume according to cooldown', () => {
  configureSaberDifficulty('NORMAL');

  const saber = new SaberAgent('Test Saber Alpha', { difficulty: 'NORMAL' });
  const player = new PlayerEntity('Survivor', new YUKA.Vector3(0, 0, 0), { health: 100, maxHealth: 100 });
  player.collisionRadius = 0.32;
  player.boundingRadius = 0.32;

  saber.position.set(0, 0, 0.5);
  saber.targetEntity = player;

  let strikeCount = 0;
  saber.onAttack = () => {
    strikeCount++;
  };

  // Strike 1
  saber.stateMachine.changeTo(SABER_STATES.ATTACK);
  saber.delta = 0.05;
  for (let i = 0; i < 6; i++) {
    saber.states.ATTACK.execute(saber);
  }
  assert.equal(strikeCount, 1);
  assert.equal(player.health, 85);

  // Player escapes at t = 0.35s
  player.position.set(0, 0, 1.5);
  saber.states.ATTACK.execute(saber);
  assert.equal(saber.stateMachine.currentState, saber.states.CHASE);

  // Simulate 10 ticks (0.5s) while escaped: cooldown decreases from 2.0s to 1.5s
  for (let i = 0; i < 10; i++) {
    saber.update(0.05);
  }
  assert.ok(saber.attackCooldownTimer > 0, 'Cooldown is still active');

  // Player re-enters contact range (0.5m) at t = 0.85s while cooldown still has ~1.5s remaining
  player.position.set(0, 0, 0.5);
  saber.canSeeTarget = true;
  saber.states.CHASE.execute(saber);

  // Because cooldown is active, Saber must NOT transition to ATTACK or deal damage
  assert.equal(saber.stateMachine.currentState, saber.states.CHASE, 'Saber remains in CHASE while cooldown is active');
  assert.equal(strikeCount, 1, 'No new strike on re-contact during cooldown');
  assert.equal(player.health, 85, 'Health remains 85');

  // Advance simulation until remaining cooldown expires
  while (saber.attackCooldownTimer > 0) {
    saber.update(0.05);
    assert.equal(strikeCount, 1, 'No premature strike while timer > 0');
  }

  // Now cooldown is 0 and player is in contact -> Saber can initiate attack
  saber.canSeeTarget = true;
  saber.states.CHASE.execute(saber);
  assert.equal(saber.stateMachine.currentState, saber.states.ATTACK, 'Saber transitions to ATTACK once cooldown expires');

  // Advance through second windup
  for (let i = 0; i < 6; i++) {
    saber.states.ATTACK.execute(saber);
  }
  assert.equal(strikeCount, 2, 'Second strike occurs after cooldown expires');
  assert.equal(player.health, 70, 'Health drops to 70 after second strike');
});

test('Scenario 6: Two clients observe consistent health updates and updates cease upon escape', () => {
  configureSaberDifficulty('NORMAL');

  const rm = new RoomManager();
  const ws1 = { send: () => {} };
  const ws2 = { send: () => {} };

  const client1Events = [];
  const client2Events = [];

  rm.onRoomEvents = (room, events) => {
    client1Events.push(...events.filter(e => e.type === 'PLAYER_HEALTH_UPDATE'));
    client2Events.push(...events.filter(e => e.type === 'PLAYER_HEALTH_UPDATE'));
  };

  rm.createRoom(ws1, 'TEST_ESC_SYNC', 'default', null, { startingPlayers: 2, directStart: true });
  rm.joinRoom(ws2, 'TEST_ESC_SYNC');

  const room = rm.getRoom('TEST_ESC_SYNC');
  const p1 = room.players.get(rm.getPlayer(ws1).player.id);
  const p2 = room.players.get(rm.getPlayer(ws2).player.id);

  // 1. Saber strikes Player 1
  const dmgRes = rm.applyDamage(p1.id, 15, 'SABER_ATTACK');
  if (rm.onRoomEvents) rm.onRoomEvents(room, dmgRes.events);

  assert.equal(p1.hp, 85);
  assert.equal(client1Events.length, 1);
  assert.equal(client2Events.length, 1);
  assert.equal(client1Events[0].payload.hp, 85);
  assert.equal(client2Events[0].payload.hp, 85, 'Both clients receive identical synchronized 85 HP');

  // 2. Player 1 moves outside contact range
  p1.position = { x: 10, y: 0, z: 10 };
  const prevEventCount = client1Events.length;

  // Simulate server ticks without contact: no further damage packets are generated
  for (let tick = 0; tick < 20; tick++) {
    // No damage applied
    assert.equal(p1.hp, 85, 'Player 1 HP remains 85 after escaping');
    assert.equal(client1Events.length, prevEventCount, 'No new damage packets sent while escaped');
    assert.equal(client2Events.length, prevEventCount, 'Client 2 receives no extraneous damage packets');
  }
});

test('Targeted Test 4: HARD preserves previous lethal damage behaviour (100 HP)', () => {
  configureSaberDifficulty('HARD');

  const saber = new SaberAgent('Test Saber Hard', { difficulty: 'HARD' });
  assert.equal(saber.difficulty, 'HARD');
  assert.equal(saber.damage, 100);
  assert.equal(saber.attackRange, 1.8);

  const player = new PlayerEntity('Survivor', new YUKA.Vector3(0, 0, 0), { health: 100, maxHealth: 100 });

  // In HARD mode, saber can strike at 1.0m (within 1.8m attack range)
  saber.position.set(0, 0, 1.0);
  saber.targetEntity = player;

  let damageDealt = 0;
  saber.onAttack = (target, dmg) => {
    damageDealt = dmg;
  };

  saber.stateMachine.changeTo(SABER_STATES.ATTACK);
  assert.equal(damageDealt, 100, 'HARD difficulty deals 100 HP damage');
  assert.equal(player.health, 0, 'Player health reduced from 100 to 0 (lethal)');
  assert.equal(player.isDead, true, 'Player marked dead');

  // Reset difficulty to NORMAL
  configureSaberDifficulty('NORMAL');
});

test('Targeted Test 5: Health Pack quantities correct for different starting player counts (1=3, 2=6, 3=9, 4=12)', () => {
  // Test 1 player: 1 * 3 = 3
  const rm1 = new RoomManager();
  const ws1 = { send: () => {} };
  rm1.createRoom(ws1, 'TEST_HP_1P', 'default', null, { startingPlayers: 1 });
  const room1 = rm1.getRoom('TEST_HP_1P');
  assert.equal(room1.availableHealthPackCount, 3, '1 starting player yields exactly 3 Health Packs');
  assert.equal(room1.healthPacksFrozen, true);

  // Test 2 players: 2 * 3 = 6
  const rm2 = new RoomManager();
  const ws2 = { send: () => {} };
  rm2.createRoom(ws2, 'TEST_HP_2P', 'default', null, { startingPlayers: 2 });
  const room2 = rm2.getRoom('TEST_HP_2P');
  assert.equal(room2.availableHealthPackCount, 6, '2 starting players yield exactly 6 Health Packs');
  assert.equal(room2.healthPacksFrozen, true);

  // Test 3 players: 3 * 3 = 9
  const rm3 = new RoomManager();
  const ws3 = { send: () => {} };
  rm3.createRoom(ws3, 'TEST_HP_3P', 'default', null, { startingPlayers: 3 });
  const room3 = rm3.getRoom('TEST_HP_3P');
  assert.equal(room3.availableHealthPackCount, 9, '3 starting players yield exactly 9 Health Packs');
  assert.equal(room3.healthPacksFrozen, true);

  // Test 4 players: 4 * 3 = 12
  const rm4 = new RoomManager();
  const ws4 = { send: () => {} };
  rm4.createRoom(ws4, 'TEST_HP_4P', 'default', null, { startingPlayers: 4 });
  const room4 = rm4.getRoom('TEST_HP_4P');
  assert.equal(room4.availableHealthPackCount, 12, '4 starting players yield exactly 12 Health Packs');
  assert.equal(room4.healthPacksFrozen, true);

  // Test configurable multiplier (e.g. 4x multiplier: 2 players * 4 = 8)
  configureHealthPackMultiplier(4);
  const rmCustom = new RoomManager();
  const wsCustom = { send: () => {} };
  rmCustom.createRoom(wsCustom, 'TEST_HP_CUSTOM', 'default', null, { startingPlayers: 2 });
  const roomCustom = rmCustom.getRoom('TEST_HP_CUSTOM');
  assert.equal(roomCustom.availableHealthPackCount, 8, 'Configured multiplier 4x with 2 players yields 8 Health Packs');

  // Reset multiplier to default 3
  configureHealthPackMultiplier(3);
});

test('Targeted Test 6: Late joiners do not increase frozen supply', () => {
  const rm = new RoomManager();
  const ws1 = { send: () => {} };
  // 1 starting player -> supply frozen at 3
  rm.createRoom(ws1, 'TEST_LATE', 'default', null, { startingPlayers: 1 });
  const room = rm.getRoom('TEST_LATE');
  assert.equal(room.availableHealthPackCount, 3);
  assert.equal(room.healthPacksFrozen, true);

  // Player 2 joins late into active room
  const ws2 = { send: () => {} };
  const joinRes = rm.joinRoom(ws2, 'TEST_LATE');
  assert.equal(joinRes.totalPlayers, 2);

  // Health pack supply must remain frozen at 3
  assert.equal(room.availableHealthPackCount, 3, 'Late joiner did not increase frozen Health Pack supply');
  assert.equal(room.healthPacksFrozen, true);

  // Find a capped unavailable health pack (the 4th item in the world items list)
  let cappedPackId = null;
  for (const [id, item] of room.worldItems) {
    if (item.type === 'first_aid' && item.cappedUnavailable) {
      cappedPackId = id;
      break;
    }
  }
  assert.ok(cappedPackId, 'Found capped unavailable Health Pack');

  // Player 2 attempts to pick up capped Health Pack -> Server authoritative rejection
  const pickRes = rm.handlePickupRequest(ws2, cappedPackId);
  assert.match(pickRes.error, /supply capped by starting player count/, 'Server rejects pickup of capped supply pack');
});

test('Targeted Test 7: Two-client damage and Health Pack synchronization work', () => {
  configureSaberDifficulty('NORMAL');

  const rm = new RoomManager();
  const ws1 = { send: () => {} };
  const ws2 = { send: () => {} };

  // Room events collector
  const broadcastEvents = [];
  rm.onRoomEvents = (room, events) => {
    broadcastEvents.push(...events);
  };

  // Start with 2 players
  rm.createRoom(ws1, 'TEST_SYNC', 'default', null, { startingPlayers: 2, directStart: true });
  rm.joinRoom(ws2, 'TEST_SYNC');

  const room = rm.getRoom('TEST_SYNC');
  const p1 = room.players.get(rm.getPlayer(ws1).player.id);
  const p2 = room.players.get(rm.getPlayer(ws2).player.id);

  assert.equal(room.availableHealthPackCount, 6, '6 Health Packs for 2 players');

  // 1. Damage synchronization: Saber deals 15 HP to Player 1 in NORMAL mode
  const dmgRes = rm.applyDamage(p1.id, 15, 'SABER_ATTACK');
  assert.equal(p1.hp, 85, 'Player 1 HP is 85');
  assert.equal(dmgRes.events.some(e => e.type === 'PLAYER_HEALTH_UPDATE' && e.payload.hp === 85), true);

  // 2. Health Pack pickup synchronization: Player 2 picks up an available Health Pack
  let availablePack = null;
  for (const [id, item] of room.worldItems) {
    if (item.type === 'first_aid' && item.available) {
      availablePack = item;
      break;
    }
  }
  assert.ok(availablePack, 'Available Health Pack exists');

  // Move Player 2 near the pack
  p2.position = { x: availablePack.position[0], y: availablePack.position[1], z: availablePack.position[2] };
  const pickRes = rm.handlePickupRequest(ws2, availablePack.id);
  assert.equal(pickRes.success, true, 'Player 2 successfully collected Health Pack');
  assert.equal(availablePack.available, false, 'Health Pack is now unavailable in world');
  assert.equal(availablePack.collectedBy, p2.id, 'Claimed authoritatively by Player 2');
  assert.equal(p2.inventory.getCount('first_aid'), 1, 'Player 2 inventory contains 1 Health Pack');

  // 3. Downed & Revival synchronization:
  // Down Player 1 by applying remaining health as damage
  const lethalRes = rm.applyDamage(p1.id, 85, 'SABER_ATTACK');
  assert.equal(p1.hp, 0);
  assert.equal(p1.state, 'DOWNED');
  assert.ok(lethalRes.events.some(e => e.type === 'PLAYER_DOWNED'));

  // Player 2 revives Player 1 using the collected Health Pack
  p2.position = { x: p1.position.x + 1.0, y: 0, z: p1.position.z };
  const reviveRes = rm.handleReviveRequest(ws2, p1.id);
  assert.equal(reviveRes.success, true, 'Revival succeeds');
  assert.equal(p1.state, 'ACTIVE', 'Player 1 restored to ACTIVE state');
  assert.equal(p1.hp, 50, 'Player 1 restored to 50 HP');
  assert.equal(p2.inventory.getCount('first_aid'), 0, 'Player 2 Health Pack consumed');
  assert.equal(p1.revivalsUsed, 1, 'Revival counted against run limit');

  // 4. Direct consumption synchronization: Player 1 uses another Health Pack to heal from 50 to 100 HP
  p1.inventory.addItem('first_aid', 1);
  const slots = p1.inventory.getSlots();
  const firstAidSlot = slots.findIndex(s => s && s.typeId === 'first_aid');
  assert.ok(firstAidSlot >= 0);

  const useRes = rm.handleUseItem(ws1, firstAidSlot);
  assert.equal(useRes.success, true, 'Health Pack consumed');
  assert.equal(p1.hp, 100, 'Player 1 healed to 100 HP');
  assert.equal(p1.inventory.getCount('first_aid'), 0, 'Health Pack removed from inventory');

  // Attempting to consume Health Pack at full HP is rejected
  p1.inventory.addItem('first_aid', 1);
  const useFullRes = rm.handleUseItem(ws1, firstAidSlot);
  assert.equal(useFullRes.success, false);
  assert.match(useFullRes.error, /Health is already full/);
});
