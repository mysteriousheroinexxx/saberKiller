// Saber Killer Room & Player Session Manager
import { MAX_PLAYERS_PER_ROOM, isValidNumber } from './protocol.js';
import { InventoryController } from '../js/multiplayer/inventory_controller.js';
import { isPickupItem, getItemDefinition, ITEM_EFFECTS_CONFIG } from '../js/multiplayer/item_catalog.js';
import { RoomSimulation } from './ai/room_simulation.js';

// Configurable Survival Mode Health, Damage & Revival Parameters
export const SURVIVAL_CONFIG = {
  maxHp: 100,
  startingHp: 100,
  revivedHp: 50,
  maxRevivalsPerRun: 1,
  maxReviveDistance: 2.8,
  keysPerStartingPlayer: 1,
  damageValues: {
    ZOMBIE_HIT: 25,
    SABER_ATTACK: 25,
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
  if (typeof opts.keysPerStartingPlayer === 'number') SURVIVAL_CONFIG.keysPerStartingPlayer = Math.max(1, Math.floor(opts.keysPerStartingPlayer));
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

// Fixed Ammunition Economy Configuration (Level 0 Room Budget)
export const AMMO_CONFIG = {
  pistol: {
    maxTotal: 48,
    magCapacity: 12,
    roundsPerBox: 2,
    boxType: 'pistol_ammo',
    ammoKey: 'bullets',
    requiredBoxes: 18 // 18 boxes * 2 rounds = 36 rounds (+ 12 loaded in weapon = 48)
  },
  shotgun: {
    maxTotal: 12,
    magCapacity: 6,
    roundsPerBox: 2,
    boxType: 'shotgun_ammo',
    ammoKey: 'shells',
    requiredBoxes: 3 // 3 boxes * 2 rounds = 6 rounds (+ 6 loaded in weapon = 12)
  },
  totalBudget: 60
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
      name: (options && options.playerName) ? options.playerName : 'Player 1',
      isReady: true,
      spawn,
      position: { ...spawn },
      inventory: new InventoryController(30),
      hp: SURVIVAL_CONFIG.startingHp,
      maxHp: SURVIVAL_CONFIG.maxHp,
      state: 'ACTIVE', // 'ACTIVE', 'DOWNED', 'ELIMINATED'
      revivalsUsed: 0,
      isDead: false,
      isDowned: false,
      bullets: 0,
      shells: 0,
      mag: { bullets: 0, shells: 0 },
      discoveredWeapons: new Set(),
      lastUpdate: 0,
      seq: 0
    };
    player.inventory.initDefaultLoadout();

    const room = {
      code: roomCode,
      createdAt: Date.now(),
      leaderId: playerId,
      layoutRevision: (typeof layoutRevision === 'string' && layoutRevision.trim()) ? layoutRevision.trim() : 'default',
      players: new Map([[playerId, player]]),
      worldItems: new Map(),
      doors: new Map(),
      pickupRequests: new Map(),
      useRequests: new Map(),
      runState: (options && (options.directStart || typeof options.startingPlayers === 'number')) ? 'IN_PROGRESS' : 'LOBBY', // 'LOBBY', 'IN_PROGRESS', 'GAME_OVER'
      healthPacksFrozen: false,
      startingPlayerCount: 0,
      availableHealthPackCount: 0,
      simulation: null
    };

    // Initialize room exit door
    const defaultDoorPos = [79.55, 0.0, 207.0];
    room.doors.set('level0_exit_door', {
      id: 'level0_exit_door',
      type: 'exit_door',
      name: 'Level 0 Exit Door',
      locked: true,
      requiredKey: 'doorKey',
      position: defaultDoorPos,
      unlockedBy: null,
      unlockedAt: null
    });

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
    // If startingPlayers is explicitly provided (e.g. survival test setup), freeze immediately;
    // Otherwise, freeze authoritatively at actual match start when leader starts the run.
    if (options && typeof options.startingPlayers === 'number' && options.startingPlayers > 0) {
      this._freezeRoomHealthPacks(room, options.startingPlayers);
    }

    // Fixed Ammunition Economy: Initialize and enforce Level 0 room budget
    this._initializeRoomAmmo(room);

    // Level 0 Key & Exit Door: Configure physical keys based on starting player count
    const startingCount = (options && typeof options.startingPlayers === 'number' && options.startingPlayers > 0)
      ? options.startingPlayers
      : (options?.directStart ? room.players.size : 1);
    this._configureRoomKeys(room, startingCount);

    this.rooms.set(roomCode, room);
    this.clientToRoom.set(ws, { roomCode, playerId });

    if (room.runState === 'IN_PROGRESS') {
      this._initializeRoomSimulation(room);
    }

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
      leaderId: room.leaderId,
      runState: room.runState,
      spawn,
      totalPlayers: 1,
      layoutRevision: room.layoutRevision,
      collectedItems,
      spawnedItems: [],
      doors: this.serializeDoors(room),
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

  /**
   * Fixed Ammunition Economy: Initializes room world items to guarantee exactly
   * 48 pistol bullets (12 in weapon magazine + 18 boxes * 2 rounds) and
   * 12 shotgun shells (6 in weapon magazine + 3 boxes * 2 rounds).
   * Total budget: 60 ammunition units.
   */
  _initializeRoomAmmo(room) {
    // 1. Ensure weapon pickups exist in room
    if (![...room.worldItems.values()].some(i => i.type === 'weapon_pistol')) {
      room.worldItems.set('floor_weapon_pistol_01', {
        id: 'floor_weapon_pistol_01',
        type: 'weapon_pistol',
        category: 'weapon',
        position: [44.2, 0.0, -187.5],
        rotation: [0, 0, 0],
        isPickup: true,
        available: true,
        collectedBy: null,
        collectedAt: null
      });
    }
    if (![...room.worldItems.values()].some(i => i.type === 'weapon_shotgun')) {
      room.worldItems.set('floor_weapon_shotgun_01', {
        id: 'floor_weapon_shotgun_01',
        type: 'weapon_shotgun',
        category: 'weapon',
        position: [40.5, 0.0, -179.8],
        rotation: [0, 0, 0],
        isPickup: true,
        available: true,
        collectedBy: null,
        collectedAt: null
      });
    }

    // Convert any legacy ammo_box items to pistol_ammo
    for (const [_, item] of room.worldItems) {
      if (item.type === 'ammo_box') {
        item.type = 'pistol_ammo';
      }
    }

    // 2. Default Level 0 positions for pistol_ammo boxes (18 total needed)
    const defaultPistolPositions = [
      [43.3, 0.0, -188.70], [44.35, 0.936, -185.45], [45.1, 0.0, -186.2], [42.1, 0.0, -185.8],
      [46.5, 0.0, -184.2], [47.8, 0.0, -187.0], [41.2, 0.0, -188.0], [43.9, 0.0, -183.5],
      [45.8, 0.0, -188.5], [48.2, 0.0, -185.0], [40.8, 0.0, -186.5], [42.9, 0.0, -184.0],
      [46.2, 0.0, -186.8], [47.1, 0.0, -183.0], [41.9, 0.0, -187.2], [44.8, 0.0, -189.0],
      [48.9, 0.0, -186.0], [43.6, 0.0, -185.1]
    ];

    // Default Level 0 positions for shotgun_ammo boxes (3 total needed)
    const defaultShotgunPositions = [
      [44.3, 0.715, -189.50], [41.0, 0.0, -180.5], [39.8, 0.0, -178.9]
    ];

    let pCount = [...room.worldItems.values()].filter(i => i.type === 'pistol_ammo').length;
    let pIdx = pCount + 1;
    while (pCount < AMMO_CONFIG.pistol.requiredBoxes) {
      const pos = defaultPistolPositions[pCount] || [45.0 + pCount * 0.3, 0.0, -186.0];
      const id = `floor_pistol_ammo_${String(pIdx++).padStart(2, '0')}`;
      room.worldItems.set(id, {
        id,
        type: 'pistol_ammo',
        category: 'ammunition',
        position: pos,
        rotation: [0, 0, 0],
        isPickup: true,
        available: true,
        collectedBy: null,
        collectedAt: null
      });
      pCount++;
    }

    let sCount = [...room.worldItems.values()].filter(i => i.type === 'shotgun_ammo').length;
    let sIdx = sCount + 1;
    while (sCount < AMMO_CONFIG.shotgun.requiredBoxes) {
      const pos = defaultShotgunPositions[sCount] || [41.0 + sCount * 0.5, 0.0, -180.0];
      const id = `floor_shotgun_ammo_${String(sIdx++).padStart(2, '0')}`;
      room.worldItems.set(id, {
        id,
        type: 'shotgun_ammo',
        category: 'ammunition',
        position: pos,
        rotation: [0, 0, 0],
        isPickup: true,
        available: true,
        collectedBy: null,
        collectedAt: null
      });
      sCount++;
    }
  }

  /**
   * Room-wide authoritative ammunition accounting
   * Counts all ammunition across:
   * 1. Loaded weapon magazines (held by players or in unclaimed world weapons)
   * 2. Player reserve ammunition (bullets & shells across all players)
   * 3. Unclaimed ammunition boxes in the world (at exactly 2 rounds per box)
   */
  getRoomAmmoAccounting(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    let pistolLoaded = 0;
    let shotgunLoaded = 0;
    let pistolReserve = 0;
    let shotgunReserve = 0;

    let anyPlayerDiscoveredPistol = false;
    let anyPlayerDiscoveredShotgun = false;

    for (const [_, p] of room.players) {
      pistolReserve += (p.bullets || 0);
      shotgunReserve += (p.shells || 0);
      pistolLoaded += (p.mag?.bullets || 0);
      shotgunLoaded += (p.mag?.shells || 0);
      if (p.discoveredWeapons?.has('weapon_pistol') || p.inventory?.hasItem('weapon_pistol')) {
        anyPlayerDiscoveredPistol = true;
      }
      if (p.discoveredWeapons?.has('weapon_shotgun') || p.inventory?.hasItem('weapon_shotgun')) {
        anyPlayerDiscoveredShotgun = true;
      }
    }

    // If weapon is still in the world (unclaimed), count its loaded magazine rounds
    for (const [_, item] of room.worldItems) {
      if (item.available) {
        if (item.type === 'weapon_pistol' && !anyPlayerDiscoveredPistol) {
          pistolLoaded += AMMO_CONFIG.pistol.magCapacity;
        } else if (item.type === 'weapon_shotgun' && !anyPlayerDiscoveredShotgun) {
          shotgunLoaded += AMMO_CONFIG.shotgun.magCapacity;
        }
      }
    }

    let worldPistolBoxes = 0;
    let worldShotgunBoxes = 0;

    for (const [_, item] of room.worldItems) {
      if (item.available) {
        if (item.type === 'pistol_ammo' || item.type === 'ammo_box') {
          worldPistolBoxes += (item.quantity || 1);
        } else if (item.type === 'shotgun_ammo') {
          worldShotgunBoxes += (item.quantity || 1);
        }
      }
    }

    let inventoryPistolBoxes = 0;
    let inventoryShotgunBoxes = 0;

    for (const [_, p] of room.players) {
      if (p.inventory) {
        inventoryPistolBoxes += (p.inventory.getCount('pistol_ammo') + p.inventory.getCount('ammo_box'));
        inventoryShotgunBoxes += p.inventory.getCount('shotgun_ammo');
      }
    }

    const totalUnusedPistolBoxes = worldPistolBoxes + inventoryPistolBoxes;
    const totalUnusedShotgunBoxes = worldShotgunBoxes + inventoryShotgunBoxes;

    const unclaimedPistolRounds = worldPistolBoxes * AMMO_CONFIG.pistol.roundsPerBox;
    const unclaimedShotgunRounds = worldShotgunBoxes * AMMO_CONFIG.shotgun.roundsPerBox;
    const unusedPistolRounds = totalUnusedPistolBoxes * AMMO_CONFIG.pistol.roundsPerBox;
    const unusedShotgunRounds = totalUnusedShotgunBoxes * AMMO_CONFIG.shotgun.roundsPerBox;

    const totalPistol = pistolLoaded + pistolReserve + unusedPistolRounds;
    const totalShotgun = shotgunLoaded + shotgunReserve + unusedShotgunRounds;

    return {
      pistol: {
        loaded: pistolLoaded,
        reserve: pistolReserve,
        worldBoxes: worldPistolBoxes,
        inventoryBoxes: inventoryPistolBoxes,
        unclaimedBoxes: worldPistolBoxes,
        unusedBoxes: totalUnusedPistolBoxes,
        unclaimedRounds: unclaimedPistolRounds,
        unusedRounds: unusedPistolRounds,
        total: totalPistol,
        max: AMMO_CONFIG.pistol.maxTotal
      },
      shotgun: {
        loaded: shotgunLoaded,
        reserve: shotgunReserve,
        worldBoxes: worldShotgunBoxes,
        inventoryBoxes: inventoryShotgunBoxes,
        unclaimedBoxes: worldShotgunBoxes,
        unusedBoxes: totalUnusedShotgunBoxes,
        unclaimedRounds: unclaimedShotgunRounds,
        unusedRounds: unusedShotgunRounds,
        total: totalShotgun,
        max: AMMO_CONFIG.shotgun.maxTotal
      },
      totalBudget: AMMO_CONFIG.totalBudget,
      totalUnits: totalPistol + totalShotgun
    };
  }

  joinRoom(ws, roomCode, options = {}) {
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
      name: (options && options.playerName) ? options.playerName : ('Player ' + (slot + 1)),
      isReady: false,
      spawn,
      position: { ...spawn },
      inventory: new InventoryController(30),
      hp: SURVIVAL_CONFIG.startingHp,
      maxHp: SURVIVAL_CONFIG.maxHp,
      state: 'ACTIVE',
      revivalsUsed: 0,
      isDead: false,
      isDowned: false,
      bullets: 0,
      shells: 0,
      mag: { bullets: 0, shells: 0 },
      discoveredWeapons: new Set(),
      lastUpdate: 0,
      seq: 0
    };
    player.inventory.initDefaultLoadout();

    // Collect existing players to return to newly joined client
    const existingPlayers = [];
    for (const [id, p] of room.players) {
      existingPlayers.push({
        id: p.id,
        name: p.name || `Player_${p.id}`,
        slot: p.slot,
        spawn: p.spawn,
        hp: p.hp,
        maxHp: p.maxHp,
        state: p.state,
        revivalsUsed: p.revivalsUsed,
        isLeader: (p.id === room.leaderId),
        isReady: (p.id === room.leaderId ? true : Boolean(p.isReady))
      });
    }

    // Collect already picked up items and dynamically spawned items in this room
    // Note: Health pack supply was frozen when run began; capped items remain unavailable.
    const collectedItems = [];
    const spawnedItems = [];
    for (const [id, item] of room.worldItems) {
      if (item.isPickup && !item.available) {
        collectedItems.push(id);
      } else if ((item.isDropped || item.isDispensed || item.isGenerated) && item.available) {
        spawnedItems.push(item);
      }
    }

    room.players.set(playerId, player);
    this.clientToRoom.set(ws, { roomCode: code, playerId });

    // Register player in active room simulation if already running
    room.simulation?.addPlayer(player);

    return {
      roomCode: code,
      player,
      leaderId: room.leaderId,
      runState: room.runState,
      spawn,
      existingPlayers,
      totalPlayers: room.players.size,
      layoutRevision: room.layoutRevision || 'default',
      collectedItems,
      spawnedItems,
      doors: this.serializeDoors(room),
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
        const itemLabel = (item.type === 'doorKey') ? 'Key' : ((item.type === 'first_aid') ? 'Health Pack' : 'Item');
        return { error: `Item '${itemId}' is unavailable (${itemLabel} supply capped by starting player count)`, room, player };
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

    // Weapon discovery logic: Discovered weapons start with loaded magazine, no reserve ammo
    if (item.type === 'weapon_pistol') {
      if (!player.discoveredWeapons.has('weapon_pistol')) {
        player.discoveredWeapons.add('weapon_pistol');
        player.mag.bullets = AMMO_CONFIG.pistol.magCapacity;
      }
    } else if (item.type === 'weapon_shotgun') {
      if (!player.discoveredWeapons.has('weapon_shotgun')) {
        player.discoveredWeapons.add('weapon_shotgun');
        player.mag.shells = AMMO_CONFIG.shotgun.magCapacity;
      }
    }

    // Ammunition box pickups: do NOT grant reserve ammunition on pickup.
    // Boxes are consumable inventory items that must be used from inventory to gain reserve rounds.
    let ammoUpdate = null;

    // Add item to player's authoritative inventory
    const addResult = player.inventory.addItem(item.type, item.quantity || 1);
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
      inventory: player.inventory.serialize(),
      ammoUpdate
    };
  }

  /**
   * Authoritative item consumption validation and processing
   */
  handleUseItem(ws, slotIndex, instanceId = null) {
    const meta = this.clientToRoom.get(ws);
    if (!meta) return { success: false, error: 'Client not associated with any active room session' };

    const room = this.rooms.get(meta.roomCode);
    if (!room) return { success: false, error: `Room ${meta.roomCode} does not exist` };

    const player = room.players.get(meta.playerId);
    if (!player) return { success: false, error: `Player ${meta.playerId} not found in room` };

    if (player.state === 'DOWNED' || player.state === 'ELIMINATED') {
      return { success: false, error: `Player is ${player.state.toLowerCase()} and cannot use items`, room, player };
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
      return { success: false, error: 'Item not found in player inventory', room, player };
    }

    const def = getItemDefinition(item.typeId);
    if (!def || !def.consumable) {
      return { success: false, error: `Item '${item.name}' cannot be consumed`, room, player };
    }

    const effectConfig = ITEM_EFFECTS_CONFIG[item.typeId] || def.metadata || {};

    // Remove exactly 1 unit from inventory
    const removeRes = player.inventory.removeItem(targetSlot, 1);
    if (!removeRes.success) {
      return { success: false, error: 'Failed to consume item from slot', room, player };
    }

    const remainingItem = player.inventory.getItem(targetSlot);
    const remainingQuantity = remainingItem ? remainingItem.quantity : 0;

    // Ammunition box consumption: atomically grants exactly 2 rounds to compatible weapon reserve
    let ammoUpdate = null;
    if (item.typeId === 'pistol_ammo' || item.typeId === 'ammo_box') {
      player.bullets = (player.bullets || 0) + AMMO_CONFIG.pistol.roundsPerBox;
      ammoUpdate = {
        type: item.typeId,
        ammoKey: 'bullets',
        rounds: AMMO_CONFIG.pistol.roundsPerBox,
        bullets: player.bullets,
        shells: player.shells
      };
    } else if (item.typeId === 'shotgun_ammo') {
      player.shells = (player.shells || 0) + AMMO_CONFIG.shotgun.roundsPerBox;
      ammoUpdate = {
        type: item.typeId,
        ammoKey: 'shells',
        rounds: AMMO_CONFIG.shotgun.roundsPerBox,
        bullets: player.bullets,
        shells: player.shells
      };
    }

    return {
      success: true,
      room,
      player,
      itemType: item.typeId,
      itemName: item.name,
      slotIndex: targetSlot,
      effect: effectConfig,
      ammoUpdate,
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
    room.simulation?.removePlayer(playerId);

    if (room.players.size === 0) {
      if (room.simulation) {
        room.simulation.destroy();
        room.simulation = null;
      }
      this.rooms.delete(roomCode);
      return { roomCode, playerId, roomDeleted: true, remainingPlayers: 0 };
    }

    // If disconnected player was room leader, elect first remaining player as new leader
    let leaderChanged = false;
    if (room.leaderId === playerId && room.players.size > 0) {
      room.leaderId = room.players.keys().next().value;
      const newLeader = room.players.get(room.leaderId);
      if (newLeader) newLeader.isReady = true;
      leaderChanged = true;
    }

    return {
      roomCode,
      playerId,
      roomDeleted: false,
      remainingPlayers: room.players.size,
      room,
      leaderChanged,
      lobbyState: this.getLobbyState(roomCode)
    };
  }

  getLobbyState(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    return {
      roomCode: room.code,
      leaderId: room.leaderId,
      runState: room.runState,
      totalPlayers: room.players.size,
      players: [...room.players.values()].map(p => ({
        id: p.id,
        name: p.name || `Player_${p.id}`,
        slot: p.slot,
        isLeader: (p.id === room.leaderId),
        isReady: (p.id === room.leaderId ? true : Boolean(p.isReady))
      }))
    };
  }

  setPlayerReady(ws, isReady = null) {
    const session = this.getPlayer(ws);
    if (!session) return { error: 'Client not associated with any active room session' };

    const { room, player } = session;
    if (room.runState !== 'LOBBY') {
      return { error: 'Room is not in lobby state', room, player };
    }

    if (player.id === room.leaderId) {
      player.isReady = true;
    } else if (typeof isReady === 'boolean') {
      player.isReady = isReady;
    } else {
      player.isReady = !player.isReady;
    }

    return {
      success: true,
      room,
      player,
      isReady: player.isReady,
      lobbyState: this.getLobbyState(room.code)
    };
  }

  /**
   * Authoritatively initializes a clean run state for a match.
   * Full reset of:
   * - Players: 100 HP, 100 Sanity, ACTIVE, 0 revivalsUsed, clean starting loadout
   * - World: world items re-derived from rawLayoutData, ammo economy reset, door locked
   * - AI: previous simulation destroyed, fresh 20Hz simulation instantiated, Sabers at home spawns
   * - matchGeneration incremented to invalidate stale callbacks
   */
  _initializeRunState(room) {
    room.matchGeneration = (room.matchGeneration || 0) + 1;
    const currentGen = room.matchGeneration;

    // 1. Destroy old simulation instance and stop its loop
    if (room.simulation) {
      room.simulation.destroy();
      room.simulation = null;
    }

    // 2. Clear all mutable world items and re-derive from rawLayoutData
    room.worldItems.clear();
    room.healthPacksFrozen = false;
    room.availableHealthPackCount = 0;

    const layoutData = room.rawLayoutData;
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

    // Re-initialize fixed ammunition economy
    this._initializeRoomAmmo(room);

    // Freeze Health Pack economy using starting player count at actual match start
    this._freezeRoomHealthPacks(room, room.players.size);

    // Reset exit door to locked
    const door = room.doors?.get('level0_exit_door');
    if (door) {
      door.locked = true;
      door.unlockedBy = null;
      door.unlockedAt = null;
    }

    // Configure keys authoritatively based on starting players
    const spawnedKeys = this._configureRoomKeys(room, room.players.size);

    // 3. Reset all players to clean run state
    for (const [id, player] of room.players) {
      player.hp = SURVIVAL_CONFIG.startingHp;
      player.maxHp = SURVIVAL_CONFIG.maxHp;
      player.sanity = 100;
      player.maxSanity = 100;
      player.state = 'ACTIVE';
      player.revivalsUsed = 0;
      player.downedAt = null;
      player.eliminatedAt = null;
      player.inventory = new InventoryController(30);
      player.equipment = {
        flashlight: true,
        primary: null,
        secondary: null
      };
      player.ammoReserves = {
        pistol: 0,
        shotgun: 0
      };
      player.weapons = [];
      player.isReady = (player.id === room.leaderId);
    }

    // 4. Instantiate fresh authoritative Saber AI simulation
    this._initializeRoomSimulation(room);

    return { currentGen, spawnedKeys };
  }

  startMatch(ws) {
    const session = this.getPlayer(ws);
    if (!session) return { error: 'Client not associated with any active room session' };

    const { room, player } = session;
    if (player.id !== room.leaderId) {
      return { error: 'Only the room leader can start the match.', room, player };
    }

    if (room.runState !== 'LOBBY' && room.runState !== 'GAME_OVER') {
      return { error: 'Match has already started.', room, player };
    }

    // Check that every connected non-leader player is ready (if starting from LOBBY)
    if (room.runState === 'LOBBY') {
      const unready = [...room.players.values()].filter(p => p.id !== room.leaderId && !p.isReady);
      if (unready.length > 0) {
        return {
          error: 'Waiting for all players to ready up.',
          room,
          player,
          unreadyCount: unready.length,
          unreadyPlayers: unready.map(p => p.id)
        };
      }
    }

    // All players ready or new run started! Transition to IN_PROGRESS
    room.runState = 'IN_PROGRESS';

    // Establish clean authoritative run state
    const { currentGen, spawnedKeys } = this._initializeRunState(room);

    const collectedItems = [];
    for (const [id, item] of room.worldItems) {
      if (item.isPickup && !item.available) {
        collectedItems.push(id);
      }
    }

    const spawnedItems = [...spawnedKeys];
    for (const [id, item] of room.worldItems) {
      if ((item.isDropped || item.isGenerated) && item.available) {
        if (!spawnedItems.some(si => si.id === item.id)) {
          spawnedItems.push(item);
        }
      }
    }

    // Build complete player list with their reset spawns, hp and statuses
    const players = [];
    for (const [id, p] of room.players) {
      players.push({
        id: p.id,
        name: p.name || `Player_${p.id}`,
        slot: p.slot,
        spawn: p.spawn,
        hp: p.hp,
        maxHp: p.maxHp,
        state: p.state,
        revivalsUsed: p.revivalsUsed,
        isLeader: (p.id === room.leaderId)
      });
    }

    return {
      success: true,
      room,
      matchGeneration: currentGen,
      startingPlayers: room.players.size,
      collectedItems,
      spawnedItems,
      doors: this.serializeDoors(room),
      players
    };
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
      // Authoritatively drop inventory and equipment upon reaching 0 HP
      const dropResult = this.dropPlayerInventoryOnDowned(room, player, player.position);
      if (dropResult.events && dropResult.events.length > 0) {
        result.events.push(...dropResult.events);
      }
      result.droppedItems = dropResult.droppedItems || [];

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

      // Synchronize player mortality state with AI simulation
      room.simulation?.setPlayerState(player.id, player.state, player.hp);
      if (room.runState === 'GAME_OVER') {
        room.simulation?.stop();
      }
    } else {
      room.simulation?.setPlayerState(player.id, player.state, player.hp);
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

    // Synchronize revival state with room simulation
    room.simulation?.setPlayerState(target.id, 'ACTIVE', target.hp);

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

  /**
   * Configures Level 0 physical Brass Door Keys scaling with starting player count.
   * Default rule: 1 key per starting player (SURVIVAL_CONFIG.keysPerStartingPlayer).
   *
   * Crucial Fix for Key Collection Rejection:
   * Extra layout keys are NOT deleted from room.worldItems (which causes
   * "Item does not exist in room layout"). Instead, surplus layout keys are marked
   * as available: false, cappedUnavailable: true, collectedReason: 'SUPPLY_CAPPED'.
   * This ensures they are included in collectedItems sent to clients, hiding them cleanly.
   *
   * Returns newly generated or activated key items so startMatch can include them in spawnedItems.
   */
  _configureRoomKeys(room, startingPlayerCount = 1) {
    const keysPerPlayer = SURVIVAL_CONFIG.keysPerStartingPlayer || 1;
    const requiredKeys = Math.max(1, Math.floor(startingPlayerCount || 1) * keysPerPlayer);
    room.requiredKeyCount = requiredKeys;
    room.startingPlayerCount = startingPlayerCount;

    // Candidate key spawn positions across Level 0 exploration locations
    const candidateLocations = [
      { id: 'shelf_door_key_tier3', position: [44.5, 1.188, -189.50], rotation: [0, -0.3, 0] },
      { id: 'table_door_key_01', position: [44.15, 0.936, -185.20], rotation: [0.0, 0.4, 0.0] },
      { id: 'floor_door_key_01', position: [45.0, 0.02, -189.50], rotation: [0.0, 0.1, 0.0] },
      { id: 'alcove_door_key_01', position: [40.5, 0.715, -179.80], rotation: [0.0, 0.0, 0.0] },
      { id: 'corridor_door_key_01', position: [48.0, 0.02, -186.00], rotation: [0.0, 0.5, 0.0] }
    ];

    const activeKeys = [];
    const newlyGeneratedKeys = [];

    // Ensure we have enough key definitions in room.worldItems
    for (const cand of candidateLocations) {
      if (activeKeys.length >= requiredKeys) break;
      let keyItem = room.worldItems.get(cand.id);
      if (!keyItem) {
        keyItem = {
          id: cand.id,
          type: 'doorKey',
          category: 'key',
          position: cand.position,
          rotation: cand.rotation,
          isPickup: true,
          available: true,
          isGenerated: true,
          collectedBy: null,
          collectedAt: null
        };
        room.worldItems.set(cand.id, keyItem);
        newlyGeneratedKeys.push(keyItem);
      } else {
        const wasInactive = !keyItem.available;
        keyItem.available = true;
        keyItem.isPickup = true;
        keyItem.collectedBy = null;
        keyItem.collectedAt = null;
        delete keyItem.cappedUnavailable;
        delete keyItem.collectedReason;
        if (wasInactive) {
          newlyGeneratedKeys.push(keyItem);
        }
      }
      activeKeys.push(keyItem);
    }

    // If there are still not enough (e.g. 6+ players), dynamically generate additional keys
    while (activeKeys.length < requiredKeys) {
      const idx = activeKeys.length + 1;
      const genId = `gen_door_key_${idx}`;
      const angle = (idx / requiredKeys) * 2 * Math.PI;
      const genPos = [+(44.5 + Math.cos(angle) * 1.5).toFixed(3), 0.02, +(-187.0 + Math.sin(angle) * 1.5).toFixed(3)];
      const keyItem = {
        id: genId,
        type: 'doorKey',
        category: 'key',
        position: genPos,
        rotation: [0, 0, 0],
        isPickup: true,
        available: true,
        isGenerated: true,
        collectedBy: null,
        collectedAt: null
      };
      room.worldItems.set(genId, keyItem);
      activeKeys.push(keyItem);
      newlyGeneratedKeys.push(keyItem);
    }

    // CRITICAL: Any existing keys in room.worldItems that are NOT active
    // MUST NOT be deleted (which causes "Item does not exist in room layout").
    // Instead mark them as supply-capped / unavailable so they are reported in collectedItems and hidden.
    for (const [id, item] of room.worldItems) {
      if (item.type === 'doorKey' && !activeKeys.some(ak => ak.id === item.id)) {
        item.available = false;
        item.isPickup = true;
        item.cappedUnavailable = true;
        item.collectedReason = 'SUPPLY_CAPPED';
      }
    }

    return newlyGeneratedKeys;
  }

  /**
   * Authoritative Death / Downed Item Drop Handler:
   * When a player reaches 0 health and enters DOWNED (or death/eliminated),
   * their entire inventory and equipment are converted to physical world pickups
   * at their current world position, registered in room.worldItems, and broadcast.
   *
   * Includes:
   * - Keys (doorKey)
   * - Weapons (weapon_pistol, weapon_shotgun)
   * - Ammunition (boxes in inventory + reserve rounds converted to boxes)
   * - Health Packs (first_aid)
   * - Consumables (almond_can)
   * - All other carried equipment (equipment_torch)
   *
   * Player's inventory, discovered weapons, loaded magazines, and reserve ammo
   * are authoritatively cleared so items cannot be duplicated. Revived players return empty.
   */
  dropPlayerInventoryOnDowned(room, player, clientPos = null) {
    if (!room || !player) return { droppedItems: [], events: [] };

    // Resolve world position
    let pPos = player.position || player.spawn;
    if (clientPos && isValidNumber(clientPos.x) && isValidNumber(clientPos.z)) {
      pPos = {
        x: clientPos.x,
        y: (typeof clientPos.y === 'number') ? clientPos.y : (pPos?.y ?? 0.02),
        z: clientPos.z
      };
    }
    const baseY = (typeof pPos?.y === 'number' && pPos.y > 0.05) ? pPos.y : 0.02;

    const itemsToDrop = [];

    // 1. All carried items in player inventory
    if (player.inventory) {
      const slots = player.inventory.getSlots();
      for (const slot of slots) {
        if (slot && slot.typeId && slot.quantity > 0) {
          itemsToDrop.push({
            type: slot.typeId,
            quantity: slot.quantity,
            metadata: slot.metadata || {}
          });
        }
      }
    }

    // 2. Discovered weapons not already accounted for in inventory slots
    if (player.discoveredWeapons) {
      for (const wType of player.discoveredWeapons) {
        if (!itemsToDrop.some(it => it.type === wType)) {
          itemsToDrop.push({ type: wType, quantity: 1, metadata: {} });
        }
      }
    }

    // 3. Reserve ammunition converted back to physical boxes (each box = 2 rounds)
    if (player.bullets && player.bullets >= 2) {
      const pBoxes = Math.floor(player.bullets / 2);
      if (pBoxes > 0) {
        itemsToDrop.push({ type: 'pistol_ammo', quantity: pBoxes, metadata: {} });
      }
    }
    if (player.shells && player.shells >= 2) {
      const sBoxes = Math.floor(player.shells / 2);
      if (sBoxes > 0) {
        itemsToDrop.push({ type: 'shotgun_ammo', quantity: sBoxes, metadata: {} });
      }
    }

    // Authoritative clearance of player's inventory and equipment
    if (player.inventory) {
      player.inventory.clear();
    }
    if (player.discoveredWeapons) {
      player.discoveredWeapons.clear();
    }
    player.bullets = 0;
    player.shells = 0;
    player.mag = { bullets: 0, shells: 0 };

    const droppedItems = [];
    const events = [];
    const count = itemsToDrop.length;

    for (let i = 0; i < count; i++) {
      const it = itemsToDrop[i];
      const angle = (count > 1) ? (i / count) * 2 * Math.PI : 0;
      const radius = (count > 1) ? 0.45 : 0;
      const dropX = +( (pPos?.x || 0) + Math.cos(angle) * radius ).toFixed(3);
      const dropZ = +( (pPos?.z || 0) + Math.sin(angle) * radius ).toFixed(3);
      const dropY = baseY;

      const dropId = `drop_${it.type}_${Date.now()}_${i}_${Math.floor(Math.random() * 10000)}`;
      const def = getItemDefinition(it.type);
      const worldItem = {
        id: dropId,
        type: it.type,
        category: def?.category || 'general',
        position: [dropX, dropY, dropZ],
        rotation: [0, +(Math.random() * 6.28).toFixed(2), 0],
        isPickup: true,
        available: true,
        isDropped: true,
        droppedBy: player.id,
        quantity: it.quantity,
        collectedBy: null,
        collectedAt: null
      };

      room.worldItems.set(dropId, worldItem);
      droppedItems.push(worldItem);

      events.push({
        type: 'ITEM_SPAWNED',
        payload: {
          item: worldItem,
          droppedBy: player.id,
          reason: 'PLAYER_DOWNED'
        }
      });
    }

    // Authoritative inventory update event for this player
    events.push({
      type: 'INVENTORY_UPDATE',
      payload: {
        playerId: player.id,
        inventory: player.inventory ? player.inventory.serialize() : { capacity: 30, slots: [] },
        reason: 'PLAYER_DOWNED'
      }
    });

    return {
      droppedItems,
      events
    };
  }

  /**
   * Serializes active doors for network transmission
   */
  serializeDoors(room) {
    if (!room || !room.doors) return [];
    const requiredKeyCount = room.requiredKeyCount || room.startingPlayerCount || 1;
    return [...room.doors.values()].map(d => ({
      id: d.id,
      type: d.type || 'exit_door',
      name: d.name || 'Level 0 Exit Door',
      locked: d.locked,
      requiredKey: d.requiredKey || 'doorKey',
      requiredKeys: requiredKeyCount,
      position: d.position,
      unlockedBy: d.unlockedBy,
      unlockedAt: d.unlockedAt
    }));
  }

  /**
   * Authoritative Door Unlock Handler:
   * - Validates player state (DOWNED or ELIMINATED rejected)
   * - Validates proximity to door (<= 3.5m)
   * - Validates player inventory has ALL required keys for this run carried by this SINGLE player
   * - Sets door.locked = false authoritatively
   * - Returns state for room-wide broadcast
   */
  handleDoorUnlock(ws, doorId = 'level0_exit_door', clientPos = null, requestId = null) {
    const meta = this.clientToRoom.get(ws);
    if (!meta) return { success: false, error: 'Client not associated with any active room session' };

    const room = this.rooms.get(meta.roomCode);
    if (!room) return { success: false, error: `Room ${meta.roomCode} does not exist` };

    const player = room.players.get(meta.playerId);
    if (!player) return { success: false, error: `Player ${meta.playerId} not found in room` };

    if (player.state === 'DOWNED' || player.state === 'ELIMINATED') {
      return { success: false, error: `Player is ${player.state.toLowerCase()} and cannot unlock doors`, room, player };
    }

    const door = room.doors.get(doorId || 'level0_exit_door');
    if (!door) {
      return { success: false, error: `Door '${doorId}' not found in room`, room, player };
    }

    // If door is already unlocked, return success immediately
    if (!door.locked) {
      return {
        success: true,
        alreadyUnlocked: true,
        doorId: door.id,
        locked: false,
        unlockedBy: door.unlockedBy,
        unlockedAt: door.unlockedAt,
        room,
        player
      };
    }

    // Distance validation: tolerance up to 3.5m
    const dPos = door.position || [79.55, 0.0, 207.0];
    const pPos = (clientPos && isValidNumber(clientPos.x) && isValidNumber(clientPos.z))
      ? clientPos
      : (player.position || SPAWN_SLOTS[0]);
    const dx = pPos.x - dPos[0];
    const dy = (typeof pPos.y === 'number' ? pPos.y : 0) - dPos[1];
    const dz = pPos.z - dPos[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const MAX_DOOR_DIST = 3.5;

    if (dist > MAX_DOOR_DIST) {
      return { success: false, error: `Player too far from door (${dist.toFixed(2)}m > ${MAX_DOOR_DIST}m)`, room, player };
    }

    // Key requirement validation: single player must carry ALL required keys for this run
    const requiredKey = door.requiredKey || 'doorKey';
    const requiredCount = room.requiredKeyCount || room.startingPlayerCount || 1;
    const playerKeyCount = player.inventory.getCount(requiredKey);
    if (playerKeyCount < requiredCount) {
      return {
        success: false,
        error: `Door is locked. Requires all ${requiredCount} Brass Door Keys to be carried by you (you have ${playerKeyCount}).`,
        reason: 'MISSING_KEY',
        requiredKeys: requiredCount,
        carriedKeys: playerKeyCount,
        room,
        player
      };
    }

    // Authoritatively unlock door permanently for the room
    door.locked = false;
    door.unlockedBy = player.id;
    door.unlockedAt = Date.now();

    return {
      success: true,
      doorId: door.id,
      locked: false,
      requiredKeys: requiredCount,
      unlockedBy: door.unlockedBy,
      unlockedAt: door.unlockedAt,
      room,
      player
    };
  }

  /**
   * Authoritative Level Escape / Run Completion Handler:
   * - Validates player state and proximity to unlocked exit doorway
   * - Sets room.runState = 'GAME_OVER' with status: 'ESCAPED'
   * - Returns victory payload for room-wide broadcast
   */
  handleEscape(ws, doorId = 'level0_exit_door', clientPos = null) {
    const meta = this.clientToRoom.get(ws);
    if (!meta) return { success: false, error: 'Client not associated with any active room session' };

    const room = this.rooms.get(meta.roomCode);
    if (!room) return { success: false, error: `Room ${meta.roomCode} does not exist` };

    const player = room.players.get(meta.playerId);
    if (!player) return { success: false, error: `Player ${meta.playerId} not found in room` };

    if (player.state === 'DOWNED' || player.state === 'ELIMINATED') {
      return { success: false, error: `Player is ${player.state.toLowerCase()} and cannot escape`, room, player };
    }

    const door = room.doors.get(doorId || 'level0_exit_door');
    if (!door) {
      return { success: false, error: `Door '${doorId}' not found in room`, room, player };
    }

    if (door.locked) {
      return { success: false, error: 'Door is locked. Cannot escape.', room, player };
    }

    const dPos = door.position || [79.55, 0.0, 207.0];
    const pPos = (clientPos && isValidNumber(clientPos.x) && isValidNumber(clientPos.z))
      ? clientPos
      : (player.position || SPAWN_SLOTS[0]);
    const dx = pPos.x - dPos[0];
    const dy = (typeof pPos.y === 'number' ? pPos.y : 0) - dPos[1];
    const dz = pPos.z - dPos[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const MAX_ESCAPE_DIST = 3.8;

    if (dist > MAX_ESCAPE_DIST) {
      return { success: false, error: `Player too far from exit doorway (${dist.toFixed(2)}m > ${MAX_ESCAPE_DIST}m)`, room, player };
    }

    // Authoritative Run Completion
    room.runState = 'GAME_OVER';
    room.simulation?.stop();

    return {
      success: true,
      status: 'ESCAPED',
      reason: 'LEVEL_COMPLETED',
      title: 'LEVEL ESCAPED!',
      message: `${player.name || 'Survivor'} unlocked the exit door and escaped the Backrooms!`,
      escapedBy: player.id,
      escapedByName: player.name || 'Survivor',
      room,
      player
    };
  }

  /**
   * Initializes authoritative Saber AI simulation for a room
   */
  _initializeRoomSimulation(room) {
    if (room.simulation) return room.simulation;

    room.simulation = new RoomSimulation(room, {
      onPlayerDamaged: (playerId, damage, reason) => {
        const res = this.applyDamage(playerId, damage, reason);
        if (res && res.events && this.onRoomEvents) {
          this.onRoomEvents(room, res.events);
        }
      },
      broadcastMessage: (type, payload) => {
        if (this.onBroadcast) {
          this.onBroadcast(room, type, payload);
        }
      },
      sendDevMessage: (type, payload) => {
        if (this.onDevBroadcast) {
          this.onDevBroadcast(room, type, payload);
        }
      }
    });

    if (room.players) {
      for (const [pId, p] of room.players) {
        room.simulation.addPlayer(pId, p.spawn);
      }
    }
    room.simulation.start();

    return room.simulation;
  }

  /**
   * Handles player weapon hit against Saber
   */
  handleAttackMonster(ws, monsterId = 'saber_alpha', damage = 50, weaponType = 'PISTOL') {
    const session = this.getPlayer(ws);
    if (!session) return { error: 'Client not associated with any active room session' };
    const { room, player } = session;
    if (!room.simulation) return { error: 'Room simulation not active' };
    return room.simulation.handleAttackMonster(player.id, monsterId, damage, weaponType);
  }
}
