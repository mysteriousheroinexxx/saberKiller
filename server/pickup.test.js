import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './room_manager.js';

const layout = {
  placements: [
    { id: 'energy_1', type: 'energy_drink', position: [48.69, 0, -187.65] },
    { id: 'aid_1', type: 'first_aid', position: [100, 0, 100] },
    { id: 'pistol_pickup_01', type: 'weapon_pistol', position: [48.69, 0, -187.65] },
    { id: 'shotgun_pickup_01', type: 'weapon_shotgun', position: [51.5, 0, -187.65] }
  ]
};

test('starting equipment is tactical flashlight only with 0 starting firearms', () => {
  const manager = new RoomManager();
  const socket = {};
  const res = manager.createRoom(socket, 'LOADOUT_TEST', 'default', layout);
  assert.equal(res.player.inventory.slots[0]?.typeId, 'equipment_torch');
  assert.equal(res.player.inventory.slots[0]?.quantity, 1);
  for (let i = 1; i < 30; i++) {
    assert.equal(res.player.inventory.slots[i], null, `Slot ${i} must be empty at start`);
  }
  assert.equal(res.player.inventory.getCount('weapon_pistol'), 0);
  assert.equal(res.player.inventory.getCount('weapon_shotgun'), 0);
});

test('weapon discovery pickup is authoritative, claims weapon once and rejects duplicates', () => {
  const manager = new RoomManager();
  const p1Socket = {};
  const p2Socket = {};
  manager.createRoom(p1Socket, 'WEAPON_TEST', 'default', layout);
  manager.joinRoom(p2Socket, 'WEAPON_TEST');

  // Player 1 claims pistol
  const claimPistol = manager.handlePickupRequest(p1Socket, 'pistol_pickup_01');
  assert.equal(claimPistol.success, true);
  assert.equal(claimPistol.player.inventory.slots[1]?.typeId, 'weapon_pistol');
  assert.equal(claimPistol.room.worldItems.get('pistol_pickup_01').available, false);
  assert.equal(claimPistol.room.worldItems.get('pistol_pickup_01').collectedBy, claimPistol.player.id);

  // Player 2 attempts to claim same pistol pickup -> rejected
  const duplicatePistolClaim = manager.handlePickupRequest(p2Socket, 'pistol_pickup_01');
  assert.match(duplicatePistolClaim.error, /already been collected/);
  assert.equal(duplicatePistolClaim.player.inventory.getCount('weapon_pistol'), 0);

  // Player 2 claims shotgun
  const claimShotgun = manager.handlePickupRequest(p2Socket, 'shotgun_pickup_01');
  assert.equal(claimShotgun.success, true);
  assert.equal(claimShotgun.player.inventory.slots[1]?.typeId, 'weapon_shotgun');
  assert.equal(claimShotgun.room.worldItems.get('shotgun_pickup_01').available, false);
});

test('pickup is authoritative, rejects competing claims, range, and fabricated IDs', () => {
  const manager = new RoomManager();
  const firstSocket = {};
  const secondSocket = {};
  manager.createRoom(firstSocket, 'TEST', 'default', layout);
  manager.joinRoom(secondSocket, 'TEST');

  const accepted = manager.handlePickupRequest(firstSocket, 'energy_1');
  assert.equal(accepted.success, true);
  assert.equal(accepted.inventory.slots.find(s => s?.typeId === 'energy_drink')?.typeId, 'energy_drink');
  assert.equal(accepted.room.worldItems.get('energy_1').available, false);

  const competingClaim = manager.handlePickupRequest(secondSocket, 'energy_1');
  assert.match(competingClaim.error, /already been collected/);
  assert.equal(competingClaim.player.inventory.getCount('energy_drink'), 0);

  const fakeId = manager.handlePickupRequest(firstSocket, 'fabricated_item');
  assert.match(fakeId.error, /does not exist/);

  const distant = manager.handlePickupRequest(firstSocket, 'aid_1', { x: 100, y: 0, z: 100 });
  assert.match(distant.error, /too far/);
  assert.equal(distant.player.inventory.getCount('first_aid'), 0);
});
