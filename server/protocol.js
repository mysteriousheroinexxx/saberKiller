// Saber Killer Multiplayer Protocol
// Shared packet definitions and validation utilities

export const MSG_TYPES = {
  CREATE_ROOM: 'CREATE_ROOM',
  JOIN_ROOM: 'JOIN_ROOM',
  ROOM_JOINED: 'ROOM_JOINED',
  PLAYER_JOINED: 'PLAYER_JOINED',
  PLAYER_LEFT: 'PLAYER_LEFT',
  PLAYER_UPDATE: 'PLAYER_UPDATE',
  SERVER_ERROR: 'SERVER_ERROR',
  HEARTBEAT: 'HEARTBEAT',
  // Interaction & Inventory packet types
  ITEM_PICKUP_REQUEST: 'ITEM_PICKUP_REQUEST',
  ITEM_PICKUP_RESPONSE: 'ITEM_PICKUP_RESPONSE',
  ITEM_COLLECTED: 'ITEM_COLLECTED',
  INVENTORY_UPDATE: 'INVENTORY_UPDATE',
  PICKUP_REJECTED: 'PICKUP_REJECTED',
  ROOM_ITEMS_STATE: 'ROOM_ITEMS_STATE',
  ITEM_USE_REQUEST: 'ITEM_USE_REQUEST',
  ITEM_USE_RESPONSE: 'ITEM_USE_RESPONSE',
  ITEM_DROP_REQUEST: 'ITEM_DROP_REQUEST',
  ITEM_DROP_RESPONSE: 'ITEM_DROP_RESPONSE',
  ITEM_SPAWNED: 'ITEM_SPAWNED',
  INVENTORY_SWAP_REQUEST: 'INVENTORY_SWAP_REQUEST'
};

export const MAX_PAYLOAD_SIZE = 4096; // 4KB per message maximum
export const MAX_PLAYERS_PER_ROOM = 2; // Phase 1 is two-player rooms

export function isValidNumber(val) {
  return typeof val === 'number' && Number.isFinite(val);
}

export function validatePlayerUpdate(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const { x, y, z, yaw, pitch } = payload;
  if (!isValidNumber(x) || !isValidNumber(y) || !isValidNumber(z)) return false;
  if (!isValidNumber(yaw) || !isValidNumber(pitch)) return false;
  return true;
}
