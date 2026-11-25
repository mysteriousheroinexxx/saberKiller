// Local First-Person Player Controller for Multiplayer
// Handles input, camera orientation, wall collision via level0_env, viewmodel, survival resources, and 20Hz network updates

import { getItemDefinition } from './item_catalog.js';

export class LocalPlayerController {
  constructor(camera, scene, networkClient, collisionHandler) {
    this.camera = camera;
    this.scene = scene;
    this.networkClient = networkClient;
    this.collisionHandler = collisionHandler;
    this.saberManager = null;
    this.audioManager = null;
    this._stepDistAccum = 0.0;
    this._wasMoving = false;
    this._lastMoveMode = 'idle';

    this.pos = new THREE.Vector3(48.69, 0.0, -187.65);
    this.yaw = 0.0;
    this.pitch = 0.0;
    this.weapon = 0; // 0 = PISTOL, 1 = SHOTGUN, 2 = TORCH

    this.keys = {};
    this.mouseSensitivity = 0.0022;
    this.isPointerLocked = false;
    this.isEditorActive = false;

    this.bob = 0;
    this.speed = 5.2;
    this.sprintSpeed = 7.6;
    this.radius = 0.32;

    this.updateTimer = 0;
    this.updateInterval = 0.05; // 20Hz network update

    // Survival Mode Attributes (matches authentic Budget-Backrooms resource systems)
    this.hp = 100.0;
    this.maxHp = 100.0;
    this.stamina = 100.0;
    this.maxStamina = 100.0;
    this.battery = 100.0;
    this.maxBattery = 100.0;
    this.staminaDrainRate = 25.0; // Drain 25/s while sprinting
    this.staminaRegenRate = 20.0; // Regen 20/s while resting/walking
    this.isSprinting = false;
    this._staminaExhausted = false;

    // Weapon Inventory & Ammo (matches WEAPONS standard)
    // Starting run with tactical flashlight only: 0 starting firearm ammunition
    this.mag = { bullets: 0, shells: 0 };
    this.bullets = 0;
    this.shells = 0;
    this.reloadT = 0;
    this.reloadWeapon = -1;
    this.cool = 0;
    this.recoilKick = 0.0;
    this.isDead = false;
    this.isDowned = false;
    this.weapon = 2; // 0=pistol, 1=shotgun, 2=torch (Starts with tactical flashlight)
    this._discoveredWeapons = new Set();
    this.state = 'ACTIVE'; // 'ACTIVE', 'DOWNED', 'ELIMINATED'
    this.revivalsUsed = 0;
    this.cameraTargetY = 1.62;
    this.currentCameraY = 1.62;

    // Developer firing diagnostics (inspected under --dev-rendering)
    this.firingDiagnostics = {
      selectedWeapon: 'TORCH (2)',
      lastFiringInput: 'NONE',
      cooldown: '0.00s',
      magAmmo: 0,
      reserveAmmo: 0,
      reloadState: 'IDLE',
      lastRejectionReason: 'NONE'
    };

    // Viewmodels, held items, and flashlight
    this.gunGroup = new THREE.Group();
    this.camera.add(this.gunGroup);
    this.viewmodels = [null, null, null]; // [pistol, shotgun, torch]

    this.selectedHotbarSlot = 0;
    this.inventory = null;
    this.isInventoryOpen = false;
    this.speedBoostTimer = 0.0;
    this.speedMultiplier = 1.0;

    this.heldItemContainer = new THREE.Group();
    this.gunGroup.add(this.heldItemContainer);
    this.heldItemMesh = null;
    this.heldItemTypeId = null;
    this.activeThrowAnimations = [];

    // Tactical Flashlight for Torch (matches Story Mode spotlight setup)
    this.flashlight = new THREE.SpotLight(0xfffae0, 24.0, 38.0, Math.PI / 6.5, 0.45, 1.8);
    this.flashlight.position.set(0.24, -0.22, -0.45);
    this.flashlight.target.position.set(0.24, -0.22, -10);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlight.target);
    this.flashlight.visible = false;

    this._buildLocalViewmodels();
    this._bindEvents();
  }

  setCollisionHandler(ch) {
    this.collisionHandler = ch;
  }

  setSpawn(spawn) {
    if (!spawn) return;
    this.pos.set(spawn.x, spawn.y || 0.0, spawn.z);
    this.yaw = spawn.yaw || 0.0;
    this.pitch = spawn.pitch || 0.0;
    this.currentCameraY = (spawn.y || 0.0) + 1.62;
    this.camera.position.set(this.pos.x, this.currentCameraY, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  /**
   * Authoritative player teleportation for developer debugging and map exploration.
   * Immediately relocates player position, updates camera, and synchronizes authoritative
   * position state to server and remote peers.
   */
  teleport(x, y, z, yaw = null, pitch = null) {
    if (typeof x === 'number' && !isNaN(x)) this.pos.x = x;
    if (typeof y === 'number' && !isNaN(y)) this.pos.y = y;
    if (typeof z === 'number' && !isNaN(z)) this.pos.z = z;
    if (typeof yaw === 'number' && !isNaN(yaw)) this.yaw = yaw;
    if (typeof pitch === 'number' && !isNaN(pitch)) this.pitch = pitch;

    this.bob = 0;
    this.currentCameraY = (typeof y === 'number' && !isNaN(y)) ? y + 1.62 : ((this.pos.y || 0.0) + 1.62);
    if (this.camera) {
      this.camera.position.set(this.pos.x, this.currentCameraY, this.pos.z);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
    }

    if (this.networkClient && this.networkClient.isConnected) {
      this.networkClient.sendUpdate(
        +this.pos.x.toFixed(3),
        +this.pos.y.toFixed(3),
        +this.pos.z.toFixed(3),
        +this.yaw.toFixed(4),
        +this.pitch.toFixed(4),
        this.weapon ?? 2
      );
    }
  }

  setEditorActive(active) {
    this.isEditorActive = !!active;
    if (this.isEditorActive) {
      if (this.isPointerLocked) {
        try {
          document.exitPointerLock();
        } catch (e) {}
      }
      this.keys = {};
    }
  }

  setSaberManager(saberManager) {
    this.saberManager = saberManager;
  }

  setAudioManager(audioManager) {
    this.audioManager = audioManager;
  }

  _resetMovementAudio() {
    if (this._wasMoving && this.audioManager) {
      this.audioManager.stopEmitter('local');
    }
    this._wasMoving = false;
    this._lastMoveMode = 'idle';
    this._stepDistAccum = 0.0;
  }

  getWeaponWorldPosition() {
    const base = this.camera?.position || {
      x: this.pos.x,
      y: this.currentCameraY || ((this.pos.y || 0) + 1.62),
      z: this.pos.z
    };
    const cosY = Math.cos(this.yaw || 0);
    const sinY = Math.sin(this.yaw || 0);
    const cosP = Math.cos(this.pitch || 0);
    const sinP = Math.sin(this.pitch || 0);
    // Weapon muzzle offset in camera frame: +0.25 right, -0.18 down, -0.85 forward
    const rx = 0.25;
    const ry = -0.18 * cosP - (-0.85) * sinP;
    const rz = -0.18 * sinP + (-0.85) * cosP;
    return {
      x: (base.x || 0) + rx * cosY + rz * sinY,
      y: (base.y || 0) + ry,
      z: (base.z || 0) - rx * sinY + rz * cosY
    };
  }

  _extractSurfaceNormal(hit, rayDir) {
    let normal = null;
    if (hit.face && hit.face.normal) {
      if (hit.object.isInstancedMesh && typeof hit.instanceId === 'number') {
        const instM = new THREE.Matrix4();
        hit.object.getMatrixAt(hit.instanceId, instM);
        const normalM = new THREE.Matrix3().getNormalMatrix(
          new THREE.Matrix4().multiplyMatrices(hit.object.matrixWorld, instM)
        );
        normal = hit.face.normal.clone().applyMatrix3(normalM).normalize();
      } else {
        normal = hit.face.normal.clone()
          .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
          .normalize();
      }
      if (normal.dot(rayDir) > 0) {
        normal.negate();
      }
    } else {
      normal = rayDir.clone().negate().normalize();
    }
    return normal;
  }

  _performWeaponHitscan(weaponType) {
    const wallImpacts = [];
    const saberHitsByMonster = new Map();

    if (!this.camera) {
      return { wallImpacts, saberHitsByMonster, centerDir: { x: 0, y: 0, z: -1 } };
    }

    const hitboxes = this.saberManager ? this.saberManager.getHitboxes() : [];
    const wallTargets = (this.collisionHandler && typeof this.collisionHandler.getRaycastTargets === 'function')
      ? this.collisionHandler.getRaycastTargets()
      : [];
    const targets = wallTargets.concat(hitboxes);

    const isShotgun = (weaponType === 'SHOTGUN');
    const pellets = isShotgun ? 7 : 1;
    const spread = isShotgun ? 0.055 : 0.0;
    const maxRange = isShotgun ? 28.0 : 45.0;

    const raycaster = new THREE.Raycaster();
    raycaster.far = maxRange;

    const eyePos = new THREE.Vector3(this.pos.x, (this.currentCameraY || 1.62), this.pos.z);
    const baseDir = new THREE.Vector3();
    this.camera.getWorldDirection(baseDir);

    if (targets.length > 0) {
      for (let i = 0; i < pellets; i++) {
        const dir = baseDir.clone();
        if (i > 0 && spread > 0) {
          dir.x += (Math.random() - 0.5) * 2 * spread;
          dir.y += (Math.random() - 0.5) * 2 * spread;
          dir.z += (Math.random() - 0.5) * 2 * spread;
        }
        dir.normalize();
        raycaster.set(eyePos, dir);

        const hits = raycaster.intersectObjects(targets, false);
        if (hits.length === 0) continue;

        const h = hits[0];
        if (h.object.userData?.isMonster) {
          const targetMonsterId = h.object.userData.monsterId;
          const saber = h.object.userData.saber;
          if (!targetMonsterId) continue;

          // Refine impact point & normal onto Saber's rendered body mesh when available
          let bodyHit = h;
          if (saber && saber.isModelLoaded && saber.visualGroup) {
            const bodyIntersects = raycaster.intersectObject(saber.visualGroup, true);
            if (bodyIntersects.length > 0) {
              bodyHit = bodyIntersects[0];
            }
          }

          const hitNorm = this._extractSurfaceNormal(bodyHit, dir);
          const saberBaseY = saber ? (saber.group.position.y || 0) : 0;
          const isHeadshot = bodyHit.point.y > (saberBaseY + 1.45);

          if (!saberHitsByMonster.has(targetMonsterId)) {
            saberHitsByMonster.set(targetMonsterId, []);
          }
          saberHitsByMonster.get(targetMonsterId).push({
            kind: 'saber',
            monsterId: targetMonsterId,
            weaponType: isShotgun ? 'shotgun' : 'pistol',
            point: { x: bodyHit.point.x, y: bodyHit.point.y, z: bodyHit.point.z },
            normal: { x: hitNorm.x, y: hitNorm.y, z: hitNorm.z },
            isHeadshot
          });
        } else {
          const wallNormal = this._extractSurfaceNormal(h, dir);
          wallImpacts.push({
            kind: 'wall',
            weaponType: isShotgun ? 'shotgun' : 'pistol',
            point: { x: h.point.x, y: h.point.y, z: h.point.z },
            normal: { x: wallNormal.x, y: wallNormal.y, z: wallNormal.z }
          });
        }
      }
    }

    const centerDir = { x: baseDir.x, y: baseDir.y, z: baseDir.z };
    const origin = { x: this.pos.x, y: this.pos.y, z: this.pos.z };
    const dmg = isShotgun ? 100 : 50;

    if (this.networkClient && this.networkClient.isConnected) {
      // Server-synchronized path: broadcast PROJECTILE_IMPACT once per shot/hit so all clients match with zero duplicates
      this.networkClient.fireWeapon(weaponType, origin, centerDir, { impacts: wallImpacts });
      for (const [monsterId, saberImpacts] of saberHitsByMonster) {
        this.networkClient.attackMonster(monsterId, dmg, weaponType, { impacts: saberImpacts });
      }
    } else if (this.saberManager && typeof this.saberManager.handleProjectileImpact === 'function') {
      // Offline preview fallback
      const allImpacts = [...wallImpacts];
      for (const impacts of saberHitsByMonster.values()) {
        allImpacts.push(...impacts);
      }
      if (allImpacts.length > 0) {
        this.saberManager.handleProjectileImpact({ weaponType, impacts: allImpacts });
      }
    }

    return { wallImpacts, saberHitsByMonster, centerDir };
  }

  _buildLocalViewmodels() {
    this.gunGroup.position.set(0.34, -0.32, -0.62);
    const loader = new THREE.GLTFLoader();

    // 1. Pistol (Beretta Px4 Storm)
    loader.load('assets/beretta_px4_storm_compact.glb', (gltf) => {
      const mesh = gltf.scene;
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const s = 0.36 / (Math.max(size.x, size.y, size.z) || 1);

      mesh.position.set(-center.x, -center.y + 2.5, -center.z);
      mesh.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material) {
            o.material.roughness = 0.38;
            o.material.metalness = 0.65;
          }
        }
      });
      const wrap = new THREE.Group();
      wrap.add(mesh);
      wrap.rotation.set(0, Math.PI, 0);
      wrap.scale.setScalar(s);
      wrap.position.set(0, 0.02, -0.16);
      this.gunGroup.add(wrap);
      this.viewmodels[0] = wrap;
      this._updateViewmodelVisibility();
    }, undefined, () => {
      const dark = new THREE.MeshBasicMaterial({ color: 0x333338 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.3), dark);
      b.position.set(0, 0, -0.15);
      this.gunGroup.add(b);
      this.viewmodels[0] = b;
    });

    // 2. Shotgun (Stagecoach)
    loader.load('assets/stagecoach_shotgun.glb', (gltf) => {
      const mesh = gltf.scene;
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      // Authentic 0.65m coach gun length matching single-player engine
      const s = 0.65 / (Math.max(size.x, size.y, size.z) || 1);

      mesh.position.set(-center.x, -center.y + 0.02, -center.z + 0.12);
      mesh.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material) {
            if (o.name && o.name.includes('Stock')) {
              o.material.roughness = 0.48;
              o.material.metalness = 0.15;
            } else {
              o.material.roughness = 0.32;
              o.material.metalness = 0.75;
            }
          }
        }
      });
      const wrap = new THREE.Group();
      wrap.add(mesh);
      // Barrels already face forward along -Z in stagecoach_shotgun.glb: orientation is (0, 0, 0)
      wrap.rotation.set(0, 0, 0);
      wrap.scale.setScalar(s);
      wrap.position.set(0, -0.04, -0.10);
      this.gunGroup.add(wrap);
      this.viewmodels[1] = wrap;
      this._updateViewmodelVisibility();
    });

    // 3. Torch / Tactical Flashlight
    loader.load('assets/torch.glb', (gltf) => {
      const mesh = gltf.scene;
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const s = 0.32 / (Math.max(size.x, size.y, size.z) || 1);

      mesh.position.set(-center.x, -center.y, -center.z);
      mesh.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material) {
            o.material.roughness = 0.42;
            o.material.metalness = 0.68;
          }
        }
      });
      const wrap = new THREE.Group();
      wrap.add(mesh);
      // Orient torch so front lens points forward along -Z with natural tactical grip tilt
      wrap.rotation.set(0.08, -Math.PI / 2, 0.04);
      wrap.scale.setScalar(s);
      wrap.position.set(0.04, -0.05, -0.16);
      this.gunGroup.add(wrap);
      this.viewmodels[2] = wrap;
      this._updateViewmodelVisibility();
    });

    // Muzzle Flash PointLight & Billboard Sprite
    this.muzzleLight = new THREE.PointLight(0xffb040, 0, 11, 2);
    this.muzzleLight.name = 'MP_LocalPlayerMuzzleLight';
    this.camera.add(this.muzzleLight);
    this.muzzleLight.position.set(0.25, -0.18, -0.92);

    const flashCanvas = document.createElement('canvas');
    flashCanvas.width = 64;
    flashCanvas.height = 64;
    const fCtx = flashCanvas.getContext('2d');
    const fGrad = fCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    fGrad.addColorStop(0, 'rgba(255, 255, 240, 1.0)');
    fGrad.addColorStop(0.25, 'rgba(255, 200, 60, 0.9)');
    fGrad.addColorStop(0.55, 'rgba(255, 100, 20, 0.5)');
    fGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    fCtx.fillStyle = fGrad;
    fCtx.fillRect(0, 0, 64, 64);
    const flashTex = new THREE.CanvasTexture(flashCanvas);

    this.muzzleSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true
    }));
    this.muzzleSprite.name = 'MP_LocalPlayerMuzzleSprite';
    this.muzzleSprite.scale.set(0.55, 0.55, 1);
    this.muzzleSprite.visible = false;
    this.muzzleSprite.raycast = () => {}; // Ephemeral billboard flash; bypass Raycaster camera requirement
    this.gunGroup.add(this.muzzleSprite);
    this._muzzleTimer = null;
  }

  _triggerMuzzleFlash(weaponIdx) {
    if (!this.muzzleSprite || !this.muzzleLight) return;
    if (weaponIdx === 0) { // Pistol
      this.muzzleSprite.position.set(0, 0.08, -0.36);
      this.muzzleLight.position.set(0.25, -0.18, -0.92);
      this.muzzleLight.intensity = 3.2;
    } else if (weaponIdx === 1) { // Shotgun
      this.muzzleSprite.position.set(0, 0.02, -0.44);
      this.muzzleLight.position.set(0.25, -0.24, -1.02);
      this.muzzleLight.intensity = 4.2;
    }
    this.muzzleSprite.material.rotation = Math.random() * Math.PI * 2;
    this.muzzleSprite.visible = true;

    if (this._muzzleTimer) clearTimeout(this._muzzleTimer);
    this._muzzleTimer = setTimeout(() => {
      if (this.muzzleSprite) this.muzzleSprite.visible = false;
      if (this.muzzleLight) this.muzzleLight.intensity = 0;
      this._muzzleTimer = null;
    }, 45);
  }

  _updateViewmodelVisibility() {
    for (let i = 0; i < 3; i++) {
      if (this.viewmodels[i]) {
        this.viewmodels[i].visible = (this.weapon === i);
      }
    }
    if (this.flashlight) {
      this.flashlight.visible = (this.weapon === 2);
    }
    if (this.heldItemContainer) {
      this.heldItemContainer.visible = (this.weapon === -1 && this.heldItemMesh !== null);
    }
    this._notifyStateChange();
  }

  _notifyStateChange() {
    if (window.survivalHUD && typeof window.survivalHUD.updatePlayer === 'function') {
      window.survivalHUD.updatePlayer(this);
    }
  }

  setWeapon(idx) {
    if (idx < 0 || idx > 2) return;
    if (this.weapon === idx) {
      this._updateViewmodelVisibility();
      return;
    }
    this.weapon = idx;
    this.reloadT = 0;
    this.reloadWeapon = -1;
    if (this.audioManager && typeof this.audioManager.stopEmitterWeaponReload === 'function') {
      this.audioManager.stopEmitterWeaponReload('local');
    }
    this._updateViewmodelVisibility();
  }

  selectHotbarSlot(idx) {
    if (idx < 0 || idx > 9) return;
    this._checkWeaponDiscovery();
    this.selectedHotbarSlot = idx;

    const slotItem = this.inventory ? this.inventory.getItem(idx) : null;
    if (slotItem) {
      if (slotItem.typeId === 'weapon_pistol') {
        this._clearHeldItem();
        this.setWeapon(0);
      } else if (slotItem.typeId === 'weapon_shotgun') {
        this._clearHeldItem();
        this.setWeapon(1);
      } else if (slotItem.typeId === 'equipment_torch') {
        this._clearHeldItem();
        this.setWeapon(2);
      } else {
        // Consumable or other world item
        this.weapon = -1;
        this._updateViewmodelVisibility();
        this._setHeldItem(slotItem.typeId);
      }
    } else {
      // Empty slot (unarmed)
      this.weapon = -1;
      this._updateViewmodelVisibility();
      this._clearHeldItem();
    }

    if (window.inventoryUI) {
      window.inventoryUI.setSelectedSlot(idx);
    }
  }

  _clearHeldItem() {
    if (this.heldItemContainer) {
      this.heldItemContainer.clear();
    }
    this.heldItemMesh = null;
    this.heldItemTypeId = null;
  }

  _setHeldItem(typeId) {
    if (this.heldItemTypeId === typeId && this.heldItemMesh) {
      if (this.heldItemContainer) this.heldItemContainer.visible = true;
      return;
    }
    this._clearHeldItem();
    this.heldItemTypeId = typeId;
    const def = getItemDefinition(typeId);
    if (!def || !def.modelUrl) return;

    // Use preloaded template from itemManager for instant zero-latency viewmodel creation
    if (window.itemManager && window.itemManager.templates && window.itemManager.templates.has(def.modelUrl)) {
      const template = window.itemManager.templates.get(def.modelUrl);
      const mesh = template.clone(true);
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const s = 0.16 / maxDim;

      mesh.position.set(-center.x, -center.y, -center.z);
      mesh.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      const wrap = new THREE.Group();
      wrap.add(mesh);
      wrap.scale.setScalar(s);
      wrap.position.set(0.04, -0.06, -0.16);
      wrap.rotation.set(0.2, -0.4, 0.1);

      this.heldItemContainer.add(wrap);
      this.heldItemMesh = wrap;
      this._updateViewmodelVisibility();
      return;
    }

    const loader = new THREE.GLTFLoader();
    loader.load(def.modelUrl, (gltf) => {
      if (this.heldItemTypeId !== typeId) return;
      const mesh = gltf.scene;
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const s = 0.16 / maxDim;

      mesh.position.set(-center.x, -center.y, -center.z);
      mesh.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      const wrap = new THREE.Group();
      wrap.add(mesh);
      wrap.scale.setScalar(s);
      wrap.position.set(0.04, -0.06, -0.16);
      wrap.rotation.set(0.2, -0.4, 0.1);

      this.heldItemContainer.add(wrap);
      this.heldItemMesh = wrap;
      this._updateViewmodelVisibility();
    });
  }

  consumeHeldItem() {
    if (this.isEditorActive || this.isInventoryOpen) return;
    if (this.selectedHotbarSlot < 0 || this.selectedHotbarSlot > 9) return;
    const item = this.inventory ? this.inventory.getItem(this.selectedHotbarSlot) : null;
    if (!item) return;

    const def = getItemDefinition(item.typeId);
    if (!def || !def.consumable) return;

    if (this.networkClient) {
      this.networkClient.requestItemUse(this.selectedHotbarSlot, item.instanceId);
    }
  }

  dropHeldItem() {
    if (this.isEditorActive || this.isInventoryOpen) return;
    if (this.selectedHotbarSlot < 0 || this.selectedHotbarSlot > 9) return;
    const item = this.inventory ? this.inventory.getItem(this.selectedHotbarSlot) : null;
    if (!item) return;

    const def = getItemDefinition(item.typeId);
    if (!def || def.droppable === false) return;

    if (this.networkClient) {
      this.networkClient.requestItemDrop(this.selectedHotbarSlot, item.instanceId, 1, this.pos, this.yaw);
    }
  }

  applyItemEffect(effect) {
    if (!effect) return;
    if (typeof effect.healAmount === 'number') {
      this.heal(effect.healAmount);
    }
    if (typeof effect.sanityRestore === 'number' && effect.sanityRestore > 0 && window.sanityController) {
      window.sanityController.restoreSanity(effect.sanityRestore);
    }
    if (typeof effect.batteryCharge === 'number') {
      this.battery = Math.min(this.maxBattery, this.battery + effect.batteryCharge);
    }
    if (typeof effect.rounds === 'number') {
      if (effect.ammoKey === 'shells' || effect.ammoType === 'shells' || effect.weapon === 'shotgun') {
        this.shells = Math.min(12, (this.shells || 0) + effect.rounds);
      } else {
        this.bullets = Math.min(48, (this.bullets || 0) + effect.rounds);
      }
      this._notifyStateChange();
    }
    if (effect.restoreFullStamina || (typeof effect.staminaBoost === 'number' && effect.staminaBoost >= this.maxStamina)) {
      this.stamina = this.maxStamina;
      this._staminaExhausted = false;
    } else if (typeof effect.staminaBoost === 'number' && effect.staminaBoost > 0) {
      this.stamina = Math.min(this.maxStamina, this.stamina + effect.staminaBoost);
      this._staminaExhausted = false;
    }
    if (typeof effect.speedMultiplier === 'number' && effect.speedMultiplier >= 1.0) {
      // Assign non-stacking speed multiplier and refresh temporary duration
      this.speedMultiplier = effect.speedMultiplier;
      const dur = (typeof effect.durationSeconds === 'number' && effect.durationSeconds > 0)
        ? effect.durationSeconds
        : 15;
      this.speedBoostTimer = dur;
    }
  }

  applyServerSpeedBoost(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (!payload.active) {
      this.speedMultiplier = 1.0;
      this.speedBoostTimer = 0.0;
      return;
    }
    if (typeof payload.speedMultiplier === 'number' && payload.speedMultiplier >= 1.0) {
      this.speedMultiplier = payload.speedMultiplier;
    }
    if (typeof payload.remainingSeconds === 'number' && payload.remainingSeconds > 0) {
      this.speedBoostTimer = payload.remainingSeconds;
    }
  }

  getEffectiveMoveSpeed() {
    return (this.isSprinting ? this.sprintSpeed : this.speed) * this.speedMultiplier;
  }

  onItemUseAccepted(payload) {
    if (!payload) return;
    const { slotIndex, itemType, remainingQuantity } = payload;

    // After successful Almond Water consumption, play can-throw animation
    if (itemType === 'almond_can') {
      this.playCanThrowAnimation();
    }

    // Immediately update hand if the consumed slot was currently equipped
    if (this.selectedHotbarSlot === slotIndex) {
      if (typeof remainingQuantity === 'number' && remainingQuantity <= 0) {
        this._clearHeldItem();
      }
    }
  }

  onItemUseRejected(payload) {
    console.warn('[PlayerController] Item use rejected by server:', payload?.reason);
    this._updateViewmodelVisibility();
  }

  refreshHeldItem() {
    this._checkWeaponDiscovery();
    if (this.selectedHotbarSlot >= 0 && this.selectedHotbarSlot <= 9) {
      this.selectHotbarSlot(this.selectedHotbarSlot);
    }
  }

  _checkWeaponDiscovery() {
    if (!this.inventory) return;
    const slots = this.inventory.getSlots();
    let hasPistol = false;
    let hasShotgun = false;
    for (const s of slots) {
      if (s) {
        if (s.typeId === 'weapon_pistol') hasPistol = true;
        else if (s.typeId === 'weapon_shotgun') hasShotgun = true;
      }
    }
    let stateChanged = false;
    if (hasPistol && !this._discoveredWeapons.has('weapon_pistol')) {
      this._discoveredWeapons.add('weapon_pistol');
      this.mag.bullets = 12;
      // Fixed Ammunition Economy: Do NOT generate additional reserve ammunition on discovery
      stateChanged = true;
    }
    if (hasShotgun && !this._discoveredWeapons.has('weapon_shotgun')) {
      this._discoveredWeapons.add('weapon_shotgun');
      this.mag.shells = 6;
      // Fixed Ammunition Economy: Do NOT generate additional reserve ammunition on discovery
      stateChanged = true;
    }
    if (stateChanged) {
      this._notifyStateChange();
    }
  }

  addReserveAmmo(ammoType, rounds = 2) {
    if (ammoType === 'bullets' || ammoType === 'pistol_ammo' || ammoType === 'weapon_pistol') {
      this.bullets = Math.min(48, (this.bullets || 0) + rounds);
      this._notifyStateChange();
      return this.bullets;
    } else if (ammoType === 'shells' || ammoType === 'shotgun_ammo' || ammoType === 'weapon_shotgun') {
      this.shells = Math.min(12, (this.shells || 0) + rounds);
      this._notifyStateChange();
      return this.shells;
    }
    return 0;
  }

  playCanThrowAnimation() {
    if (!this.scene) return;

    let throwMesh = null;
    if (this.heldItemMesh) {
      throwMesh = this.heldItemMesh.clone(true);
    } else {
      const canGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.12, 16);
      const canMat = new THREE.MeshStandardMaterial({ color: 0xd4a373, roughness: 0.4, metalness: 0.6 });
      throwMesh = new THREE.Mesh(canGeo, canMat);
    }

    const startPos = new THREE.Vector3();
    if (this.heldItemContainer) {
      this.heldItemContainer.getWorldPosition(startPos);
    } else {
      this.camera.getWorldPosition(startPos);
      startPos.y -= 0.15;
    }

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const horizForward = new THREE.Vector3(forward.x, 0, forward.z).normalize();
    if (horizForward.lengthSq() < 0.001) horizForward.set(0, 0, -1);

    const startRot = new THREE.Euler().copy(this.camera.rotation);

    throwMesh.position.copy(startPos);
    throwMesh.rotation.copy(startRot);
    this.scene.add(throwMesh);

    const anim = {
      mesh: throwMesh,
      startPos: startPos.clone(),
      forward: horizForward.clone(),
      startRot: startRot.clone(),
      elapsed: 0,
      duration: 0.75
    };

    if (!this.activeThrowAnimations) this.activeThrowAnimations = [];
    this.activeThrowAnimations.push(anim);
  }

  _updateThrowAnimations(dt) {
    if (!this.activeThrowAnimations || this.activeThrowAnimations.length === 0) return;

    for (let i = this.activeThrowAnimations.length - 1; i >= 0; i--) {
      const anim = this.activeThrowAnimations[i];
      anim.elapsed += dt;
      const progress = Math.min(1.0, anim.elapsed / anim.duration);

      const forwardDist = 1.1 * progress;
      anim.mesh.position.x = anim.startPos.x + anim.forward.x * forwardDist;
      anim.mesh.position.z = anim.startPos.z + anim.forward.z * forwardDist;

      const floorY = 0.03;
      const dropY = anim.startPos.y - (0.85 * (progress * progress));
      anim.mesh.position.y = Math.max(floorY, dropY);

      anim.mesh.rotation.x = anim.startRot.x + (1.05 * progress);
      anim.mesh.rotation.z = anim.startRot.z + (0.55 * progress);

      if (progress >= 1.0) {
        if (anim.mesh.parent) anim.mesh.parent.remove(anim.mesh);
        anim.mesh.traverse(o => {
          if (o.geometry) o.geometry.dispose?.();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
            else o.material.dispose?.();
          }
        });
        this.activeThrowAnimations.splice(i, 1);
      }
    }
  }

  getFiringDiagnostics() {
    return { ...this.firingDiagnostics };
  }

  fire() {
    this.firingDiagnostics.lastFiringInput = 'LMB at ' + new Date().toTimeString().split(' ')[0];

    if (window.mpManager && window.mpManager.isInStagingLobby) {
      this.firingDiagnostics.lastRejectionReason = 'STAGING_LOBBY';
      return false;
    }
    if (this.isEditorActive) {
      this.firingDiagnostics.lastRejectionReason = 'EDITOR_ACTIVE';
      return false;
    }
    if (this.isInventoryOpen) {
      this.firingDiagnostics.lastRejectionReason = 'INVENTORY_OPEN';
      return false;
    }
    if (this.isDowned || this.isDead || this.hp <= 0 || (this.state && this.state !== 'ACTIVE')) {
      this.firingDiagnostics.lastRejectionReason = 'PLAYER_DOWNED_OR_ELIMINATED';
      return false;
    }
    if (this.reloadT > 0) {
      this.firingDiagnostics.lastRejectionReason = `RELOAD_IN_PROGRESS (${this.reloadT.toFixed(2)}s)`;
      return false;
    }
    if (this.cool > 0) {
      this.firingDiagnostics.lastRejectionReason = `COOLDOWN_ACTIVE (${this.cool.toFixed(2)}s)`;
      return false;
    }

    if (this.weapon === 0) { // PISTOL (Beretta Px4)
      if (this.mag.bullets <= 0) {
        if (this.bullets > 0) {
          this.startReload();
          this.firingDiagnostics.lastRejectionReason = 'MAGAZINE_EMPTY_RELOADING';
        } else {
          this.firingDiagnostics.lastRejectionReason = 'OUT_OF_AMMO';
        }
        return false;
      }

      this.mag.bullets = Math.max(0, this.mag.bullets - 1);
      this.cool = 0.21;
      this.recoilKick = 0.04;
      this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch + 0.016));
      this._triggerMuzzleFlash(0);

      this._performWeaponHitscan('PISTOL');

      if (this.audioManager && typeof this.audioManager.playWeaponFire === 'function') {
        const attachTarget = () => this.getWeaponWorldPosition();
        this.audioManager.playWeaponFire('local', 'weapon_pistol_fire', {
          positional: true,
          position: attachTarget(),
          attachTarget
        });
      }

      this.firingDiagnostics.lastRejectionReason = 'NONE';

      if (this.mag.bullets === 0 && this.bullets > 0) {
        this.startReload();
      }
      this._notifyStateChange();
      return true;
    } else if (this.weapon === 1) { // SHOTGUN (Stagecoach Coach Gun)
      if (this.mag.shells <= 0) {
        if (this.shells > 0) {
          this.startReload();
          this.firingDiagnostics.lastRejectionReason = 'MAGAZINE_EMPTY_RELOADING';
        } else {
          this.firingDiagnostics.lastRejectionReason = 'OUT_OF_AMMO';
        }
        return false;
      }

      this.mag.shells = Math.max(0, this.mag.shells - 1);
      this.cool = 0.95;
      this.recoilKick = 0.09;
      this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch + 0.038));
      this._triggerMuzzleFlash(1);

      this._performWeaponHitscan('SHOTGUN');

      this.firingDiagnostics.lastRejectionReason = 'NONE';

      if (this.mag.shells === 0 && this.shells > 0) {
        this.startReload();
      }
      this._notifyStateChange();
      return true;
    } else if (this.weapon === 2) { // TORCH
      this.cool = 0.3;
      this.firingDiagnostics.lastRejectionReason = 'NONE';
      this._notifyStateChange();
      return true;
    } else {
      this.firingDiagnostics.lastRejectionReason = 'NO_WEAPON_EQUIPPED';
      return false;
    }
  }

  startReload() {
    if (window.mpManager && window.mpManager.isInStagingLobby) {
      this.firingDiagnostics.lastRejectionReason = 'STAGING_LOBBY';
      return false;
    }
    if (this.isEditorActive) {
      this.firingDiagnostics.lastRejectionReason = 'EDITOR_ACTIVE';
      return false;
    }
    if (this.isInventoryOpen) {
      this.firingDiagnostics.lastRejectionReason = 'INVENTORY_OPEN';
      return false;
    }
    if (this.isDowned || this.isDead || this.hp <= 0 || (this.state && this.state !== 'ACTIVE')) {
      this.firingDiagnostics.lastRejectionReason = 'PLAYER_DOWNED_OR_ELIMINATED';
      return false;
    }
    if (this.reloadT > 0) {
      this.firingDiagnostics.lastRejectionReason = `RELOAD_ALREADY_IN_PROGRESS (${this.reloadT.toFixed(2)}s)`;
      return false;
    }

    if (this.weapon === 0) {
      const needed = 12 - this.mag.bullets;
      if (needed <= 0) {
        this.firingDiagnostics.lastRejectionReason = 'MAGAZINE_ALREADY_FULL';
        return false;
      }
      if (this.bullets <= 0) {
        this.firingDiagnostics.lastRejectionReason = 'NO_RESERVE_AMMO';
        return false;
      }
      this.reloadT = 1.15;
      this.reloadWeapon = 0;
      this.firingDiagnostics.lastRejectionReason = 'NONE';
      this._triggerReloadAudio('PISTOL');
      this._notifyStateChange();
      return true;
    } else if (this.weapon === 1) {
      const needed = 6 - this.mag.shells;
      if (needed <= 0) {
        this.firingDiagnostics.lastRejectionReason = 'MAGAZINE_ALREADY_FULL';
        return false;
      }
      if (this.shells <= 0) {
        this.firingDiagnostics.lastRejectionReason = 'NO_RESERVE_AMMO';
        return false;
      }
      this.reloadT = 1.6;
      this.reloadWeapon = 1;
      this.firingDiagnostics.lastRejectionReason = 'NONE';
      this._triggerReloadAudio('SHOTGUN');
      this._notifyStateChange();
      return true;
    }
    return false;
  }

  _triggerReloadAudio(weaponType = 'PISTOL') {
    const weaponPos = this.getWeaponWorldPosition();
    if (this.audioManager && typeof this.audioManager.playWeaponReload === 'function') {
      const attachTarget = () => this.getWeaponWorldPosition();
      this.audioManager.playWeaponReload('local', {
        weaponType,
        positional: true,
        position: weaponPos,
        attachTarget
      });
    }
    if (this.networkClient && this.networkClient.isConnected && typeof this.networkClient.reloadWeapon === 'function') {
      this.networkClient.reloadWeapon(weaponType, weaponPos);
    }
  }

  _finishReload() {
    if (this.reloadWeapon === 0) {
      const needed = Math.max(0, 12 - this.mag.bullets);
      const loaded = Math.min(needed, Math.max(0, this.bullets));
      this.bullets -= loaded;
      this.mag.bullets += loaded;
    } else if (this.reloadWeapon === 1) {
      const needed = Math.max(0, 6 - this.mag.shells);
      const loaded = Math.min(needed, Math.max(0, this.shells));
      this.shells -= loaded;
      this.mag.shells += loaded;
    }
    this.reloadWeapon = -1;
    this._notifyStateChange();
  }

  setState(state, revivalsUsed = null) {
    this.state = state;
    if (state === 'DOWNED') {
      this.isDowned = true;
      this.isDead = false;
      this.cameraTargetY = 0.42;
      this._resetMovementAudio();
      this.audioManager?.stopEmitterWeaponReload?.('local');
    } else if (state === 'ELIMINATED') {
      this.isDead = true;
      this.isDowned = false;
      this.cameraTargetY = 0.25;
      this._resetMovementAudio();
      this.audioManager?.stopEmitterWeaponReload?.('local');
    } else if (state === 'ACTIVE') {
      this.isDowned = false;
      this.isDead = false;
      this.cameraTargetY = 1.62;
    }
    if (typeof revivalsUsed === 'number') {
      this.revivalsUsed = revivalsUsed;
    }
  }

  resetCombatState() {
    this.setState('ACTIVE', 0);
    this._resetMovementAudio();
    this.setHp(100);
    this.camera.position.y = 1.62;
    this.currentCameraY = 1.62;
    this.cameraTargetY = 1.62;
    this.stamina = 100.0;
    this._staminaExhausted = false;
    this.speedMultiplier = 1.0;
    this.speedBoostTimer = 0.0;
    this.activeEffects = [];
    this.isCrawling = false;
    this.isSprinting = false;
    this.weapon = 2; // Torch / Tactical Flashlight in slot 0 (0 is pistol, 1 is shotgun, 2 is torch)
    this._discoveredWeapons.clear();
    this.mag = { bullets: 0, shells: 0 };
    this.bullets = 0;
    this.shells = 0;
    this.ammo = 0;
    this.reserveAmmo = 0;
    this.reloadT = 0;
    this.reloadWeapon = -1;
    this._clearHeldItem();
    this._updateViewmodelVisibility();
  }

  get discoveredWeapons() {
    return this._discoveredWeapons;
  }

  get health() {
    return this.hp;
  }

  setHp(hp) {
    this.hp = Math.max(0, Math.min(this.maxHp, hp));
  }

  damage(amount, reason = 'DEV_TEST') {
    if (this.networkClient && this.networkClient.isConnected) {
      this.networkClient.requestDamage(amount, reason);
    } else {
      this.setHp(this.hp - amount);
    }
  }

  heal(amount) {
    this.setHp(this.hp + amount);
  }

  setStamina(val) {
    this.stamina = Math.max(0, Math.min(this.maxStamina, val));
    if (this.stamina >= 20.0) this._staminaExhausted = false;
  }

  setBattery(val) {
    this.battery = Math.max(0, Math.min(this.maxBattery, val));
  }

  _bindEvents() {
    this._onKeyDown = (e) => {
      if (this.isEditorActive || this.isInventoryOpen || (window.mpManager && window.mpManager.isInStagingLobby)) {
        return;
      }
      // Allow regular typing in visible input/textarea elements when not in active pointer lock
      if (!this.isPointerLocked && e.target) {
        const tag = e.target.tagName;
        const type = (e.target.type || '').toLowerCase();
        const isEditableText = (tag === 'TEXTAREA') || (tag === 'INPUT' && ['text', 'password', 'search', 'email', 'url', 'tel', 'number', ''].includes(type));
        if (isEditableText && e.target.offsetParent !== null) {
          return;
        }
      }

      // Browser keyboard shortcut protection during active first-person pointer lock
      if (this.isPointerLocked) {
        // Intercept and prevent browser window navigation/closure shortcuts: Ctrl+W, Ctrl+R, etc.
        if (e.ctrlKey || e.metaKey) {
          const blockedCodes = ['KeyW', 'KeyR', 'KeyS', 'KeyD', 'KeyA', 'KeyP', 'KeyF', 'KeyO', 'KeyU'];
          if (blockedCodes.includes(e.code)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }

        // Intercept page reload / browser shortcuts: F5, F1, F3, etc. (preserve F11 fullscreen, F12 devtools)
        if (e.code === 'F5' || e.key === 'F5' || (e.key && e.key.startsWith('F') && e.key.length <= 3 && e.code !== 'F11' && e.code !== 'F12')) {
          e.preventDefault();
          e.stopPropagation();
        }

        // Intercept page scrolling keys while pointer locked
        if (['Space', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.code)) {
          e.preventDefault();
        }
      }

      this.keys[e.code] = true;

      // Hotbar selection shortcuts (1-9, 0)
      if (e.code === 'Digit1' || e.code === 'Numpad1' || e.key === '1') this.selectHotbarSlot(0);
      else if (e.code === 'Digit2' || e.code === 'Numpad2' || e.key === '2') this.selectHotbarSlot(1);
      else if (e.code === 'Digit3' || e.code === 'Numpad3' || e.key === '3') this.selectHotbarSlot(2);
      else if (e.code === 'Digit4' || e.code === 'Numpad4' || e.key === '4') this.selectHotbarSlot(3);
      else if (e.code === 'Digit5' || e.code === 'Numpad5' || e.key === '5') this.selectHotbarSlot(4);
      else if (e.code === 'Digit6' || e.code === 'Numpad6' || e.key === '6') this.selectHotbarSlot(5);
      else if (e.code === 'Digit7' || e.code === 'Numpad7' || e.key === '7') this.selectHotbarSlot(6);
      else if (e.code === 'Digit8' || e.code === 'Numpad8' || e.key === '8') this.selectHotbarSlot(7);
      else if (e.code === 'Digit9' || e.code === 'Numpad9' || e.key === '9') this.selectHotbarSlot(8);
      else if (e.code === 'Digit0' || e.code === 'Numpad0' || e.key === '0') this.selectHotbarSlot(9);
      else if (e.code === 'KeyR' || e.key === 'r' || e.key === 'R') this.startReload();
    };

    this._onKeyUp = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }
      this.keys[e.code] = false;
    };

    this._onMouseMove = (e) => {
      if (!this.isPointerLocked || this.isInventoryOpen) return;
      this.yaw -= e.movementX * this.mouseSensitivity;
      this.pitch -= e.movementY * this.mouseSensitivity;
      this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch));
    };

    this._onMouseDown = (e) => {
      if (window.mpManager && window.mpManager.isInStagingLobby) {
        return;
      }
      if (this.isEditorActive) {
        this.firingDiagnostics.lastRejectionReason = 'EDITOR_ACTIVE';
        return;
      }
      if (this.isInventoryOpen) {
        this.firingDiagnostics.lastRejectionReason = 'INVENTORY_OPEN';
        return;
      }
      if (this.isDowned || this.isDead || this.hp <= 0) {
        this.firingDiagnostics.lastRejectionReason = 'PLAYER_DOWNED_OR_ELIMINATED';
        return;
      }
      if (this.isPointerLocked) {
        if (e.button === 0) { // Left click
          if (this.weapon >= 0) {
            this.fire();
          } else {
            this.consumeHeldItem();
          }
        } else if (e.button === 2) { // Right click
          e.preventDefault();
          this.dropHeldItem();
        }
      } else {
        if (e.button === 0) {
          this.firingDiagnostics.lastRejectionReason = 'NO_POINTER_LOCK';
        }
      }
    };

    this._onWheel = (e) => {
      if (this.isEditorActive || this.isInventoryOpen) return;
      if (this.isPointerLocked) {
        e.preventDefault(); // Prevent page scrolling during weapon selection wheel
        if (e.deltaY > 0) {
          this.selectHotbarSlot((this.selectedHotbarSlot + 1) % 10);
        } else if (e.deltaY < 0) {
          this.selectHotbarSlot((this.selectedHotbarSlot + 9) % 10);
        }
      }
    };

    this._onContextMenu = (e) => {
      if (this.isPointerLocked) {
        e.preventDefault();
      }
    };

    this._onPointerLockChange = () => {
      this.isPointerLocked = (document.pointerLockElement !== null);
      if (this.isPointerLocked) {
        // Request keyboard lock for W and R if supported by browser
        if (navigator.keyboard && typeof navigator.keyboard.lock === 'function') {
          navigator.keyboard.lock(['KeyW', 'KeyR']).catch(() => {});
        }
      } else {
        if (navigator.keyboard && typeof navigator.keyboard.unlock === 'function') {
          try { navigator.keyboard.unlock(); } catch (e) {}
        }
      }
    };

    window.addEventListener('keydown', this._onKeyDown, { capture: true });
    window.addEventListener('keyup', this._onKeyUp, { capture: true });
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  requestPointerLock(element) {
    if (element && element.requestPointerLock) {
      element.requestPointerLock();
    }
  }

  update(dt) {
    if (window.mpManager && window.mpManager.isInStagingLobby) {
      if (this.gunGroup) this.gunGroup.visible = false;
      this._resetMovementAudio();
      return;
    }

    this._updateThrowAnimations(dt);

    if (this.isEditorActive || this.isInventoryOpen || this.isDowned || this.isDead || this.state !== 'ACTIVE') {
      this._resetMovementAudio();
      // Suspend movement and firing, but maintain 20Hz network sync
      // If downed or dead, smoothly transition camera height to prone
      if (this.isDowned || this.isDead) {
        this.currentCameraY += (this.cameraTargetY - this.currentCameraY) * Math.min(1.0, dt * 6.0);
        this.camera.position.set(this.pos.x, this.currentCameraY, this.pos.z);
      }
      this.updateTimer += dt;
      if (this.updateTimer >= this.updateInterval) {
        this.updateTimer = 0;
        if (this.networkClient && this.networkClient.isConnected) {
          this.networkClient.sendUpdate(
            +this.pos.x.toFixed(3),
            +this.pos.y.toFixed(3),
            +this.pos.z.toFixed(3),
            +this.yaw.toFixed(4),
            +this.pitch.toFixed(4),
            this.weapon,
            this.isSprinting
          );
        }
      }
      return;
    }

    // 0. Update firing cooldown, reload, battery, and recoil recovery
    if (this.cool > 0) this.cool = Math.max(0, this.cool - dt);
    if (this.recoilKick > 0) {
      this.recoilKick = Math.max(0, this.recoilKick - dt * 0.45);
    }
    if (this.reloadT > 0) {
      this.reloadT = Math.max(0, this.reloadT - dt);
      if (this.reloadT === 0 && this.reloadWeapon >= 0) {
        this._finishReload();
      }
    }
    if (this.weapon === 2 && this.battery > 0) {
      this.battery = Math.max(0, this.battery - 0.25 * dt);
    }
    if (this.speedBoostTimer > 0) {
      this.speedBoostTimer = Math.max(0, this.speedBoostTimer - dt);
      if (this.speedBoostTimer === 0) {
        this.speedMultiplier = 1.0;
      }
    }

    // Update telemetry firing diagnostics
    this.firingDiagnostics.cooldown = `${this.cool.toFixed(2)}s`;
    this.firingDiagnostics.selectedWeapon = this.weapon === 0 ? 'PISTOL (0)' : (this.weapon === 1 ? 'SHOTGUN (1)' : (this.weapon === 2 ? 'TORCH (2)' : 'UNARMED (-1)'));
    this.firingDiagnostics.magAmmo = this.weapon === 0 ? this.mag.bullets : (this.weapon === 1 ? this.mag.shells : 0);
    this.firingDiagnostics.reserveAmmo = this.weapon === 0 ? this.bullets : (this.weapon === 1 ? this.shells : 0);
    this.firingDiagnostics.reloadState = this.reloadT > 0 ? `RELOADING (${this.reloadT.toFixed(2)}s)` : 'IDLE';

    // 1. Movement and stamina drain/regeneration
    let fx = 0, fz = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) fz -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) fz += 1;
    if (this.keys['KeyA']) fx -= 1;
    if (this.keys['KeyD']) fx += 1;

    // Arrow keys turning when not using mouse
    if (this.keys['ArrowLeft']) this.yaw += 2.2 * dt;
    if (this.keys['ArrowRight']) this.yaw -= 2.2 * dt;

    const len = Math.hypot(fx, fz);
    const wantsSprint = (this.keys['ShiftLeft'] || this.keys['ShiftRight']);

    if (wantsSprint && len > 0 && this.stamina > 0 && !this._staminaExhausted) {
      this.isSprinting = true;
      this.stamina = Math.max(0, this.stamina - this.staminaDrainRate * dt);
      if (this.stamina <= 0) {
        this._staminaExhausted = true;
        this.isSprinting = false;
      }
    } else {
      this.isSprinting = false;
      if (this.stamina < this.maxStamina) {
        this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegenRate * dt);
        if (this._staminaExhausted && this.stamina >= 20.0) {
          this._staminaExhausted = false;
        }
      }
    }

    const curSpeed = this.getEffectiveMoveSpeed();
    const prevPosX = this.pos.x;
    const prevPosZ = this.pos.z;

    if (len > 0) {
      fx /= len; fz /= len;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      const mx = (fx * cos + fz * sin) * curSpeed * dt;
      const mz = (-fx * sin + fz * cos) * curSpeed * dt;

      let nx = this.pos.x + mx;
      if (!this._hitsWall(nx, this.pos.z, this.radius)) {
        this.pos.x = nx;
      }
      let nz = this.pos.z + mz;
      if (!this._hitsWall(this.pos.x, nz, this.radius)) {
        this.pos.z = nz;
      }

      this.bob += dt * (this.isSprinting ? 11 : 8);
    }

    // 1b. Local movement footstep cadence tied to real horizontal displacement
    const movedDist = Math.hypot(this.pos.x - prevPosX, this.pos.z - prevPosZ);
    const isActuallyMoving = (len > 0 && movedDist > 0.0005);
    if (!isActuallyMoving) {
      this._resetMovementAudio();
    } else {
      const mode = this.isSprinting ? 'run' : 'walk';
      const stride = this.isSprinting ? 2.2 : 2.4;
      if (!this._wasMoving || mode !== this._lastMoveMode) {
        const switchedMode = this._wasMoving && mode !== this._lastMoveMode;
        this._stepDistAccum = 0.0;
        this._wasMoving = true;
        this._lastMoveMode = mode;
        this.audioManager?.playFootstep('local', mode, {
          positional: false,
          immediateSwitch: switchedMode,
          ignoreRateLimit: switchedMode
        });
      }
      this._stepDistAccum += movedDist;
      while (this._stepDistAccum >= stride) {
        this._stepDistAccum -= stride;
        this.audioManager?.playFootstep('local', mode, { positional: false });
      }
    }

    // 2. Camera positioning & bobbing
    const targetEyeY = (this.pos.y || 0.0) + 1.62;
    this.currentCameraY += (targetEyeY - this.currentCameraY) * Math.min(1.0, dt * 6.0);
    const bobY = len > 0 ? Math.sin(this.bob) * 0.04 : 0;
    this.camera.position.set(this.pos.x, this.currentCameraY + bobY, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // 3. Gun bobbing + recoil kick
    const gb = len > 0 ? Math.sin(this.bob) * 0.01 : 0;
    this.gunGroup.position.set(0.34 + gb, -0.32 + Math.abs(Math.cos(this.bob)) * 0.01, -0.62 + this.recoilKick);

    // 4. Send network updates at 20Hz
    this.updateTimer += dt;
    if (this.updateTimer >= this.updateInterval) {
      this.updateTimer = 0;
      if (this.networkClient && this.networkClient.isConnected) {
        this.networkClient.sendUpdate(
          +this.pos.x.toFixed(3),
          +this.pos.y.toFixed(3),
          +this.pos.z.toFixed(3),
          +this.yaw.toFixed(4),
          +this.pitch.toFixed(4),
          this.weapon,
          this.isSprinting
        );
      }
    }
  }

  _hitsWall(px, pz, r) {
    if (this.collisionHandler && typeof this.collisionHandler.circleHitsWall === 'function') {
      return this.collisionHandler.circleHitsWall(px, pz, r);
    }
    return false;
  }

  dispose() {
    if (this._muzzleTimer) {
      clearTimeout(this._muzzleTimer);
      this._muzzleTimer = null;
    }
    if (this.muzzleLight && this.muzzleLight.parent) {
      this.muzzleLight.parent.remove(this.muzzleLight);
    }
    if (this.muzzleSprite && this.muzzleSprite.parent) {
      this.muzzleSprite.parent.remove(this.muzzleSprite);
    }
    window.removeEventListener('keydown', this._onKeyDown, { capture: true });
    window.removeEventListener('keyup', this._onKeyUp, { capture: true });
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    if (navigator.keyboard && typeof navigator.keyboard.unlock === 'function') {
      try { navigator.keyboard.unlock(); } catch (e) {}
    }
  }
}
