// Client-Side WebSocket Network Manager for Saber Killer Multiplayer

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
  INVENTORY_SWAP_REQUEST: 'INVENTORY_SWAP_REQUEST',
  VENDING_DISPENSE_REQUEST: 'VENDING_DISPENSE_REQUEST',
  VENDING_DISPENSE_RESPONSE: 'VENDING_DISPENSE_RESPONSE',
  // Health, Downed & Revival packet types
  PLAYER_DAMAGE_REQUEST: 'PLAYER_DAMAGE_REQUEST',
  PLAYER_HEALTH_UPDATE: 'PLAYER_HEALTH_UPDATE',
  PLAYER_DOWNED: 'PLAYER_DOWNED',
  PLAYER_ELIMINATED: 'PLAYER_ELIMINATED',
  PLAYER_REVIVE_REQUEST: 'PLAYER_REVIVE_REQUEST',
  PLAYER_REVIVE_RESPONSE: 'PLAYER_REVIVE_RESPONSE',
  PLAYER_REVIVED: 'PLAYER_REVIVED',
  GAME_OVER: 'GAME_OVER',
  // Pre-Game Staging Lobby packet types
  LOBBY_READY_TOGGLE: 'LOBBY_READY_TOGGLE',
  LOBBY_STATE_UPDATE: 'LOBBY_STATE_UPDATE',
  MATCH_START_REQUEST: 'MATCH_START_REQUEST',
  MATCH_START_REJECTED: 'MATCH_START_REJECTED',
  MATCH_STARTED: 'MATCH_STARTED',
  // Door & Level Escape packet types
  DOOR_UNLOCK_REQUEST: 'DOOR_UNLOCK_REQUEST',
  DOOR_UNLOCK_RESPONSE: 'DOOR_UNLOCK_RESPONSE',
  DOOR_STATE_UPDATE: 'DOOR_STATE_UPDATE',
  PLAYER_ESCAPE_REQUEST: 'PLAYER_ESCAPE_REQUEST',
  LEVEL_ESCAPED: 'LEVEL_ESCAPED',
  // Saber AI Simulation & Telemetry packet types
  MONSTER_SNAPSHOT: 'MONSTER_SNAPSHOT',
  SOUND_EVENT_BROADCAST: 'SOUND_EVENT_BROADCAST',
  DEV_AI_TELEMETRY: 'DEV_AI_TELEMETRY',
  FIRE_WEAPON: 'FIRE_WEAPON',
  ATTACK_MONSTER: 'ATTACK_MONSTER'
};

function resolveWebSocketUrl(input) {
  const value = (input || '').trim();
  const defaultScheme = (typeof window !== 'undefined' && window.location?.protocol === 'https:') ? 'wss:' : 'ws:';
  const defaultHost = (typeof window !== 'undefined' && window.location?.host) ? window.location.host : '127.0.0.1:8749';
  const target = value || defaultHost;

  if (/^wss?:\/\//i.test(target)) return new URL(target).toString();
  if (/^https?:\/\//i.test(target)) {
    const parsed = new URL(target);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return parsed.toString();
  }
  return new URL(`${defaultScheme}//${target.replace(/^\/+/, '')}`).toString();
}

export class NetworkClient {
  constructor() {
    this.ws = null;
    this.serverUrl = '';
    this.isConnected = false;
    this.myPlayerId = null;
    this.currentRoomCode = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.shouldReconnect = false;
    this.openWaiters = new Set();

    // Event listeners
    this.onStatusChange = null;
    this.onRoomJoined = null;
    this.onPlayerJoined = null;
    this.onPlayerLeft = null;
    this.onPlayerUpdate = null;
    this.onError = null;
    this.onItemPickupResponse = null;
    this.onItemCollected = null;
    this.onInventoryUpdate = null;
    this.onPickupRejected = null;
    this.onRoomItemsState = null;
    this.onItemUseResponse = null;
    this.onItemDropResponse = null;
    this.onItemSpawned = null;
    this.onVendingDispenseResponse = null;
    this.onHealthUpdate = null;
    this.onPlayerDowned = null;
    this.onPlayerEliminated = null;
    this.onPlayerReviveResponse = null;
    this.onPlayerRevived = null;
    this.onGameOver = null;
    this.onLobbyStateUpdate = null;
    this.onMatchStartRejected = null;
    this.onMatchStarted = null;
    this.onDoorUnlockResponse = null;
    this.onDoorStateUpdate = null;
    this.onLevelEscaped = null;
    this.onMonsterSnapshot = null;
    this.onSoundEventBroadcast = null;
    this.onDevAiTelemetry = null;
  }

  connect(url) {
    let resolvedUrl;
    try {
      resolvedUrl = resolveWebSocketUrl(url);
    } catch (e) {
      this._setStatus('error', `Invalid WebSocket address: ${e.message}`);
      if (this.onError) this.onError(e.message);
      return null;
    }

    if (this.serverUrl === resolvedUrl && this.ws &&
        (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.shouldReconnect = true;
      return this.ws;
    }

    if (this.ws) this.disconnect();
    this.serverUrl = resolvedUrl;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    return this._openSocket();
  }

  _openSocket() {
    if (!this.serverUrl || !this.shouldReconnect || this.ws) return this.ws;
    this._setStatus('connecting', `Connecting to ${this.serverUrl}...`);
    console.info(`[NetworkClient] Opening WebSocket: ${this.serverUrl}`);

    let socket;
    try {
      socket = new WebSocket(this.serverUrl);
    } catch (e) {
      console.error(`[NetworkClient] WebSocket construction failed for ${this.serverUrl}: ${e.message}`);
      this._setStatus('error', `WebSocket connection failed: ${e.message}`);
      if (this.onError) this.onError(e.message);
      this._scheduleReconnect();
      return null;
    }
    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.info(`[NetworkClient] WebSocket open: ${this.serverUrl}`);
      this._setStatus('connected', `Connected to ${this.serverUrl}`);
      this._startHeartbeat();
      for (const waiter of this.openWaiters) waiter.resolve(socket);
      this.openWaiters.clear();
    };

    socket.onmessage = (event) => {
      let msg = null;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.warn('[NetworkClient] Ignored non-JSON packet:', event.data);
        return;
      }

      this._handleMessage(msg);
    };

    socket.onclose = (event) => {
      console.warn(`[NetworkClient] WebSocket close: url=${this.serverUrl}, code=${event.code}, reason=${event.reason || '(none)'}, clean=${event.wasClean}`);
      if (this.ws !== socket) return;
      this.isConnected = false;
      this._stopHeartbeat();
      this.ws = null;
      this._setStatus('disconnected', `Disconnected (${event.code || 'Closed'})`);
      if (this.shouldReconnect) this._scheduleReconnect();
    };

    socket.onerror = () => {
      if (this.ws !== socket) return;
      console.error(`[NetworkClient] WebSocket error event for ${this.serverUrl}; browser does not expose handshake details here`);
      this._setStatus('error', `WebSocket connection error: ${this.serverUrl}`);
      if (this.onError) this.onError(`WebSocket connection error: ${this.serverUrl}`);
    };

    return socket;
  }

  _scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer || this.ws) return;
    this.reconnectAttempts++;
    const delay = Math.min(500 * (2 ** Math.min(this.reconnectAttempts - 1, 5)), 15000);
    this._setStatus('connecting', `Reconnecting to ${this.serverUrl} in ${Math.ceil(delay / 1000)}s...`);
    console.warn(`[NetworkClient] Reconnect attempt ${this.reconnectAttempts} scheduled in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._openSocket();
    }, delay);
  }

  whenOpen() {
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    if (!this.shouldReconnect) return Promise.reject(new Error('WebSocket connection has not been requested'));
    return new Promise((resolve, reject) => this.openWaiters.add({ resolve, reject }));
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send(MSG_TYPES.HEARTBEAT, { clientTime: Date.now() });
      }
    }, 20000);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _setStatus(status, message) {
    if (this.onStatusChange) {
      this.onStatusChange({ status, message });
    }
  }

  _handleMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case MSG_TYPES.ROOM_JOINED:
        this.myPlayerId = payload.playerId;
        this.currentRoomCode = payload.roomCode;
        this._setStatus('in_room', `In Room: ${payload.roomCode}`);
        if (this.onRoomJoined) this.onRoomJoined(payload);
        break;

      case MSG_TYPES.PLAYER_JOINED:
        if (this.onPlayerJoined) this.onPlayerJoined(payload);
        break;

      case MSG_TYPES.PLAYER_LEFT:
        if (this.onPlayerLeft) this.onPlayerLeft(payload);
        break;

      case MSG_TYPES.PLAYER_UPDATE:
        if (this.onPlayerUpdate) this.onPlayerUpdate(payload);
        break;

      case MSG_TYPES.SERVER_ERROR:
        if (this.onError) this.onError(payload.message || 'Server error');
        break;

      case MSG_TYPES.HEARTBEAT:
        // Pong received, connection is healthy
        break;

      case MSG_TYPES.ITEM_PICKUP_RESPONSE:
        if (this.onItemPickupResponse) this.onItemPickupResponse(payload);
        break;

      case MSG_TYPES.ITEM_COLLECTED:
        if (this.onItemCollected) this.onItemCollected(payload);
        break;

      case MSG_TYPES.INVENTORY_UPDATE:
        if (this.onInventoryUpdate) this.onInventoryUpdate(payload);
        break;

      case MSG_TYPES.PICKUP_REJECTED:
        if (this.onPickupRejected) this.onPickupRejected(payload);
        break;

      case MSG_TYPES.ROOM_ITEMS_STATE:
        if (this.onRoomItemsState) this.onRoomItemsState(payload);
        break;

      case MSG_TYPES.ITEM_USE_RESPONSE:
        if (this.onItemUseResponse) this.onItemUseResponse(payload);
        break;

      case MSG_TYPES.ITEM_DROP_RESPONSE:
        if (this.onItemDropResponse) this.onItemDropResponse(payload);
        break;

      case MSG_TYPES.ITEM_SPAWNED:
        if (this.onItemSpawned) this.onItemSpawned(payload);
        break;

      case MSG_TYPES.VENDING_DISPENSE_RESPONSE:
        if (this.onVendingDispenseResponse) this.onVendingDispenseResponse(payload);
        break;

      case MSG_TYPES.PLAYER_HEALTH_UPDATE:
        if (this.onHealthUpdate) this.onHealthUpdate(payload);
        break;

      case MSG_TYPES.PLAYER_DOWNED:
        if (this.onPlayerDowned) this.onPlayerDowned(payload);
        break;

      case MSG_TYPES.PLAYER_ELIMINATED:
        if (this.onPlayerEliminated) this.onPlayerEliminated(payload);
        break;

      case MSG_TYPES.PLAYER_REVIVE_RESPONSE:
        if (this.onPlayerReviveResponse) this.onPlayerReviveResponse(payload);
        break;

      case MSG_TYPES.PLAYER_REVIVED:
        if (this.onPlayerRevived) this.onPlayerRevived(payload);
        break;

      case MSG_TYPES.GAME_OVER:
        if (this.onGameOver) this.onGameOver(payload);
        break;

      case MSG_TYPES.LOBBY_STATE_UPDATE:
        if (this.onLobbyStateUpdate) this.onLobbyStateUpdate(payload);
        break;

      case MSG_TYPES.MATCH_START_REJECTED:
        if (this.onMatchStartRejected) this.onMatchStartRejected(payload);
        break;

      case MSG_TYPES.MATCH_STARTED:
        if (this.onMatchStarted) this.onMatchStarted(payload);
        break;

      case MSG_TYPES.DOOR_UNLOCK_RESPONSE:
        if (this.onDoorUnlockResponse) this.onDoorUnlockResponse(payload);
        break;

      case MSG_TYPES.DOOR_STATE_UPDATE:
        if (this.onDoorStateUpdate) this.onDoorStateUpdate(payload);
        break;

      case MSG_TYPES.LEVEL_ESCAPED:
        if (this.onLevelEscaped) this.onLevelEscaped(payload);
        break;

      case MSG_TYPES.MONSTER_SNAPSHOT:
        if (this.onMonsterSnapshot) this.onMonsterSnapshot(payload);
        break;

      case MSG_TYPES.SOUND_EVENT_BROADCAST:
        if (this.onSoundEventBroadcast) this.onSoundEventBroadcast(payload);
        break;

      case MSG_TYPES.DEV_AI_TELEMETRY:
        if (this.onDevAiTelemetry) this.onDevAiTelemetry(payload);
        break;

      default:
        console.log('[NetworkClient] Unhandled packet type:', type);
        break;
    }
  }

  send(type, payload) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify({ type, payload }));
    return true;
  }

  createRoom(roomCode = null, layoutRevision = null, options = {}) {
    return this.send(MSG_TYPES.CREATE_ROOM, { roomCode, layoutRevision, ...options });
  }

  joinRoom(roomCode) {
    return this.send(MSG_TYPES.JOIN_ROOM, { roomCode });
  }

  requestItemPickup(itemId, requestId = null, clientPosition = null) {
    if (!requestId) {
      requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }
    const payload = { itemId, requestId };
    if (clientPosition) {
      payload.clientPosition = clientPosition;
    }
    const sent = this.send(MSG_TYPES.ITEM_PICKUP_REQUEST, payload);
    if (sent) console.log(`[PICKUP ${requestId}] WebSocket send completed (${MSG_TYPES.ITEM_PICKUP_REQUEST}, item=${itemId})`);
    else console.warn(`[PICKUP ${requestId}] WebSocket send failed (connected=${this.isConnected}, readyState=${this.ws?.readyState ?? 'no socket'})`);
    return { sent, requestId };
  }

  requestItemUse(slotIndex, instanceId = null, requestId = null) {
    if (!requestId) {
      requestId = 'use_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }
    const payload = { slotIndex, instanceId, requestId };
    const sent = this.send(MSG_TYPES.ITEM_USE_REQUEST, payload);
    return { sent, requestId };
  }

  requestItemDrop(slotIndex, instanceId = null, quantity = 1, playerPosition = null, playerYaw = 0, requestId = null) {
    if (!requestId) {
      requestId = 'drop_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }
    const payload = {
      slotIndex,
      instanceId,
      quantity: Math.max(1, parseInt(quantity, 10) || 1),
      playerPosition,
      playerYaw,
      requestId
    };
    const sent = this.send(MSG_TYPES.ITEM_DROP_REQUEST, payload);
    return { sent, requestId };
  }

  requestItemSwap(fromSlot, toSlot) {
    return this.send(MSG_TYPES.INVENTORY_SWAP_REQUEST, { fromSlot, toSlot });
  }

  requestVendingDispense(machineId, requestId = null, clientPosition = null) {
    if (!requestId) {
      requestId = 'disp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }
    const payload = { machineId, requestId };
    if (clientPosition) {
      payload.clientPosition = clientPosition;
    }
    const sent = this.send(MSG_TYPES.VENDING_DISPENSE_REQUEST, payload);
    return { sent, requestId };
  }

  requestDamage(amount, reason = 'DEFAULT', targetPlayerId = null) {
    const payload = { amount, reason };
    if (targetPlayerId) {
      payload.targetPlayerId = targetPlayerId;
    }
    return this.send(MSG_TYPES.PLAYER_DAMAGE_REQUEST, payload);
  }

  requestRevive(targetPlayerId, requestId = null, clientPosition = null) {
    if (!requestId) {
      requestId = 'rev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }
    const payload = { targetPlayerId, requestId };
    if (clientPosition) {
      payload.clientPosition = clientPosition;
    }
    const sent = this.send(MSG_TYPES.PLAYER_REVIVE_REQUEST, payload);
    return { sent, requestId };
  }

  toggleReady(isReady = null) {
    return this.send(MSG_TYPES.LOBBY_READY_TOGGLE, { isReady });
  }

  requestMatchStart() {
    return this.send(MSG_TYPES.MATCH_START_REQUEST, {});
  }

  requestDoorUnlock(doorId = 'level0_exit_door', requestId = null, clientPosition = null) {
    if (!requestId) {
      requestId = 'door_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    }
    const payload = { doorId, requestId };
    if (clientPosition) {
      payload.clientPosition = clientPosition;
    }
    const sent = this.send(MSG_TYPES.DOOR_UNLOCK_REQUEST, payload);
    return { sent, requestId };
  }

  requestEscape(doorId = 'level0_exit_door', clientPosition = null) {
    const payload = { doorId };
    if (clientPosition) {
      payload.clientPosition = clientPosition;
    }
    return this.send(MSG_TYPES.PLAYER_ESCAPE_REQUEST, payload);
  }

  sendUpdate(x, y, z, yaw, pitch, weapon = 0, isSprinting = false) {
    return this.send(MSG_TYPES.PLAYER_UPDATE, { x, y, z, yaw, pitch, weapon, isSprinting });
  }

  fireWeapon(weaponType = 'PISTOL', origin = null, direction = null) {
    return this.send(MSG_TYPES.FIRE_WEAPON, { weaponType, origin, direction });
  }

  attackMonster(monsterId = 'saber_alpha', damage = 50, weaponType = 'PISTOL') {
    return this.send(MSG_TYPES.ATTACK_MONSTER, { monsterId, damage, weaponType });
  }

  disconnect() {
    this.shouldReconnect = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this._stopHeartbeat();
    const socket = this.ws;
    this.ws = null;
    this.isConnected = false;
    this.myPlayerId = null;
    this.currentRoomCode = null;
    for (const waiter of this.openWaiters) waiter.reject(new Error('WebSocket connection cancelled'));
    this.openWaiters.clear();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Client disconnect');
    this._setStatus('disconnected', 'Disconnected');
  }
}
