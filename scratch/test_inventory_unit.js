import assert from 'assert';
import { InventoryController } from '../js/multiplayer/inventory_controller.js';
import { getItemDefinition, isPickupItem, validateItemQuantity } from '../js/multiplayer/item_catalog.js';
import { RoomManager } from '../server/room_manager.js';

console.log('--- RUNNING UNIT TESTS FOR INVENTORY & INTERACTION FOUNDATION ---');

// 1. Test Item Catalog
console.log('1. Testing Item Catalog...');
const firstAidDef = getItemDefinition('first_aid');
assert(firstAidDef, 'first_aid definition should exist');
assert.strictEqual(firstAidDef.stackable, false, 'first_aid should not be stackable');
assert.strictEqual(firstAidDef.maxStack, 1, 'first_aid maxStack should be 1');

const almondDef = getItemDefinition('almond_can');
assert(almondDef, 'almond_can definition should exist');
assert.strictEqual(almondDef.stackable, true, 'almond_can should be stackable');
assert.strictEqual(almondDef.maxStack, 4, 'almond_can maxStack should be 4');

assert.strictEqual(isPickupItem('first_aid'), true);
assert.strictEqual(isPickupItem('almond_can'), true);
assert.strictEqual(isPickupItem('prop_shelf_01'), false);
assert.strictEqual(isPickupItem('vending_almond'), false);

// 2. Test InventoryController Data Model
console.log('2. Testing InventoryController...');
const inv = new InventoryController(4); // 4 slots
assert.strictEqual(inv.capacity, 4);
assert.strictEqual(inv.isFull(), false);

// Add 3 almond cans (stackable, maxStack 4)
const r1 = inv.addItem('almond_can', 3);
assert.strictEqual(r1.success, true);
assert.strictEqual(r1.added, 3);
assert.strictEqual(inv.getCount('almond_can'), 3);
assert.strictEqual(inv.getItem(0).quantity, 3);

// Add 2 more almond cans -> 1 fills slot 0 (reaching max 4), 1 goes to slot 1
const r2 = inv.addItem('almond_can', 2);
assert.strictEqual(r2.success, true);
assert.strictEqual(r2.added, 2);
assert.strictEqual(inv.getCount('almond_can'), 5);
assert.strictEqual(inv.getItem(0).quantity, 4);
assert.strictEqual(inv.getItem(1).quantity, 1);

// Add non-stackable item: first_aid
const r3 = inv.addItem('first_aid', 1);
assert.strictEqual(r3.success, true);
assert.strictEqual(r3.added, 1);
assert(inv.getItem(2).instanceId.startsWith('inst_first_aid_'));

// Add another non-stackable item: doorKey
const r4 = inv.addItem('doorKey', 1);
assert.strictEqual(r4.success, true);
assert.strictEqual(inv.isFull(), true);

// Try adding when full
const r5 = inv.addItem('energy_drink', 1);
assert.strictEqual(r5.success, false);
assert.strictEqual(r5.added, 0);

// Remove 1 almond can from slot 0
const rem1 = inv.removeItem(0, 1);
assert.strictEqual(rem1.success, true);
assert.strictEqual(inv.getItem(0).quantity, 3);
assert.strictEqual(inv.getCount('almond_can'), 4);

// Serialize and Deserialize
const serialized = inv.serialize();
const inv2 = new InventoryController(4);
inv2.deserialize(serialized);
assert.strictEqual(inv2.getCount('almond_can'), 4);
assert.strictEqual(inv2.getCount('first_aid'), 1);
assert.strictEqual(inv2.getCount('doorKey'), 1);
assert.strictEqual(inv2.getItem(2).instanceId, inv.getItem(2).instanceId);

// 3. Test RoomManager Authoritative Pickups
console.log('3. Testing RoomManager authoritativeness...');
const rm = new RoomManager();

// Mock mock layout
const mockLayout = {
  level: 'level0',
  placements: [
    { id: 'item_medkit_01', type: 'first_aid', position: [48.69, 0.0, -187.65] }, // at spawn 0
    { id: 'item_can_01', type: 'almond_can', position: [48.69, 0.0, -188.0] },    // 0.35m away
    { id: 'item_far_01', type: 'sanity_pill', position: [100.0, 0.0, 100.0] },   // very far away
    { id: 'prop_table_01', type: 'table', position: [48.69, 0.0, -187.65] }       // prop, not pickup
  ]
};

// Mock sockets
const ws1 = { send: () => {}, readyState: 1 };
const ws2 = { send: () => {}, readyState: 1 };

// Client 1 creates room
const cRoom = rm.createRoom(ws1, 'TEST', 'test_rev', mockLayout);
assert(!cRoom.error, 'Room creation should succeed');
assert.strictEqual(cRoom.roomCode, 'TEST');
assert.strictEqual(cRoom.collectedItems.length, 0);

// Client 2 joins room
const jRoom = rm.joinRoom(ws2, 'TEST');
assert(!jRoom.error, 'Room join should succeed');
assert.strictEqual(jRoom.collectedItems.length, 0);

// Client 1 attempts invalid item ID
const badId = rm.handlePickupRequest(ws1, 'non_existent_item');
assert(badId.error, 'Non-existent item should return error');

// Client 1 attempts to pick up a prop (not a pickup)
const propPickup = rm.handlePickupRequest(ws1, 'prop_table_01');
assert(propPickup.error, 'Prop should not be collectible');

// Client 1 attempts out-of-range pickup
const farPickup = rm.handlePickupRequest(ws1, 'item_far_01');
assert(farPickup.error, 'Out-of-range item should return error');
assert(farPickup.error.includes('too far'), 'Error should mention distance');

// Client 1 picks up item_medkit_01 (valid, close)
const goodPickup = rm.handlePickupRequest(ws1, 'item_medkit_01');
assert.strictEqual(goodPickup.success, true);
assert.strictEqual(goodPickup.item.id, 'item_medkit_01');
assert.strictEqual(goodPickup.player.inventory.getCount('first_aid'), 1);

// Client 2 attempts to pick up item_medkit_01 (already collected)
const dupPickup = rm.handlePickupRequest(ws2, 'item_medkit_01');
assert(dupPickup.error, 'Already collected item should return error');
assert(dupPickup.error.includes('already been collected'), 'Error should mention already collected');

// Client 2 moves closer to item_can_01 (within 2.1m) and picks it up
jRoom.player.position = { x: 49.0, y: 0.0, z: -188.0 };
const goodPickup2 = rm.handlePickupRequest(ws2, 'item_can_01');
assert.strictEqual(goodPickup2.success, true);
assert.strictEqual(goodPickup2.player.inventory.getCount('almond_can'), 1);
// Verify Client 1 does not have almond_can
const p1 = rm.rooms.get('TEST').players.get('p_1');
assert.strictEqual(p1.inventory.getCount('almond_can'), 0);

// Disconnect Client 2 so room has capacity for a new joiner
rm.handleDisconnect(ws2);

// Client 3 joins: should receive collectedItems list of already picked up items
const ws3 = { send: () => {}, readyState: 1 };
const jRoom3 = rm.joinRoom(ws3, 'TEST');
assert(!jRoom3.error, 'Join should succeed');
assert.deepStrictEqual(jRoom3.collectedItems.sort(), ['item_can_01', 'item_medkit_01'].sort());

// Disconnect cleanup
rm.handleDisconnect(ws1);
rm.handleDisconnect(ws3);
assert(!rm.getRoom('TEST'), 'Empty room should be deleted');

console.log('--- ALL UNIT TESTS PASSED SUCCESSFULLY! ---');
