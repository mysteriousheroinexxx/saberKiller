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

export class NetworkClient {
  constructor() {
    this.ws = null;
    this.serverUrl = '';
    this.isConnected = false;
    this.myPlayerId = null;
    this.currentRoomCode = null;
    this.heartbeatTimer = null;

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
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.disconnect();
    }

    // Default to current host if unspecified
    if (!url || url.trim() === '') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url = `${protocol}//${window.location.host}`;
    }

    // Format protocol if user entered raw IP:PORT
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      url = protocol + url;
    }

    this.serverUrl = url;
    this._setStatus('connecting', `Connecting to ${url}...`);

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this._setStatus('disconnected', `Connection error: ${e.message}`);
      if (this.onError) this.onError(e.message);
      return;
    }

    this.ws.onopen = () => {
      this.isConnected = true;
      this._setStatus('connected', 'Connected to server');
      this._startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      let msg = null;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.warn('[NetworkClient] Ignored non-JSON packet:', event.data);
        return;
      }

      this._handleMessage(msg);
    };

    this.ws.onclose = (event) => {
      this.isConnected = false;
      this._stopHeartbeat();
      this._setStatus('disconnected', `Disconnected (${event.code || 'Closed'})`);
    };

    this.ws.onerror = (err) => {
      console.warn('[NetworkClient] WebSocket error event');
      this._setStatus('error', 'Connection encountered an error');
      if (this.onError) this.onError('WebSocket connection error');
    };
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
    return { sent, requestId };
  }

  sendUpdate(x, y, z, yaw, pitch, weapon = 0) {
    return this.send(MSG_TYPES.PLAYER_UPDATE, { x, y, z, yaw, pitch, weapon });
  }

  disconnect() {
    this._stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.myPlayerId = null;
    this.currentRoomCode = null;
    this._setStatus('disconnected', 'Disconnected');
  }
}
