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
    this.inventory = new InventoryController(30);
    this.inventory.initDefaultLoadout();
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
      if (status && status.status === 'disconnected') {
        if (window.interactionManager) {
          window.interactionManager.handleDisconnect();
        }
      }
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

      // Spawn any dynamically dropped items in this room
      if (Array.isArray(payload.spawnedItems) && this.itemManager) {
        for (const si of payload.spawnedItems) {
          this.itemManager.spawnWorldItem(si);
        }
      }

      // Sync player inventory from server if provided
      if (payload.inventory) {
        this.inventory.deserialize(payload.inventory);
      }

      // Synchronize local player viewmodel and weapon with active hotbar slot
      this.localPlayer.selectHotbarSlot(this.localPlayer.selectedHotbarSlot);

      // Spawn any players who were already in the room
      if (Array.isArray(payload.existingPlayers)) {
        for (const ep of payload.existingPlayers) {
          if (ep.id !== this.myPlayerId && !this.remotePlayers.has(ep.id)) {
            const rp = new RemotePlayer(ep.id, this.scene, ep.spawn);
            if (ep.state) rp.setState(ep.state);
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

    this.network.onItemPickupResponse = (payload) => {
      if (window.interactionManager) {
        window.interactionManager.handlePickupResponse(payload);
      }
      if (this.ui.onItemPickupResponse) this.ui.onItemPickupResponse(payload);
    };

    this.network.onItemCollected = (payload) => {
      if (this.itemManager && payload.itemId) {
        this.itemManager.hideItem(payload.itemId);
      }
      if (window.interactionManager) {
        window.interactionManager.clearTargetIfId(payload.itemId);
        window.interactionManager.handleItemCollected(payload);
      }
      if (this.ui.onItemCollected) this.ui.onItemCollected(payload);
    };

    this.network.onInventoryUpdate = (payload) => {
      if (payload && payload.inventory) {
        this.inventory.deserialize(payload.inventory);
        if (this.localPlayer) {
          this.localPlayer.refreshHeldItem();
        }
      }
      if (window.interactionManager) {
        window.interactionManager.recordServerResponse('INVENTORY_UPDATE', payload);
      }
      if (this.ui.onInventoryUpdate) this.ui.onInventoryUpdate(payload);
    };

    this.network.onPickupRejected = (payload) => {
      if (window.interactionManager) {
        window.interactionManager.handlePickupRejected(payload);
      }
      if (this.ui.onPickupRejected) this.ui.onPickupRejected(payload);
    };

    this.network.onRoomItemsState = (payload) => {
      if (this.ui.onRoomItemsState) this.ui.onRoomItemsState(payload);
    };

    this.network.onItemSpawned = (payload) => {
      if (this.itemManager && payload.item) {
        this.itemManager.spawnWorldItem(payload.item);
      }
      if (this.ui.onItemSpawned) this.ui.onItemSpawned(payload);
    };

    this.network.onItemUseResponse = (payload) => {
      if (payload && payload.success) {
        if (payload.effect && this.localPlayer) {
          this.localPlayer.applyItemEffect(payload.effect);
        }
        if (this.localPlayer) {
          this.localPlayer.onItemUseAccepted(payload);
        }
      } else if (payload && !payload.success) {
        if (this.localPlayer) {
          this.localPlayer.onItemUseRejected(payload);
        }
      }
      if (this.ui.onItemUseResponse) this.ui.onItemUseResponse(payload);
    };

    this.network.onVendingDispenseResponse = (payload) => {
      if (window.interactionManager) {
        window.interactionManager.handleVendingDispenseResponse(payload);
      }
      if (this.ui.onVendingDispenseResponse) this.ui.onVendingDispenseResponse(payload);
    };

    this.network.onItemDropResponse = (payload) => {
      if (this.ui.onItemDropResponse) this.ui.onItemDropResponse(payload);
    };

    this.network.onHealthUpdate = (payload) => {
      if (payload && payload.playerId === this.myPlayerId) {
        this.localPlayer.setHp(payload.hp);
        if (window.survivalHUD) {
          window.survivalHUD.updatePlayer(this.localPlayer);
        }
      }
      if (this.ui.onHealthUpdate) this.ui.onHealthUpdate(payload);
    };

    this.network.onPlayerDowned = (payload) => {
      if (payload && payload.playerId === this.myPlayerId) {
        this.localPlayer.setState('DOWNED');
        const downedOverlay = document.getElementById('bb-downed-overlay');
        if (downedOverlay) downedOverlay.style.display = 'flex';
      } else if (payload) {
        const rp = this.remotePlayers.get(payload.playerId);
        if (rp) rp.setState('DOWNED');
      }
      if (this.ui.onPlayerDowned) this.ui.onPlayerDowned(payload);
    };

    this.network.onPlayerEliminated = (payload) => {
      if (payload && payload.playerId === this.myPlayerId) {
        this.localPlayer.setState('ELIMINATED');
        const downedOverlay = document.getElementById('bb-downed-overlay');
        if (downedOverlay) downedOverlay.style.display = 'none';
        const elimOverlay = document.getElementById('bb-eliminated-overlay');
        if (elimOverlay) elimOverlay.style.display = 'flex';
      } else if (payload) {
        const rp = this.remotePlayers.get(payload.playerId);
        if (rp) rp.setState('ELIMINATED');
      }
      if (this.ui.onPlayerEliminated) this.ui.onPlayerEliminated(payload);
    };

    this.network.onPlayerReviveResponse = (payload) => {
      if (window.interactionManager) {
        window.interactionManager.handleReviveResponse(payload);
      }
      if (this.ui.onPlayerReviveResponse) this.ui.onPlayerReviveResponse(payload);
    };

    this.network.onPlayerRevived = (payload) => {
      if (payload && payload.targetId === this.myPlayerId) {
        this.localPlayer.setState('ACTIVE', payload.revivalsUsed);
        this.localPlayer.setHp(payload.hp);
        const downedOverlay = document.getElementById('bb-downed-overlay');
        if (downedOverlay) downedOverlay.style.display = 'none';
        if (window.survivalHUD) {
          window.survivalHUD.updatePlayer(this.localPlayer);
        }
      } else if (payload) {
        const rp = this.remotePlayers.get(payload.targetId);
        if (rp) rp.setState('ACTIVE');
      }
      if (this.ui.onPlayerRevived) this.ui.onPlayerRevived(payload);
    };

    this.network.onGameOver = (payload) => {
      this.localPlayer.setState('ELIMINATED');
      const downedOverlay = document.getElementById('bb-downed-overlay');
      if (downedOverlay) downedOverlay.style.display = 'none';
      const elimOverlay = document.getElementById('bb-eliminated-overlay');
      if (elimOverlay) elimOverlay.style.display = 'none';

      const goOverlay = document.getElementById('bb-gameover-overlay');
      if (goOverlay) {
        goOverlay.style.display = 'flex';
        const reasonEl = document.getElementById('bb-gameover-reason');
        if (reasonEl) {
          reasonEl.textContent = payload.message || payload.reason || 'RUN FAILED';
        }
      }
      if (this.ui.onGameOver) this.ui.onGameOver(payload);
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

  createRoom(roomCode = null, layoutRevision = null, options = {}) {
    this.network.createRoom(roomCode, layoutRevision, options);
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
