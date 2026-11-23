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
  ROOM_ITEMS_STATE: 'ROOM_ITEMS_STATE'
};

function resolveWebSocketUrl(input) {
  const value = (input || '').trim();
  const defaultScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (!value) return `${defaultScheme}//${window.location.host}`;
  if (/^wss?:\/\//i.test(value)) return new URL(value).toString();
  if (/^https?:\/\//i.test(value)) {
    const parsed = new URL(value);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return parsed.toString();
  }
  return `${defaultScheme}//${value.replace(/^\/+/, '')}`;
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

  createRoom(roomCode = null, layoutRevision = null) {
    return this.send(MSG_TYPES.CREATE_ROOM, { roomCode, layoutRevision });
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

  sendUpdate(x, y, z, yaw, pitch, weapon = 0) {
    return this.send(MSG_TYPES.PLAYER_UPDATE, { x, y, z, yaw, pitch, weapon });
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
