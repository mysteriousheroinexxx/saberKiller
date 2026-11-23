// Pre-Game Staging Lobby Module for Multiplayer Survival Mode
// Manages the 3D floating metallic platform, atmospheric lighting,
// 3D character models standing on the platform with synchronized name labels,
// and the authoritative Ready / Start match flow.

import { preloadPlayerAssets } from './remote_player.js';

export class StagingLobby {
  constructor(scene, camera, networkClient) {
    this.scene = scene;
    this.camera = camera;
    this.networkClient = networkClient;

    this.isActive = false;
    this.roomCode = null;
    this.myPlayerId = null;
    this.isLeader = false;
    this.localReady = false;

    // 3D Staging Environment Objects
    this.lobbyGroup = new THREE.Group();
    this.lobbyGroup.name = 'StagingLobbyGroup';
    this.lobbyGroup.visible = false;
    this.scene.add(this.lobbyGroup);

    this.platformMesh = null;
    this.lobbyLights = [];
    this.characterSlots = new Map(); // playerId -> { group, mesh, nameSprite, isReady, slot }

    // Preloaded assets cache
    this.t800Template = null;
    this.pistolTemplate = null;
    this._assetsLoaded = false;

    // UI DOM Elements
    this.overlayEl = null;
    this.roomCodeEl = null;
    this.statusMsgEl = null;
    this.actionBtn = null;
    this.leaveBtn = null;

    this._onLeaveCallback = null;
    this._onMatchStartedCallback = null;

    this._build3DEnvironment();
    this._initUI();
    this._preloadAssets();
  }

  _preloadAssets() {
    preloadPlayerAssets().then(({ template, pistol }) => {
      this.t800Template = template;
      this.pistolTemplate = pistol;
      this._assetsLoaded = true;
      if (this.isActive) {
        this._refreshCharacterModels();
      }
    }).catch(err => {
      console.warn('[StagingLobby] Asset preload error:', err);
    });
  }

  _build3DEnvironment() {
    // 1. Floating Silver-Grey Metallic Platform
    // Sleek cylinder: 3.4m top radius, 3.6m bottom radius, 0.35m thickness
    const platformGeom = new THREE.CylinderGeometry(3.4, 3.6, 0.35, 48);
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x828a94,
      roughness: 0.28,
      metalness: 0.85
    });
    this.platformMesh = new THREE.Mesh(platformGeom, platformMat);
    this.platformMesh.position.set(0, 0, 0);
    this.platformMesh.receiveShadow = true;
    this.lobbyGroup.add(this.platformMesh);

    // Decorative dark metal bottom rim
    const rimGeom = new THREE.CylinderGeometry(3.62, 3.72, 0.08, 48);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x1c2026,
      roughness: 0.55,
      metalness: 0.65
    });
    const rimMesh = new THREE.Mesh(rimGeom, rimMat);
    rimMesh.position.set(0, -0.16, 0);
    this.lobbyGroup.add(rimMesh);

    // 2. Atmospheric Staging Lights
    // Main key light from top-front
    const dirLight = new THREE.DirectionalLight(0xdde8f5, 1.4);
    dirLight.position.set(2, 6, 4);
    this.lobbyGroup.add(dirLight);
    this.lobbyLights.push(dirLight);

    // Soft cool rim light underneath platform
    const rimLight = new THREE.PointLight(0x4488ff, 1.3, 12, 1.5);
    rimLight.position.set(0, -0.6, 0);
    this.lobbyGroup.add(rimLight);
    this.lobbyLights.push(rimLight);

    // Soft fill light illuminating characters from front
    const fillLight = new THREE.PointLight(0xffeedd, 0.7, 8, 1.5);
    fillLight.position.set(0, 2.2, 2.0);
    this.lobbyGroup.add(fillLight);
    this.lobbyLights.push(fillLight);
  }

  _initUI() {
    this.overlayEl = document.getElementById('staging-lobby-overlay');
    if (!this.overlayEl) return;

    this.roomCodeEl = document.getElementById('staging-room-code');
    this.statusMsgEl = document.getElementById('staging-status-msg');
    this.actionBtn = document.getElementById('btn-staging-action');
    this.leaveBtn = document.getElementById('btn-staging-leave');

    if (this.actionBtn) {
      this.actionBtn.addEventListener('click', () => {
        this._handleActionClick();
      });
    }

    if (this.leaveBtn) {
      this.leaveBtn.addEventListener('click', () => {
        if (typeof this._onLeaveCallback === 'function') {
          this._onLeaveCallback();
        }
      });
    }
  }

  setOnLeave(callback) {
    this._onLeaveCallback = callback;
  }

  setOnMatchStarted(callback) {
    this._onMatchStartedCallback = callback;
  }

  /**
   * Enters the Staging Lobby mode
   */
  enterLobby(roomCode, isLeader, myPlayerId) {
    this.isActive = true;
    this.roomCode = roomCode;
    this.myPlayerId = myPlayerId;
    this.isLeader = isLeader;
    this.localReady = isLeader; // Leader is ready by default

    // Set dark empty surrounding space
    this.savedBackground = this.scene.background;
    this.scene.background = new THREE.Color(0x060709);

    // Show floating platform and staging lights
    this.lobbyGroup.visible = true;

    // Position camera overlooking floating platform
    this.camera.position.set(0, 1.65, 4.2);
    this.camera.lookAt(0, 1.15, 0);

    // Display Staging UI Overlay
    if (this.overlayEl) {
      this.overlayEl.style.display = 'flex';
    }
    if (this.roomCodeEl) {
      this.roomCodeEl.textContent = `ROOM: ${roomCode}`;
    }
    if (this.statusMsgEl) {
      this.statusMsgEl.style.display = 'none';
      this.statusMsgEl.textContent = '';
    }

    this._updateActionButton();
  }

  _updateActionButton() {
    if (!this.actionBtn) return;

    if (this.isLeader) {
      this.actionBtn.textContent = 'START MATCH';
      this.actionBtn.className = 'staging-btn-action staging-btn-start';
    } else {
      if (this.localReady) {
        this.actionBtn.textContent = 'READY ✓';
        this.actionBtn.className = 'staging-btn-action staging-btn-ready-on';
      } else {
        this.actionBtn.textContent = 'READY';
        this.actionBtn.className = 'staging-btn-action staging-btn-ready-off';
      }
    }
  }

  _handleActionClick() {
    if (this.isLeader) {
      // Authoritative start request to server
      if (this.networkClient) {
        this.networkClient.requestMatchStart();
      }
    } else {
      // Toggle ready state
      this.localReady = !this.localReady;
      this._updateActionButton();
      if (this.networkClient) {
        this.networkClient.toggleReady(this.localReady);
      }
    }
  }

  /**
   * Updates lobby with authoritative state received from server
   */
  handleLobbyStateUpdate(state) {
    if (!state || !this.isActive) return;

    if (state.roomCode) {
      this.roomCode = state.roomCode;
      if (this.roomCodeEl) {
        this.roomCodeEl.textContent = `ROOM: ${this.roomCode}`;
      }
    }

    // Check if leadership changed
    if (state.leaderId) {
      const wasLeader = this.isLeader;
      this.isLeader = (state.leaderId === this.myPlayerId);
      if (wasLeader !== this.isLeader) {
        this._updateActionButton();
      }
    }

    // Clear any previous error/rejected banner upon state change
    if (this.statusMsgEl && this.statusMsgEl.style.display !== 'none') {
      this.statusMsgEl.style.display = 'none';
    }

    // Synchronize connected player models and ready status
    if (Array.isArray(state.players)) {
      this.cachedPlayers = state.players;
      this._syncPlayers(state.players);

      // Synchronize local player ready state if non-leader
      const me = state.players.find(p => p.id === this.myPlayerId);
      if (me && !this.isLeader) {
        this.localReady = Boolean(me.isReady);
        this._updateActionButton();
      }
    }
  }

  /**
   * Handles start rejection from server (e.g. unready players)
   */
  handleMatchStartRejected(payload) {
    const reason = payload?.reason || 'Waiting for all players to ready up.';
    if (this.statusMsgEl) {
      this.statusMsgEl.textContent = reason;
      this.statusMsgEl.style.display = 'block';
    }
  }

  /**
   * Synchronizes 3D player character models and floating name labels on platform
   */
  _syncPlayers(players) {
    const currentIds = new Set(players.map(p => p.id));

    // Remove disconnected players
    for (const [id, slot] of this.characterSlots) {
      if (!currentIds.has(id)) {
        if (slot.group && slot.group.parent) {
          slot.group.parent.remove(slot.group);
        }
        this.characterSlots.delete(id);
      }
    }

    // Position slots on platform:
    // 1 player: center (0, 0.175, 0)
    // 2 players: slot 0 at (-1.15, 0.175, 0), slot 1 at (1.15, 0.175, 0)
    const count = players.length;
    players.forEach((p, index) => {
      let targetX = 0;
      if (count === 2) {
        targetX = (p.slot === 0 || index === 0) ? -1.15 : 1.15;
      } else if (count > 2) {
        const span = 2.4;
        targetX = -span / 2 + (index / (count - 1)) * span;
      }

      let slotObj = this.characterSlots.get(p.id);
      if (!slotObj) {
        slotObj = this._createCharacterSlot(p, targetX);
        this.characterSlots.set(p.id, slotObj);
      } else {
        // Update position if count changed
        slotObj.group.position.set(targetX, 0.175, 0);
        // Update ready state and name label
        if (slotObj.isReady !== p.isReady || slotObj.name !== p.name) {
          slotObj.isReady = p.isReady;
          slotObj.name = p.name;
          this._updateNameSprite(slotObj, p.name, p.isReady);
        }
      }
    });
  }

  _createCharacterSlot(player, posX) {
    const group = new THREE.Group();
    group.name = `StagingPlayer_${player.id}`;
    group.position.set(posX, 0.175, 0);
    this.lobbyGroup.add(group);

    // Inner visual container facing camera
    const visualPivot = new THREE.Group();
    visualPivot.rotation.y = 0; // Faces forward toward camera at +Z
    group.add(visualPivot);

    let charMesh = null;
    if (this.t800Template) {
      charMesh = this.t800Template.clone(true);
      charMesh.position.set(0, 0, 0);
      visualPivot.add(charMesh);
    } else {
      // Fallback procedural figure while GLB loads
      charMesh = this._createFallbackFigure();
      visualPivot.add(charMesh);
    }

    // Name label sprite above head
    const nameSprite = this._createNameSprite(player.name || `Player_${player.id}`, player.isReady);
    group.add(nameSprite);

    return {
      id: player.id,
      name: player.name || `Player_${player.id}`,
      isReady: Boolean(player.isReady),
      group,
      visualPivot,
      mesh: charMesh,
      nameSprite
    };
  }

  _refreshCharacterModels() {
    if (!this.t800Template) return;
    for (const [, slotObj] of this.characterSlots) {
      if (slotObj.mesh && slotObj.visualPivot) {
        slotObj.visualPivot.remove(slotObj.mesh);
        const clone = this.t800Template.clone(true);
        clone.position.set(0, 0, 0);
        slotObj.visualPivot.add(clone);
        slotObj.mesh = clone;
      }
    }
  }

  _createNameSprite(name, isReady) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    this._drawNameOnCanvas(ctx, canvas, name, isReady);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.4, 0.6, 1);
    sprite.position.set(0, 2.15, 0);
    sprite.userData = { canvas, ctx, texture };
    return sprite;
  }

  _updateNameSprite(slotObj, name, isReady) {
    if (!slotObj.nameSprite) return;
    const { canvas, ctx, texture } = slotObj.nameSprite.userData;
    if (!ctx || !canvas) return;

    this._drawNameOnCanvas(ctx, canvas, name, isReady);
    texture.needsUpdate = true;
  }

  _drawNameOnCanvas(ctx, canvas, name, isReady) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.font = 'bold 36px "Rubik", -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Green text for ready players; white text for unready players
    const textColor = isReady ? '#44ff88' : '#ffffff';
    const glowColor = isReady ? 'rgba(68, 255, 136, 0.85)' : 'rgba(0, 0, 0, 0.75)';

    ctx.shadowColor = glowColor;
    ctx.shadowBlur = isReady ? 14 : 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = textColor;

    ctx.fillText((name || 'PLAYER').toUpperCase(), canvas.width / 2, canvas.height / 2);
  }

  _createFallbackFigure() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.4, metalness: 0.8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.3), mat);
    body.position.y = 0.9;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.28, 0.25), mat);
    head.position.y = 1.65;
    g.add(body); g.add(head);
    return g;
  }

  /**
   * Transitions from staging lobby into Level 0 match
   */
  exitToGame() {
    this.leaveLobby();
    if (typeof this._onMatchStartedCallback === 'function') {
      this._onMatchStartedCallback();
    }
  }

  /**
   * Cleans up staging lobby visuals and UI
   */
  leaveLobby() {
    this.isActive = false;

    // Hide staging 3D platform and player models
    this.lobbyGroup.visible = false;
    for (const [, slotObj] of this.characterSlots) {
      if (slotObj.group && slotObj.group.parent) {
        slotObj.group.parent.remove(slotObj.group);
      }
    }
    this.characterSlots.clear();

    // Hide Staging UI
    if (this.overlayEl) {
      this.overlayEl.style.display = 'none';
    }
    if (this.statusMsgEl) {
      this.statusMsgEl.style.display = 'none';
    }

    // Restore background if set
    if (this.savedBackground !== undefined) {
      this.scene.background = this.savedBackground;
    }
  }

  destroy() {
    this.leaveLobby();
    if (this.lobbyGroup && this.lobbyGroup.parent) {
      this.scene.remove(this.lobbyGroup);
    }
  }
}
