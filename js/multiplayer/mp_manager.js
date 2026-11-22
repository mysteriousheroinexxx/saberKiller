// Central Multiplayer Manager
// Manages NetworkClient, local player session, remote player entities, and UI state

import { NetworkClient } from './network_client.js';
import { RemotePlayer, preloadPlayerAssets } from './remote_player.js';
import { LocalPlayerController } from './player_controller.js';
import { InventoryController } from './inventory_controller.js';

export class MPManager {
  constructor(scene, camera, uiCallbacks = {}) {
    this.scene = scene;
    this.camera = camera;
    this.ui = uiCallbacks;

    this.network = new NetworkClient();
    this.remotePlayers = new Map(); // playerId -> RemotePlayer
    this.localPlayer = new LocalPlayerController(camera, scene, this.network, null);
    this.inventory = new InventoryController(12);
    this.localPlayer.inventory = this.inventory;
    this.itemManager = null;

    this.currentRoomCode = null;
    this.myPlayerId = null;

    this._bindNetworkEvents();
    preloadPlayerAssets();
  }

  setCollisionHandler(ch) {
    this.localPlayer.setCollisionHandler(ch);
  }

  setItemManager(im) {
    this.itemManager = im;
  }

  _bindNetworkEvents() {
    this.network.onStatusChange = (status) => {
      if (this.ui.onStatusChange) this.ui.onStatusChange(status);
    };

    this.network.onRoomJoined = (payload) => {
      this.myPlayerId = payload.playerId;
      this.currentRoomCode = payload.roomCode;

      // Spawn local player at assigned spawn
      this.localPlayer.setSpawn(payload.spawn);

      // Hide any already collected world items in this room
      if (Array.isArray(payload.collectedItems) && this.itemManager) {
        this.itemManager.setCollectedItems(payload.collectedItems);
      }

      // Spawn any players who were already in the room
      if (Array.isArray(payload.existingPlayers)) {
        for (const ep of payload.existingPlayers) {
          if (ep.id !== this.myPlayerId && !this.remotePlayers.has(ep.id)) {
            const rp = new RemotePlayer(ep.id, this.scene, ep.spawn);
            this.remotePlayers.set(ep.id, rp);
          }
        }
      }

      this._updatePlayerCount();
      if (this.ui.onRoomJoined) this.ui.onRoomJoined(payload);
    };

    this.network.onPlayerJoined = (payload) => {
      if (payload.playerId !== this.myPlayerId && !this.remotePlayers.has(payload.playerId)) {
        const rp = new RemotePlayer(payload.playerId, this.scene, payload.spawn);
        this.remotePlayers.set(payload.playerId, rp);
        this._updatePlayerCount();
        if (this.ui.onPlayerJoined) this.ui.onPlayerJoined(payload);
      }
    };

    this.network.onPlayerLeft = (payload) => {
      const rp = this.remotePlayers.get(payload.playerId);
      if (rp) {
        rp.destroy();
        this.remotePlayers.delete(payload.playerId);
        this._updatePlayerCount();
        if (this.ui.onPlayerLeft) this.ui.onPlayerLeft(payload);
      }
    };

    this.network.onPlayerUpdate = (payload) => {
      const rp = this.remotePlayers.get(payload.playerId);
      if (rp) {
        rp.pushUpdate(payload);
      }
    };

    this.network.onItemCollected = (payload) => {
      if (this.itemManager && payload.itemId) {
        this.itemManager.hideItem(payload.itemId);
      }
      if (window.interactionManager) {
        window.interactionManager.clearTargetIfId(payload.itemId);
        window.interactionManager.recordServerResponse('ITEM_COLLECTED', payload);
      }
      if (this.ui.onItemCollected) this.ui.onItemCollected(payload);
    };

    this.network.onInventoryUpdate = (payload) => {
      if (payload && payload.inventory) {
        this.inventory.deserialize(payload.inventory);
      }
      if (window.interactionManager) {
        window.interactionManager.recordServerResponse('INVENTORY_UPDATE', payload);
      }
      if (this.ui.onInventoryUpdate) this.ui.onInventoryUpdate(payload);
    };

    this.network.onPickupRejected = (payload) => {
      if (window.interactionManager) {
        window.interactionManager.recordServerResponse('PICKUP_REJECTED', payload);
      }
      if (this.ui.onPickupRejected) this.ui.onPickupRejected(payload);
    };

    this.network.onRoomItemsState = (payload) => {
      if (this.ui.onRoomItemsState) this.ui.onRoomItemsState(payload);
    };

    this.network.onError = (errMsg) => {
      if (this.ui.onError) this.ui.onError(errMsg);
    };
  }

  _updatePlayerCount() {
    const total = 1 + this.remotePlayers.size;
    if (this.ui.onPlayerCountChange) {
      this.ui.onPlayerCountChange(total);
    }
  }

  connect(serverUrl) {
    this.network.connect(serverUrl);
  }

  createRoom(roomCode = null, layoutRevision = null) {
    this.network.createRoom(roomCode, layoutRevision);
  }

  joinRoom(roomCode) {
    this.network.joinRoom(roomCode);
  }

  disconnect() {
    this.network.disconnect();
    for (const rp of this.remotePlayers.values()) {
      rp.destroy();
    }
    this.remotePlayers.clear();
    this.currentRoomCode = null;
    this.myPlayerId = null;
    this.inventory.clear();
    this._updatePlayerCount();
  }

  update(dt) {
    // 1. Update local player
    this.localPlayer.update(dt);

    // 2. Update remote players (interpolation)
    for (const rp of this.remotePlayers.values()) {
      rp.update(dt);
    }
  }
}
