import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, SURVIVAL_CONFIG, configureSurvivalRules } from './room_manager.js';

const mockLayout = {
  placements: [
    { id: 'floor_first_aid_01', type: 'first_aid', position: [48.69, 0, -187.65] },
    { id: 'floor_first_aid_02', type: 'first_aid', position: [49.50, 0, -187.65] },
    { id: 'floor_first_aid_03', type: 'first_aid', position: [50.50, 0, -187.65] },
    { id: 'almond_01', type: 'almond_can', position: [48.69, 0, -187.0] }
  ]
};

test('1. Health and damage: Authoritative, configurable, clamped at zero', () => {
  const manager = new RoomManager();
  const ws1 = { send: () => {} };
  manager.createRoom(ws1, 'TEST_HP', 'default', mockLayout);

  const session = manager.getPlayer(ws1);
  assert.equal(session.player.hp, 100);
  assert.equal(session.player.maxHp, 100);
  assert.equal(session.player.state, 'ACTIVE');

  // Apply 25 damage
  const res1 = manager.applyDamage(ws1, 25, 'ZOMBIE_HIT');
  assert.equal(res1.damageApplied, 25);
  assert.equal(session.player.hp, 75);
  assert.equal(res1.events.some(e => e.type === 'PLAYER_HEALTH_UPDATE' && e.payload.hp === 75), true);

  // Apply 100 damage (should clamp to 0, not negative)
  const res2 = manager.applyDamage(ws1, 100, 'ZOMBIE_HIT');
  assert.equal(session.player.hp, 0);
  assert.equal(res2.events.some(e => e.type === 'PLAYER_HEALTH_UPDATE' && e.payload.hp === 0), true);
});

test('2. Solo behaviour: 0 HP triggers immediate game over, no revival', () => {
  const manager = new RoomManager();
  const ws1 = { send: () => {} };
  manager.createRoom(ws1, 'SOLO_ROOM', 'default', mockLayout);

  const res = manager.applyDamage(ws1, 100, 'HAZARD');
  assert.equal(res.player.hp, 0);
  assert.equal(res.player.state, 'ELIMINATED');
  assert.equal(res.player.isDead, true);
  assert.equal(res.room.runState, 'GAME_OVER');

  const elimEvent = res.events.find(e => e.type === 'PLAYER_ELIMINATED');
  assert.ok(elimEvent);
  assert.equal(elimEvent.payload.reason, 'SOLO_DEATH');

  const gameOverEvent = res.events.find(e => e.type === 'GAME_OVER');
  assert.ok(gameOverEvent);
  assert.equal(gameOverEvent.payload.reason, 'SOLO_DEATH');

  // Solo revival attempt must fail
  const reviveRes = manager.handleReviveRequest(ws1, res.player.id);
  assert.match(reviveRes.error, /Game is already over|Reviver must be active/);
});

test('3. Co-op downed: 0 HP enters DOWNED state; interaction suppressed; teammate revives using Health Pack', () => {
  const manager = new RoomManager();
  const ws1 = { send: () => {} };
  const ws2 = { send: () => {} };
  manager.createRoom(ws1, 'COOP_ROOM', 'default', mockLayout, { startingPlayers: 2 });
  manager.joinRoom(ws2, 'COOP_ROOM');

  const p1 = manager.getPlayer(ws1).player;
  const p2 = manager.getPlayer(ws2).player;

  // p2 acquires a Health Pack
  p2.inventory.addItem('first_aid', 1);
  assert.equal(p2.inventory.getCount('first_aid'), 1);

  // Set positions close together (within 2.8m)
  p1.position = { x: 50.0, y: 0.0, z: -187.0 };
  p2.position = { x: 51.0, y: 0.0, z: -187.0 };

  // p1 takes lethal damage
  const lethalRes = manager.applyDamage(ws1, 100, 'ZOMBIE_HIT');
  assert.equal(p1.hp, 0);
  assert.equal(p1.state, 'DOWNED');
  assert.equal(p1.isDowned, true);
  assert.equal(p1.isDead, false);
  assert.equal(lethalRes.room.runState, 'IN_PROGRESS'); // Room continues!

  const downedEvent = lethalRes.events.find(e => e.type === 'PLAYER_DOWNED');
  assert.ok(downedEvent);
  assert.equal(downedEvent.payload.playerId, p1.id);

  // Downed player cannot perform interactions (pickup, use, etc.)
  const pickupRes = manager.handlePickupRequest(ws1, 'almond_01');
  assert.match(pickupRes.error, /Player is downed and cannot interact/);

  const useRes = manager.handleUseItem(ws1, 0);
  assert.match(useRes.error, /Player is downed and cannot use items/);

  // Revive attempt from too far away should fail without consuming Health Pack
  p2.position = { x: 100.0, y: 0.0, z: 100.0 };
  const distantRevive = manager.handleReviveRequest(ws2, p1.id);
  assert.match(distantRevive.error, /too far/);
  assert.equal(p2.inventory.getCount('first_aid'), 1); // 0 consumed on failure

  // Revive attempt within range
  p2.position = { x: 51.0, y: 0.0, z: -187.0 };
  const reviveRes = manager.handleReviveRequest(ws2, p1.id);
  assert.equal(reviveRes.success, true);
  assert.equal(p1.state, 'ACTIVE');
  assert.equal(p1.hp, 50); // Restored to 50 HP
  assert.equal(p1.revivalsUsed, 1);
  assert.equal(p2.inventory.getCount('first_aid'), 0); // Exactly 1 consumed on success
});

test('4. Revival limit (1 per run) & permanent elimination on second death', () => {
  const manager = new RoomManager();
  const ws1 = { send: () => {} };
  const ws2 = { send: () => {} };
  manager.createRoom(ws1, 'PERM_ELIM', 'default', mockLayout, { startingPlayers: 2 });
  manager.joinRoom(ws2, 'PERM_ELIM');

  const p1 = manager.getPlayer(ws1).player;
  const p2 = manager.getPlayer(ws2).player;
  p2.inventory.addItem('first_aid', 2);
  p1.position = { x: 50.0, y: 0.0, z: -187.0 };
  p2.position = { x: 51.0, y: 0.0, z: -187.0 };

  // First down & revive
  manager.applyDamage(ws1, 100, 'ZOMBIE_HIT');
  assert.equal(p1.state, 'DOWNED');
  manager.handleReviveRequest(ws2, p1.id);
  assert.equal(p1.state, 'ACTIVE');
  assert.equal(p1.revivalsUsed, 1);

  // Second lethal damage -> Permanent Elimination
  const secondLethal = manager.applyDamage(ws1, 100, 'ZOMBIE_HIT');
  assert.equal(p1.state, 'ELIMINATED');
  assert.equal(p1.isDead, true);
  assert.equal(p1.isDowned, false);

  const elimEvent = secondLethal.events.find(e => e.type === 'PLAYER_ELIMINATED');
  assert.ok(elimEvent);
  assert.equal(elimEvent.payload.reason, 'PERMANENT_ELIMINATION');

  // p2 is still alive, so runState remains IN_PROGRESS
  assert.equal(secondLethal.room.runState, 'IN_PROGRESS');

  // Attempting to revive eliminated player must fail
  const failedRevive = manager.handleReviveRequest(ws2, p1.id);
  assert.match(failedRevive.error, /permanently eliminated and cannot be revived/);
  assert.equal(p2.inventory.getCount('first_aid'), 1); // Not consumed

  // When surviving player p2 also dies -> TEAM_WIPED game over
  const wipeRes = manager.applyDamage(ws2, 100, 'ZOMBIE_HIT');
  assert.equal(wipeRes.room.runState, 'GAME_OVER');
  const goEvent = wipeRes.events.find(e => e.type === 'GAME_OVER');
  assert.ok(goEvent);
  assert.equal(goEvent.payload.reason, 'TEAM_WIPED');
});

test('5. Health Pack economy: Supply scales with starting player count and freezes against late joiners', () => {
  const manager = new RoomManager();
  const ws1 = { send: () => {} };
  // Start with 1 player
  const roomRes = manager.createRoom(ws1, 'SUPPLY_TEST', 'default', mockLayout, { startingPlayers: 1 });
  const room = manager.getRoom('SUPPLY_TEST');

  // In mockLayout there are 3 first_aid items. With startingPlayers: 1, exactly 1 must be available
  assert.equal(room.availableHealthPackCount, 1);
  assert.equal(room.healthPacksFrozen, true);

  const aid1 = room.worldItems.get('floor_first_aid_01');
  const aid2 = room.worldItems.get('floor_first_aid_02');
  const aid3 = room.worldItems.get('floor_first_aid_03');

  assert.equal(aid1.available, true);
  assert.equal(aid2.available, false);
  assert.equal(aid2.cappedUnavailable, true);
  assert.equal(aid3.available, false);
  assert.equal(aid3.cappedUnavailable, true);

  // Late joiner joins room
  const ws2 = { send: () => {} };
  const joinRes = manager.joinRoom(ws2, 'SUPPLY_TEST');
  assert.equal(joinRes.totalPlayers, 2);

  // Supply must NOT increase for late joiners! Still 1
  assert.equal(room.availableHealthPackCount, 1);
  assert.equal(aid2.available, false);
  assert.equal(aid3.available, false);

  // Late joiner receives capped items in collectedItems
  assert.equal(joinRes.collectedItems.includes('floor_first_aid_02'), true);
  assert.equal(joinRes.collectedItems.includes('floor_first_aid_03'), true);

  // Attempting to pick up capped Health Pack is rejected
  const pickRes = manager.handlePickupRequest(ws2, 'floor_first_aid_02');
  assert.match(pickRes.error, /supply capped by starting player count/);
});

test('6. Sanity separation: Zero sanity causes psychological collapse without health death; HP 0 downs player without changing sanity', async () => {
  const { SanityController, SANITY_STATE } = await import('../js/multiplayer/sanity_controller.js');
  const sanity = new SanityController();
  const manager = new RoomManager();
  const ws = { send: () => {} };
  manager.createRoom(ws, 'SANITY_SEP', 'default', mockLayout);
  const p = manager.getPlayer(ws).player;

  // Initial state
  assert.equal(p.hp, 100);
  assert.equal(sanity.currentSanity, 100);
  assert.equal(sanity.state, SANITY_STATE.NORMAL);

  // Deplete sanity completely to 0 (psychological collapse)
  sanity.drainSanity(100);
  assert.equal(sanity.currentSanity, 0);
  assert.equal(sanity.state, SANITY_STATE.DEPLETED);

  // Player health must remain untouched at 100 HP, state remains ACTIVE (not downed, not dead)
  assert.equal(p.hp, 100);
  assert.equal(p.state, 'ACTIVE');
  assert.equal(p.isDead, false);
  assert.equal(p.isDowned, false);

  // Restore sanity via rapid regen (Almond Water consumption)
  sanity.restoreSanity(50);
  assert.equal(sanity.currentSanity, 50);
  assert.equal(p.hp, 100);

  // Now apply health damage to 0 HP
  const dmgRes = manager.applyDamage(ws, 100, 'ZOMBIE_HIT');
  assert.equal(p.hp, 0);
  assert.equal(p.state, 'ELIMINATED'); // Solo run ended
  // Sanity was NOT modified by health damage
  assert.equal(sanity.currentSanity, 50);
});

