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

test('1. Environmental loot layout audit: furniture density, strict key surface rules, valid furniture/vending slots, and walkable clearance', () => {
  const layout = loadDefaultWorldItems();
  const map = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'assets/level0/level0_map.json'), 'utf8'));
  const env = new Level0Environment();

  // Build exact Level 0 obstacle OBBs matching WorldItemManager
  const obstacles = [];
  for (const w of (map.walls || [])) {
    obstacles.push({ cx: w[0], cz: w[2], hx: 5.0, hz: 0.4, cos: Math.cos(w[3] || 0), sin: Math.sin(w[3] || 0) });
  }
  for (const p of (map.pillars || [])) {
    obstacles.push({ cx: p[0], cz: p[2], hx: 1.0, hz: 1.0, cos: 1, sin: 0 });
  }
  const minObsDist = (x, z) => {
    let m = Infinity;
    for (const o of obstacles) {
      const dx = x - o.cx;
      const dz = z - o.cz;
      const lx = dx * o.cos + dz * o.sin;
      const lz = -dx * o.sin + dz * o.cos;
      const d = Math.hypot(Math.max(0, Math.abs(lx) - o.hx), Math.max(0, Math.abs(lz) - o.hz));
      if (d < m) m = d;
    }
    return m;
  };

  // Verify dense distributed Level 0 furniture targets
  const vendingProps = layout.placements.filter(p => p.type === 'vending_almond');
  const tableProps = layout.placements.filter(p => p.type === 'table');
  const shelfProps = layout.placements.filter(p => p.type === 'metal_shelf');
  assert.equal(vendingProps.length, 10, 'Level 0 contains 10 vending machines');
  assert.equal(tableProps.length, 50, 'Level 0 contains 50 tables/desks');
  assert.equal(shelfProps.length, 60, 'Level 0 contains 60 metal shelves');

  const sectors = new Set([...vendingProps, ...tableProps, ...shelfProps].map(
    p => `${Math.floor(p.position[0] / 30)},${Math.floor(p.position[2] / 30)}`
  ));
  assert.ok(sectors.size >= 40, `Furniture spans at least 40 Level 0 spatial sectors (got ${sectors.size})`);

  // Verify pistol placed on nearby desk/shelf 10–15m from normal player spawn [48.69, 0, -187.65]
  const pistol = layout.placements.find(p => p.id === 'floor_weapon_pistol_01');
  assert.ok(pistol, 'Beretta Px4 pistol exists');
  assert.equal(pistol.surfaceType, 'table', 'Pistol rests on an exploration table/desk');
  assert.equal(pistol.position[1], 0.936, 'Pistol rests at tabletop height');
  const pistolDistFromSpawn = Math.hypot(pistol.position[0] - 48.69, pistol.position[2] + 187.65);
  assert.ok(pistolDistFromSpawn >= 10 && pistolDistFromSpawn <= 15, `Pistol within 10-15m of spawn (got ${pistolDistFromSpawn.toFixed(2)}m)`);

  // Verify every vending machine's -Z front faces unobstructed walkable room space
  for (const vp of vendingProps) {
    const ry = vp.rotation?.[1] || 0;
    const fx = -Math.sin(ry);
    const fz = -Math.cos(ry);
    const frontX = vp.position[0] + fx * 0.75;
    const frontZ = vp.position[2] + fz * 0.75;
    const clearX = vp.position[0] + fx * 1.5;
    const clearZ = vp.position[2] + fz * 1.5;
    assert.equal(env.isWall(env.cellOfX(frontX), env.cellOfZ(frontZ)), false, `Vending '${vp.id}' -Z front must face walkable area`);
    assert.ok(minObsDist(frontX, frontZ) >= 0.35, `Vending '${vp.id}' front has clear access (dist=${minObsDist(frontX, frontZ).toFixed(2)})`);
    assert.ok(minObsDist(clearX, clearZ) >= 0.35, `Vending '${vp.id}' approach room side is unobstructed`);
  }

  assert.ok(layout.environmentalLoot, 'world_items.json must define environmentalLoot');
  const { consumableSlots, healthPackSlots, keySlots } = layout.environmentalLoot;

  assert.ok(Array.isArray(consumableSlots) && consumableSlots.length >= 150, 'Map-wide consumable slots across furniture');
  assert.ok(Array.isArray(healthPackSlots) && healthPackSlots.length >= 50, 'Map-wide Health Pack slots across furniture');
  assert.ok(Array.isArray(keySlots) && keySlots.length >= 50, 'Map-wide key slots across furniture');

  // Ensure ZERO static doorKey or floor_door_key_01 and NO start-area floor demo cluster
  const staticKeys = layout.placements.filter(p => p.type === 'doorKey');
  assert.equal(staticKeys.length, 0, 'No static floor/legacy doorKey entries should remain in default placements');
  const startFloorDemoCluster = layout.placements.filter(
    p => p.surfaceType === 'floor' &&
         !['table', 'metal_shelf', 'vending_almond'].includes(p.type) &&
         p.position[0] >= 39 && p.position[0] <= 49 &&
         p.position[2] >= -191 && p.position[2] <= -178
  );
  assert.equal(startFloorDemoCluster.length, 0, 'Temporary floor demo loot/ammo/crate cluster near [42, -189] must be completely removed');

  // Verify calibrated small-item scales are non-trivial and visible
  assert.ok(layout.catalog.sanity_pill.scale[0] >= 0.0012, 'Sanity pill bottle scale increased for clear visibility');
  assert.ok(layout.catalog.aa_battery.scale[0] >= 2.0, 'AA battery scale increased for clear visibility');
  assert.ok(layout.catalog.doorKey.scale[0] >= 2.0, 'Key scale increased for clear visibility');

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

  // Verify every slot clears physical walls/pillars and vending ground slots sit on walkable non-wall grid cells
  const allSlots = [...consumableSlots, ...healthPackSlots, ...keySlots];
  for (const slot of allSlots) {
    const obsDist = minObsDist(slot.position[0], slot.position[2]);
    assert.ok(obsDist >= 0.10, `Slot '${slot.id}' clears physical wall/pillar OBBs (dist=${obsDist.toFixed(3)})`);
    if (slot.supportType === 'table') {
      assert.equal(slot.position[1], 0.936, `Table slot '${slot.id}' height must match table top`);
    } else if (slot.supportType === 'metal_shelf') {
      assert.ok([0.243, 0.715, 1.188, 1.643, 2.097].includes(slot.position[1]), `Shelf slot '${slot.id}' height must match valid shelf tier`);
    } else {
      assert.equal(slot.position[1], 0.02, `Vending-adjacent slot '${slot.id}' rests cleanly beside unit at y=0.02`);
      const c = env.cellOfX(slot.position[0]);
      const r = env.cellOfZ(slot.position[2]);
      assert.equal(env.isWall(c, r), false, `Vending ground slot '${slot.id}' must not sit on a wall grid cell`);
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

test('3. Exact per-run quantities (30 batteries, 15 pills, 20 almond cans, 12 energy drinks), randomized across runs & economy preservation', () => {
  resetLootConfig();
  const env = new Level0Environment();
  const observedKeySlotIds = new Set();
  const observedBatterySlots = new Set();

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

    // Exact requested per-type consumable quantities (30 + 15 + 20 + 12 = 77)
    const activeConsumables = [...room.worldItems.values()].filter(
      i => i.isPickup && i.available && APPROVED_CONSUMABLE_TYPES.has(i.type)
    );
    const counts = { aa_battery: 0, sanity_pill: 0, almond_can: 0, energy_drink: 0 };
    let almondNearVending = 0;
    for (const c of activeConsumables) {
      counts[c.type] = (counts[c.type] || 0) + 1;
      if (c.type === 'aa_battery') {
        observedBatterySlots.add(c.slotId);
        assert.ok(['table', 'shelf_tier'].includes(c.surfaceType), 'Batteries only spawn on tables or shelves');
      }
      if (c.type === 'sanity_pill' || c.type === 'energy_drink') {
        assert.ok(['table', 'shelf_tier'].includes(c.surfaceType), `${c.type} only spawns on tables or shelves`);
      }
      if (c.type === 'almond_can' && c.surfaceType === 'vending_around') {
        almondNearVending++;
      }
    }
    assert.equal(counts.aa_battery, 30, 'Exact 30 flashlight batteries per run');
    assert.equal(counts.sanity_pill, 15, 'Exact 15 sanity pills per run');
    assert.equal(counts.almond_can, 20, 'Exact 20 Almond Water cans per run');
    assert.equal(counts.energy_drink, 12, 'Exact 12 energy drinks per run');
    assert.ok(almondNearVending >= 1, 'Some Almond Water cans appear near vending machines');

    const consumableZones = new Set(activeConsumables.map(i => `${Math.floor(i.position[0] / 35)},${Math.floor(i.position[2] / 35)}`));
    assert.ok(consumableZones.size >= 25, `Consumables distributed widely across Level 0 zones (got ${consumableZones.size})`);

    // Verify vending dispense places almond_can cleanly in front of machine's -Z facing direction
    const vend = [...room.worldItems.values()].find(i => i.type === 'vending_almond');
    assert.ok(vend, 'Vending machine exists');
    const player1 = rm.getPlayer(ws1).player;
    player1.position = { x: vend.position[0], y: 0, z: vend.position[2] };
    const dispRes = rm.handleVendingDispense(ws1, vend.id, player1.position);
    assert.equal(dispRes.success, true, 'Vending dispense succeeds');
    const dispPos = dispRes.dispensedItem.position;
    assert.equal(env.isWall(env.cellOfX(dispPos[0]), env.cellOfZ(dispPos[2])), false, `Dispensed can from '${vend.id}' lands on walkable floor`);
  }

  assert.ok(observedKeySlotIds.size >= 3, `Expected randomized key locations across 8 runs, saw ${observedKeySlotIds.size}`);
  assert.ok(observedBatterySlots.size > 30, `Expected randomized battery slot selection across runs, saw ${observedBatterySlots.size}`);
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
