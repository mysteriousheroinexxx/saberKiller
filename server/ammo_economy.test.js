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
  assert.strictEqual(accounting.pistol.unclaimedBoxes, 18, 'Room must contain exactly 18 pistol ammo boxes');
  assert.strictEqual(accounting.pistol.unclaimedRounds, 36, '18 boxes * 2 rounds = 36 unclaimed reserve rounds');

  // Shotgun budget checks
  assert.strictEqual(accounting.shotgun.max, 12, 'Max shotgun shells must be 12');
  assert.strictEqual(accounting.shotgun.total, 12, 'Total shotgun shells in room must equal exactly 12');
  assert.strictEqual(accounting.shotgun.loaded, 6, 'Unclaimed world shotgun holds 6 loaded magazine shells');
  assert.strictEqual(accounting.shotgun.reserve, 0, 'Starting player reserve shells must be 0');
  assert.strictEqual(accounting.shotgun.unclaimedBoxes, 3, 'Room must contain exactly 3 shotgun ammo boxes');
  assert.strictEqual(accounting.shotgun.unclaimedRounds, 6, '3 boxes * 2 rounds = 6 unclaimed reserve rounds');

  // Combined room budget checks
  assert.strictEqual(accounting.totalBudget, 60, 'Room total budget must be 60 units');
  assert.strictEqual(accounting.totalUnits, 60, 'Combined total ammunition units must equal exactly 60');
});

test('2. Correct ammunition per box: Each box grants exactly 2 rounds', () => {
  const rm = new RoomManager();
  const ws1 = createMockWebSocket();
  const layoutData = loadLayoutData();
  const res = rm.createRoom(ws1, 'TEST_AMMO_ROUNDS', 'default', layoutData, { directStart: true });
  const player = res.player;

  // Claim first pistol ammo box
  const pBox1 = claimNearItem(rm, ws1, player, 'floor_ammo_box_01');
  assert(pBox1.success, `Pickup failed: ${pBox1.error}`);
  assert.strictEqual(pBox1.ammoUpdate.rounds, 2, 'Pistol ammo box must grant exactly 2 rounds');
  assert.strictEqual(player.bullets, 2, 'Player bullets must increase from 0 to 2');

  // Claim second pistol ammo box
  const pBox2 = claimNearItem(rm, ws1, player, 'table_ammo_box_01');
  assert(pBox2.success, `Pickup failed: ${pBox2.error}`);
  assert.strictEqual(pBox2.ammoUpdate.rounds, 2, 'Pistol ammo box must grant exactly 2 rounds');
  assert.strictEqual(player.bullets, 4, 'Player bullets must increase from 2 to 4');

  // Claim shotgun ammo box
  const sBox1 = claimNearItem(rm, ws1, player, 'shelf_ammo_box_tier2');
  assert(sBox1.success, `Pickup failed: ${sBox1.error}`);
  assert.strictEqual(sBox1.ammoUpdate.rounds, 2, 'Shotgun ammo box must grant exactly 2 rounds');
  assert.strictEqual(player.shells, 2, 'Player shells must increase from 0 to 2');
});

test('3. Weapon compatibility: Pickups add rounds ONLY to compatible weapon reserve', () => {
  const rm = new RoomManager();
  const ws1 = createMockWebSocket();
  const layoutData = loadLayoutData();
  const res = rm.createRoom(ws1, 'TEST_AMMO_COMPAT', 'default', layoutData, { directStart: true });
  const player = res.player;

  assert.strictEqual(player.bullets, 0);
  assert.strictEqual(player.shells, 0);

  // Pick up pistol_ammo: must only add to bullets, shells stays 0
  const pRes = claimNearItem(rm, ws1, player, 'floor_ammo_box_01');
  assert(pRes.success, `Pickup failed: ${pRes.error}`);
  assert.strictEqual(player.bullets, 2, 'bullets increased by 2');
  assert.strictEqual(player.shells, 0, 'shells must remain 0 after picking up pistol ammo');

  // Pick up shotgun_ammo: must only add to shells, bullets stays at 2
  const sRes = claimNearItem(rm, ws1, player, 'shelf_ammo_box_tier2');
  assert(sRes.success, `Pickup failed: ${sRes.error}`);
  assert.strictEqual(player.shells, 2, 'shells increased by 2');
  assert.strictEqual(player.bullets, 2, 'bullets must remain at 2 after picking up shotgun ammo');
});

test('4. No ammunition duplication on weapon discovery: Discovered weapons grant NO extra reserve ammo', () => {
  const rm = new RoomManager();
  const ws1 = createMockWebSocket();
  const layoutData = loadLayoutData();
  const res = rm.createRoom(ws1, 'TEST_NO_DISCOVERY_DUP', 'default', layoutData, { directStart: true });
  const player = res.player;

  // Player picks up 2 pistol ammo boxes first (accumulates 4 reserve bullets)
  claimNearItem(rm, ws1, player, 'floor_ammo_box_01');
  claimNearItem(rm, ws1, player, 'table_ammo_box_01');
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
  assert.strictEqual(accounting.pistol.unclaimedRounds, 32); // 16 remaining boxes * 2 rounds
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
  assert.strictEqual(p1.bullets, 2, 'Player 1 receives 2 bullets');

  // Player 2 attempts to claim the exact same box
  const claim2 = claimNearItem(rm, ws2, p2, 'floor_pistol_ammo_03');
  assert(!claim2.success, 'Player 2 duplicate claim must be rejected');
  assert(claim2.error.includes('already been collected'), 'Error must specify already collected');
  assert.strictEqual(p2.bullets, 0, 'Player 2 must receive 0 bullets from rejected claim');

  // Verify accounting: unclaimed boxes decreased by exactly 1, no duplicate ammo created
  const accounting = rm.getRoomAmmoAccounting('TEST_CONTENTION');
  assert.strictEqual(accounting.pistol.reserve, 2, 'Total player reserve bullets is exactly 2');
  assert.strictEqual(accounting.pistol.unclaimedBoxes, 17, '17 unclaimed pistol boxes remain');
  assert.strictEqual(accounting.pistol.total, 48, 'Total pistol ammo remains strictly 48');
});

test('6. Loaded and reserve ammunition accounting across firing and reloading lifecycle', () => {
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

  // Player 1 picks up 2 pistol ammo boxes (grants +4 reserve bullets)
  claimNearItem(rm, ws1, p1, 'floor_ammo_box_01');
  claimNearItem(rm, ws1, p1, 'table_ammo_box_01');
  assert.strictEqual(p1.bullets, 4);
  acc = rm.getRoomAmmoAccounting('TEST_LIFECYCLE');
  assert.strictEqual(acc.pistol.loaded, 7);
  assert.strictEqual(acc.pistol.reserve, 4);
  assert.strictEqual(acc.pistol.unclaimedRounds, 32); // 16 remaining boxes * 2 rounds
  assert.strictEqual(acc.pistol.total, 43, 'Total remains 43 (conservation of ammunition)');

  // Player 1 reloads: 4 bullets move from reserve to magazine
  p1.mag.bullets += 4; // 7 -> 11
  p1.bullets -= 4;     // 4 -> 0
  acc = rm.getRoomAmmoAccounting('TEST_LIFECYCLE');
  assert.strictEqual(acc.pistol.loaded, 11);
  assert.strictEqual(acc.pistol.reserve, 0);
  assert.strictEqual(acc.pistol.total, 43, 'Reload preserves total ammunition (11 + 0 + 32 = 43)');

  // Player 2 picks up 3 pistol ammo boxes (grants +6 reserve bullets)
  claimNearItem(rm, ws2, p2, 'floor_pistol_ammo_03');
  claimNearItem(rm, ws2, p2, 'floor_pistol_ammo_04');
  claimNearItem(rm, ws2, p2, 'floor_pistol_ammo_05');
  assert.strictEqual(p2.bullets, 6);
  acc = rm.getRoomAmmoAccounting('TEST_LIFECYCLE');
  assert.strictEqual(acc.pistol.loaded, 11);
  assert.strictEqual(acc.pistol.reserve, 6); // P1(0) + P2(6)
  assert.strictEqual(acc.pistol.unclaimedRounds, 26); // 13 remaining boxes * 2 rounds
  assert.strictEqual(acc.pistol.total, 43, 'Shared accounting across both players equals 43 (11 + 6 + 26 = 43 <= 48)');

  // Player 2 claims shotgun and 1 shotgun ammo box
  claimNearItem(rm, ws2, p2, 'floor_weapon_shotgun_01');
  claimNearItem(rm, ws2, p2, 'shelf_ammo_box_tier2');
  assert.strictEqual(p2.mag.shells, 6, 'Shotgun magazine holds 6 shells');
  assert.strictEqual(p2.shells, 2, 'Shotgun reserve holds 2 shells');
  acc = rm.getRoomAmmoAccounting('TEST_LIFECYCLE');
  assert.strictEqual(acc.shotgun.loaded, 6);
  assert.strictEqual(acc.shotgun.reserve, 2);
  assert.strictEqual(acc.shotgun.unclaimedRounds, 4); // 2 remaining boxes * 2 rounds
  assert.strictEqual(acc.shotgun.total, 12, 'Total shotgun shells equals exactly 12');

  // Verify total room units never exceeds 60
  assert(acc.totalUnits <= 60, `Total units ${acc.totalUnits} must be <= 60`);
  assert.strictEqual(acc.totalUnits, 55, '43 pistol + 12 shotgun = 55 total units in room');
});
