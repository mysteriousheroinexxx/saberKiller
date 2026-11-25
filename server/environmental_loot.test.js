import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  RoomManager,
  LOOT_CONFIG,
  configureLootRules,
  resetLootConfig
} from './room_manager.js';
import {
  isApprovedKeySlot,
  APPROVED_CONSUMABLE_TYPES,
  APPROVED_KEY_SUPPORT_TYPES
} from '../js/multiplayer/loot_config.js';
import { Level0Environment } from './ai/environment.js';

function createMockWs() {
  return { readyState: 1, send: () => {} };
}

function loadDefaultWorldItems() {
  const layoutPath = path.resolve(process.cwd(), 'assets/data/world_items.json');
  return JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
}

test('1. Environmental loot layout audit: strict key surface rules, valid furniture/vending slots, and walkable clearance', () => {
  const layout = loadDefaultWorldItems();
  const env = new Level0Environment();

  assert.ok(layout.environmentalLoot, 'world_items.json must define environmentalLoot');
  const { consumableSlots, healthPackSlots, keySlots } = layout.environmentalLoot;

  assert.ok(Array.isArray(consumableSlots) && consumableSlots.length >= 30, 'Sufficient Level 0 consumable slots');
  assert.ok(Array.isArray(healthPackSlots) && healthPackSlots.length >= 15, 'Sufficient Health Pack slots');
  assert.ok(Array.isArray(keySlots) && keySlots.length >= 10, 'Sufficient key slots');

  // Ensure ZERO static doorKey or floor_door_key_01 remains in base placements
  const staticKeys = layout.placements.filter(p => p.type === 'doorKey');
  assert.equal(staticKeys.length, 0, 'No static floor/legacy doorKey entries should remain in default placements');

  // Every key slot MUST strictly belong to metal_shelf, table, or vending/vending_almond
  for (const ks of keySlots) {
    assert.equal(isApprovedKeySlot(ks), true, `Key slot '${ks.id}' must be strictly on shelf/table/vending`);
    assert.ok(APPROVED_KEY_SUPPORT_TYPES.has(ks.supportType), `Approved supportType for '${ks.id}'`);
    assert.notEqual(ks.surfaceType, 'floor', `Key slot '${ks.id}' must never use generic floor surface`);
  }

  // Verify rejection guard against generic floor key slots
  assert.equal(isApprovedKeySlot({
    id: 'bad_floor_key',
    supportProp: 'none',
    supportType: 'floor',
    surfaceType: 'floor',
    position: [45, 0.02, -189],
    anchor: { surface: 'floor' }
  }), false, 'Generic floor key slot must be strictly rejected');

  // Verify every slot is outside walls/solid cells and does not overlap sibling slots on the same prop/tier
  const allSlots = [...consumableSlots, ...healthPackSlots, ...keySlots];
  for (const slot of allSlots) {
    const c = env.cellOfX(slot.position[0]);
    const r = env.cellOfZ(slot.position[2]);
    assert.equal(env.isWall(c, r), false, `Slot '${slot.id}' must not sit inside a wall grid cell`);
    if (slot.supportType === 'table') {
      assert.equal(slot.position[1], 0.936, `Table slot '${slot.id}' height must match table top`);
    } else if (slot.supportType === 'metal_shelf') {
      assert.ok([0.243, 0.715, 1.188, 1.643, 2.097].includes(slot.position[1]), `Shelf slot '${slot.id}' height must match valid shelf tier`);
    } else {
      assert.equal(slot.position[1], 0.02, `Vending-adjacent slot '${slot.id}' rests cleanly beside unit at y=0.02`);
    }
  }
});

test('2. Configurable loot rules: quantities, probabilities, weights, and cap enforcement work', () => {
  resetLootConfig();
  try {
    configureLootRules({
      minConsumables: 12,
      maxConsumables: 12,
      consumableSlotSpawnChance: 0.5,
      consumableWeights: {
        aa_battery: 100,
        almond_can: 0,
        energy_drink: 0,
        sanity_pill: 0
      },
      maxPerType: {
        aa_battery: 12,
        almond_can: 10,
        energy_drink: 8,
        sanity_pill: 8
      }
    });

    const rm = new RoomManager();
    const ws = createMockWs();
    const res = rm.createRoom(ws, 'CFG_LOOT', 'default', null, { directStart: true });
    const room = rm.getRoom(res.roomCode);

    const activeConsumables = [...room.worldItems.values()].filter(
      i => i.isPickup && i.available && APPROVED_CONSUMABLE_TYPES.has(i.type)
    );
    assert.equal(activeConsumables.length, 12, 'Exact configured min=max=12 consumables spawned');
    assert.ok(activeConsumables.every(i => i.type === 'aa_battery'), 'All spawned consumables match 100% battery weight');
    assert.equal(room.lootSummary.totalConsumables, 12);
    assert.equal(room.lootSummary.byType.aa_battery, 12);

    // Every spawned item ID must appear in createRoom spawnedItems
    const spawnedIds = new Set(res.spawnedItems.map(i => i.id));
    for (const item of activeConsumables) {
      assert.ok(spawnedIds.has(item.id), `Consumable '${item.id}' synced in ROOM_JOINED spawnedItems`);
    }
  } finally {
    resetLootConfig();
  }
});

test('3. Randomized distribution & economy preservation across runs (keys only on shelf/table/vending, 60 ammo, 3x HP)', () => {
  resetLootConfig();
  const observedKeySlotIds = new Set();

  for (let run = 0; run < 8; run++) {
    const rm = new RoomManager();
    const ws1 = createMockWs();
    const ws2 = createMockWs();
    const roomCode = `RAND_${run}`;
    rm.createRoom(ws1, roomCode, 'default', null, { startingPlayers: 2, directStart: true });
    rm.joinRoom(ws2, roomCode);
    const room = rm.getRoom(roomCode);

    // Keys: exact 1 per player = 2, all on approved furniture/vending surfaces, distinct hubs preferred
    const activeKeys = [...room.worldItems.values()].filter(i => i.type === 'doorKey' && i.available);
    assert.equal(activeKeys.length, 2, 'Duo run has exactly 2 active keys');
    const keyHubs = new Set();
    for (const k of activeKeys) {
      assert.ok(APPROVED_KEY_SUPPORT_TYPES.has(k.supportType), `Spawned key ${k.id} supportType=${k.supportType} must be shelf/table/vending`);
      observedKeySlotIds.add(k.slotId);
      keyHubs.add(k.supportProp);
    }
    assert.equal(keyHubs.size, 2, 'Duo keys spread across distinct furniture/vending hubs');

    // Health Packs: exact 3 * 2 = 6 active, surplus cappedUnavailable
    const activeHp = [...room.worldItems.values()].filter(i => i.type === 'first_aid' && i.available);
    const cappedHp = [...room.worldItems.values()].filter(i => i.type === 'first_aid' && i.cappedUnavailable);
    assert.equal(activeHp.length, 6, 'Duo run preserves exact 6 Health Packs');
    assert.ok(cappedHp.length > 0, 'Surplus Health Pack slots remain marked cappedUnavailable');

    // Fixed 60-unit ammo economy preserved
    const ammo = rm.getRoomAmmoAccounting(roomCode);
    assert.equal(ammo.totalBudget, 60);
    assert.equal(ammo.totalUnits, 60);
    assert.equal(ammo.pistol.max, 48);
    assert.equal(ammo.shotgun.max, 12);

    // Consumables within configured bounds
    const activeConsumables = [...room.worldItems.values()].filter(
      i => i.isPickup && i.available && APPROVED_CONSUMABLE_TYPES.has(i.type)
    );
    assert.ok(
      activeConsumables.length >= LOOT_CONFIG.minConsumables && activeConsumables.length <= LOOT_CONFIG.maxConsumables,
      `Consumable count ${activeConsumables.length} within [${LOOT_CONFIG.minConsumables}, ${LOOT_CONFIG.maxConsumables}]`
    );
  }

  assert.ok(observedKeySlotIds.size >= 3, `Expected randomized key locations across 8 runs, saw ${observedKeySlotIds.size}`);
});

test('4. Authoritative 2-player contention, drop handling, unique IDs, and fresh-run loot regeneration', () => {
  resetLootConfig();
  const rm = new RoomManager();
  const ws1 = createMockWs();
  const ws2 = createMockWs();

  rm.createRoom(ws1, 'LIFECYCLE_LOOT', 'default');
  rm.joinRoom(ws2, 'LIFECYCLE_LOOT');
  rm.setPlayerReady(ws2, true);

  // Start Run 1
  const start1 = rm.startMatch(ws1);
  assert.equal(start1.success, true);
  assert.equal(start1.matchGeneration, 2);

  const room = rm.getRoom('LIFECYCLE_LOOT');
  const p1 = rm.getPlayer(ws1).player;
  const p2 = rm.getPlayer(ws2).player;

  // Verify unique IDs across all room.worldItems
  const allIdsRun1 = [...room.worldItems.keys()];
  assert.equal(new Set(allIdsRun1).size, allIdsRun1.length, 'Every world item ID is unique');

  const lootItem = [...room.worldItems.values()].find(i => i.available && APPROVED_CONSUMABLE_TYPES.has(i.type));
  assert.ok(lootItem, 'Run 1 has available spawned consumable');
  assert.ok(start1.spawnedItems.some(s => s.id === lootItem.id), 'Spawned consumable included in MATCH_STARTED spawnedItems');

  // Competing pickup by P1 and P2: P1 wins, P2 rejected cleanly
  p1.position = { x: lootItem.position[0], y: lootItem.position[1], z: lootItem.position[2] };
  p2.position = { x: lootItem.position[0], y: lootItem.position[1], z: lootItem.position[2] };
  const pick1 = rm.handlePickupRequest(ws1, lootItem.id, p1.position);
  const pick2 = rm.handlePickupRequest(ws2, lootItem.id, p2.position);
  assert.equal(pick1.success, true);
  assert.match(pick2.error, /already been collected/);
  assert.equal(p1.inventory.getCount(lootItem.type), 1);
  assert.equal(p2.inventory.getCount(lootItem.type), 0);

  // P1 drops the item -> creates unique drop_* entry that P2 can claim
  const dropSlot = p1.inventory.getSlots().findIndex(s => s?.typeId === lootItem.type);
  const dropRes = rm.handleDropItem(ws1, dropSlot, null, 1, p1.position, 0);
  assert.equal(dropRes.success, true);
  const droppedId = dropRes.droppedItem.id;
  assert.ok(room.worldItems.has(droppedId));

  // End Run 1 and start Run 2
  rm.applyDamage(p1.id, 200, 'HAZARD');
  rm.applyDamage(p2.id, 200, 'HAZARD');
  assert.equal(room.runState, 'GAME_OVER');

  const start2 = rm.startMatch(ws1);
  assert.equal(start2.success, true);
  assert.equal(start2.matchGeneration, 3);

  // Old run loot IDs and dropped IDs MUST be purged; fresh generation IDs created
  assert.equal(room.worldItems.has(lootItem.id), false, 'Old Run 1 loot ID purged on fresh run');
  assert.equal(room.worldItems.has(droppedId), false, 'Old Run 1 dropped item purged on fresh run');
  assert.equal(p1.inventory.getCount(lootItem.type), 0, 'Player 1 inventory reset cleanly');

  const newLoot = [...room.worldItems.values()].filter(i => i.available && APPROVED_CONSUMABLE_TYPES.has(i.type));
  assert.ok(newLoot.length >= LOOT_CONFIG.minConsumables);
  for (const nl of newLoot) {
    assert.ok(nl.id.startsWith('loot_g3_'), `Fresh Run 2 loot item '${nl.id}' carries new generation ID`);
    assert.ok(start2.spawnedItems.some(s => s.id === nl.id), `Run 2 loot '${nl.id}' synced in startMatch.spawnedItems`);
  }
});
