import { test } from 'node:test';
import assert from 'node:assert';
import { RoomManager, AMMO_CONFIG } from './room_manager.js';
import fs from 'fs';
import path from 'path';

function createMockWebSocket() {
  return {
    readyState: 1, // OPEN
    send: () => {}
  };
}

function loadLayoutData() {
  const layoutPath = path.resolve(process.cwd(), 'assets/data/world_items.json');
  return JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
}

function claimNearItem(rm, ws, player, itemId) {
  const room = rm.rooms.get(rm.clientToRoom.get(ws).roomCode);
  const item = room.worldItems.get(itemId);
  if (item && item.position) {
    player.position = { x: item.position[0], y: item.position[1], z: item.position[2] + 0.8 };
  }
  return rm.handlePickupRequest(ws, itemId, player.position);
}

test('1. Shared room-wide limits: Exactly 48 pistol bullets, 12 shotgun shells, 60 total units', () => {
  const rm = new RoomManager();
  const ws1 = createMockWebSocket();
  const layoutData = loadLayoutData();
  const res = rm.createRoom(ws1, 'TEST_AMMO_LIMITS', 'default', layoutData, { directStart: true });

  assert(!res.error, `Room creation failed: ${res.error}`);
  const accounting = rm.getRoomAmmoAccounting('TEST_AMMO_LIMITS');
  assert(accounting, 'Accounting must be returned');

  console.log('[TEST 1 INITIAL ACCOUNTING]:', JSON.stringify(accounting, null, 2));

  // Pistol budget checks
  assert.strictEqual(accounting.pistol.max, 48, 'Max pistol bullets must be 48');
  assert.strictEqual(accounting.pistol.total, 48, 'Total pistol bullets in room must equal exactly 48');
  assert.strictEqual(accounting.pistol.loaded, 12, 'Unclaimed world pistol holds 12 loaded magazine rounds');
  assert.strictEqual(accounting.pistol.reserve, 0, 'Starting player reserve bullets must be 0');
  assert.strictEqual(accounting.pistol.worldBoxes, 18, 'Room must contain exactly 18 pistol ammo boxes in world');
  assert.strictEqual(accounting.pistol.inventoryBoxes, 0, '0 pistol ammo boxes in player inventory at start');
  assert.strictEqual(accounting.pistol.unusedRounds, 36, '18 boxes * 2 rounds = 36 unused reserve rounds');

  // Shotgun budget checks
  assert.strictEqual(accounting.shotgun.max, 12, 'Max shotgun shells must be 12');
  assert.strictEqual(accounting.shotgun.total, 12, 'Total shotgun shells in room must equal exactly 12');
  assert.strictEqual(accounting.shotgun.loaded, 6, 'Unclaimed world shotgun holds 6 loaded magazine shells');
  assert.strictEqual(accounting.shotgun.reserve, 0, 'Starting player reserve shells must be 0');
  assert.strictEqual(accounting.shotgun.worldBoxes, 3, 'Room must contain exactly 3 shotgun ammo boxes in world');
  assert.strictEqual(accounting.shotgun.inventoryBoxes, 0, '0 shotgun ammo boxes in player inventory at start');
  assert.strictEqual(accounting.shotgun.unusedRounds, 6, '3 boxes * 2 rounds = 6 unused reserve rounds');

  // Combined room budget checks
  assert.strictEqual(accounting.totalBudget, 60, 'Room total budget must be 60 units');
  assert.strictEqual(accounting.totalUnits, 60, 'Combined total ammunition units must equal exactly 60');
});

test('2. Consumable ammo boxes: Pickup transfers to inventory without ammo; consumption grants exactly 2 rounds', () => {
  const rm = new RoomManager();
  const ws1 = createMockWebSocket();
  const layoutData = loadLayoutData();
  const res = rm.createRoom(ws1, 'TEST_AMMO_ROUNDS', 'default', layoutData, { directStart: true });
  const player = res.player;

  // Claim first pistol ammo box: transfers to inventory, 0 reserve ammo added
  const pBox1 = claimNearItem(rm, ws1, player, 'floor_ammo_box_01');
  assert(pBox1.success, `Pickup failed: ${pBox1.error}`);
  assert.strictEqual(player.bullets, 0, 'Player bullets must NOT increase upon pickup');
  assert.strictEqual(player.inventory.getCount('pistol_ammo'), 1, 'Pistol ammo box must be in inventory');

  // Consume first pistol ammo box: grants exactly 2 bullets
  const slotIdx1 = player.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  assert(slotIdx1 !== -1, 'Pistol ammo box must be found in inventory slot');
  const use1 = rm.handleUseItem(ws1, slotIdx1);
  assert(use1.success, `Use failed: ${use1.error}`);
  assert.strictEqual(use1.ammoUpdate.rounds, 2, 'Pistol ammo box must grant exactly 2 rounds');
  assert.strictEqual(player.bullets, 2, 'Player bullets must increase from 0 to 2');
  assert.strictEqual(player.inventory.getCount('pistol_ammo'), 0, 'Consumed box is removed from inventory');

  // Claim second pistol ammo box
  const pBox2 = claimNearItem(rm, ws1, player, 'table_ammo_box_01');
  assert(pBox2.success, `Pickup failed: ${pBox2.error}`);
  assert.strictEqual(player.bullets, 2, 'Player bullets must remain 2 after picking up second box');
  assert.strictEqual(player.inventory.getCount('pistol_ammo'), 1);

  // Consume second box: grants another 2 bullets (total 4)
  const slotIdx2 = player.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  const use2 = rm.handleUseItem(ws1, slotIdx2);
  assert(use2.success, `Use failed: ${use2.error}`);
  assert.strictEqual(player.bullets, 4, 'Player bullets must increase from 2 to 4');
  assert.strictEqual(player.inventory.getCount('pistol_ammo'), 0);

  // Claim shotgun ammo box
  const sBox1 = claimNearItem(rm, ws1, player, 'shelf_ammo_box_tier2');
  assert(sBox1.success, `Pickup failed: ${sBox1.error}`);
  assert.strictEqual(player.shells, 0, 'Player shells must remain 0 after picking up shotgun ammo box');
  assert.strictEqual(player.inventory.getCount('shotgun_ammo'), 1);

  // Consume shotgun ammo box: grants exactly 2 shells
  const sSlotIdx = player.inventory.getSlots().findIndex(s => s?.typeId === 'shotgun_ammo');
  const useS1 = rm.handleUseItem(ws1, sSlotIdx);
  assert(useS1.success, `Use failed: ${useS1.error}`);
  assert.strictEqual(useS1.ammoUpdate.rounds, 2, 'Shotgun ammo box must grant exactly 2 shells');
  assert.strictEqual(player.shells, 2, 'Player shells must increase from 0 to 2');
  assert.strictEqual(player.inventory.getCount('shotgun_ammo'), 0);
});

test('3. Weapon compatibility: Consuming boxes adds rounds ONLY to compatible weapon reserve', () => {
  const rm = new RoomManager();
  const ws1 = createMockWebSocket();
  const layoutData = loadLayoutData();
  const res = rm.createRoom(ws1, 'TEST_AMMO_COMPAT', 'default', layoutData, { directStart: true });
  const player = res.player;

  assert.strictEqual(player.bullets, 0);
  assert.strictEqual(player.shells, 0);

  // Pick up pistol_ammo
  const pRes = claimNearItem(rm, ws1, player, 'floor_ammo_box_01');
  assert(pRes.success);
  assert.strictEqual(player.bullets, 0, 'bullets 0 on pickup');
  assert.strictEqual(player.shells, 0, 'shells 0 on pickup');

  // Consume pistol_ammo: must only add to bullets, shells stays 0
  const pSlot = player.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  const pUseRes = rm.handleUseItem(ws1, pSlot);
  assert(pUseRes.success);
  assert.strictEqual(player.bullets, 2, 'bullets increased by 2');
  assert.strictEqual(player.shells, 0, 'shells must remain 0 after consuming pistol ammo');

  // Pick up shotgun_ammo
  const sRes = claimNearItem(rm, ws1, player, 'shelf_ammo_box_tier2');
  assert(sRes.success);
  assert.strictEqual(player.shells, 0, 'shells 0 on pickup');

  // Consume shotgun_ammo: must only add to shells, bullets stays at 2
  const sSlot = player.inventory.getSlots().findIndex(s => s?.typeId === 'shotgun_ammo');
  const sUseRes = rm.handleUseItem(ws1, sSlot);
  assert(sUseRes.success);
  assert.strictEqual(player.shells, 2, 'shells increased by 2');
  assert.strictEqual(player.bullets, 2, 'bullets must remain at 2 after consuming shotgun ammo');
});

test('4. No ammunition duplication on weapon discovery: Discovered weapons grant NO extra reserve ammo', () => {
  const rm = new RoomManager();
  const ws1 = createMockWebSocket();
  const layoutData = loadLayoutData();
  const res = rm.createRoom(ws1, 'TEST_NO_DISCOVERY_DUP', 'default', layoutData, { directStart: true });
  const player = res.player;

  // Player picks up 2 pistol ammo boxes and consumes them (accumulates 4 reserve bullets)
  claimNearItem(rm, ws1, player, 'floor_ammo_box_01');
  let slot = player.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  rm.handleUseItem(ws1, slot);

  claimNearItem(rm, ws1, player, 'table_ammo_box_01');
  slot = player.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  rm.handleUseItem(ws1, slot);

  assert.strictEqual(player.bullets, 4, 'Player has 4 reserve bullets');
  assert.strictEqual(player.mag.bullets, 0, 'Player has 0 loaded pistol bullets before finding weapon');

  // Player discovers weapon_pistol
  const weaponRes = claimNearItem(rm, ws1, player, 'floor_weapon_pistol_01');
  assert(weaponRes.success, `Weapon pickup failed: ${weaponRes.error}`);

  // Discovered pistol has 12 loaded in magazine, but reserve bullets must STAY at 4 (NO free 36 bullets!)
  assert.strictEqual(player.mag.bullets, 12, 'Pistol is found loaded with 12 magazine rounds');
  assert.strictEqual(player.bullets, 4, 'Reserve bullets must strictly remain 4 (no additional reserve generated on discovery)');

  // Verify room total pistol bullets is still exactly 48
  const accounting = rm.getRoomAmmoAccounting('TEST_NO_DISCOVERY_DUP');
  assert.strictEqual(accounting.pistol.loaded, 12);
  assert.strictEqual(accounting.pistol.reserve, 4);
  assert.strictEqual(accounting.pistol.unusedRounds, 32); // 16 remaining unused boxes * 2 rounds
  assert.strictEqual(accounting.pistol.total, 48, 'Combined total pistol ammunition must equal exactly 48');
});

test('5. Two-player pickup contention: Every box is claimed authoritatively and collected only once', () => {
  const rm = new RoomManager();
  const ws1 = createMockWebSocket();
  const ws2 = createMockWebSocket();
  const layoutData = loadLayoutData();

  const r1 = rm.createRoom(ws1, 'TEST_CONTENTION', 'default', layoutData, { directStart: true });
  const r2 = rm.joinRoom(ws2, 'TEST_CONTENTION');

  const p1 = r1.player;
  const p2 = r2.player;

  // Player 1 claims box
  const claim1 = claimNearItem(rm, ws1, p1, 'floor_pistol_ammo_03');
  assert(claim1.success, 'Player 1 claim must succeed');
  assert.strictEqual(p1.bullets, 0, 'Player 1 reserve bullets remains 0 before consumption');
  assert.strictEqual(p1.inventory.getCount('pistol_ammo'), 1, 'Player 1 has box in inventory');

  // Player 2 attempts to claim the exact same box
  const claim2 = claimNearItem(rm, ws2, p2, 'floor_pistol_ammo_03');
  assert(!claim2.success, 'Player 2 duplicate claim must be rejected');
  assert(claim2.error.includes('already been collected'), 'Error must specify already collected');
  assert.strictEqual(p2.inventory.getCount('pistol_ammo'), 0, 'Player 2 inventory unchanged');
  assert.strictEqual(p2.bullets, 0, 'Player 2 must receive 0 bullets from rejected claim');

  // Player 1 consumes the claimed box
  const slot = p1.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  const useRes = rm.handleUseItem(ws1, slot);
  assert(useRes.success, 'Player 1 consumption must succeed');
  assert.strictEqual(p1.bullets, 2, 'Player 1 receives 2 bullets');

  // Verify accounting: unclaimed boxes in world decreased by 1, reserve is 2, total strictly 48
  const accounting = rm.getRoomAmmoAccounting('TEST_CONTENTION');
  assert.strictEqual(accounting.pistol.reserve, 2, 'Total player reserve bullets is exactly 2');
  assert.strictEqual(accounting.pistol.worldBoxes, 17, '17 world pistol boxes remain');
  assert.strictEqual(accounting.pistol.inventoryBoxes, 0, '0 inventory boxes remain');
  assert.strictEqual(accounting.pistol.total, 48, 'Total pistol ammo remains strictly 48');
});

test('6. Loaded and reserve ammunition accounting across firing, reloading, and box consumption', () => {
  const rm = new RoomManager();
  const ws1 = createMockWebSocket();
  const ws2 = createMockWebSocket();
  const layoutData = loadLayoutData();

  const r1 = rm.createRoom(ws1, 'TEST_LIFECYCLE', 'default', layoutData, { directStart: true });
  const r2 = rm.joinRoom(ws2, 'TEST_LIFECYCLE');

  const p1 = r1.player;
  const p2 = r2.player;

  // Initial accounting: 48 pistol, 12 shotgun, 60 total
  let acc = rm.getRoomAmmoAccounting('TEST_LIFECYCLE');
  assert.strictEqual(acc.pistol.total, 48);
  assert.strictEqual(acc.shotgun.total, 12);
  assert.strictEqual(acc.totalUnits, 60);

  // Player 1 claims pistol: magazine loaded with 12
  const p1Wpn = claimNearItem(rm, ws1, p1, 'floor_weapon_pistol_01');
  assert(p1Wpn.success);
  assert.strictEqual(p1.mag.bullets, 12);

  // Player 1 fires 5 shots: magazine drops from 12 to 7
  p1.mag.bullets = 7;
  acc = rm.getRoomAmmoAccounting('TEST_LIFECYCLE');
  assert.strictEqual(acc.pistol.loaded, 7);
  assert.strictEqual(acc.pistol.reserve, 0);
  assert.strictEqual(acc.pistol.total, 43, 'Total drops by 5 expended rounds (43 <= 48)');

  // Player 1 picks up 2 pistol ammo boxes and consumes them (+4 reserve bullets)
  claimNearItem(rm, ws1, p1, 'floor_ammo_box_01');
  let slot = p1.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  rm.handleUseItem(ws1, slot);

  claimNearItem(rm, ws1, p1, 'table_ammo_box_01');
  slot = p1.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  rm.handleUseItem(ws1, slot);

  assert.strictEqual(p1.bullets, 4);
  acc = rm.getRoomAmmoAccounting('TEST_LIFECYCLE');
  assert.strictEqual(acc.pistol.loaded, 7);
  assert.strictEqual(acc.pistol.reserve, 4);
  assert.strictEqual(acc.pistol.unusedRounds, 32); // 16 remaining boxes * 2 rounds
  assert.strictEqual(acc.pistol.total, 43, 'Total remains 43 (conservation of ammunition)');

  // Player 1 reloads: 4 bullets move from reserve to magazine
  p1.mag.bullets += 4; // 7 -> 11
  p1.bullets -= 4;     // 4 -> 0
  acc = rm.getRoomAmmoAccounting('TEST_LIFECYCLE');
  assert.strictEqual(acc.pistol.loaded, 11);
  assert.strictEqual(acc.pistol.reserve, 0);
  assert.strictEqual(acc.pistol.total, 43, 'Reload preserves total ammunition (11 + 0 + 32 = 43)');

  // Player 2 picks up 3 pistol ammo boxes and consumes them (+6 reserve bullets)
  claimNearItem(rm, ws2, p2, 'floor_pistol_ammo_03');
  slot = p2.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  rm.handleUseItem(ws2, slot);

  claimNearItem(rm, ws2, p2, 'floor_pistol_ammo_04');
  slot = p2.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  rm.handleUseItem(ws2, slot);

  claimNearItem(rm, ws2, p2, 'floor_pistol_ammo_05');
  slot = p2.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  rm.handleUseItem(ws2, slot);

  assert.strictEqual(p2.bullets, 6);
  acc = rm.getRoomAmmoAccounting('TEST_LIFECYCLE');
  assert.strictEqual(acc.pistol.loaded, 11);
  assert.strictEqual(acc.pistol.reserve, 6); // P1(0) + P2(6)
  assert.strictEqual(acc.pistol.unusedRounds, 26); // 13 remaining boxes * 2 rounds
  assert.strictEqual(acc.pistol.total, 43, 'Shared accounting across both players equals 43 (11 + 6 + 26 = 43 <= 48)');

  // Player 2 claims shotgun and consumes 1 shotgun ammo box
  claimNearItem(rm, ws2, p2, 'floor_weapon_shotgun_01');
  claimNearItem(rm, ws2, p2, 'shelf_ammo_box_tier2');
  slot = p2.inventory.getSlots().findIndex(s => s?.typeId === 'shotgun_ammo');
  rm.handleUseItem(ws2, slot);

  assert.strictEqual(p2.mag.shells, 6, 'Shotgun magazine holds 6 shells');
  assert.strictEqual(p2.shells, 2, 'Shotgun reserve holds 2 shells');
  acc = rm.getRoomAmmoAccounting('TEST_LIFECYCLE');
  assert.strictEqual(acc.shotgun.loaded, 6);
  assert.strictEqual(acc.shotgun.reserve, 2);
  assert.strictEqual(acc.shotgun.unusedRounds, 4); // 2 remaining boxes * 2 rounds
  assert.strictEqual(acc.shotgun.total, 12, 'Total shotgun shells equals exactly 12');

  // Verify total room units never exceeds 60
  assert(acc.totalUnits <= 60, `Total units ${acc.totalUnits} must be <= 60`);
  assert.strictEqual(acc.totalUnits, 55, '43 pistol + 12 shotgun = 55 total units in room');
});

test('7. Anti-duplication exploit verification: Full lifecycle for pistol & shotgun ammo', () => {
  const rm = new RoomManager();
  const ws1 = createMockWebSocket();
  const layoutData = loadLayoutData();
  const res = rm.createRoom(ws1, 'TEST_EXPLOIT', 'default', layoutData, { directStart: true });
  const player = res.player;

  // 1. Pick up a pistol ammunition box
  const pBox = claimNearItem(rm, ws1, player, 'floor_ammo_box_01');
  assert(pBox.success, 'Pistol box pickup must succeed');
  assert.strictEqual(player.inventory.getCount('pistol_ammo'), 1, 'Box must transfer into inventory');

  // 2. Verify reserve ammunition has not increased
  assert.strictEqual(player.bullets, 0, 'Reserve ammunition must not increase upon pickup');
  let acc = rm.getRoomAmmoAccounting('TEST_EXPLOIT');
  assert.strictEqual(acc.pistol.total, 48, 'Room total must strictly remain 48');
  assert.strictEqual(acc.pistol.inventoryBoxes, 1, '1 box in inventory');
  assert.strictEqual(acc.pistol.worldBoxes, 17, '17 boxes in world');

  // 3. Drop the box
  const slotIdx = player.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  assert(slotIdx !== -1, 'Pistol ammo slot must exist in inventory');
  const dropRes = rm.handleDropItem(ws1, slotIdx, null, 1, { x: 43.3, y: 0, z: -187.9 }, 0);
  assert(dropRes.success, 'Drop item must succeed');
  assert.strictEqual(player.inventory.getCount('pistol_ammo'), 0, 'Box removed from inventory');
  assert.strictEqual(player.bullets, 0, 'Reserve bullets still 0 after dropping');
  acc = rm.getRoomAmmoAccounting('TEST_EXPLOIT');
  assert.strictEqual(acc.pistol.total, 48, 'Room total strictly remains 48 after drop');
  assert.strictEqual(acc.pistol.inventoryBoxes, 0, '0 boxes in inventory');
  assert.strictEqual(acc.pistol.worldBoxes, 18, '18 boxes in world');

  // 4. Pick it up again
  const droppedId = dropRes.droppedItem.id;
  const rePickup = claimNearItem(rm, ws1, player, droppedId);
  assert(rePickup.success, 'Re-picking up dropped box must succeed');
  assert.strictEqual(player.inventory.getCount('pistol_ammo'), 1, 'Box back in inventory');

  // 5. Verify it still represents only 2 rounds and granted no free ammo
  assert.strictEqual(player.bullets, 0, 'Re-picking up dropped box must NEVER grant free ammunition');
  acc = rm.getRoomAmmoAccounting('TEST_EXPLOIT');
  assert.strictEqual(acc.pistol.total, 48, 'Room total strictly 48');

  // 6. Use it and verify exactly 2 bullets are added
  const useSlotIdx = player.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  const useRes = rm.handleUseItem(ws1, useSlotIdx);
  assert(useRes.success, 'Using pistol ammo box must succeed');
  assert.strictEqual(player.bullets, 2, 'Exactly 2 bullets must be added upon box consumption');
  assert.strictEqual(player.inventory.getCount('pistol_ammo'), 0, 'Consumed box must permanently disappear from inventory');
  acc = rm.getRoomAmmoAccounting('TEST_EXPLOIT');
  assert.strictEqual(acc.pistol.reserve, 2, 'Reserve bullets is 2');
  assert.strictEqual(acc.pistol.inventoryBoxes, 0, '0 inventory boxes');
  assert.strictEqual(acc.pistol.worldBoxes, 17, '17 world boxes');
  assert.strictEqual(acc.pistol.total, 48, 'Room total strictly 48 (conservation preserved)');

  // 7. Attempt to use or duplicate the consumed box
  const dupUseRes = rm.handleUseItem(ws1, useSlotIdx);
  assert(!dupUseRes.success, 'Attempting to use consumed box must be rejected');
  assert(dupUseRes.error.includes('not found'), 'Error indicates item not found');

  // 8. Verify no additional ammunition is awarded
  assert.strictEqual(player.bullets, 2, 'Reserve bullets must remain strictly 2 (no duplicate ammo granted)');
  acc = rm.getRoomAmmoAccounting('TEST_EXPLOIT');
  assert.strictEqual(acc.pistol.total, 48, 'Room total remains strictly 48');

  // --- Repeat full lifecycle for shotgun ammunition ---
  const sBox = claimNearItem(rm, ws1, player, 'shelf_ammo_box_tier2');
  assert(sBox.success, 'Shotgun box pickup must succeed');
  assert.strictEqual(player.shells, 0, 'Shotgun reserve must not increase upon pickup');
  assert.strictEqual(player.inventory.getCount('shotgun_ammo'), 1);

  // Drop shotgun box
  const sSlotIdx = player.inventory.getSlots().findIndex(s => s?.typeId === 'shotgun_ammo');
  const sDropRes = rm.handleDropItem(ws1, sSlotIdx, null, 1, { x: 44.3, y: 0.7, z: -188.7 }, 0);
  assert(sDropRes.success);
  assert.strictEqual(player.shells, 0, 'Shells remain 0 after drop');
  assert.strictEqual(player.inventory.getCount('shotgun_ammo'), 0);

  // Re-pick up shotgun box
  const sDroppedId = sDropRes.droppedItem.id;
  const sRePickup = claimNearItem(rm, ws1, player, sDroppedId);
  assert(sRePickup.success);
  assert.strictEqual(player.shells, 0, 'Shells remain 0 after re-pickup');
  assert.strictEqual(player.inventory.getCount('shotgun_ammo'), 1);

  // Use shotgun box
  const sUseSlotIdx = player.inventory.getSlots().findIndex(s => s?.typeId === 'shotgun_ammo');
  const sUseRes = rm.handleUseItem(ws1, sUseSlotIdx);
  assert(sUseRes.success);
  assert.strictEqual(player.shells, 2, 'Exactly 2 shells added upon consumption');
  assert.strictEqual(player.inventory.getCount('shotgun_ammo'), 0);

  // Duplicate use attempt
  const sDupUseRes = rm.handleUseItem(ws1, sUseSlotIdx);
  assert(!sDupUseRes.success, 'Duplicate shotgun box use must be rejected');
  assert.strictEqual(player.shells, 2, 'Shells remain strictly 2');

  acc = rm.getRoomAmmoAccounting('TEST_EXPLOIT');
  assert.strictEqual(acc.shotgun.total, 12, 'Room total shotgun shells remains strictly 12');
  assert.strictEqual(acc.totalUnits, 60, 'Combined total units remains strictly 60');
});

test('8. Server authority: Repeated or concurrent consumption requests cannot consume same box twice', () => {
  const rm = new RoomManager();
  const ws1 = createMockWebSocket();
  const layoutData = loadLayoutData();
  const res = rm.createRoom(ws1, 'TEST_CONCURRENT', 'default', layoutData, { directStart: true });
  const player = res.player;

  // Pick up 1 pistol ammo box
  claimNearItem(rm, ws1, player, 'floor_ammo_box_01');
  const slotIdx = player.inventory.getSlots().findIndex(s => s?.typeId === 'pistol_ammo');
  const instanceId = player.inventory.getItem(slotIdx).instanceId;

  // Simulate concurrent / rapid sequential requests with identical slot/instanceId
  const req1 = rm.handleUseItem(ws1, slotIdx, instanceId);
  const req2 = rm.handleUseItem(ws1, slotIdx, instanceId);
  const req3 = rm.handleUseItem(ws1, slotIdx, instanceId);

  assert.strictEqual(req1.success, true, 'First consumption request succeeds');
  assert.strictEqual(req2.success, false, 'Second request must be rejected');
  assert.strictEqual(req3.success, false, 'Third request must be rejected');

  assert.strictEqual(player.bullets, 2, 'Player received exactly 2 bullets, not 4 or 6');
  assert.strictEqual(player.inventory.getCount('pistol_ammo'), 0, 'Inventory holds 0 boxes');

  // Verify accounting
  const acc = rm.getRoomAmmoAccounting('TEST_CONCURRENT');
  assert.strictEqual(acc.pistol.total, 48, 'Room total pistol bullets strictly 48');
  assert.strictEqual(acc.totalUnits, 60, 'Combined total units strictly 60');
});
