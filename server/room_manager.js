// Saber Killer Room & Player Session Manager
import { MAX_PLAYERS_PER_ROOM } from './protocol.js';
import { InventoryController } from '../js/multiplayer/inventory_controller.js';
import { isPickupItem } from '../js/multiplayer/item_catalog.js';

// Predefined verified Level 0 spawn slots (safe from walls, 2.8m apart)
const SPAWN_SLOTS = [
  { x: 48.69, y: 0.0, z: -187.65, yaw: 0.0, pitch: 0.0 },
  { x: 51.50, y: 0.0, z: -187.65, yaw: 0.0, pitch: 0.0 }
];

export class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> Room
    this.clientToRoom = new Map(); // ws -> { roomCode, playerId }
    this.nextPlayerId = 1;
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let attempts = 0; attempts < 1000; attempts++) {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      if (!this.rooms.has(code)) return code;
    }
    return 'ROOM' + Math.floor(Math.random() * 1000);
  }

  createRoom(ws, customCode = null, layoutRevision = null, layoutData = null) {
    const roomCode = (customCode && typeof customCode === 'string' && customCode.trim().length > 0)
      ? customCode.trim().toUpperCase()
      : this.generateRoomCode();

    if (this.rooms.has(roomCode)) {
      return { error: `Room ${roomCode} already exists.` };
    }

    const playerId = 'p_' + (this.nextPlayerId++);
    const spawn = SPAWN_SLOTS[0];

    const player = {
      id: playerId,
      ws,
      slot: 0,
      spawn,
      position: { ...spawn },
      inventory: new InventoryController(12),
      lastUpdate: 0,
      seq: 0
    };

    const room = {
      code: roomCode,
      createdAt: Date.now(),
      layoutRevision: (typeof layoutRevision === 'string' && layoutRevision.trim()) ? layoutRevision.trim() : 'default',
      players: new Map([[playerId, player]]),
      worldItems: new Map()
    };

    // Initialize room world pickup state from frozen layout
    if (layoutData && Array.isArray(layoutData.placements)) {
      for (const p of layoutData.placements) {
        const isPickup = isPickupItem(p.type);
        room.worldItems.set(p.id, {
          id: p.id,
          type: p.type,
          category: p.category || (layoutData.catalog?.[p.type]?.category) || 'prop',
          position: Array.isArray(p.position) ? [p.position[0], p.position[1], p.position[2]] : [0, 0, 0],
          isPickup,
          available: isPickup,
          collectedBy: null,
          collectedAt: null
        });
      }
    }

    this.rooms.set(roomCode, room);
    this.clientToRoom.set(ws, { roomCode, playerId });

    return {
      roomCode,
      player,
      spawn,
      totalPlayers: 1,
      layoutRevision: room.layoutRevision,
      collectedItems: []
    };
  }

  joinRoom(ws, roomCode) {
    const code = (roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(code);

    if (!room) {
      return { error: `Room ${code} not found.` };
    }

    if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
      return { error: `Room ${code} is full (max ${MAX_PLAYERS_PER_ROOM} players).` };
    }

    const playerId = 'p_' + (this.nextPlayerId++);
    // Find unoccupied slot
    const occupiedSlots = new Set([...room.players.values()].map(p => p.slot));
    const slot = [0, 1].find(s => !occupiedSlots.has(s)) ?? 1;
    const spawn = SPAWN_SLOTS[slot] || SPAWN_SLOTS[0];

    const player = {
      id: playerId,
      ws,
      slot,
      spawn,
      position: { ...spawn },
      inventory: new InventoryController(12),
      lastUpdate: 0,
      seq: 0
    };

    // Collect existing players to return to newly joined client
    const existingPlayers = [];
    for (const [id, p] of room.players) {
      existingPlayers.push({
        id: p.id,
        slot: p.slot,
        spawn: p.spawn
      });
    }

    // Collect already picked up items in this room
    const collectedItems = [];
    for (const [id, item] of room.worldItems) {
      if (item.isPickup && !item.available) {
        collectedItems.push(id);
      }
    }

    room.players.set(playerId, player);
    this.clientToRoom.set(ws, { roomCode: code, playerId });

    return {
      roomCode: code,
      player,
      spawn,
      existingPlayers,
      totalPlayers: room.players.size,
      layoutRevision: room.layoutRevision || 'default',
      collectedItems
    };
  }

  /**
   * Authoritative pickup validation and atomic claiming
   */
  handlePickupRequest(ws, itemId) {
    const meta = this.clientToRoom.get(ws);
    if (!meta) return { error: 'Client not associated with any active room session' };

    const room = this.rooms.get(meta.roomCode);
    if (!room) return { error: `Room ${meta.roomCode} does not exist` };

    const player = room.players.get(meta.playerId);
    if (!player) return { error: `Player ${meta.playerId} not found in room` };

    if (!itemId || typeof itemId !== 'string') {
      return { error: 'Invalid or missing item ID' };
    }

    const item = room.worldItems.get(itemId);
    if (!item) {
      return { error: `Item '${itemId}' does not exist in room layout` };
    }

    if (!item.isPickup) {
      return { error: `Object '${itemId}' (${item.type}) is not a collectible pickup` };
    }

    if (!item.available) {
      return { error: `Item '${itemId}' has already been collected by player ${item.collectedBy}` };
    }

    // Server-side proximity check
    const pPos = player.position || player.spawn;
    const iPos = item.position;
    console.log(`[HANDLE PICKUP] player ${player.id} pPos:`, pPos, 'itemPos:', iPos);
    const dx = pPos.x - iPos[0];
    const dy = (pPos.y || 0) - iPos[1];
    const dz = pPos.z - iPos[2];

    // Distance from camera eye (approx y + 1.62) vs distance from feet
    const eyeDy = ((pPos.y || 0) + 1.62) - iPos[1];
    const eyeDist = Math.sqrt(dx * dx + eyeDy * eyeDy + dz * dz);
    const feetDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dist = Math.min(eyeDist, feetDist);

    // Initial interaction distance is 2.1m. With network tolerance: 2.6m
    const MAX_PICKUP_DIST = 2.6;
    if (dist > MAX_PICKUP_DIST) {
      return { error: `Player too far from item (${dist.toFixed(2)}m > 2.1m limit)` };
    }

    // Add item to player's authoritative inventory
    const addResult = player.inventory.addItem(item.type, 1);
    if (!addResult.success) {
      return { error: addResult.reason || 'Player inventory is full' };
    }

    // Atomically claim item
    item.available = false;
    item.collectedBy = player.id;
    item.collectedAt = Date.now();

    return {
      success: true,
      room,
      player,
      item,
      inventory: player.inventory.serialize()
    };
  }

  handleDisconnect(ws) {
    const meta = this.clientToRoom.get(ws);
    if (!meta) return null;

    const { roomCode, playerId } = meta;
    this.clientToRoom.delete(ws);

    const room = this.rooms.get(roomCode);
    if (!room) return null;

    room.players.delete(playerId);

    if (room.players.size === 0) {
      this.rooms.delete(roomCode);
      return { roomCode, playerId, roomDeleted: true, remainingPlayers: 0 };
    }

    return { roomCode, playerId, roomDeleted: false, remainingPlayers: room.players.size, room };
  }

  getRoom(roomCode) {
    return this.rooms.get(roomCode);
  }

  getPlayer(ws) {
    const meta = this.clientToRoom.get(ws);
    if (!meta) return null;
    const room = this.rooms.get(meta.roomCode);
    if (!room) return null;
    return { room, player: room.players.get(meta.playerId) };
  }
}
