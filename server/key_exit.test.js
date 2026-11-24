import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager, configureSurvivalRules } from './room_manager.js';

function createMockSocket() {
  const ws = {
    readyState: 1, // OPEN
    sent: [],
    send(data) {
      this.sent.push(JSON.parse(data));
    },
    close() {
      this.readyState = 3;
    }
  };
  return ws;
}

test('Saber Killer Level 0 Key & Exit Door Objective Suite', async (t) => {
  await t.test('1. Key scaling: Solo (1 key) vs two-player (2 keys) key generation & registry', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();

    // 1. Solo room configuration
    rm.createRoom(ws1, 'ROOM_SCALE_1', 'rev1', null, { startingPlayers: 1, directStart: true });
    const soloRoom = rm.getRoom('ROOM_SCALE_1');
    assert.equal(soloRoom.requiredKeyCount, 1, 'Solo run requires exactly 1 key');
    const soloActiveKeys = [...soloRoom.worldItems.values()].filter(i => i.type === 'doorKey' && i.available);
    assert.equal(soloActiveKeys.length, 1, 'Solo run must have exactly 1 active key in world');

    // 2. Two-player room configuration
    const ws2a = createMockSocket();
    const ws2b = createMockSocket();
    rm.createRoom(ws2a, 'ROOM_SCALE_2', 'rev1', null, { startingPlayers: 2, directStart: true });
    rm.joinRoom(ws2b, 'ROOM_SCALE_2');
    const duoRoom = rm.getRoom('ROOM_SCALE_2');
    assert.equal(duoRoom.requiredKeyCount, 2, 'Two-player run requires exactly 2 keys');
    const duoActiveKeys = [...duoRoom.worldItems.values()].filter(i => i.type === 'doorKey' && i.available);
    assert.equal(duoActiveKeys.length, 2, 'Two-player run must have exactly 2 active keys in world');

    // 3. Dynamic scaling via startMatch in staging lobby
    const ws3a = createMockSocket();
    const ws3b = createMockSocket();
    rm.createRoom(ws3a, 'ROOM_SCALE_3', 'rev1'); // In LOBBY mode
    rm.joinRoom(ws3b, 'ROOM_SCALE_3');
    const lobbyRoom = rm.getRoom('ROOM_SCALE_3');
    for (const p of lobbyRoom.players.values()) {
      p.isReady = true;
    }
    const startRes = rm.startMatch(ws3a);
    assert.equal(startRes.success, true);
    assert.equal(lobbyRoom.requiredKeyCount, 2, 'Match start with 2 players configures 2 required keys');
    const lobbyActiveKeys = [...lobbyRoom.worldItems.values()].filter(i => i.type === 'doorKey' && i.available);
    assert.equal(lobbyActiveKeys.length, 2, 'Lobby match start produces 2 active keys');

    // 4. Configurable keys per player
    configureSurvivalRules({ keysPerStartingPlayer: 2 });
    const ws4 = createMockSocket();
    rm.createRoom(ws4, 'ROOM_SCALE_4', 'rev1', null, { startingPlayers: 2, directStart: true });
    const customRoom = rm.getRoom('ROOM_SCALE_4');
    assert.equal(customRoom.requiredKeyCount, 4, 'Configured keysPerStartingPlayer: 2 results in 4 required keys');
    configureSurvivalRules({ keysPerStartingPlayer: 1 }); // Reset back to default 1
  });

  await t.test('2. Authoritative key registry & fix for visual key pickup rejection', () => {
    const rm = new RoomManager();
    const ws = createMockSocket();

    // Simulated layout containing 3 candidate key placements
    const mockLayout = {
      placements: [
        { id: 'floor_door_key_01', type: 'doorKey', position: [45.0, 0.02, -189.5] },
        { id: 'table_door_key_01', type: 'doorKey', position: [44.15, 0.936, -185.2] },
        { id: 'shelf_door_key_tier3', type: 'doorKey', position: [44.5, 1.188, -189.5] },
        { id: 'floor_first_aid_01', type: 'first_aid', position: [48.69, 0.0, -187.65] }
      ]
    };

    const res = rm.createRoom(ws, 'ROOM_KEY_REG', 'rev1', mockLayout, { startingPlayers: 1, directStart: true });
    const room = rm.getRoom('ROOM_KEY_REG');

    // All 3 keys are present in room.worldItems (none are deleted!)
    assert.ok(room.worldItems.has('shelf_door_key_tier3'), 'shelf key exists');
    assert.ok(room.worldItems.has('table_door_key_01'), 'table key exists in registry');
    assert.ok(room.worldItems.has('floor_door_key_01'), 'floor key exists in registry');

    // Exactly 1 is active (shelf), 2 are supply-capped
    const shelfKey = room.worldItems.get('shelf_door_key_tier3');
    const tableKey = room.worldItems.get('table_door_key_01');
    assert.equal(shelfKey.available, true, 'Active key must be available');
    assert.equal(tableKey.available, false, 'Surplus key must be marked unavailable');
    assert.equal(tableKey.cappedUnavailable, true, 'Surplus key marked cappedUnavailable');

    // Surplus keys are included in collectedItems sent to client so they are hidden
    assert.ok(res.collectedItems.includes('table_door_key_01'), 'Surplus table key sent in collectedItems');
    assert.ok(res.collectedItems.includes('floor_door_key_01'), 'Surplus floor key sent in collectedItems');

    // Attempting to pick up surplus key gives clean "is unavailable", never "does not exist in layout"
    const p1 = [...room.players.values()][0];
    const tablePos = { x: 44.15, y: 0.936, z: -185.2 };
    p1.position = { ...tablePos };
    const pickupRes = rm.handlePickupRequest(ws, 'table_door_key_01', tablePos);
    assert.equal(pickupRes.success, undefined);
    assert.match(pickupRes.error, /is unavailable/i);
    assert.doesNotMatch(pickupRes.error, /does not exist in room layout/i);
  });

  await t.test('3. Authoritative key pickup & no player binding: Any player can collect any key', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();

    rm.createRoom(ws1, 'ROOM_KEY_PICK', 'default', null, { startingPlayers: 2, directStart: true });
    rm.joinRoom(ws2, 'ROOM_KEY_PICK');

    const room = rm.getRoom('ROOM_KEY_PICK');
    const activeKeys = [...room.worldItems.values()].filter(i => i.type === 'doorKey' && i.available);
    assert.equal(activeKeys.length, 2, 'Must have 2 active keys for 2 players');

    const [key1, key2] = activeKeys;
    const p1 = room.players.get('p_1');
    const p2 = room.players.get('p_2');

    // Player 1 collects key 1
    const pos1 = { x: key1.position[0], y: key1.position[1], z: key1.position[2] + 0.5 };
    p1.position = { ...pos1 };
    const claim1 = rm.handlePickupRequest(ws1, key1.id, pos1);
    assert.equal(claim1.success, true);
    assert.equal(p1.inventory.getCount('doorKey'), 1);

    // Player 2 collects key 2 (not bound to specific player)
    const pos2 = { x: key2.position[0], y: key2.position[1], z: key2.position[2] + 0.5 };
    p2.position = { ...pos2 };
    const claim2 = rm.handlePickupRequest(ws2, key2.id, pos2);
    assert.equal(claim2.success, true);
    assert.equal(p2.inventory.getCount('doorKey'), 1);

    // Both players carry 1 key
    assert.equal(p1.inventory.getCount('doorKey'), 1);
    assert.equal(p2.inventory.getCount('doorKey'), 1);
  });

  await t.test('4. Key dropping and re-pickup behaves normally without duplicating key', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();

    rm.createRoom(ws1, 'ROOM_KEY_DROP', 'default', null, { startingPlayers: 1, directStart: true });
    rm.joinRoom(ws2, 'ROOM_KEY_DROP');

    const room = rm.getRoom('ROOM_KEY_DROP');
    const keyItem = [...room.worldItems.values()].find(i => i.type === 'doorKey' && i.available);
    const keyPos = { x: keyItem.position[0], y: keyItem.position[1], z: keyItem.position[2] + 0.8 };
    const p1 = room.players.get('p_1');
    const p2 = room.players.get('p_2');
    p1.position = { ...keyPos };

    // Player 1 picks up key
    const pickRes = rm.handlePickupRequest(ws1, keyItem.id, keyPos);
    assert.equal(pickRes.success, true);
    assert.equal(p1.inventory.hasItem('doorKey'), true);

    const slots = p1.inventory.getSlots();
    const keySlot = slots.findIndex(s => s && s.typeId === 'doorKey');
    assert.ok(keySlot !== -1);

    // Player 1 drops key
    const dropRes = rm.handleDropItem(ws1, keySlot, null, 1, { x: 44.5, y: 0.0, z: -189.0 }, 0);
    assert.ok(dropRes.success);
    assert.equal(p1.inventory.hasItem('doorKey'), false);

    const droppedItem = room.worldItems.get(dropRes.droppedItem.id);
    assert.ok(droppedItem);
    assert.equal(droppedItem.type, 'doorKey');
    assert.equal(droppedItem.available, true);

    // Total keys in world + inventories remains strictly 1
    let totalKeys = 0;
    for (const [_, p] of room.players) totalKeys += p.inventory.getCount('doorKey');
    for (const [_, item] of room.worldItems) {
      if (item.type === 'doorKey' && item.available) totalKeys++;
    }
    assert.equal(totalKeys, 1);

    // Player 2 picks up dropped key
    const dropPos = { x: droppedItem.position[0], y: droppedItem.position[1], z: droppedItem.position[2] + 0.5 };
    p2.position = { ...dropPos };
    const p2Claim = rm.handlePickupRequest(ws2, droppedItem.id, dropPos);
    assert.equal(p2Claim.success, true);
    assert.equal(p2.inventory.hasItem('doorKey'), true);
  });

  await t.test('5. Downing a player drops their entire inventory & equipment (keys, weapons, ammo, flashlight, consumables)', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();

    rm.createRoom(ws1, 'ROOM_DOWN_DROP', 'default', null, { startingPlayers: 2, directStart: true });
    rm.joinRoom(ws2, 'ROOM_DOWN_DROP');

    const room = rm.getRoom('ROOM_DOWN_DROP');
    const p1 = room.players.get('p_1');
    p1.position = { x: 45.0, y: 0.0, z: -185.0 };

    // Equip player 1 with various items:
    // Slot 0 already has equipment_torch from initDefaultLoadout()
    assert.equal(p1.inventory.hasItem('equipment_torch'), true);
    p1.inventory.addItem('doorKey', 1);
    p1.inventory.addItem('weapon_pistol', 1);
    p1.inventory.addItem('ammo_box_pistol', 2);
    p1.inventory.addItem('first_aid', 1);
    p1.inventory.addItem('almond_can', 1);
    p1.discoveredWeapons.add('weapon_pistol');
    p1.bullets = 6; // 6 reserve bullets = 3 boxes
    p1.mag = { bullets: 12, shells: 0 };

    // Apply lethal damage to down player 1 (from 100 HP to 0 HP)
    const dmgRes = rm.applyDamage(ws1, 100, 'ZOMBIE_HIT');
    assert.equal(p1.hp, 0);
    assert.equal(p1.state, 'DOWNED');
    assert.equal(p1.isDowned, true);

    // Verify droppedItems returned and registered in room.worldItems
    assert.ok(Array.isArray(dmgRes.droppedItems));
    assert.ok(dmgRes.droppedItems.length >= 6, 'Must drop all carried inventory and equipment items');

    const droppedTypes = dmgRes.droppedItems.map(d => d.type);
    assert.ok(droppedTypes.includes('doorKey'), 'Dropped items must include key');
    assert.ok(droppedTypes.includes('weapon_pistol'), 'Dropped items must include weapon');
    assert.ok(droppedTypes.includes('equipment_torch'), 'Dropped items must include tactical flashlight');
    assert.ok(droppedTypes.includes('first_aid'), 'Dropped items must include health pack');
    assert.ok(droppedTypes.includes('almond_can'), 'Dropped items must include almond water');
    assert.ok(droppedTypes.includes('pistol_ammo'), 'Dropped items must include ammo converted from reserve');

    // All dropped items are available in room.worldItems at player position
    for (const d of dmgRes.droppedItems) {
      const wi = room.worldItems.get(d.id);
      assert.ok(wi, `World item ${d.id} must exist in room`);
      assert.equal(wi.available, true);
      assert.equal(wi.isDropped, true);
      assert.equal(wi.droppedBy, p1.id);
    }

    // Downed player inventory is authoritatively cleared
    assert.equal(p1.inventory.getCount('doorKey'), 0);
    assert.equal(p1.inventory.getCount('weapon_pistol'), 0);
    assert.equal(p1.inventory.getCount('equipment_torch'), 0);
    assert.equal(p1.inventory.getCount('first_aid'), 0);
    assert.equal(p1.discoveredWeapons.size, 0);
    assert.equal(p1.bullets, 0);
    assert.equal(p1.mag.bullets, 0);
  });

  await t.test('6. Teammates can recover dropped items; revived player returns without duplicate inventory', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();

    rm.createRoom(ws1, 'ROOM_REVIVE_DROP', 'default', null, { startingPlayers: 2, directStart: true });
    rm.joinRoom(ws2, 'ROOM_REVIVE_DROP');

    const room = rm.getRoom('ROOM_REVIVE_DROP');
    const p1 = room.players.get('p_1');
    const p2 = room.players.get('p_2');
    p1.position = { x: 45.0, y: 0.0, z: -185.0 };
    p2.position = { x: 45.5, y: 0.0, z: -185.0 };

    p1.inventory.addItem('doorKey', 1);
    p2.inventory.addItem('first_aid', 1); // P2 has health pack to revive P1

    // Down Player 1
    const dmg = rm.applyDamage(ws1, 100, 'ZOMBIE_HIT');
    assert.equal(p1.state, 'DOWNED');
    const droppedKey = dmg.droppedItems.find(it => it.type === 'doorKey');
    assert.ok(droppedKey);

    // Player 2 recovers the dropped key
    const p2Pos = { x: droppedKey.position[0], y: droppedKey.position[1], z: droppedKey.position[2] + 0.3 };
    p2.position = { ...p2Pos };
    const p2Pickup = rm.handlePickupRequest(ws2, droppedKey.id, p2Pos);
    assert.equal(p2Pickup.success, true);
    assert.equal(p2.inventory.getCount('doorKey'), 1);

    // Player 2 revives Player 1
    const revRes = rm.handleReviveRequest(ws2, p1.id, p2.position);
    assert.equal(revRes.success, true);
    assert.equal(p1.state, 'ACTIVE');
    assert.equal(p1.hp, 50);

    // Revived player returns WITHOUT dropped items (no duplication!)
    assert.equal(p1.inventory.getCount('doorKey'), 0, 'Revived player does not duplicate key');
    assert.equal(p1.inventory.getCount('equipment_torch'), 0, 'Revived player does not duplicate flashlight');
    assert.equal(p2.inventory.getCount('doorKey'), 1, 'Teammate retains recovered key');
  });

  await t.test('7. Single-carrier exit requirement: Exit door unlocks ONLY when a SINGLE conscious player carries all required keys', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();

    rm.createRoom(ws1, 'ROOM_SINGLE_CARRIER', 'default', null, { startingPlayers: 2, directStart: true });
    rm.joinRoom(ws2, 'ROOM_SINGLE_CARRIER');

    const room = rm.getRoom('ROOM_SINGLE_CARRIER');
    assert.equal(room.requiredKeyCount, 2, '2 players require 2 keys');
    const p1 = room.players.get('p_1');
    const p2 = room.players.get('p_2');
    const doorPos = { x: 79.55, y: 0.0, z: 207.0 };
    p1.position = { ...doorPos };
    p2.position = { ...doorPos };

    // Case A: Split team possession (P1 has 1 key, P2 has 1 key)
    p1.inventory.addItem('doorKey', 1);
    p2.inventory.addItem('doorKey', 1);

    // Player 1 attempts to unlock door -> REJECTED because collective split is not sufficient!
    const unlockFail = rm.handleDoorUnlock(ws1, 'level0_exit_door', doorPos);
    assert.equal(unlockFail.success, false);
    assert.equal(unlockFail.reason, 'MISSING_KEY');
    assert.equal(unlockFail.requiredKeys, 2);
    assert.equal(unlockFail.carriedKeys, 1);
    assert.match(unlockFail.error, /Requires all 2 Brass Door Keys to be carried by you/i);

    const door = room.doors.get('level0_exit_door');
    assert.equal(door.locked, true, 'Door remains locked when keys are split across teammates');

    // Case B: Player 2 drops key, Player 1 picks it up to possess ALL required keys
    const p2Slots = p2.inventory.getSlots();
    const p2KeySlot = p2Slots.findIndex(s => s && s.typeId === 'doorKey');
    const dropRes = rm.handleDropItem(ws2, p2KeySlot, null, 1, doorPos, 0);
    assert.equal(dropRes.success, true);

    const p1Pickup = rm.handlePickupRequest(ws1, dropRes.droppedItem.id, doorPos);
    assert.equal(p1Pickup.success, true);
    assert.equal(p1.inventory.getCount('doorKey'), 2, 'Player 1 now carries all 2 keys');

    // Case C: Player 1 with all 2 keys unlocks the door -> SUCCESS!
    const unlockOk = rm.handleDoorUnlock(ws1, 'level0_exit_door', doorPos);
    assert.equal(unlockOk.success, true);
    assert.equal(unlockOk.locked, false);
    assert.equal(door.locked, false, 'Door is permanently unlocked authoritatively');

    // Keys are NOT consumed on unlock
    assert.equal(p1.inventory.getCount('doorKey'), 2, 'Keys are NOT consumed on door unlock');
  });

  await t.test('8. Door state synchronizes and allows Level Escape; Downed players cannot unlock or escape', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();

    rm.createRoom(ws1, 'ROOM_ESCAPE_SYNC', 'default', null, { startingPlayers: 2, directStart: true });
    rm.joinRoom(ws2, 'ROOM_ESCAPE_SYNC');

    const room = rm.getRoom('ROOM_ESCAPE_SYNC');
    const p1 = room.players.get('p_1');
    const doorPos = { x: 79.55, y: 0.0, z: 207.0 };
    p1.position = { ...doorPos };

    // Downed player cannot unlock door even if carrying all keys
    p1.inventory.addItem('doorKey', 2);
    p1.state = 'DOWNED';
    const downedUnlock = rm.handleDoorUnlock(ws1, 'level0_exit_door', doorPos);
    assert.equal(downedUnlock.success, false);
    assert.match(downedUnlock.error, /downed/i);

    // Active player unlocks door
    p1.state = 'ACTIVE';
    const okUnlock = rm.handleDoorUnlock(ws1, 'level0_exit_door', doorPos);
    assert.equal(okUnlock.success, true);

    // Synchronized door state reflects unlocked
    const doors = rm.serializeDoors(room);
    assert.equal(doors[0].locked, false);
    assert.equal(doors[0].requiredKeys, 2);

    // Escape through unlocked door triggers run completion
    const escRes = rm.handleEscape(ws1, 'level0_exit_door', doorPos);
    assert.equal(escRes.success, true);
    assert.equal(escRes.status, 'ESCAPED');
    assert.equal(room.runState, 'GAME_OVER');
  });
});
