// Saber Killer Room & Player Session Manager
import { MAX_PLAYERS_PER_ROOM, isValidNumber } from './protocol.js';
import { InventoryController } from '../js/multiplayer/inventory_controller.js';
import { isPickupItem, getItemDefinition, ITEM_EFFECTS_CONFIG } from '../js/multiplayer/item_catalog.js';

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
      inventory: new InventoryController(30),
      lastUpdate: 0,
      seq: 0
    };
    player.inventory.initDefaultLoadout();

    const room = {
      code: roomCode,
      createdAt: Date.now(),
      layoutRevision: (typeof layoutRevision === 'string' && layoutRevision.trim()) ? layoutRevision.trim() : 'default',
      players: new Map([[playerId, player]]),
      worldItems: new Map(),
      pickupRequests: new Map()
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
      collectedItems: [],
      spawnedItems: [],
      inventory: player.inventory.serialize()
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
      inventory: new InventoryController(30),
      lastUpdate: 0,
      seq: 0
    };
    player.inventory.initDefaultLoadout();

    // Collect existing players to return to newly joined client
    const existingPlayers = [];
    for (const [id, p] of room.players) {
      existingPlayers.push({
        id: p.id,
        slot: p.slot,
        spawn: p.spawn
      });
    }

    // Collect already picked up items and dynamically spawned items in this room
    const collectedItems = [];
    const spawnedItems = [];
    for (const [id, item] of room.worldItems) {
      if (item.isPickup && !item.available) {
        collectedItems.push(id);
      } else if (item.isDropped && item.available) {
        spawnedItems.push(item);
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
      collectedItems,
      spawnedItems,
      inventory: player.inventory.serialize()
    };
  }

  /**
   * Authoritative pickup validation and atomic claiming
   */
  handlePickupRequest(ws, itemId, clientPosition = null) {
    const meta = this.clientToRoom.get(ws);
    if (!meta) return { error: 'Client not associated with any active room session' };

    const room = this.rooms.get(meta.roomCode);
    if (!room) return { error: `Room ${meta.roomCode} does not exist` };

    const player = room.players.get(meta.playerId);
    if (!player) return { error: `Player ${meta.playerId} not found in room` };

    if (!itemId || typeof itemId !== 'string') {
      return { error: 'Invalid or missing item ID', room, player };
    }

    const item = room.worldItems.get(itemId);
    if (!item) {
      return { error: `Item '${itemId}' does not exist in room layout`, room, player };
    }

    if (!item.isPickup) {
      return { error: `Object '${itemId}' (${item.type}) is not a collectible pickup`, room, player };
    }

    if (!item.available) {
      return { error: `Item '${itemId}' has already been collected by player ${item.collectedBy}`, room, player };
    }

    // Server-side proximity check
    let pPos = player.position || player.spawn;
    if (clientPosition && isValidNumber(clientPosition.x) && isValidNumber(clientPosition.z)) {
      const sDx = clientPosition.x - pPos.x;
      const sDz = clientPosition.z - pPos.z;
      const discrepancy = Math.sqrt(sDx * sDx + sDz * sDz);
      if (discrepancy < 2.5) {
        // Safe to use client position for interaction verification
        pPos = {
          x: clientPosition.x,
          y: (typeof clientPosition.y === 'number') ? clientPosition.y : pPos.y,
          z: clientPosition.z
        };
      }
    }

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
      return { error: `Player too far from item (${dist.toFixed(2)}m > 2.1m limit)`, room, player };
    }

    // Add item to player's authoritative inventory
    const addResult = player.inventory.addItem(item.type, 1);
    if (!addResult.success) {
      return { error: addResult.reason || 'Player inventory is full', room, player };
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

  /**
   * Authoritative item consumption validation and processing
   */
  handleUseItem(ws, slotIndex, instanceId = null) {
    const meta = this.clientToRoom.get(ws);
    if (!meta) return { error: 'Client not associated with any active room session' };

    const room = this.rooms.get(meta.roomCode);
    if (!room) return { error: `Room ${meta.roomCode} does not exist` };

    const player = room.players.get(meta.playerId);
    if (!player) return { error: `Player ${meta.playerId} not found in room` };

    let item = null;
    let targetSlot = slotIndex;
    if (typeof targetSlot === 'number' && targetSlot >= 0 && targetSlot < player.inventory.capacity) {
      item = player.inventory.getItem(targetSlot);
    } else if (instanceId) {
      const slots = player.inventory.getSlots();
      const idx = slots.findIndex(s => s && s.instanceId === instanceId);
      if (idx !== -1) {
        targetSlot = idx;
        item = slots[idx];
      }
    }

    if (!item) {
      return { error: 'Item not found in player inventory', room, player };
    }

    const def = getItemDefinition(item.typeId);
    if (!def || !def.consumable) {
      return { error: `Item '${item.name}' cannot be consumed`, room, player };
    }

    const effectConfig = ITEM_EFFECTS_CONFIG[item.typeId] || def.metadata || {};

    // Remove exactly 1 unit from inventory
    const removeRes = player.inventory.removeItem(targetSlot, 1);
    if (!removeRes.success) {
      return { error: 'Failed to consume item from slot', room, player };
    }

    return {
      success: true,
      room,
      player,
      itemType: item.typeId,
      itemName: item.name,
      slotIndex: targetSlot,
      effect: effectConfig,
      remainingQuantity: removeRes.item?.quantity || 0,
      inventory: player.inventory.serialize()
    };
  }

  /**
   * Authoritative physical item dropping and room spawning
   */
  handleDropItem(ws, slotIndex, instanceId = null, requestedQty = 1, clientPos = null, clientYaw = 0) {
    const meta = this.clientToRoom.get(ws);
    if (!meta) return { error: 'Client not associated with any active room session' };

    const room = this.rooms.get(meta.roomCode);
    if (!room) return { error: `Room ${meta.roomCode} does not exist` };

    const player = room.players.get(meta.playerId);
    if (!player) return { error: `Player ${meta.playerId} not found in room` };

    let item = null;
    let targetSlot = slotIndex;
    if (typeof targetSlot === 'number' && targetSlot >= 0 && targetSlot < player.inventory.capacity) {
      item = player.inventory.getItem(targetSlot);
    } else if (instanceId) {
      const slots = player.inventory.getSlots();
      const idx = slots.findIndex(s => s && s.instanceId === instanceId);
      if (idx !== -1) {
        targetSlot = idx;
        item = slots[idx];
      }
    }

    if (!item) {
      return { error: 'Item not found in inventory', room, player };
    }

    const def = getItemDefinition(item.typeId);
    if (!def || def.droppable === false) {
      return { error: `Item '${item.name}' cannot be dropped`, room, player };
    }

    // Clamp requested drop quantity: minimum 1, max available in stack
    const dropQty = Math.max(1, Math.min(item.quantity, Math.floor(requestedQty || 1)));

    // Remove accepted quantity from inventory
    const removeRes = player.inventory.removeItem(targetSlot, dropQty);
    if (!removeRes.success) {
      return { error: 'Failed to remove dropped item from inventory', room, player };
    }

    // Calculate safe world drop position in front of player
    let pPos = player.position || player.spawn;
    if (clientPos && isValidNumber(clientPos.x) && isValidNumber(clientPos.z)) {
      const sDx = clientPos.x - pPos.x;
      const sDz = clientPos.z - pPos.z;
      if (Math.hypot(sDx, sDz) < 2.5) {
        pPos = { x: clientPos.x, y: (typeof clientPos.y === 'number') ? clientPos.y : pPos.y, z: clientPos.z };
      }
    }
    const yaw = isValidNumber(clientYaw) ? clientYaw : 0;
    // Drop ~0.9m in front of player along eye heading
    const dropX = +(pPos.x - Math.sin(yaw) * 0.9).toFixed(3);
    const dropZ = +(pPos.z - Math.cos(yaw) * 0.9).toFixed(3);
    const dropY = 0.02; // Rest on floor

    const dropId = `drop_${item.typeId}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const worldItem = {
      id: dropId,
      type: item.typeId,
      category: def.category,
      position: [dropX, dropY, dropZ],
      rotation: [0, yaw, 0],
      isPickup: true,
      available: true,
      isDropped: true,
      droppedBy: player.id,
      quantity: dropQty,
      collectedBy: null,
      collectedAt: null
    };

    room.worldItems.set(dropId, worldItem);

    return {
      success: true,
      room,
      player,
      droppedItem: worldItem,
      droppedQuantity: dropQty,
      slotIndex: targetSlot,
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
