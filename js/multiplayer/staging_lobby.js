// Pre-Game Staging Lobby Module for Multiplayer Survival Mode
// Manages the 3D floating rectangular metallic platform, atmospheric lighting,
// 3D character models standing on the platform with synchronized name labels,
// collision and grounding integration, and the authoritative Ready / Start match flow.

import { preloadPlayerAssets } from './remote_player.js';

export class StagingLobby {
  constructor(scene, camera, networkClient, renderer = null) {
    this.scene = scene;
    this.camera = camera;
    this.networkClient = networkClient;
    this.renderer = renderer;

    this.isActive = false;
    this.roomCode = null;
    this.myPlayerId = null;
    this.isLeader = false;
    this.localReady = false;

    // Platform Physical Dimensions and Collision Volume
    this.platformBounds = {
      width: 6.8,
      depth: 4.2,
      thickness: 0.5,
      topY: 0.0,
      bottomY: -0.5,
      minX: -3.4,
      maxX: 3.4,
      minZ: -2.1,
      maxZ: 2.1
    };

    this.collisionBox = new THREE.Box3(
      new THREE.Vector3(this.platformBounds.minX, this.platformBounds.bottomY, this.platformBounds.minZ),
      new THREE.Vector3(this.platformBounds.maxX, this.platformBounds.topY, this.platformBounds.maxZ)
    );

    // 3D Staging Environment Objects
    this.lobbyGroup = new THREE.Group();
    this.lobbyGroup.name = 'StagingLobbyGroup';
    this.lobbyGroup.visible = false;
    this.scene.add(this.lobbyGroup);

    this.platformMesh = null;
    this.subChassisMesh = null;
    this.lobbyLights = [];
    this.characterSlots = new Map(); // playerId -> { id, name, isReady, group, visualPivot, mesh, nameSprite }

    // Preloaded assets cache
    this.t800Template = null;
    this.pistolTemplate = null;
    this._assetsLoaded = false;

    // Studio Environment Map for metallic PBR reflections
    this.lobbyEnvMap = null;
    this.savedEnvironment = undefined;
    this.savedExposure = undefined;
    this.savedBackground = undefined;

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

  getRenderer() {
    return this.renderer || (typeof window !== 'undefined' ? window.renderer : null);
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

  /**
   * Generates a procedural brushed-metal canvas texture with fine directional micro-streaks
   */
  _createBrushedMetalTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Base neutral silver-grey tone
    ctx.fillStyle = '#b4bac2';
    ctx.fillRect(0, 0, 512, 512);

    // Directional brushed streaks in X direction with variable transparency
    for (let i = 0; i < 5000; i++) {
      const y = Math.random() * 512;
      const len = 35 + Math.random() * 150;
      const x = Math.random() * 512;
      const alpha = 0.025 + Math.random() * 0.06;
      const bright = Math.random() > 0.46;
      ctx.strokeStyle = bright ? `rgba(255, 255, 255, ${alpha})` : `rgba(28, 34, 44, ${alpha})`;
      ctx.lineWidth = 0.75 + Math.random() * 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();

      // Wrap around horizontally for seamless tiling
      if (x + len > 512) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo((x + len) - 512, y);
        ctx.stroke();
      }
    }

    // Fine surface micro-grain
    const imgData = ctx.getImageData(0, 0, 512, 512);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 8;
      d[i] = Math.min(255, Math.max(0, d[i] + n));
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
    }
    ctx.putImageData(imgData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 2);
    return texture;
  }

  /**
   * Generates a 3D rectangular geometry with beveled/chamfered edges
   */
  _createBeveledPlatformGeometry(width, depth, thickness, bevelSize, bevelThickness) {
    const hw = (width / 2) - bevelSize;
    const hd = (depth / 2) - bevelSize;
    const coreThick = thickness - (bevelThickness * 2);

    const shape = new THREE.Shape();
    shape.moveTo(-hw, -hd);
    shape.lineTo(hw, -hd);
    shape.lineTo(hw, hd);
    shape.lineTo(-hw, hd);
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: coreThick,
      bevelEnabled: true,
      bevelSegments: 4,
      steps: 1,
      bevelSize: bevelSize,
      bevelThickness: bevelThickness
    });

    // Rotate so depth is vertical along Y axis
    geom.rotateX(Math.PI / 2);
    geom.computeVertexNormals();
    geom.computeBoundingBox();

    // Translate so top surface is at Y = 0.0 and bottom surface is at Y = -thickness
    const topY = geom.boundingBox.max.y;
    geom.translate(0, -topY, 0);
    geom.computeBoundingBox();

    return geom;
  }

  /**
   * Creates an HDR studio environment map for metallic PBR reflections
   */
  _ensureStudioEnvironmentMap() {
    if (this.lobbyEnvMap) return this.lobbyEnvMap;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Soft studio lighting gradient (overhead bright softbox, cool horizon fill, soft dark floor)
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, '#ffffff'); // bright overhead key light
    grad.addColorStop(0.2, '#f0f4f9');
    grad.addColorStop(0.45, '#b4c4d6'); // cool blue-grey horizon
    grad.addColorStop(0.7, '#425368');
    grad.addColorStop(1.0, '#101720'); // dark floor
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    // Studio softbox highlight panels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fillRect(160, 20, 192, 60);

    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;

    const renderer = this.getRenderer();
    if (renderer && THREE.PMREMGenerator) {
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        const renderTarget = pmrem.fromEquirectangular(tex);
        this.lobbyEnvMap = renderTarget.texture;
        pmrem.dispose();
      } catch (e) {
        console.warn('[StagingLobby] PMREMGenerator fallback:', e);
        this.lobbyEnvMap = tex;
      }
    } else {
      this.lobbyEnvMap = tex;
    }

    return this.lobbyEnvMap;
  }

  _build3DEnvironment() {
    // -------------------------------------------------------------
    // 1. Rectangular Floating Metallic Platform with Beveled Edges
    // -------------------------------------------------------------
    const { width, depth, thickness } = this.platformBounds;
    const platformGeom = this._createBeveledPlatformGeometry(width, depth, thickness, 0.08, 0.08);

    const brushedTexture = this._createBrushedMetalTexture();
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3ab, // Silver-grey metallic
      roughness: 0.32,
      metalness: 0.82,
      bumpMap: brushedTexture,
      bumpScale: 0.005,
      roughnessMap: brushedTexture,
      envMapIntensity: 1.4
    });

    this.platformMesh = new THREE.Mesh(platformGeom, platformMat);
    this.platformMesh.name = 'StagingLobby_MetallicPlatform';
    this.platformMesh.position.set(0, 0, 0);
    this.platformMesh.receiveShadow = true;
    this.platformMesh.castShadow = true;
    this.lobbyGroup.add(this.platformMesh);

    // Recessed dark industrial sub-chassis / support base
    const subGeom = new THREE.BoxGeometry(width - 0.3, 0.14, depth - 0.3);
    const subMat = new THREE.MeshStandardMaterial({
      color: 0x1b1f26,
      roughness: 0.55,
      metalness: 0.75
    });
    this.subChassisMesh = new THREE.Mesh(subGeom, subMat);
    this.subChassisMesh.name = 'StagingLobby_SubChassis';
    this.subChassisMesh.position.set(0, -thickness - 0.06, 0);
    this.subChassisMesh.receiveShadow = true;
    this.lobbyGroup.add(this.subChassisMesh);

    // -------------------------------------------------------------
    // 2. Comprehensive Staging Lighting
    // -------------------------------------------------------------
    // Main light source ~50 metres above platform directed towards its centre
    const mainLight = new THREE.DirectionalLight(0xf8fbff, 4.2);
    mainLight.position.set(0, 50, 0);
    mainLight.target.position.set(0, 0, 0);
    this.lobbyGroup.add(mainLight.target);
    this.lobbyGroup.add(mainLight);
    this.lobbyLights.push(mainLight);

    // Front key/fill light to ensure character faces, chests, and legs are brightly illuminated
    const frontFill = new THREE.DirectionalLight(0xecf3fd, 2.6);
    frontFill.position.set(0, 3.5, 4.8);
    frontFill.target.position.set(0, 0.9, 0);
    this.lobbyGroup.add(frontFill.target);
    this.lobbyGroup.add(frontFill);
    this.lobbyLights.push(frontFill);

    // Left and right cross-fill lights for rich sculptural metallic highlights
    const leftFill = new THREE.DirectionalLight(0xd9e5f5, 1.5);
    leftFill.position.set(-4.5, 2.8, 3.0);
    leftFill.target.position.set(-0.5, 0.9, 0);
    this.lobbyGroup.add(leftFill.target);
    this.lobbyGroup.add(leftFill);
    this.lobbyLights.push(leftFill);

    const rightFill = new THREE.DirectionalLight(0xd9e5f5, 1.5);
    rightFill.position.set(4.5, 2.8, 3.0);
    rightFill.target.position.set(0.5, 0.9, 0);
    this.lobbyGroup.add(rightFill.target);
    this.lobbyGroup.add(rightFill);
    this.lobbyLights.push(rightFill);

    // Rim backlight to give characters and platform edges crisp silhouette separation from void
    const rimLight = new THREE.DirectionalLight(0x7da8db, 2.2);
    rimLight.position.set(0, 4.0, -4.5);
    rimLight.target.position.set(0, 0.9, 0);
    this.lobbyGroup.add(rimLight.target);
    this.lobbyGroup.add(rimLight);
    this.lobbyLights.push(rimLight);

    // Soft ambient hemisphere light filling shadows
    const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x161e28, 1.8);
    this.lobbyGroup.add(hemiLight);
    this.lobbyLights.push(hemiLight);

    // Under-chassis soft glow emphasizing the floating platform thickness
    const underGlow = new THREE.PointLight(0x386898, 2.0, 9, 1.5);
    underGlow.position.set(0, -1.1, 0);
    this.lobbyGroup.add(underGlow);
    this.lobbyLights.push(underGlow);
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
   * Collision Query: Returns the platform collision bounding box
   */
  getCollisionBox() {
    return this.collisionBox.clone();
  }

  /**
   * Grounding Query: Returns the top surface height if (x, z) is on the platform, or null
   */
  getGroundHeightAt(x, z) {
    const { minX, maxX, minZ, maxZ, topY } = this.platformBounds;
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
      return topY;
    }
    return null;
  }

  /**
   * Checks if a point is within the platform boundary
   */
  isPointOnPlatform(x, z) {
    return this.getGroundHeightAt(x, z) !== null;
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
    this.scene.background = new THREE.Color(0x07090c);

    // Apply studio environment map for metallic PBR reflections
    this.savedEnvironment = this.scene.environment;
    const envMap = this._ensureStudioEnvironmentMap();
    if (envMap) {
      this.scene.environment = envMap;
    }

    // Set exposure for clean, well-illuminated staging visuals
    const renderer = this.getRenderer();
    if (renderer) {
      this.savedExposure = renderer.toneMappingExposure;
      renderer.toneMappingExposure = 0.92;
    }

    // Show floating platform and staging lights
    this.lobbyGroup.visible = true;

    // Position camera overlooking the rectangular platform and character models
    this.camera.position.set(0, 1.65, 4.6);
    this.camera.lookAt(0, 0.95, 0);

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
   * Precise vertical foot grounding: aligns model's soles exactly with local Y = 0
   */
  _alignModelFeetToOrigin(model) {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    // If box.min.y is the lowest vertex, offsetting model.position.y by -box.min.y
    // guarantees that the lowest vertex sits exactly at local Y = 0.000.
    model.position.y = -box.min.y;
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

    // Position slots on rectangular platform:
    // Feet are grounded at platformBounds.topY (Y = 0.0)
    // Z position is 0.0 (comfortably centered on the 4.2m depth)
    const count = players.length;
    players.forEach((p, index) => {
      let targetX = 0;
      if (count === 2) {
        targetX = (p.slot === 0 || index === 0) ? -1.35 : 1.35;
      } else if (count === 3) {
        const xs = [-2.0, 0.0, 2.0];
        targetX = xs[index] !== undefined ? xs[index] : 0;
      } else if (count > 3) {
        const span = 4.8;
        targetX = -span / 2 + (index / (count - 1)) * span;
      }

      let slotObj = this.characterSlots.get(p.id);
      if (!slotObj) {
        slotObj = this._createCharacterSlot(p, targetX, 0.0);
        this.characterSlots.set(p.id, slotObj);
      } else {
        // Update position if count changed (grounded exactly at topY)
        slotObj.group.position.set(targetX, this.platformBounds.topY, 0.0);
        // Update ready state and name label
        if (slotObj.isReady !== p.isReady || slotObj.name !== p.name) {
          slotObj.isReady = p.isReady;
          slotObj.name = p.name;
          this._updateNameSprite(slotObj, p.name, p.isReady);
        }
      }
    });
  }

  _createCharacterSlot(player, posX, posZ = 0.0) {
    const group = new THREE.Group();
    group.name = `StagingPlayer_${player.id}`;
    // Position group on top surface of the platform (Y = platformBounds.topY)
    group.position.set(posX, this.platformBounds.topY, posZ);
    this.lobbyGroup.add(group);

    // Inner visual container facing camera
    const visualPivot = new THREE.Group();
    visualPivot.rotation.y = 0; // Faces forward toward camera at +Z
    group.add(visualPivot);

    let charMesh = null;
    if (this.t800Template) {
      charMesh = this.t800Template.clone(true);
      this._alignModelFeetToOrigin(charMesh);
      visualPivot.add(charMesh);
    } else {
      // Fallback procedural figure with grounded feet
      charMesh = this._createFallbackFigure();
      this._alignModelFeetToOrigin(charMesh);
      visualPivot.add(charMesh);
    }

    // Name label sprite above head (at Y = 2.15m, 0.30m above 1.85m character head)
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
        this._alignModelFeetToOrigin(clone);
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
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9ca3ab,
      roughness: 0.35,
      metalness: 0.75
    });

    // Torso
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.3), mat);
    body.position.y = 1.2;
    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.24), mat);
    head.position.y = 1.74;
    // Left & right legs grounded to Y = 0.0
    const legGeom = new THREE.BoxGeometry(0.18, 0.8, 0.2);
    const leftLeg = new THREE.Mesh(legGeom, mat);
    leftLeg.position.set(-0.14, 0.4, 0);
    const rightLeg = new THREE.Mesh(legGeom, mat);
    rightLeg.position.set(0.14, 0.4, 0);

    g.add(body);
    g.add(head);
    g.add(leftLeg);
    g.add(rightLeg);
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

    // Restore environment map if set
    if (this.savedEnvironment !== undefined) {
      this.scene.environment = this.savedEnvironment;
    }

    // Restore exposure if set
    const renderer = this.getRenderer();
    if (renderer && this.savedExposure !== undefined) {
      renderer.toneMappingExposure = this.savedExposure;
    }
  }

  destroy() {
    this.leaveLobby();
    if (this.lobbyGroup && this.lobbyGroup.parent) {
      this.scene.remove(this.lobbyGroup);
    }
  }
}
