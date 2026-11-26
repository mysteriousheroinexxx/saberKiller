// Pre-Game Staging Lobby Module for Multiplayer Survival Mode
// Minimalist industrial brushed-steel staging environment with engineered overhead
// and 3-point lighting, grounded T-800 character presentation, and clean readiness HUD.

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
    this.cachedPlayers = [];
    this._idleClock = 0;

    // Platform Physical Dimensions and Collision Volume
    this.platformBounds = {
      width: 5.4,
      depth: 3.4,
      thickness: 0.42,
      topY: 0.0,
      bottomY: -0.42,
      minX: -2.7,
      maxX: 2.7,
      minZ: -1.7,
      maxZ: 1.7
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
    this.characterSlots = new Map(); // playerId -> { id, name, isReady, group, visualPivot, mesh, nameSprite, padMesh, phase }

    // Preloaded assets cache
    this.t800Template = null;
    this.pistolTemplate = null;
    this._assetsLoaded = false;

    // Studio Environment Map & saved scene state
    this.lobbyEnvMap = null;
    this.savedEnvironment = undefined;
    this.savedExposure = undefined;
    this.savedBackground = undefined;
    this.savedFog = undefined;
    this.savedCameraFov = undefined;

    // UI DOM Elements
    this.overlayEl = null;
    this.roomCodeEl = null;
    this.rosterEl = null;
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
   * Generates a crisp brushed-steel albedo/bump/roughness map with subtle machined panel seams
   */
  _createBrushedMetalTextures() {
    const size = 1024;
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = size;
    colorCanvas.height = size;
    const cctx = colorCanvas.getContext('2d');

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = size;
    roughCanvas.height = size;
    const rctx = roughCanvas.getContext('2d');

    // Dark gunmetal brushed-steel base
    cctx.fillStyle = '#4f5762';
    cctx.fillRect(0, 0, size, size);

    rctx.fillStyle = '#5e5e5e'; // ~0.37 roughness center
    rctx.fillRect(0, 0, size, size);

    // Directional micro-brushed horizontal steel grain
    for (let i = 0; i < 12000; i++) {
      const y = Math.random() * size;
      const x = Math.random() * size;
      const len = 40 + Math.random() * 200;
      const bright = Math.random() > 0.48;
      const alpha = 0.02 + Math.random() * 0.055;

      cctx.strokeStyle = bright ? `rgba(225, 232, 240, ${alpha})` : `rgba(18, 22, 28, ${alpha})`;
      cctx.lineWidth = 0.6 + Math.random() * 1.3;
      cctx.beginPath();
      cctx.moveTo(x, y);
      cctx.lineTo(x + len, y);
      cctx.stroke();

      rctx.strokeStyle = bright ? `rgba(220, 220, 220, ${alpha * 1.4})` : `rgba(40, 40, 40, ${alpha * 1.4})`;
      rctx.lineWidth = cctx.lineWidth;
      rctx.beginPath();
      rctx.moveTo(x, y);
      rctx.lineTo(x + len, y);
      rctx.stroke();

      if (x + len > size) {
        cctx.beginPath();
        cctx.moveTo(0, y);
        cctx.lineTo((x + len) - size, y);
        cctx.stroke();
      }
    }

    // Clean architectural machined deck plate seams (4x2 plate grid feel)
    const drawSeam = (ctx, x1, y1, x2, y2) => {
      ctx.strokeStyle = 'rgba(12, 15, 20, 0.72)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(185, 198, 214, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1 + 2, y1 + 2);
      ctx.lineTo(x2 + 2, y2 + 2);
      ctx.stroke();
    };

    for (const gx of [size * 0.25, size * 0.5, size * 0.75]) {
      drawSeam(cctx, gx, 0, gx, size);
    }
    drawSeam(cctx, 0, size * 0.5, size, size * 0.5);

    // Subtle surface grain
    const imgData = cctx.getImageData(0, 0, size, size);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 6;
      d[i] = Math.min(255, Math.max(0, d[i] + n));
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
    }
    cctx.putImageData(imgData, 0, 0);

    const colorTex = new THREE.CanvasTexture(colorCanvas);
    colorTex.encoding = THREE.sRGBEncoding;
    colorTex.anisotropy = 8;

    const roughTex = new THREE.CanvasTexture(roughCanvas);
    roughTex.anisotropy = 8;

    return { colorTex, roughTex };
  }

  /**
   * Generates a 3D rectangular deck with precision chamfered/beveled edges
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

    geom.rotateX(Math.PI / 2);
    geom.computeVertexNormals();
    geom.computeBoundingBox();

    const topY = geom.boundingBox.max.y;
    geom.translate(0, -topY, 0);
    geom.computeBoundingBox();

    return geom;
  }

  /**
   * Generates a high-contrast studio reflection map for metallic T-800s and brushed steel
   */
  _ensureStudioEnvironmentMap() {
    if (this.lobbyEnvMap) return this.lobbyEnvMap;

    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Deep industrial architectural ambient gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, '#1e2530');
    grad.addColorStop(0.28, '#2b3544');
    grad.addColorStop(0.50, '#181e27');
    grad.addColorStop(0.75, '#0e1217');
    grad.addColorStop(1.0, '#07090c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 512);

    // Overhead main industrial diffuser strip (drives crisp shoulder/crown highlights)
    const drawSoftbox = (x, y, w, h, innerColor, outerColor = 'rgba(255,255,255,0)') => {
      const g = ctx.createRadialGradient(
        x + w / 2, y + h / 2, Math.min(w, h) * 0.1,
        x + w / 2, y + h / 2, Math.max(w, h) * 0.6
      );
      g.addColorStop(0, innerColor);
      g.addColorStop(1, outerColor);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    };

    // Ceiling bright studio strip
    drawSoftbox(180, 14, 664, 110, 'rgba(248, 251, 255, 0.95)');
    // Left & right mid-horizon sculpting strips (crucial for metallic ribs, arms & skull contours)
    drawSoftbox(70, 155, 220, 185, 'rgba(220, 232, 248, 0.85)');
    drawSoftbox(734, 155, 220, 185, 'rgba(218, 228, 242, 0.80)');
    // Subtle restrained warm architectural reflection strip front-right
    drawSoftbox(420, 170, 184, 130, 'rgba(255, 238, 205, 0.62)');

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
        tex.dispose();
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
    const { width, depth, thickness } = this.platformBounds;
    const { colorTex, roughTex } = this._createBrushedMetalTextures();

    // -------------------------------------------------------------
    // 1. Brushed-Steel Floating Deck + Heavy Industrial Underframe
    // -------------------------------------------------------------
    const platformGeom = this._createBeveledPlatformGeometry(width, depth, thickness, 0.06, 0.06);
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0xb6bec8,
      map: colorTex,
      roughnessMap: roughTex,
      bumpMap: roughTex,
      bumpScale: 0.004,
      roughness: 0.36,
      metalness: 0.84,
      envMapIntensity: 1.55
    });

    this.platformMesh = new THREE.Mesh(platformGeom, platformMat);
    this.platformMesh.name = 'StagingLobby_MetallicPlatform';
    this.platformMesh.position.set(0, 0, 0);
    this.platformMesh.receiveShadow = true;
    this.platformMesh.castShadow = true;
    this.lobbyGroup.add(this.platformMesh);

    // Anodized gunmetal perimeter collar framing the brushed deck
    const collarMat = new THREE.MeshStandardMaterial({
      color: 0x1e232a,
      roughness: 0.42,
      metalness: 0.78,
      envMapIntensity: 1.2
    });
    const borderThick = 0.14;
    const collarH = 0.055;
    const frontCollar = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, collarH, borderThick), collarMat);
    frontCollar.position.set(0, -0.015, depth / 2 + borderThick / 2 - 0.05);
    const backCollar = frontCollar.clone();
    backCollar.position.z = -(depth / 2 + borderThick / 2 - 0.05);
    const leftCollar = new THREE.Mesh(new THREE.BoxGeometry(borderThick, collarH, depth + borderThick * 2 - 0.06), collarMat);
    leftCollar.position.set(-(width / 2 + borderThick / 2 - 0.05), -0.015, 0);
    const rightCollar = leftCollar.clone();
    rightCollar.position.x = (width / 2 + borderThick / 2 - 0.05);
    [frontCollar, backCollar, leftCollar, rightCollar].forEach(m => {
      m.receiveShadow = true;
      m.castShadow = true;
      this.lobbyGroup.add(m);
    });

    // Subtle restrained metallic accent strip recessed along front chamfer edge
    const edgeAccentMat = new THREE.MeshStandardMaterial({
      color: 0x8d7432,
      emissive: 0x3b2e10,
      emissiveIntensity: 0.65,
      roughness: 0.35,
      metalness: 0.85
    });
    const edgeAccent = new THREE.Mesh(new THREE.BoxGeometry(width - 1.2, 0.014, 0.02), edgeAccentMat);
    edgeAccent.position.set(0, -0.08, depth / 2 + 0.036);
    this.lobbyGroup.add(edgeAccent);

    // Stepped Heavy Industrial Sub-Chassis & Support Cross-Beams
    const subMat = new THREE.MeshStandardMaterial({
      color: 0x15181e,
      roughness: 0.56,
      metalness: 0.72,
      envMapIntensity: 0.9
    });
    const subGeom = new THREE.BoxGeometry(width - 0.45, 0.18, depth - 0.45);
    this.subChassisMesh = new THREE.Mesh(subGeom, subMat);
    this.subChassisMesh.name = 'StagingLobby_SubChassis';
    this.subChassisMesh.position.set(0, -thickness - 0.07, 0);
    this.subChassisMesh.receiveShadow = true;
    this.lobbyGroup.add(this.subChassisMesh);

    const lowerPlinth = new THREE.Mesh(
      new THREE.BoxGeometry(width - 1.2, 0.22, depth - 1.1),
      new THREE.MeshStandardMaterial({ color: 0x0f1217, roughness: 0.65, metalness: 0.65 })
    );
    lowerPlinth.position.set(0, -thickness - 0.25, 0);
    this.lobbyGroup.add(lowerPlinth);

    for (const bx of [-2.1, 0, 2.1]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, depth - 0.36), collarMat);
      rib.position.set(bx, -thickness - 0.14, 0);
      this.lobbyGroup.add(rib);
    }

    // -------------------------------------------------------------
    // 2. Overhead Architectural Light Rig (high above frame on desktop, subtle luminaire)
    // -------------------------------------------------------------
    const rigGroup = new THREE.Group();
    rigGroup.name = 'StagingLobby_OverheadRig';
    rigGroup.position.set(0, 3.65, -0.15);

    const beamMat = new THREE.MeshStandardMaterial({
      color: 0x161920,
      roughness: 0.5,
      metalness: 0.78
    });
    const gantryBeam = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.1, 0.24), beamMat);
    rigGroup.add(gantryBeam);

    const diffuserMat = new THREE.MeshStandardMaterial({
      color: 0xeaf0f8,
      emissive: 0xcfe0f2,
      emissiveIntensity: 1.15,
      roughness: 0.25
    });
    const diffuserBar = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.022, 0.12), diffuserMat);
    diffuserBar.position.set(0, -0.052, 0);
    rigGroup.add(diffuserBar);

    this.lobbyGroup.add(rigGroup);

    // -------------------------------------------------------------
    // 3. Engineered 3-Point & Overhead Conical Lighting
    // -------------------------------------------------------------
    // High-resolution overhead key spotlight positioned slightly behind midpoint
    // so specular floor bounce frames characters cleanly without glaring under the front UI
    const overheadSpot = new THREE.SpotLight(0xf6f9ff, 20.0, 18, Math.PI / 3.4, 0.7, 1.35);
    overheadSpot.name = 'StagingLobby_OverheadSpot';
    overheadSpot.position.set(0, 5.8, -0.25);
    overheadSpot.target.position.set(0, 0.45, 0.2);
    overheadSpot.castShadow = true;
    overheadSpot.shadow.mapSize.width = 2048;
    overheadSpot.shadow.mapSize.height = 2048;
    overheadSpot.shadow.camera.near = 1.5;
    overheadSpot.shadow.camera.far = 12.0;
    overheadSpot.shadow.bias = -0.0004;
    overheadSpot.shadow.normalBias = 0.02;
    this.lobbyGroup.add(overheadSpot.target);
    this.lobbyGroup.add(overheadSpot);
    this.lobbyLights.push(overheadSpot);

    // Overhead character-level fill so skull, shoulders, and chest actuators read crisply
    const overheadFill = new THREE.PointLight(0xf3f7ff, 5.0, 10, 1.4);
    overheadFill.name = 'StagingLobby_OverheadFill';
    overheadFill.position.set(0, 2.9, 1.15);
    this.lobbyGroup.add(overheadFill);
    this.lobbyLights.push(overheadFill);

    // Front sculptural key light illuminating character faces & chest endoskeleton
    const frontKey = new THREE.DirectionalLight(0xf4f7fc, 2.4);
    frontKey.position.set(0.35, 2.15, 4.8);
    frontKey.target.position.set(0, 1.0, 0.15);
    this.lobbyGroup.add(frontKey.target);
    this.lobbyGroup.add(frontKey);
    this.lobbyLights.push(frontKey);

    // Crisp left/right steel edge fills
    const leftEdge = new THREE.DirectionalLight(0xcfe0f5, 1.55);
    leftEdge.position.set(-4.2, 2.2, 2.4);
    leftEdge.target.position.set(-0.4, 1.0, 0.15);
    this.lobbyGroup.add(leftEdge.target);
    this.lobbyGroup.add(leftEdge);
    this.lobbyLights.push(leftEdge);

    const rightEdge = new THREE.DirectionalLight(0xf5ead2, 1.35);
    rightEdge.position.set(4.2, 2.2, 2.4);
    rightEdge.target.position.set(0.4, 1.0, 0.15);
    this.lobbyGroup.add(rightEdge.target);
    this.lobbyGroup.add(rightEdge);
    this.lobbyLights.push(rightEdge);

    // Backlight separation rim so dark metal shoulders/head pop sharply against dark space
    const rimBack = new THREE.DirectionalLight(0x8bb4e3, 2.2);
    rimBack.position.set(0, 3.2, -3.8);
    rimBack.target.position.set(0, 1.0, 0.15);
    this.lobbyGroup.add(rimBack.target);
    this.lobbyGroup.add(rimBack);
    this.lobbyLights.push(rimBack);

    // Controlled ambient hemisphere preventing pitch-black shadow crush
    const hemiLight = new THREE.HemisphereLight(0xc7d7ea, 0x161b22, 0.85);
    this.lobbyGroup.add(hemiLight);
    this.lobbyLights.push(hemiLight);

    // Subtle under-chassis edge separation glow
    const underGlow = new THREE.PointLight(0x415b76, 1.6, 8.5, 1.5);
    underGlow.position.set(0, -1.05, 0.3);
    this.lobbyGroup.add(underGlow);
    this.lobbyLights.push(underGlow);
  }

  _initUI() {
    this.overlayEl = document.getElementById('staging-lobby-overlay');
    if (!this.overlayEl) return;

    this.roomCodeEl = document.getElementById('staging-room-code');
    this.rosterEl = document.getElementById('staging-roster');
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

  getCollisionBox() {
    return this.collisionBox.clone();
  }

  getGroundHeightAt(x, z) {
    const { minX, maxX, minZ, maxZ, topY } = this.platformBounds;
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
      return topY;
    }
    return null;
  }

  isPointOnPlatform(x, z) {
    return this.getGroundHeightAt(x, z) !== null;
  }

  /**
   * Computes balanced desktop & mobile camera distance so players and platform
   * always remain framed inside the viewport without horizontal clipping.
   */
  updateCameraFraming() {
    if (!this.isActive || !this.camera) return;

    const aspect = Math.max(0.4, this.camera.aspect || (typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 1.6));
    const targetFov = aspect < 0.85 ? 54 : 48;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = targetFov;
      this.camera.updateProjectionMatrix();
    }

    const vFovRad = (this.camera.fov * Math.PI) / 180;
    const tanHalfV = Math.tan(vFovRad / 2);
    const halfSpanX = this.characterSlots.size >= 3 ? 2.45 : (this.characterSlots.size === 2 ? 1.65 : 1.15);
    const requiredDistForWidth = (halfSpanX * 1.18) / (tanHalfV * aspect);

    const baseZ = 5.95;
    const camZ = Math.max(baseZ, Math.min(8.6, requiredDistForWidth + 0.45));
    const camY = aspect < 0.85 ? 1.82 : 1.72;
    const lookY = aspect < 0.85 ? 0.82 : 0.82;

    this.camera.position.set(0, camY, camZ);
    this.camera.lookAt(0, lookY, 0.05);
  }

  enterLobby(roomCode, isLeader, myPlayerId) {
    this.isActive = true;
    this.roomCode = roomCode;
    this.myPlayerId = myPlayerId;
    this.isLeader = isLeader;
    this.localReady = isLeader;
    this._idleClock = 0;

    // Dark industrial void surrounding space
    this.savedBackground = this.scene.background;
    this.scene.background = new THREE.Color(0x080a0d);

    this.savedFog = this.scene.fog;
    this.scene.fog = new THREE.FogExp2(0x080a0d, 0.035);

    this.savedEnvironment = this.scene.environment;
    const envMap = this._ensureStudioEnvironmentMap();
    if (envMap) {
      this.scene.environment = envMap;
    }

    const renderer = this.getRenderer();
    if (renderer) {
      this.savedExposure = renderer.toneMappingExposure;
      renderer.toneMappingExposure = 1.08;
    }

    this.savedCameraFov = this.camera.fov;
    this.lobbyGroup.visible = true;
    this.updateCameraFraming();

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

    this._renderRoster(this.cachedPlayers);
    this._updateActionButton();
  }

  _updateActionButton() {
    if (!this.actionBtn) return;

    if (this.isLeader) {
      this.actionBtn.textContent = 'START';
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
      if (this.networkClient) {
        this.networkClient.requestMatchStart();
      }
    } else {
      this.localReady = !this.localReady;
      this._updateActionButton();
      if (this.networkClient) {
        this.networkClient.toggleReady(this.localReady);
      }
    }
  }

  handleLobbyStateUpdate(state) {
    if (!state || !this.isActive) return;

    if (state.roomCode) {
      this.roomCode = state.roomCode;
      if (this.roomCodeEl) {
        this.roomCodeEl.textContent = `ROOM: ${this.roomCode}`;
      }
    }

    if (state.leaderId) {
      const wasLeader = this.isLeader;
      this.isLeader = (state.leaderId === this.myPlayerId);
      if (wasLeader !== this.isLeader) {
        this._updateActionButton();
      }
    }

    if (this.statusMsgEl && this.statusMsgEl.style.display !== 'none') {
      this.statusMsgEl.style.display = 'none';
    }

    if (Array.isArray(state.players)) {
      this.cachedPlayers = state.players;
      this._syncPlayers(state.players);
      this._renderRoster(state.players);
      this.updateCameraFraming();

      const me = state.players.find(p => p.id === this.myPlayerId);
      if (me && !this.isLeader) {
        this.localReady = Boolean(me.isReady);
        this._updateActionButton();
      }
    }
  }

  _renderRoster(players) {
    if (!this.rosterEl) return;
    this.rosterEl.innerHTML = '';
    if (!Array.isArray(players) || players.length === 0) return;

    for (const p of players) {
      const chip = document.createElement('div');
      chip.className = p.isReady ? 'staging-player-chip ready' : 'staging-player-chip';
      chip.setAttribute('data-player-id', p.id || '');

      const dot = document.createElement('span');
      dot.className = 'staging-player-dot';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name || `Player_${p.id}`;

      const stateSpan = document.createElement('span');
      stateSpan.className = 'staging-player-state';
      stateSpan.textContent = p.isReady ? 'READY' : 'NOT READY';

      chip.appendChild(dot);
      chip.appendChild(nameSpan);
      chip.appendChild(stateSpan);
      this.rosterEl.appendChild(chip);
    }
  }

  handleMatchStartRejected(payload) {
    const reason = payload?.reason || 'Waiting for all players to ready up.';
    if (this.statusMsgEl) {
      this.statusMsgEl.textContent = reason;
      this.statusMsgEl.style.display = 'block';
    }
  }

  _alignModelFeetToOrigin(model) {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    model.position.y = -box.min.y;
  }

  /**
   * Clones materials for the lobby preview character so PBR steel highlights
   * read clearly under studio lighting without mutating shared Level 0 assets.
   */
  _prepareLobbyCharacterMesh(model) {
    model.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (!obj.material) return;

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const cloned = mats.map((m) => {
        const cm = m.clone();
        cm.envMapIntensity = 2.2;
        if (typeof cm.metalness === 'number' && cm.metalness > 0.4) {
          cm.roughness = Math.min(0.44, Math.max(0.22, cm.roughness || 0.34));
          if (cm.color) {
            // Prevent pitch-black metallic albedo collapse in shadow pockets
            const lum = cm.color.r * 0.299 + cm.color.g * 0.587 + cm.color.b * 0.114;
            if (lum < 0.28) {
              cm.color.lerp(new THREE.Color(0x6d7785), 0.55);
            }
          }
        }
        return cm;
      });
      obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
    });
  }

  _computeSlotTransform(index, count, player) {
    let x = 0;
    let facingOffset = 0;
    if (count === 2) {
      const isLeft = (player.slot === 0 || index === 0);
      x = isLeft ? -1.04 : 1.04;
      facingOffset = isLeft ? 0.16 : -0.16;
    } else if (count === 3) {
      const xs = [-1.75, 0.0, 1.75];
      x = xs[index] !== undefined ? xs[index] : 0;
      facingOffset = x < 0 ? 0.16 : (x > 0 ? -0.16 : 0);
    } else if (count > 3) {
      const span = 4.6;
      x = -span / 2 + (index / (count - 1)) * span;
      facingOffset = -x * 0.08;
    }
    return { x, z: 0.20, facingOffset };
  }

  _syncPlayers(players) {
    const currentIds = new Set(players.map(p => p.id));

    for (const [id, slot] of this.characterSlots) {
      if (!currentIds.has(id)) {
        if (slot.group && slot.group.parent) {
          slot.group.parent.remove(slot.group);
        }
        this.characterSlots.delete(id);
      }
    }

    const count = players.length;
    players.forEach((p, index) => {
      const { x, z, facingOffset } = this._computeSlotTransform(index, count, p);

      let slotObj = this.characterSlots.get(p.id);
      if (!slotObj) {
        slotObj = this._createCharacterSlot(p, x, z, facingOffset, index);
        this.characterSlots.set(p.id, slotObj);
      } else {
        slotObj.group.position.set(x, this.platformBounds.topY, z);
        slotObj.baseFacingY = facingOffset;
        slotObj.visualPivot.rotation.y = facingOffset;

        if (slotObj.isReady !== p.isReady || slotObj.name !== p.name) {
          slotObj.isReady = Boolean(p.isReady);
          slotObj.name = p.name;
          this._updateNameSprite(slotObj, p.name, p.isReady);
          this._updateStandPadState(slotObj);
        }
      }
    });
  }

  _createStandPad(isReady) {
    const padGroup = new THREE.Group();
    padGroup.name = 'StagingPlayerPad';

    // Machined circular steel floor plate
    const plateGeom = new THREE.CylinderGeometry(0.46, 0.49, 0.014, 32);
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x262c34,
      roughness: 0.34,
      metalness: 0.85,
      envMapIntensity: 1.4
    });
    const plate = new THREE.Mesh(plateGeom, plateMat);
    plate.position.y = 0.007;
    plate.receiveShadow = true;
    padGroup.add(plate);

    // Subtle status indicator ring (restrained green when ready, cool gunmetal when unready)
    const ringGeom = new THREE.RingGeometry(0.44, 0.468, 40);
    ringGeom.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: isReady ? 0x4ade80 : 0x5c6672,
      transparent: true,
      opacity: isReady ? 0.72 : 0.45
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.y = 0.0155;
    padGroup.add(ring);
    padGroup.userData.ringMat = ringMat;

    return padGroup;
  }

  _updateStandPadState(slotObj) {
    const ringMat = slotObj?.padGroup?.userData?.ringMat;
    if (!ringMat) return;
    ringMat.color.setHex(slotObj.isReady ? 0x4ade80 : 0x5c6672);
    ringMat.opacity = slotObj.isReady ? 0.72 : 0.45;
  }

  _createCharacterSlot(player, posX, posZ = 0.20, facingOffset = 0, index = 0) {
    const group = new THREE.Group();
    group.name = `StagingPlayer_${player.id}`;
    group.position.set(posX, this.platformBounds.topY, posZ);
    this.lobbyGroup.add(group);

    const padGroup = this._createStandPad(Boolean(player.isReady));
    group.add(padGroup);

    const visualPivot = new THREE.Group();
    visualPivot.rotation.y = facingOffset;
    group.add(visualPivot);

    let charMesh = null;
    if (this.t800Template) {
      charMesh = this.t800Template.clone(true);
      this._prepareLobbyCharacterMesh(charMesh);
      this._alignModelFeetToOrigin(charMesh);
      charMesh.position.y += 0.014; // Ground soles cleanly atop the 1.4cm machined pad
      visualPivot.add(charMesh);
    } else {
      charMesh = this._createFallbackFigure();
      this._alignModelFeetToOrigin(charMesh);
      charMesh.position.y += 0.014;
      visualPivot.add(charMesh);
    }

    const nameSprite = this._createNameSprite(player.name || `Player_${player.id}`, player.isReady);
    group.add(nameSprite);

    return {
      id: player.id,
      name: player.name || `Player_${player.id}`,
      isReady: Boolean(player.isReady),
      group,
      padGroup,
      visualPivot,
      mesh: charMesh,
      nameSprite,
      baseFacingY: facingOffset,
      phase: index * 1.4
    };
  }

  _refreshCharacterModels() {
    if (!this.t800Template) return;
    for (const [, slotObj] of this.characterSlots) {
      if (slotObj.mesh && slotObj.visualPivot) {
        slotObj.visualPivot.remove(slotObj.mesh);
        const clone = this.t800Template.clone(true);
        this._prepareLobbyCharacterMesh(clone);
        this._alignModelFeetToOrigin(clone);
        clone.position.y += 0.014;
        slotObj.visualPivot.add(clone);
        slotObj.mesh = clone;
      }
    }
  }

  _createNameSprite(name, isReady) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 160;
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
    sprite.scale.set(2.15, 0.54, 1);
    sprite.position.set(0, 2.08, 0);
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

    ctx.font = '600 40px "Rubik", -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Green names for ready players; crisp white names for unready players
    const textColor = isReady ? '#4ade80' : '#f4f3ee';
    const glowColor = isReady ? 'rgba(74, 222, 128, 0.55)' : 'rgba(0, 0, 0, 0.85)';

    ctx.shadowColor = glowColor;
    ctx.shadowBlur = isReady ? 10 : 6;
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
      metalness: 0.78
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.3), mat);
    body.position.y = 1.2;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.24), mat);
    head.position.y = 1.74;
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

  update(dt) {
    if (!this.isActive) return;
    this._idleClock += dt || 0;
    for (const slot of this.characterSlots.values()) {
      if (slot.visualPivot) {
        slot.visualPivot.rotation.y = (slot.baseFacingY || 0) + Math.sin(this._idleClock * 0.8 + (slot.phase || 0)) * 0.025;
        slot.visualPivot.position.y = Math.sin(this._idleClock * 1.6 + (slot.phase || 0)) * 0.004;
      }
    }
  }

  exitToGame() {
    this.leaveLobby();
    if (typeof this._onMatchStartedCallback === 'function') {
      this._onMatchStartedCallback();
    }
  }

  leaveLobby() {
    this.isActive = false;

    this.lobbyGroup.visible = false;
    for (const [, slotObj] of this.characterSlots) {
      if (slotObj.group && slotObj.group.parent) {
        slotObj.group.parent.remove(slotObj.group);
      }
    }
    this.characterSlots.clear();
    this.cachedPlayers = [];

    if (this.overlayEl) {
      this.overlayEl.style.display = 'none';
    }
    if (this.statusMsgEl) {
      this.statusMsgEl.style.display = 'none';
    }
    if (this.rosterEl) {
      this.rosterEl.innerHTML = '';
    }

    if (this.savedBackground !== undefined) {
      this.scene.background = this.savedBackground;
      this.savedBackground = undefined;
    }

    if (this.savedFog !== undefined) {
      this.scene.fog = this.savedFog;
      this.savedFog = undefined;
    }

    if (this.savedEnvironment !== undefined) {
      this.scene.environment = this.savedEnvironment;
      this.savedEnvironment = undefined;
    }

    if (this.camera && this.savedCameraFov !== undefined) {
      this.camera.fov = this.savedCameraFov;
      this.camera.updateProjectionMatrix();
      this.savedCameraFov = undefined;
    }

    const renderer = this.getRenderer();
    if (renderer && this.savedExposure !== undefined) {
      renderer.toneMappingExposure = this.savedExposure;
      this.savedExposure = undefined;
    }
  }

  destroy() {
    this.leaveLobby();
    if (this.lobbyGroup && this.lobbyGroup.parent) {
      this.scene.remove(this.lobbyGroup);
    }
  }
}
