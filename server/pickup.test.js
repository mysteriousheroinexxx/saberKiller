import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './room_manager.js';

const layout = {
  placements: [
    { id: 'energy_1', type: 'energy_drink', position: [48.69, 0, -187.65] },
    { id: 'aid_1', type: 'first_aid', position: [100, 0, 100] }
  ]
};

test('pickup is authoritative, rejects competing claims, range, and fabricated IDs', () => {
  const manager = new RoomManager();
  const firstSocket = {};
  const secondSocket = {};
  manager.createRoom(firstSocket, 'TEST', 'default', layout);
  manager.joinRoom(secondSocket, 'TEST');

  const accepted = manager.handlePickupRequest(firstSocket, 'energy_1');
  assert.equal(accepted.success, true);
  assert.equal(accepted.inventory.slots[0].typeId, 'energy_drink');
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
