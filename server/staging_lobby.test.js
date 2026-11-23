import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './room_manager.js';

const mockLayout = {
  placements: [
    { id: 'floor_first_aid_01', type: 'first_aid', position: [48.69, 0, -187.65] },
    { id: 'floor_first_aid_02', type: 'first_aid', position: [49.50, 0, -187.65] },
    { id: 'floor_first_aid_03', type: 'first_aid', position: [50.50, 0, -187.65] },
    { id: 'almond_01', type: 'almond_can', position: [48.69, 0, -187.0] }
  ]
};

test('1. Room creation places leader in LOBBY state', () => {
  const manager = new RoomManager();
  const ws1 = { send: () => {} };
  const res = manager.createRoom(ws1, 'LOBBY_ROOM', 'default', mockLayout);

  assert.equal(res.runState, 'LOBBY');
  assert.equal(res.leaderId, res.player.id);
  assert.equal(res.player.isReady, true);
  assert.equal(res.totalPlayers, 1);

  const state = manager.getLobbyState('LOBBY_ROOM');
  assert.equal(state.runState, 'LOBBY');
  assert.equal(state.leaderId, res.player.id);
  assert.equal(state.players.length, 1);
  assert.equal(state.players[0].isLeader, true);
});

test('2. Joining player enters LOBBY unready', () => {
  const manager = new RoomManager();
  const ws1 = { send: () => {} };
  const ws2 = { send: () => {} };

  const r1 = manager.createRoom(ws1, 'COOP_LOBBY', 'default', mockLayout);
  const r2 = manager.joinRoom(ws2, 'COOP_LOBBY');

  assert.equal(r2.runState, 'LOBBY');
  assert.equal(r2.leaderId, r1.player.id);
  assert.equal(r2.player.isReady, false);
  assert.equal(r2.totalPlayers, 2);

  const state = manager.getLobbyState('COOP_LOBBY');
  assert.equal(state.players.length, 2);
  const p1 = state.players.find(p => p.id === r1.player.id);
  const p2 = state.players.find(p => p.id === r2.player.id);

  assert.equal(p1.isLeader, true);
  assert.equal(p1.isReady, true);
  assert.equal(p2.isLeader, false);
  assert.equal(p2.isReady, false);
});

test('3. Leader cannot start match while players are unready', () => {
  const manager = new RoomManager();
  const ws1 = { send: () => {} };
  const ws2 = { send: () => {} };

  manager.createRoom(ws1, 'WAIT_LOBBY', 'default', mockLayout);
  manager.joinRoom(ws2, 'WAIT_LOBBY');

  // Leader attempts to start while p2 is unready
  const startRes = manager.startMatch(ws1);
  assert.equal(startRes.error, 'Waiting for all players to ready up.');
  assert.equal(startRes.unreadyCount, 1);

  const room = manager.getRoom('WAIT_LOBBY');
  assert.equal(room.runState, 'LOBBY'); // Did not start!
});

test('4. Non-leader cannot start match', () => {
  const manager = new RoomManager();
  const ws1 = { send: () => {} };
  const ws2 = { send: () => {} };

  manager.createRoom(ws1, 'PERM_LOBBY', 'default', mockLayout);
  manager.joinRoom(ws2, 'PERM_LOBBY');

  // p2 marks ready
  manager.setPlayerReady(ws2, true);

  // p2 attempts to start match
  const nonLeaderStart = manager.startMatch(ws2);
  assert.equal(nonLeaderStart.error, 'Only the room leader can start the match.');
});

test('5. Ready state toggles and synchronizes', () => {
  const manager = new RoomManager();
  const ws1 = { send: () => {} };
  const ws2 = { send: () => {} };

  manager.createRoom(ws1, 'TOGGLE_LOBBY', 'default', mockLayout);
  const r2 = manager.joinRoom(ws2, 'TOGGLE_LOBBY');

  // Toggle ready to true
  const t1 = manager.setPlayerReady(ws2);
  assert.equal(t1.isReady, true);
  assert.equal(manager.getPlayer(ws2).player.isReady, true);

  // Toggle ready to false
  const t2 = manager.setPlayerReady(ws2);
  assert.equal(t2.isReady, false);
  assert.equal(manager.getPlayer(ws2).player.isReady, false);

  // Set explicit ready boolean
  const t3 = manager.setPlayerReady(ws2, true);
  assert.equal(t3.isReady, true);
  assert.equal(manager.getPlayer(ws2).player.isReady, true);
});

test('6. Leader can start match when everyone is ready, freezing Health Pack supply', () => {
  const manager = new RoomManager();
  const ws1 = { send: () => {} };
  const ws2 = { send: () => {} };

  manager.createRoom(ws1, 'START_LOBBY', 'default', mockLayout);
  manager.joinRoom(ws2, 'START_LOBBY');

  // p2 readies up
  manager.setPlayerReady(ws2, true);

  // Leader starts match
  const startRes = manager.startMatch(ws1);
  assert.equal(startRes.success, true);
  assert.equal(startRes.startingPlayers, 2);

  const room = manager.getRoom('START_LOBBY');
  assert.equal(room.runState, 'IN_PROGRESS');

  // In mockLayout there are 3 first_aid items. With 2 starting players, exactly 2 must be available!
  assert.equal(room.availableHealthPackCount, 2);
  assert.equal(room.healthPacksFrozen, true);

  const aid1 = room.worldItems.get('floor_first_aid_01');
  const aid2 = room.worldItems.get('floor_first_aid_02');
  const aid3 = room.worldItems.get('floor_first_aid_03');

  assert.equal(aid1.available, true);
  assert.equal(aid2.available, true);
  assert.equal(aid3.available, false);
  assert.equal(aid3.cappedUnavailable, true);
});

test('7. Disconnecting a player updates lobby state and leadership', () => {
  const manager = new RoomManager();
  const ws1 = { send: () => {} };
  const ws2 = { send: () => {} };

  const r1 = manager.createRoom(ws1, 'DISC_LOBBY', 'default', mockLayout);
  const r2 = manager.joinRoom(ws2, 'DISC_LOBBY');

  // Leader disconnects
  const discRes = manager.handleDisconnect(ws1);
  assert.equal(discRes.roomDeleted, false);
  assert.equal(discRes.remainingPlayers, 1);
  assert.equal(discRes.leaderChanged, true);

  const state = manager.getLobbyState('DISC_LOBBY');
  assert.equal(state.players.length, 1);
  assert.equal(state.leaderId, r2.player.id); // Leadership transferred to p2!
  assert.equal(state.players[0].isLeader, true);
  assert.equal(state.players[0].isReady, true); // New leader is ready!
});
