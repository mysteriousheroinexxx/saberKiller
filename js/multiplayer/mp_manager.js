// Central Multiplayer Manager
// Manages NetworkClient, local player session, remote player entities, and UI state

import { NetworkClient } from './network_client.js';
import { RemotePlayer, preloadPlayerAssets } from './remote_player.js';
import { LocalPlayerController } from './player_controller.js';
import { InventoryController } from './inventory_controller.js';
import { StagingLobby } from './staging_lobby.js';
import { SaberManager } from './saber_manager.js';
import { MultiplayerAudioManager } from './audio_manager.js';
import { MultiplayerAmbientAudio } from './ambient_audio.js';

export class MPManager {
  constructor(scene, camera, uiCallbacks = {}) {
    this.scene = scene;
    this.camera = camera;
    this.ui = uiCallbacks;

    this.network = new NetworkClient();
    this.remotePlayers = new Map(); // playerId -> RemotePlayer
    this.saberManager = new SaberManager(this.scene);
    this.audioManager = new MultiplayerAudioManager({ camera });
    this.localPlayer = new LocalPlayerController(camera, scene, this.network, null);
    this.localPlayer.setSaberManager(this.saberManager);
    this.localPlayer.setAudioManager(this.audioManager);
    this.inventory = new InventoryController(30);
    this.inventory.initDefaultLoadout();
    this.localPlayer.inventory = this.inventory;
    this.inventory.subscribe(() => {
      if (this.localPlayer) {
        this.localPlayer.refreshHeldItem();
      }
    });
    this.localPlayer.selectHotbarSlot(0);
    this.itemManager = null;

    this.stagingLobby = new StagingLobby(scene, camera, this.network);
    this.ambientAudio = new MultiplayerAmbientAudio({ audioManager: this.audioManager });
    this.isInStagingLobby = false;
    this.mySpawn = null;
    this.isLeader = false;
    this.roomRunState = null;

    this.currentRoomCode = null;
    this.myPlayerId = null;
    this.lastRoomSyncState = null;

    this._bindNetworkEvents();
    preloadPlayerAssets();
  }

  setCollisionHandler(ch) {
    this.localPlayer.setCollisionHandler(ch);
  }

  setItemManager(im) {
    this.itemManager = im;
  }

  resyncWorldItems() {
    if (!this.itemManager || !this.lastRoomSyncState) return;
    if (typeof this.itemManager.resetRunItems === 'function') {
      this.itemManager.resetRunItems();
    }
    const { spawnedItems, collectedItems } = this.lastRoomSyncState;
    if (Array.isArray(spawnedItems)) {
      for (const it of spawnedItems) {
        this.itemManager.spawnWorldItem(it);
      }
    }
    if (Array.isArray(collectedItems)) {
      this.itemManager.setCollectedItems(collectedItems);
    }
  }

  _bindNetworkEvents() {
    this.network.onStatusChange = (status) => {
      if (status && status.status === 'disconnected') {
        if (this.ambientAudio) {
          this.ambientAudio.stop();
        }
        if (this.audioManager) {
          this.audioManager.stopAllAudio();
        }
        if (window.interactionManager) {
          window.interactionManager.handleDisconnect();
        }
      }
      if (this.ui.onStatusChange) this.ui.onStatusChange(status);
    };

    this.network.onRoomJoined = (payload) => {
      this.myPlayerId = payload.playerId;
      this.currentRoomCode = payload.roomCode;
      this.mySpawn = payload.spawn;
      this.roomRunState = payload.runState || 'IN_PROGRESS';
      this.isLeader = Boolean(payload.leaderId ? (payload.leaderId === this.myPlayerId) : (payload.slot === 0));

      // Cache existing players and instantiate remote player entities
      if (Array.isArray(payload.existingPlayers)) {
        this.cachedExistingPlayers = payload.existingPlayers;
        for (const ep of payload.existingPlayers) {
          if (ep.id !== this.myPlayerId && !this.remotePlayers.has(ep.id)) {
            const rp = new RemotePlayer(ep.id, this.scene, ep.spawn);
            if (ep.state) rp.setState(ep.state);
            // Hide Level 0 character mesh while in staging lobby
            if (payload.runState === 'LOBBY') {
              rp.group.visible = false;
            }
            this.remotePlayers.set(ep.id, rp);
          }
        }
      }

      if (payload.runState === 'LOBBY') {
        this.isInStagingLobby = true;
        if (this.ambientAudio) {
          this.ambientAudio.stop();
        }
        if (this.audioManager) {
          this.audioManager.stopAllAudio();
        }
        if (this.localPlayer && this.localPlayer.gunGroup) {
          this.localPlayer.gunGroup.visible = false;
        }
        if (this.stagingLobby) {
          this.stagingLobby.enterLobby(payload.roomCode, this.isLeader, this.myPlayerId);
        }
      } else {
        this.isInStagingLobby = false;
        if (this.audioManager) {
          this.audioManager.stopAllAudio();
          this.audioManager.preloadMatchAudio();
        }
        if (this.ambientAudio) {
          this.ambientAudio.start();
        }
        if (this.localPlayer && this.localPlayer.gunGroup) {
          this.localPlayer.gunGroup.visible = true;
        }
        // Spawn local player at assigned spawn
        this.localPlayer.setSpawn(payload.spawn);

        // Store sync state so any asynchronous layout reload preserves generated loot
        this.lastRoomSyncState = {
          collectedItems: payload.collectedItems || [],
          spawnedItems: payload.spawnedItems || []
        };

        // Hide any already collected world items in this room
        if (Array.isArray(payload.collectedItems) && this.itemManager) {
          this.itemManager.setCollectedItems(payload.collectedItems);
        }

        // Spawn any dynamically generated or dropped items in this room
        if (Array.isArray(payload.spawnedItems) && this.itemManager) {
          for (const si of payload.spawnedItems) {
            this.itemManager.spawnWorldItem(si);
          }
        }
      }

      // Sync player inventory from server if provided
      if (payload.inventory) {
        this.inventory.deserialize(payload.inventory);
      }

      // Sync doors state if provided
      if (Array.isArray(payload.doors)) {
        this.roomDoors = payload.doors;
        if (window.exitDoorManager && typeof window.exitDoorManager.initDoors === 'function') {
          window.exitDoorManager.initDoors(payload.doors);
        }
      }

      // Synchronize local player viewmodel and weapon with active hotbar slot
      this.localPlayer.selectHotbarSlot(this.localPlayer.selectedHotbarSlot);

      this._updatePlayerCount();
      if (this.ui.onRoomJoined) this.ui.onRoomJoined(payload);
    };

    this.network.onPlayerJoined = (payload) => {
      if (payload.playerId !== this.myPlayerId && !this.remotePlayers.has(payload.playerId)) {
        const rp = new RemotePlayer(payload.playerId, this.scene, payload.spawn);
        if (this.isInStagingLobby) {
          rp.group.visible = false;
        }
        this.remotePlayers.set(payload.playerId, rp);
        this._updatePlayerCount();
        if (this.ui.onPlayerJoined) this.ui.onPlayerJoined(payload);
      }
    };

    this.network.onPlayerLeft = (payload) => {
      if (this.audioManager && payload?.playerId) {
        this.audioManager.stopEmitter(payload.playerId);
      }
      const rp = this.remotePlayers.get(payload.playerId);
      if (rp) {
        rp.destroy();
        this.remotePlayers.delete(payload.playerId);
        this._updatePlayerCount();
        if (this.ui.onPlayerLeft) this.ui.onPlayerLeft(payload);
      }
    };

    this.network.onPlayerUpdate = (payload) => {
      let rp = this.remotePlayers.get(payload.playerId);
      if (!rp && payload.playerId !== this.myPlayerId) {
        // Defensive self-healing: instantiate remote player if position update received
        rp = new RemotePlayer(payload.playerId, this.scene, {
          x: payload.x,
          y: payload.y,
          z: payload.z,
          yaw: payload.yaw || 0,
          pitch: payload.pitch || 0
        });
        if (this.isInStagingLobby) {
          rp.group.visible = false;
        }
        this.remotePlayers.set(payload.playerId, rp);
        this._updatePlayerCount();
      }
      if (rp) {
        rp.pushUpdate(payload);
        if (!this.isInStagingLobby && rp.state !== 'ELIMINATED') {
          rp.group.visible = true;
        }
      }
    };

    this.network.onItemPickupResponse = (payload) => {
      if (payload && payload.success && this.localPlayer) {
        if (payload.ammoUpdate) {
          if (typeof payload.ammoUpdate.bullets === 'number') this.localPlayer.bullets = payload.ammoUpdate.bullets;
          if (typeof payload.ammoUpdate.shells === 'number') this.localPlayer.shells = payload.ammoUpdate.shells;
          this.localPlayer._notifyStateChange();
        }
      }
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
      if (payload && payload.playerId && payload.playerId !== this.myPlayerId) {
        return;
      }
      if (payload && payload.ammoUpdate && this.localPlayer) {
        if (typeof payload.ammoUpdate.bullets === 'number') this.localPlayer.bullets = payload.ammoUpdate.bullets;
        if (typeof payload.ammoUpdate.shells === 'number') this.localPlayer.shells = payload.ammoUpdate.shells;
        this.localPlayer._notifyStateChange();
      }
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
        if (payload.ammoUpdate && this.localPlayer) {
          if (typeof payload.ammoUpdate.bullets === 'number') this.localPlayer.bullets = payload.ammoUpdate.bullets;
          if (typeof payload.ammoUpdate.shells === 'number') this.localPlayer.shells = payload.ammoUpdate.shells;
          this.localPlayer._notifyStateChange();
        } else if (payload.effect && this.localPlayer) {
          this.localPlayer.applyItemEffect(payload.effect);
        }
        if (payload.sanityUpdate && window.sanityController && typeof window.sanityController.applyServerState === 'function') {
          window.sanityController.applyServerState(payload.sanityUpdate);
          if (window.sanityHUD && typeof window.sanityHUD.update === 'function') {
            window.sanityHUD.update();
          }
        }
        if (payload.staminaUpdate && this.localPlayer && typeof payload.staminaUpdate.stamina === 'number') {
          this.localPlayer.stamina = Math.min(this.localPlayer.maxStamina, payload.staminaUpdate.stamina);
          this.localPlayer._staminaExhausted = false;
        }
        if (payload.speedBoostUpdate && this.localPlayer) {
          this.localPlayer.applyServerSpeedBoost(payload.speedBoostUpdate);
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

    this.network.onPlayerSanityUpdate = (payload) => {
      if (payload && (!payload.playerId || payload.playerId === this.myPlayerId)) {
        if (window.sanityController && typeof window.sanityController.applyServerState === 'function') {
          window.sanityController.applyServerState(payload);
        }
        if (window.sanityHUD && typeof window.sanityHUD.update === 'function') {
          window.sanityHUD.update();
        }
      }
      if (this.ui.onPlayerSanityUpdate) this.ui.onPlayerSanityUpdate(payload);
    };

    this.network.onPlayerSpeedBoostUpdate = (payload) => {
      if (payload && (!payload.playerId || payload.playerId === this.myPlayerId)) {
        if (this.localPlayer && typeof this.localPlayer.applyServerSpeedBoost === 'function') {
          this.localPlayer.applyServerSpeedBoost(payload);
        }
      }
      if (this.ui.onPlayerSpeedBoostUpdate) this.ui.onPlayerSpeedBoostUpdate(payload);
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
        if (this.audioManager) this.audioManager.stopEmitter('local');
        const downedOverlay = document.getElementById('bb-downed-overlay');
        if (downedOverlay) downedOverlay.style.display = 'flex';
      } else if (payload) {
        const rp = this.remotePlayers.get(payload.playerId);
        if (rp) rp.setState('DOWNED');
        if (this.audioManager && payload.playerId) this.audioManager.stopEmitter(payload.playerId);
      }
      if (this.ui.onPlayerDowned) this.ui.onPlayerDowned(payload);
    };

    this.network.onPlayerEliminated = (payload) => {
      if (payload && payload.playerId === this.myPlayerId) {
        this.localPlayer.setState('ELIMINATED');
        if (this.audioManager) this.audioManager.stopEmitter('local');
        const downedOverlay = document.getElementById('bb-downed-overlay');
        if (downedOverlay) downedOverlay.style.display = 'none';
        const elimOverlay = document.getElementById('bb-eliminated-overlay');
        if (elimOverlay) elimOverlay.style.display = 'flex';
      } else if (payload) {
        const rp = this.remotePlayers.get(payload.playerId);
        if (rp) rp.setState('ELIMINATED');
        if (this.audioManager && payload.playerId) this.audioManager.stopEmitter(payload.playerId);
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
      if (this.ambientAudio) {
        this.ambientAudio.stop();
      }
      if (this.audioManager) {
        this.audioManager.stopAllAudio();
      }
      const isVictory = (payload?.status === 'ESCAPED' || payload?.reason === 'LEVEL_COMPLETED');
      if (!isVictory) {
        this.localPlayer.setState('ELIMINATED');
      }
      const downedOverlay = document.getElementById('bb-downed-overlay');
      if (downedOverlay) downedOverlay.style.display = 'none';
      const elimOverlay = document.getElementById('bb-eliminated-overlay');
      if (elimOverlay) elimOverlay.style.display = 'none';

      const goOverlay = document.getElementById('bb-gameover-overlay');
      if (goOverlay) {
        goOverlay.style.display = 'flex';
        const titleEl = goOverlay.querySelector('.bb-gameover-title');
        if (titleEl) {
          titleEl.textContent = payload?.title || (isVictory ? 'LEVEL ESCAPED!' : 'GAME OVER');
          titleEl.style.color = isVictory ? '#4ade80' : '#dc2626';
        }
        const reasonEl = document.getElementById('bb-gameover-reason');
        if (reasonEl) {
          reasonEl.textContent = payload?.message || payload?.reason || (isVictory ? 'Level 0 Cleared: You escaped the Backrooms!' : 'RUN FAILED');
        }
      }
      if (this.ui.onGameOver) this.ui.onGameOver(payload);
    };

    this.network.onLobbyStateUpdate = (payload) => {
      if (this.stagingLobby && this.isInStagingLobby) {
        this.stagingLobby.handleLobbyStateUpdate(payload);
      }
      if (payload && payload.leaderId) {
        this.isLeader = (payload.leaderId === this.myPlayerId);
      }
      if (this.ui.onLobbyStateUpdate) this.ui.onLobbyStateUpdate(payload);
    };

    this.network.onMatchStartRejected = (payload) => {
      if (this.stagingLobby && this.isInStagingLobby) {
        this.stagingLobby.handleMatchStartRejected(payload);
      }
      if (this.ui.onMatchStartRejected) this.ui.onMatchStartRejected(payload);
    };

    this.network.onMatchStarted = (payload) => {
      this.isInStagingLobby = false;
      this.roomRunState = 'IN_PROGRESS';
      if (this.audioManager) {
        this.audioManager.stopAllAudio();
        this.audioManager.preloadMatchAudio();
      }
      if (this.ambientAudio) {
        this.ambientAudio.start();
      }
      if (this.stagingLobby) {
        this.stagingLobby.leaveLobby();
      }

      // Hide all death, downed, and game over overlays
      const downedOverlay = document.getElementById('bb-downed-overlay');
      if (downedOverlay) downedOverlay.style.display = 'none';
      const elimOverlay = document.getElementById('bb-eliminated-overlay');
      if (elimOverlay) elimOverlay.style.display = 'none';
      const goOverlay = document.getElementById('bb-gameover-overlay');
      if (goOverlay) goOverlay.style.display = 'none';

      // 1. Authoritatively restore client world pickups (unhide authored items, remove dynamic drops)
      if (this.itemManager) {
        if (typeof this.itemManager.resetRunItems === 'function') {
          this.itemManager.resetRunItems();
        } else if (typeof this.itemManager.resetCollectedItems === 'function') {
          this.itemManager.resetCollectedItems();
        }
      }

      // 2. Authoritatively reset Sabers (stop stagger animations, reset mixers, home transforms)
      if (this.saberManager && typeof this.saberManager.reset === 'function') {
        this.saberManager.reset(payload?.matchGeneration);
      }

      // 3. Reset interaction manager hover/prompt state
      if (window.interactionManager && typeof window.interactionManager.reset === 'function') {
        window.interactionManager.reset();
      }

      // 4. Reset local inventory to clean starting loadout (slot 0: flashlight only)
      if (this.inventory) {
        if (payload?.inventory) {
          this.inventory.deserialize(payload.inventory);
        } else {
          this.inventory.initDefaultLoadout();
        }
      }

      // 5. Reset local player to clean run state (100 HP, ACTIVE, 1.62m eye height, equip flashlight)
      if (this.localPlayer) {
        if (typeof this.localPlayer.resetCombatState === 'function') {
          this.localPlayer.resetCombatState();
        } else {
          this.localPlayer.setState('ACTIVE');
          this.localPlayer.setHp(100);
        }
        if (typeof this.localPlayer.selectHotbarSlot === 'function') {
          this.localPlayer.selectHotbarSlot(0); // Equips starting tactical flashlight
        }
        if (this.localPlayer.gunGroup) {
          this.localPlayer.gunGroup.visible = true;
        }
      }

      // 6. Reset HUDs, Sanity & Inventory UI
      if (window.inventoryUI && typeof window.inventoryUI.render === 'function') {
        window.inventoryUI.render();
      }
      if (window.sanityController && typeof window.sanityController.reset === 'function') {
        window.sanityController.reset();
      }
      if (window.sanityHUD && typeof window.sanityHUD.update === 'function') {
        window.sanityHUD.update();
      } else if (window.sanityHud && typeof window.sanityHud.updateSanity === 'function') {
        window.sanityHud.updateSanity(100);
      }
      if (window.survivalHud && typeof window.survivalHud.updateHealth === 'function') {
        window.survivalHud.updateHealth(100, 100);
      }
      if (this.mySpawn) {
        this.localPlayer.setSpawn(this.mySpawn);
        // Immediately broadcast initial spawn update to server so all clients receive host & player positions
        if (this.network && this.network.isConnected) {
          this.network.sendUpdate(
            +this.mySpawn.x.toFixed(3),
            +this.mySpawn.y.toFixed(3),
            +this.mySpawn.z.toFixed(3),
            +this.mySpawn.yaw.toFixed(4),
            +this.mySpawn.pitch.toFixed(4),
            this.localPlayer.weapon || 0
          );
        }
      }

      // 7. Ensure every connected player from payload.players or cachedExistingPlayers is instantiated & reset
      const playerList = payload?.players || this.cachedExistingPlayers || [];
      for (const p of playerList) {
        if (p.id !== this.myPlayerId) {
          let rp = this.remotePlayers.get(p.id);
          if (!rp) {
            rp = new RemotePlayer(p.id, this.scene, p.spawn);
            this.remotePlayers.set(p.id, rp);
          } else {
            if (typeof rp.reset === 'function') {
              rp.reset(p.spawn);
            }
          }
          if (p.state) rp.setState(p.state);
          rp.group.visible = (rp.state !== 'ELIMINATED');
        }
      }

      // Unhide and activate all remote player character models for Level 0
      for (const [id, rp] of this.remotePlayers) {
        if (rp && rp.state !== 'ELIMINATED') {
          rp.group.visible = true;
        }
      }

      // 8. Re-apply newly spawned items (loot, health packs, keys) and collected items for this generation
      this.lastRoomSyncState = {
        collectedItems: payload.collectedItems || [],
        spawnedItems: payload.spawnedItems || []
      };
      if (Array.isArray(payload.spawnedItems) && this.itemManager) {
        for (const it of payload.spawnedItems) {
          this.itemManager.spawnWorldItem(it);
        }
      }

      if (Array.isArray(payload.collectedItems) && this.itemManager) {
        this.itemManager.setCollectedItems(payload.collectedItems);
      }

      // 9. Re-initialize doors
      if (Array.isArray(payload.doors)) {
        this.roomDoors = payload.doors;
        if (window.exitDoorManager && typeof window.exitDoorManager.initDoors === 'function') {
          window.exitDoorManager.initDoors(payload.doors);
        }
      }
      this._updatePlayerCount();
      if (this.ui.onMatchStarted) this.ui.onMatchStarted(payload);
    };

    this.network.onMonsterSnapshot = (payload) => {
      if (this.saberManager) {
        this.saberManager.handleSnapshot(payload);
      }
      if (this.ui.onMonsterSnapshot) this.ui.onMonsterSnapshot(payload);
    };

    this.network.onSoundEventBroadcast = (payload) => {
      if (this.saberManager) {
        this.saberManager.handleSoundEvent(payload);
      }
      if (this.audioManager && payload && (payload.soundType === 'FOOTSTEP_WALK' || payload.soundType === 'FOOTSTEP_SPRINT')) {
        // Skip our own player ID because local prediction already drives local footsteps
        if (payload.sourceEntityId && payload.sourceEntityId !== this.myPlayerId) {
          const rp = this.remotePlayers.get(payload.sourceEntityId);
          if (!rp || rp.state === 'ACTIVE') {
            const mode = payload.soundType === 'FOOTSTEP_SPRINT' ? 'run' : 'walk';
            this.audioManager.playFootstep(payload.sourceEntityId, mode, {
              positional: true,
              position: payload.position
            });
          }
        }
      } else if (this.audioManager && payload && (payload.soundType === 'GUNSHOT' || payload.soundType === 'GUNSHOT_PRIMARY')) {
        // Skip our own player ID because local weapon firing already plays attached audio immediately
        if (payload.sourceEntityId && payload.sourceEntityId !== this.myPlayerId) {
          const rp = this.remotePlayers.get(payload.sourceEntityId);
          if (!rp || rp.state === 'ACTIVE') {
            this.audioManager.playWeaponFire(payload.sourceEntityId, 'weapon_pistol_fire', {
              positional: true,
              position: payload.position
            });
          }
        }
      }
      if (this.ui.onSoundEventBroadcast) this.ui.onSoundEventBroadcast(payload);
    };

    this.network.onProjectileImpact = (payload) => {
      if (this.saberManager && typeof this.saberManager.handleProjectileImpact === 'function') {
        this.saberManager.handleProjectileImpact(payload);
      }
      if (this.ui.onProjectileImpact) this.ui.onProjectileImpact(payload);
    };

    this.network.onDevAiTelemetry = (payload) => {
      if (this.ui.onDevAiTelemetry) this.ui.onDevAiTelemetry(payload);
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

  leaveRoom() {
    if (this.ambientAudio) {
      this.ambientAudio.stop();
    }
    if (this.audioManager) {
      this.audioManager.stopAllAudio();
    }
    if (this.stagingLobby) {
      this.stagingLobby.leaveLobby();
    }
    this.isInStagingLobby = false;
    for (const rp of this.remotePlayers.values()) {
      rp.destroy();
    }
    this.remotePlayers.clear();
    this.currentRoomCode = null;
    this.myPlayerId = null;
    this.inventory.clear();
    this.itemManager?.resetRunItems();
    this.saberManager?.reset();
    this.localPlayer?.resetCombatState();
    window.sanityController?.reset();
    window.interactionManager?.reset();
    this._updatePlayerCount();
  }

  disconnect() {
    if (this.ambientAudio) {
      this.ambientAudio.stop();
    }
    if (this.audioManager) {
      this.audioManager.stopAllAudio();
    }
    if (this.stagingLobby) {
      this.stagingLobby.leaveLobby();
    }
    this.isInStagingLobby = false;
    this.network.disconnect();
    for (const rp of this.remotePlayers.values()) {
      rp.destroy();
    }
    this.remotePlayers.clear();
    this.currentRoomCode = null;
    this.myPlayerId = null;
    this.inventory.clear();
    this.itemManager?.resetRunItems();
    this.saberManager?.reset();
    this.localPlayer?.resetCombatState();
    window.sanityController?.reset();
    window.interactionManager?.reset();
    this._updatePlayerCount();
  }

  update(dt) {
    // 1. Update local player
    this.localPlayer.update(dt);
    if (this.audioManager && this.camera) {
      this.audioManager.updateListener(this.camera);
    }

    // 2. Update remote players (interpolation)
    for (const rp of this.remotePlayers.values()) {
      rp.update(dt);
    }

    // 3. Update Saber monsters
    if (this.saberManager) {
      this.saberManager.update(dt, this.localPlayer ? this.localPlayer.pos : null);
    }
  }
}
