import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './room_manager.js';

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
  await t.test('1. Single key guarantee: exactly ONE key exists in Level 0', () => {
    const rm = new RoomManager();
    const ws = createMockSocket();

    // Create room with a simulated layout that contains duplicate keys
    const mockLayout = {
      placements: [
        { id: 'floor_door_key_01', type: 'doorKey', position: [43.1, 0.0, -186.0] },
        { id: 'table_door_key_01', type: 'doorKey', position: [44.15, 0.936, -185.2] },
        { id: 'shelf_door_key_tier3', type: 'doorKey', position: [44.5, 1.188, -189.5] },
        { id: 'floor_first_aid_01', type: 'first_aid', position: [48.69, 0.0, -187.65] }
      ]
    };

    const res = rm.createRoom(ws, 'ROOM_KEY_1', 'rev1', mockLayout, { directStart: true });
    assert.equal(res.roomCode, 'ROOM_KEY_1');

    const room = rm.getRoom('ROOM_KEY_1');
    const keyItems = [...room.worldItems.values()].filter(i => i.type === 'doorKey');

    assert.equal(keyItems.length, 1, 'Room must contain exactly ONE physical door key pickup');
    assert.equal(keyItems[0].id, 'shelf_door_key_tier3', 'Retains preferred shelf exploration key');
    assert.equal(keyItems[0].available, true, 'Key must be available for collection');
  });

  await t.test('2. Authoritative key pickup: claims key once, rejects contention and duplicate claims', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();

    rm.createRoom(ws1, 'ROOM_KEY_2', 'default', null, { directStart: true });
    rm.joinRoom(ws2, 'ROOM_KEY_2');

    const room = rm.getRoom('ROOM_KEY_2');
    const keyItem = [...room.worldItems.values()].find(i => i.type === 'doorKey');
    assert.ok(keyItem, 'Key item must exist in room');

    const keyPos = { x: keyItem.position[0], y: keyItem.position[1], z: keyItem.position[2] + 0.8 };
    const p1 = room.players.get('p_1');
    const p2 = room.players.get('p_2');
    p1.position = { ...keyPos };
    p2.position = { ...keyPos };

    // Player 1 claims key authoritatively
    const claim1 = rm.handlePickupRequest(ws1, keyItem.id, keyPos);
    assert.equal(claim1.success, true, 'Player 1 must successfully claim the key');
    assert.equal(claim1.player.inventory.hasItem('doorKey'), true, 'Player 1 inventory must contain doorKey');
    assert.equal(keyItem.available, false, 'Key must be marked unavailable in world');

    // Player 2 attempts to claim the same key concurrently
    const claim2 = rm.handlePickupRequest(ws2, keyItem.id, keyPos);
    assert.ok(claim2.error, 'Player 2 pickup claim must be rejected');
    assert.match(claim2.error, /already been collected/i);
    assert.equal(claim2.player.inventory.hasItem('doorKey'), false, 'Player 2 inventory must NOT contain key');
  });

  await t.test('3. Key dropping and re-pickup behaves normally without duplicating key', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();

    rm.createRoom(ws1, 'ROOM_KEY_3', 'default', null, { directStart: true });
    rm.joinRoom(ws2, 'ROOM_KEY_3');

    const room = rm.getRoom('ROOM_KEY_3');
    const keyItem = [...room.worldItems.values()].find(i => i.type === 'doorKey');
    const keyPos = { x: keyItem.position[0], y: keyItem.position[1], z: keyItem.position[2] + 0.8 };
    const p1 = room.players.get('p_1');
    const p2 = room.players.get('p_2');
    p1.position = { ...keyPos };

    // Player 1 picks up key
    const pickRes = rm.handlePickupRequest(ws1, keyItem.id, keyPos);
    assert.equal(pickRes.success, true);
    assert.equal(p1.inventory.hasItem('doorKey'), true);

    // Find key slot
    const slots = p1.inventory.getSlots();
    const keySlot = slots.findIndex(s => s && s.typeId === 'doorKey');
    assert.ok(keySlot !== -1, 'Key must occupy an inventory slot');

    // Player 1 drops the key
    const dropRes = rm.handleDropItem(ws1, keySlot, null, 1, { x: 44.5, y: 0.0, z: -189.0 }, 0);
    assert.ok(dropRes.success, 'Drop request must succeed');
    assert.equal(p1.inventory.hasItem('doorKey'), false, 'Player 1 must no longer possess key');

    // Verify dropped world item exists
    const droppedItem = room.worldItems.get(dropRes.droppedItem.id);
    assert.ok(droppedItem, 'Dropped world item must exist in room');
    assert.equal(droppedItem.type, 'doorKey');
    assert.equal(droppedItem.available, true);

    // Total keys in world + inventory must still be exactly 1
    let totalKeys = 0;
    for (const [_, p] of room.players) totalKeys += p.inventory.getCount('doorKey');
    for (const [_, item] of room.worldItems) {
      if (item.type === 'doorKey' && item.available) totalKeys++;
    }
    assert.equal(totalKeys, 1, 'Total key instances in room must be strictly 1');

    // Player 2 moves to dropped key and picks it up
    const dropPos = { x: droppedItem.position[0], y: droppedItem.position[1], z: droppedItem.position[2] + 0.8 };
    p2.position = { ...dropPos };
    const p2Claim = rm.handlePickupRequest(ws2, droppedItem.id, dropPos);
    assert.equal(p2Claim.success, true);
    assert.equal(p2Claim.player.inventory.hasItem('doorKey'), true);
  });

  await t.test('4. Exit door is initially locked and rejects unlock without key', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();

    const res = rm.createRoom(ws1, 'ROOM_KEY_4', 'default', null, { directStart: true });
    assert.ok(Array.isArray(res.doors), 'createRoom must return serialized doors array');
    assert.equal(res.doors.length, 1);
    assert.equal(res.doors[0].id, 'level0_exit_door');
    assert.equal(res.doors[0].locked, true, 'Exit door must be initially locked');

    const doorPos = { x: 79.55, y: 0.0, z: 207.0 };

    // Player 1 has not picked up the key; tries to unlock door
    const unlockRes = rm.handleDoorUnlock(ws1, 'level0_exit_door', doorPos);
    assert.equal(unlockRes.success, false, 'Unlock without key must be rejected');
    assert.equal(unlockRes.reason, 'MISSING_KEY');

    const room = rm.getRoom('ROOM_KEY_4');
    const door = room.doors.get('level0_exit_door');
    assert.equal(door.locked, true, 'Door must remain locked');
  });

  await t.test('5. Player with key authoritatively unlocks door for entire room', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();

    rm.createRoom(ws1, 'ROOM_KEY_5', 'default', null, { directStart: true });
    const joinRes = rm.joinRoom(ws2, 'ROOM_KEY_5');
    assert.ok(Array.isArray(joinRes.doors), 'joinRoom must return synchronized doors');
    assert.equal(joinRes.doors[0].locked, true);

    const room = rm.getRoom('ROOM_KEY_5');
    const p1 = room.players.get('p_1');

    // Give key to Player 1
    p1.inventory.addItem('doorKey', 1);
    assert.equal(p1.inventory.hasItem('doorKey'), true);

    const doorPos = { x: 79.55, y: 0.0, z: 207.0 };

    // Player 1 unlocks the door
    const unlockRes = rm.handleDoorUnlock(ws1, 'level0_exit_door', doorPos);
    assert.equal(unlockRes.success, true, 'Player 1 with key must unlock the door');
    assert.equal(unlockRes.locked, false);
    assert.equal(unlockRes.unlockedBy, 'p_1');

    // Room door state is permanently unlocked
    const door = room.doors.get('level0_exit_door');
    assert.equal(door.locked, false, 'Door must be unlocked in room state');
    assert.equal(door.unlockedBy, 'p_1');

    // Second player checking door sees unlocked state
    const doorsSerialized = rm.serializeDoors(room);
    assert.equal(doorsSerialized[0].locked, false, 'Door must be unlocked for Player 2');

    // Redundant unlock call returns alreadyUnlocked success
    const secondUnlock = rm.handleDoorUnlock(ws2, 'level0_exit_door', doorPos);
    assert.equal(secondUnlock.success, true);
    assert.equal(secondUnlock.alreadyUnlocked, true);
  });

  await t.test('6. Unlocking rejects players that are too far from the door', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();

    rm.createRoom(ws1, 'ROOM_KEY_6', 'default', null, { directStart: true });
    const room = rm.getRoom('ROOM_KEY_6');
    const p1 = room.players.get('p_1');
    p1.inventory.addItem('doorKey', 1);

    // Player position at spawn [48.69, -187.65], door is at [79.55, 207.0] (>300m away)
    const farPos = { x: 48.69, y: 0.0, z: -187.65 };
    const unlockRes = rm.handleDoorUnlock(ws1, 'level0_exit_door', farPos);
    assert.equal(unlockRes.success, false, 'Unlock from far away must be rejected');
    assert.match(unlockRes.error, /too far from door/i);
  });

  await t.test('7. Escape: Unlocked door allows players to escape and triggers run completion', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();

    rm.createRoom(ws1, 'ROOM_KEY_7', 'default', null, { directStart: true });
    rm.joinRoom(ws2, 'ROOM_KEY_7');

    const room = rm.getRoom('ROOM_KEY_7');
    const doorPos = { x: 79.55, y: 0.0, z: 207.0 };

    // Escape while locked must be rejected
    const escapeLocked = rm.handleEscape(ws1, 'level0_exit_door', doorPos);
    assert.equal(escapeLocked.success, false, 'Cannot escape through locked door');

    // Unlock door
    const door = room.doors.get('level0_exit_door');
    door.locked = false;
    door.unlockedBy = 'p_1';

    // Player within doorway escapes
    const escapeRes = rm.handleEscape(ws1, 'level0_exit_door', doorPos);
    assert.equal(escapeRes.success, true, 'Escape must succeed when door is unlocked');
    assert.equal(escapeRes.status, 'ESCAPED');
    assert.equal(escapeRes.reason, 'LEVEL_COMPLETED');
    assert.equal(escapeRes.title, 'LEVEL ESCAPED!');
    assert.equal(room.runState, 'GAME_OVER', 'Escape must set room state to GAME_OVER');
  });

  await t.test('8. Downed players cannot unlock door or escape', () => {
    const rm = new RoomManager();
    const ws1 = createMockSocket();

    rm.createRoom(ws1, 'ROOM_KEY_8', 'default', null, { directStart: true });
    const room = rm.getRoom('ROOM_KEY_8');
    const p1 = room.players.get('p_1');
    p1.inventory.addItem('doorKey', 1);
    p1.state = 'DOWNED';

    const doorPos = { x: 79.55, y: 0.0, z: 207.0 };

    const unlockRes = rm.handleDoorUnlock(ws1, 'level0_exit_door', doorPos);
    assert.equal(unlockRes.success, false, 'Downed player cannot unlock door');
    assert.match(unlockRes.error, /downed/i);

    const door = room.doors.get('level0_exit_door');
    door.locked = false;

    const escapeRes = rm.handleEscape(ws1, 'level0_exit_door', doorPos);
    assert.equal(escapeRes.success, false, 'Downed player cannot escape');
    assert.match(escapeRes.error, /downed/i);
  });
});
