// Saber Killer Room & Player Session Manager
import { MAX_PLAYERS_PER_ROOM, isValidNumber } from './protocol.js';
import { InventoryController } from '../js/multiplayer/inventory_controller.js';
import { isPickupItem, getItemDefinition, ITEM_EFFECTS_CONFIG } from '../js/multiplayer/item_catalog.js';

// Configurable Survival Mode Health, Damage & Revival Parameters
export const SURVIVAL_CONFIG = {
  maxHp: 100,
  startingHp: 100,
  revivedHp: 50,
  maxRevivalsPerRun: 1,
  maxReviveDistance: 2.8,
  damageValues: {
    ZOMBIE_HIT: 25,
    HAZARD: 20,
    DEV_TEST: 25,
    DEFAULT: 25
  }
};

export function configureSurvivalRules(opts = {}) {
  if (typeof opts.maxHp === 'number') SURVIVAL_CONFIG.maxHp = Math.max(1, opts.maxHp);
  if (typeof opts.startingHp === 'number') SURVIVAL_CONFIG.startingHp = Math.max(1, opts.startingHp);
  if (typeof opts.revivedHp === 'number') SURVIVAL_CONFIG.revivedHp = Math.max(1, opts.revivedHp);
  if (typeof opts.maxRevivalsPerRun === 'number') SURVIVAL_CONFIG.maxRevivalsPerRun = Math.max(0, opts.maxRevivalsPerRun);
  if (typeof opts.maxReviveDistance === 'number') SURVIVAL_CONFIG.maxReviveDistance = Math.max(0, opts.maxReviveDistance);
  if (opts.damageValues && typeof opts.damageValues === 'object') {
    SURVIVAL_CONFIG.damageValues = { ...SURVIVAL_CONFIG.damageValues, ...opts.damageValues };
  }
  return { ...SURVIVAL_CONFIG };
}

// Configurable Vending Machine Parameters
export const VENDING_CONFIG = {
  defaultMaxStock: 5,
  cooldownMs: 1000,
  maxInteractionDistance: 2.8
};

export function configureVendingMachine(opts = {}) {
  if (typeof opts.defaultMaxStock === 'number') {
    VENDING_CONFIG.defaultMaxStock = Math.max(0, opts.defaultMaxStock);
  }
  if (typeof opts.cooldownMs === 'number') {
    VENDING_CONFIG.cooldownMs = Math.max(0, opts.cooldownMs);
  }
  if (typeof opts.maxInteractionDistance === 'number') {
    VENDING_CONFIG.maxInteractionDistance = Math.max(0, opts.maxInteractionDistance);
  }
  return { ...VENDING_CONFIG };
}

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

  createRoom(ws, customCode = null, layoutRevision = null, layoutData = null, options = {}) {
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
      hp: SURVIVAL_CONFIG.startingHp,
      maxHp: SURVIVAL_CONFIG.maxHp,
      state: 'ACTIVE', // 'ACTIVE', 'DOWNED', 'ELIMINATED'
      revivalsUsed: 0,
      isDead: false,
      isDowned: false,
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
      pickupRequests: new Map(),
      runState: 'IN_PROGRESS', // 'IN_PROGRESS', 'GAME_OVER'
      healthPacksFrozen: false,
      startingPlayerCount: 0,
      availableHealthPackCount: 0
    };

    // Initialize room world pickup state from frozen layout
    if (layoutData && Array.isArray(layoutData.placements)) {
      for (const p of layoutData.placements) {
        const isPickup = isPickupItem(p.type);
        const isVending = (p.type === 'vending_almond');
        const maxStock = isVending
          ? ((p.metadata && typeof p.metadata.maxStock === 'number') ? p.metadata.maxStock : VENDING_CONFIG.defaultMaxStock)
          : undefined;

        room.worldItems.set(p.id, {
          id: p.id,
          type: p.type,
          category: p.category || (layoutData.catalog?.[p.type]?.category) || 'prop',
          position: Array.isArray(p.position) ? [p.position[0], p.position[1], p.position[2]] : [0, 0, 0],
          rotation: Array.isArray(p.rotation) ? [p.rotation[0], p.rotation[1], p.rotation[2]] : [0, 0, 0],
          isPickup,
          available: isPickup,
          collectedBy: null,
          collectedAt: null,
          stock: maxStock,
          maxStock: maxStock
        });
      }
    }

    // Health Pack Economy: Total Health Packs available on map must equal starting player count at run start
    // Quantity frozen when run begins; late joiners must NOT increase supply.
    const startingCount = (options && typeof options.startingPlayers === 'number' && options.startingPlayers > 0)
      ? options.startingPlayers
      : 1;
    this._freezeRoomHealthPacks(room, startingCount);

    this.rooms.set(roomCode, room);
    this.clientToRoom.set(ws, { roomCode, playerId });

    // Collect any world items that are unavailable from the start (e.g. capped health packs)
    const collectedItems = [];
    for (const [id, item] of room.worldItems) {
      if (item.isPickup && !item.available) {
        collectedItems.push(id);
      }
    }

    return {
      roomCode,
      player,
      spawn,
      totalPlayers: 1,
      layoutRevision: room.layoutRevision,
      collectedItems,
      spawnedItems: [],
      inventory: player.inventory.serialize()
    };
  }

  _freezeRoomHealthPacks(room, startingPlayerCount = 1) {
    if (room.healthPacksFrozen) return room.availableHealthPackCount;
    room.healthPacksFrozen = true;
    room.startingPlayerCount = Math.max(1, Math.floor(startingPlayerCount));

    const firstAidItems = [];
    for (const [id, item] of room.worldItems) {
      if (item.type === 'first_aid') {
        firstAidItems.push(item);
      }
    }

    const allowed = room.startingPlayerCount;
    let active = 0;
    for (let i = 0; i < firstAidItems.length; i++) {
      const item = firstAidItems[i];
      if (i < allowed) {
        item.available = true;
        item.cappedUnavailable = false;
        active++;
      } else {
        item.available = false;
        item.cappedUnavailable = true;
        item.collectedReason = 'SUPPLY_CAPPED';
      }
    }
    room.availableHealthPackCount = active;
    return active;
  }

  freezeHealthPackSupply(roomCode, startingCount = 1) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    return this._freezeRoomHealthPacks(room, startingCount);
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
      hp: SURVIVAL_CONFIG.startingHp,
      maxHp: SURVIVAL_CONFIG.maxHp,
      state: 'ACTIVE',
      revivalsUsed: 0,
      isDead: false,
      isDowned: false,
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
        spawn: p.spawn,
        hp: p.hp,
        maxHp: p.maxHp,
        state: p.state,
        revivalsUsed: p.revivalsUsed
      });
    }

    // Collect already picked up items and dynamically spawned items in this room
    // Note: Health pack supply was frozen when run began; capped items remain unavailable.
    const collectedItems = [];
    const spawnedItems = [];
    for (const [id, item] of room.worldItems) {
      if (item.isPickup && !item.available) {
        collectedItems.push(id);
      } else if ((item.isDropped || item.isDispensed) && item.available) {
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

    if (player.state === 'DOWNED' || player.state === 'ELIMINATED') {
      return { error: `Player is ${player.state.toLowerCase()} and cannot interact`, room, player };
    }

    if (!itemId || typeof itemId !== 'string') {
      return { error: 'Invalid or missing item ID', room, player };
    }

    const item = room.worldItems.get(itemId);
    if (!item) {
      return { error: `Item '${itemId}' does not exist in room layout`, room, player };
    }

    if (item.type === 'vending_almond') {
      return this.handleVendingDispense(ws, itemId, clientPosition);
    }

    if (!item.isPickup) {
      return { error: `Object '${itemId}' (${item.type}) is not a collectible pickup`, room, player };
    }

    if (!item.available) {
      if (item.cappedUnavailable) {
        return { error: `Item '${itemId}' is unavailable (Health Pack supply capped by starting player count)`, room, player };
      }
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

    if (player.state === 'DOWNED' || player.state === 'ELIMINATED') {
      return { error: `Player is ${player.state.toLowerCase()} and cannot use items`, room, player };
    }

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

    const remainingItem = player.inventory.getItem(targetSlot);
    const remainingQuantity = remainingItem ? remainingItem.quantity : 0;

    return {
      success: true,
      room,
      player,
      itemType: item.typeId,
      itemName: item.name,
      slotIndex: targetSlot,
      effect: effectConfig,
      remainingQuantity,
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

    if (player.state === 'DOWNED' || player.state === 'ELIMINATED') {
      return { error: `Player is ${player.state.toLowerCase()} and cannot drop items`, room, player };
    }

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

  /**
   * Authoritative Almond Water vending machine dispense validation and spawning
   */
  handleVendingDispense(ws, machineId, clientPosition = null) {
    const meta = this.clientToRoom.get(ws);
    if (!meta) return { error: 'Client not associated with any active room session' };

    const room = this.rooms.get(meta.roomCode);
    if (!room) return { error: `Room ${meta.roomCode} does not exist` };

    const player = room.players.get(meta.playerId);
    if (!player) return { error: `Player ${meta.playerId} not found in room` };

    if (player.state === 'DOWNED' || player.state === 'ELIMINATED') {
      return { error: `Player is ${player.state.toLowerCase()} and cannot interact`, room, player };
    }

    const machine = room.worldItems.get(machineId);
    if (!machine) {
      return { error: `Vending machine '${machineId}' not found in room layout`, room, player };
    }

    if (machine.type !== 'vending_almond') {
      return { error: `Object '${machineId}' (${machine.type}) is not a vending machine`, room, player };
    }

    // Ensure stock is initialized if missing
    if (machine.stock === undefined) {
      machine.stock = VENDING_CONFIG.defaultMaxStock;
      machine.maxStock = VENDING_CONFIG.defaultMaxStock;
    }

    // 1. Authoritative stock check: Reject if out of stock
    if (machine.stock <= 0) {
      return {
        error: 'Vending machine is out of stock',
        room,
        player,
        machineId,
        remainingStock: 0,
        maxStock: machine.maxStock
      };
    }

    // 2. Cooldown check on vending machine (debounced per VENDING_CONFIG)
    const now = Date.now();
    if (machine.lastDispenseTime && (now - machine.lastDispenseTime < VENDING_CONFIG.cooldownMs)) {
      return {
        error: 'Vending machine is dispensing, please wait...',
        room,
        player,
        machineId,
        remainingStock: machine.stock,
        maxStock: machine.maxStock
      };
    }

    // 3. Proximity check (with network latency tolerance)
    let pPos = player.position || player.spawn;
    if (clientPosition && isValidNumber(clientPosition.x) && isValidNumber(clientPosition.z)) {
      const sDx = clientPosition.x - pPos.x;
      const sDz = clientPosition.z - pPos.z;
      if (Math.hypot(sDx, sDz) < 2.5) {
        pPos = {
          x: clientPosition.x,
          y: (typeof clientPosition.y === 'number') ? clientPosition.y : pPos.y,
          z: clientPosition.z
        };
      }
    }

    const mPos = machine.position || [41.5, 0.0, -185.45];
    const dx = pPos.x - mPos[0];
    const dy = (pPos.y || 0) - mPos[1];
    const dz = pPos.z - mPos[2];
    const eyeDy = ((pPos.y || 0) + 1.62) - mPos[1];
    const dist = Math.min(Math.hypot(dx, dy, dz), Math.hypot(dx, eyeDy, dz));

    if (dist > VENDING_CONFIG.maxInteractionDistance) {
      return {
        error: `Player too far from vending machine (${dist.toFixed(2)}m > 2.1m limit)`,
        room,
        player,
        machineId,
        remainingStock: machine.stock,
        maxStock: machine.maxStock
      };
    }

    // All validations passed! Authorize dispense and consume exactly ONE use
    machine.lastDispenseTime = now;
    machine.stock = Math.max(0, machine.stock - 1);

    // Calculate dispense position: in front of machine
    // Machine is facing southward in Level 0 (Z decreasing towards -186)
    // Offset ~0.65m in front of machine
    const rotY = (machine.rotation && machine.rotation[1]) ? machine.rotation[1] : 0;
    const dispenseX = +(mPos[0] - Math.sin(rotY) * 0.65).toFixed(3);
    const dispenseZ = +(mPos[2] - Math.cos(rotY) * 0.65).toFixed(3);
    const dispenseY = 0.02;

    const dispenseId = `dispensed_almond_${now}_${Math.floor(Math.random() * 1000)}`;
    const worldItem = {
      id: dispenseId,
      type: 'almond_can',
      category: 'consumable',
      position: [dispenseX, dispenseY, dispenseZ],
      rotation: [0, +(Math.random() * 3.14).toFixed(3), 0],
      isPickup: true,
      available: true,
      isDropped: false,
      isDispensed: true,
      dispensedFrom: machineId,
      quantity: 1,
      collectedBy: null,
      collectedAt: null
    };

    room.worldItems.set(dispenseId, worldItem);

    return {
      success: true,
      room,
      player,
      machineId,
      dispensedItem: worldItem,
      remainingStock: machine.stock,
      maxStock: machine.maxStock
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

  handleSwapSlots(ws, fromSlot, toSlot) {
    const session = this.getPlayer(ws);
    if (!session) return { error: 'Client not associated with any active room session' };

    const { room, player } = session;
    if (!player) return { error: 'Player not found in room' };

    if (typeof fromSlot !== 'number' || typeof toSlot !== 'number') {
      return { error: 'Invalid slot indices' };
    }

    const success = player.inventory.swapSlots(fromSlot, toSlot);
    return {
      success,
      room,
      player,
      fromSlot,
      toSlot,
      inventory: player.inventory.serialize()
    };
  }

  /**
   * Authoritative Survival Mode Damage Processing
   * Enforces:
   * - Configurable damage values
   * - Minimum health clamped at 0
   * - Solo mode: 0 HP triggers immediate game over, no revival
   * - Co-op mode: First 0 HP death enters DOWNED state
   * - Co-op mode: Second 0 HP death causes PERMANENT ELIMINATION
   * - Team wipe check: If all players are downed or eliminated, triggers GAME_OVER
   */
  applyDamage(wsOrPlayerId, amount = null, reason = 'DEFAULT') {
    let session = null;
    if (typeof wsOrPlayerId === 'object' && wsOrPlayerId !== null) {
      session = this.getPlayer(wsOrPlayerId);
    } else if (typeof wsOrPlayerId === 'string') {
      for (const room of this.rooms.values()) {
        if (room.players.has(wsOrPlayerId)) {
          session = { room, player: room.players.get(wsOrPlayerId) };
          break;
        }
      }
    }

    if (!session) return { error: 'Player or room session not found' };
    const { room, player } = session;

    if (room.runState === 'GAME_OVER') {
      return { error: 'Game is already over', room, player };
    }

    if (player.state === 'ELIMINATED') {
      return { error: 'Player is already eliminated', room, player };
    }

    if (player.state === 'DOWNED') {
      return { error: 'Player is already downed', room, player };
    }

    // Resolve damage amount (configurable)
    let dmg = (typeof amount === 'number' && !isNaN(amount) && amount > 0)
      ? amount
      : (SURVIVAL_CONFIG.damageValues[reason] || SURVIVAL_CONFIG.damageValues.DEFAULT);

    // Prevent health from dropping below zero
    player.hp = Math.max(0, player.hp - dmg);

    const result = {
      room,
      player,
      damageApplied: dmg,
      currentHp: player.hp,
      maxHp: player.maxHp,
      reason,
      events: []
    };

    // Immediate authoritative health update
    result.events.push({
      type: 'PLAYER_HEALTH_UPDATE',
      payload: {
        playerId: player.id,
        hp: player.hp,
        maxHp: player.maxHp,
        reason
      }
    });

    if (player.hp === 0) {
      // Check solo vs co-op
      const isSolo = (room.players.size <= 1);

      if (isSolo) {
        // Solo player health reaches zero: trigger game over, no revival
        player.state = 'ELIMINATED';
        player.isDead = true;
        player.isDowned = false;
        room.runState = 'GAME_OVER';

        result.events.push({
          type: 'PLAYER_ELIMINATED',
          payload: {
            playerId: player.id,
            reason: 'SOLO_DEATH',
            revivalsUsed: player.revivalsUsed
          }
        });
        result.events.push({
          type: 'GAME_OVER',
          payload: {
            reason: 'SOLO_DEATH',
            message: 'Run failed: Solo player perished.'
          }
        });
      } else {
        // Co-op mode
        if (player.revivalsUsed >= SURVIVAL_CONFIG.maxRevivalsPerRun) {
          // Exactly one revival per player per run. Reaching 0 health again -> permanent elimination.
          player.state = 'ELIMINATED';
          player.isDead = true;
          player.isDowned = false;

          result.events.push({
            type: 'PLAYER_ELIMINATED',
            payload: {
              playerId: player.id,
              reason: 'PERMANENT_ELIMINATION',
              revivalsUsed: player.revivalsUsed
            }
          });

          // Check if all players in room are now downed or eliminated
          const anyActive = [...room.players.values()].some(p => p.state === 'ACTIVE');
          if (!anyActive) {
            room.runState = 'GAME_OVER';
            result.events.push({
              type: 'GAME_OVER',
              payload: {
                reason: 'TEAM_WIPED',
                message: 'Run failed: All players are eliminated or downed.'
              }
            });
          }
        } else {
          // First time reaching 0 health: enter DOWNED state
          player.state = 'DOWNED';
          player.isDowned = true;
          player.isDead = false;

          result.events.push({
            type: 'PLAYER_DOWNED',
            payload: {
              playerId: player.id,
              revivalsRemaining: SURVIVAL_CONFIG.maxRevivalsPerRun - player.revivalsUsed
            }
          });

          // Check if all players in room are now downed or eliminated
          const anyActive = [...room.players.values()].some(p => p.state === 'ACTIVE');
          if (!anyActive) {
            room.runState = 'GAME_OVER';
            result.events.push({
              type: 'GAME_OVER',
              payload: {
                reason: 'TEAM_WIPED',
                message: 'Run failed: All players are downed.'
              }
            });
          }
        }
      }
    }

    return result;
  }

  /**
   * Authoritative Teammate Revival Processing
   * Enforces:
   * - Reviver must be ACTIVE and alive
   * - Target must be DOWNED
   * - Target must not exceed 1 revival per run
   * - Reviver must be within 2.8m proximity
   * - Reviver must possess at least 1 Health Pack (first_aid)
   * - Consumes exactly 1 Health Pack on success; 0 on failure
   * - Restores target to ACTIVE state and 50 HP
   */
  handleReviveRequest(ws, targetPlayerId, clientPosition = null) {
    const session = this.getPlayer(ws);
    if (!session) return { error: 'Client not associated with any active room session' };

    const { room, player: reviver } = session;
    if (room.runState === 'GAME_OVER') {
      return { error: 'Game is already over', room, reviver };
    }

    if (reviver.state !== 'ACTIVE' || reviver.hp <= 0) {
      return { error: 'Reviver must be active and conscious', room, reviver };
    }

    if (!targetPlayerId || typeof targetPlayerId !== 'string') {
      return { error: 'Missing target player ID', room, reviver };
    }

    const target = room.players.get(targetPlayerId);
    if (!target) {
      return { error: `Target player '${targetPlayerId}' not found in room`, room, reviver };
    }

    if (target.id === reviver.id) {
      return { error: 'Cannot revive yourself', room, reviver };
    }

    if (target.state === 'ACTIVE') {
      return { error: `Player '${target.id}' is already active and not downed`, room, reviver, target };
    }

    if (target.state === 'ELIMINATED') {
      return { error: `Player '${target.id}' is permanently eliminated and cannot be revived`, room, reviver, target };
    }

    if (target.state !== 'DOWNED') {
      return { error: `Player '${target.id}' is not in a downed state`, room, reviver, target };
    }

    if (target.revivalsUsed >= SURVIVAL_CONFIG.maxRevivalsPerRun) {
      return { error: `Player '${target.id}' has already reached the maximum revival limit (1)`, room, reviver, target };
    }

    // Distance check between reviver and target (with client position verification)
    let rPos = reviver.position || reviver.spawn;
    if (clientPosition && isValidNumber(clientPosition.x) && isValidNumber(clientPosition.z)) {
      const sDx = clientPosition.x - rPos.x;
      const sDz = clientPosition.z - rPos.z;
      if (Math.hypot(sDx, sDz) < 2.5) {
        rPos = {
          x: clientPosition.x,
          y: (typeof clientPosition.y === 'number') ? clientPosition.y : rPos.y,
          z: clientPosition.z
        };
        reviver.position = rPos;
      }
    }
    const tPos = target.position || target.spawn;
    const dx = rPos.x - tPos.x;
    const dy = (rPos.y || 0) - (tPos.y || 0);
    const dz = rPos.z - tPos.z;
    const dist = Math.hypot(dx, dy, dz);

    if (dist > SURVIVAL_CONFIG.maxReviveDistance) {
      return {
        error: `Reviver too far from downed teammate (${dist.toFixed(2)}m > ${SURVIVAL_CONFIG.maxReviveDistance}m limit)`,
        room,
        reviver,
        target
      };
    }

    // Health pack check in reviver's authoritative inventory
    const slots = reviver.inventory.getSlots();
    const firstAidSlotIdx = slots.findIndex(s => s && s.typeId === 'first_aid');
    if (firstAidSlotIdx === -1) {
      return {
        error: 'Reviver does not possess a Health Pack (first_aid) in inventory',
        room,
        reviver,
        target
      };
    }

    // Authoritative consumption: Remove exactly 1 Health Pack from reviver's inventory
    const removeRes = reviver.inventory.removeItem(firstAidSlotIdx, 1);
    if (!removeRes.success) {
      return {
        error: 'Failed to consume Health Pack from reviver inventory',
        room,
        reviver,
        target
      };
    }

    // Update target state to ACTIVE and restore HP
    target.state = 'ACTIVE';
    target.isDowned = false;
    target.isDead = false;
    target.hp = SURVIVAL_CONFIG.revivedHp;
    target.revivalsUsed += 1;

    return {
      success: true,
      room,
      reviver,
      target,
      reviverInventory: reviver.inventory.serialize(),
      events: [
        {
          type: 'PLAYER_REVIVED',
          payload: {
            targetId: target.id,
            reviverId: reviver.id,
            hp: target.hp,
            revivalsUsed: target.revivalsUsed
          }
        },
        {
          type: 'PLAYER_HEALTH_UPDATE',
          payload: {
            playerId: target.id,
            hp: target.hp,
            maxHp: target.maxHp,
            reason: 'REVIVED'
          }
        }
      ]
    };
  }
}
