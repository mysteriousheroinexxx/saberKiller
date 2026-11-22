// Local First-Person Player Controller for Multiplayer
// Handles input, camera orientation, wall collision via level0_env, viewmodel, survival resources, and 20Hz network updates

export class LocalPlayerController {
  constructor(camera, scene, networkClient, collisionHandler) {
    this.camera = camera;
    this.scene = scene;
    this.networkClient = networkClient;
    this.collisionHandler = collisionHandler;

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
    this.mag = { bullets: 12, shells: 6 };
    this.bullets = 36;
    this.shells = 2;
    this.reloadT = 0;
    this.reloadWeapon = -1;
    this.cool = 0;

    // Viewmodels and flashlight
    this.gunGroup = new THREE.Group();
    this.camera.add(this.gunGroup);
    this.viewmodels = [null, null, null]; // [pistol, shotgun, torch]

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
    this.camera.position.set(this.pos.x, 1.62, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
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
  }

  setWeapon(idx) {
    if (idx < 0 || idx > 2) return;
    if (this.weapon === idx) return;
    this.weapon = idx;
    this.reloadT = 0;
    this.reloadWeapon = -1;
    this._updateViewmodelVisibility();
  }

  fire() {
    if (this.cool > 0 || this.reloadT > 0) return false;
    if (this.weapon === 0) { // PISTOL
      if (this.mag.bullets <= 0) {
        this.startReload();
        return false;
      }
      this.mag.bullets--;
      this.cool = 0.21;
      if (this.mag.bullets === 0 && this.bullets > 0) {
        this.startReload();
      }
      return true;
    } else if (this.weapon === 1) { // SHOTGUN
      if (this.mag.shells <= 0) {
        this.startReload();
        return false;
      }
      this.mag.shells--;
      this.cool = 0.95;
      if (this.mag.shells === 0 && this.shells > 0) {
        this.startReload();
      }
      return true;
    } else if (this.weapon === 2) { // TORCH
      this.cool = 0.3;
      return true;
    }
    return false;
  }

  startReload() {
    if (this.reloadT > 0) return false;
    if (this.weapon === 0) {
      const needed = 12 - this.mag.bullets;
      if (needed <= 0 || this.bullets <= 0) return false;
      this.reloadT = 1.15;
      this.reloadWeapon = 0;
      return true;
    } else if (this.weapon === 1) {
      const needed = 6 - this.mag.shells;
      if (needed <= 0 || this.shells <= 0) return false;
      this.reloadT = 1.6;
      this.reloadWeapon = 1;
      return true;
    }
    return false;
  }

  _finishReload() {
    if (this.reloadWeapon === 0) {
      const needed = 12 - this.mag.bullets;
      const loaded = Math.min(needed, this.bullets);
      this.bullets -= loaded;
      this.mag.bullets += loaded;
    } else if (this.reloadWeapon === 1) {
      const needed = 6 - this.mag.shells;
      const loaded = Math.min(needed, this.shells);
      this.shells -= loaded;
      this.mag.shells += loaded;
    }
    this.reloadWeapon = -1;
  }

  setHp(hp) {
    this.hp = Math.max(0, Math.min(this.maxHp, hp));
  }

  damage(amount) {
    this.hp = Math.max(0, this.hp - amount);
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
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
      if (this.isEditorActive) {
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
        // ALWAYS preserve Escape key so the browser / user can release pointer lock at will
        if (e.code === 'Escape') {
          return;
        }

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

        // Intercept Tab to avoid losing focus / cycling DOM focus out of the canvas
        if (e.code === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
        }

        // Intercept page scrolling keys while pointer locked
        if (['Space', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.code)) {
          e.preventDefault();
        }
      }

      this.keys[e.code] = true;

      // Weapon selection shortcuts
      if (e.code === 'Digit1') this.setWeapon(0);
      else if (e.code === 'Digit2') this.setWeapon(1);
      else if (e.code === 'Digit3') this.setWeapon(2);
      else if (e.code === 'KeyR') this.startReload();
    };

    this._onKeyUp = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }
      this.keys[e.code] = false;
    };

    this._onMouseMove = (e) => {
      if (!this.isPointerLocked) return;
      this.yaw -= e.movementX * this.mouseSensitivity;
      this.pitch -= e.movementY * this.mouseSensitivity;
      this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch));
    };

    this._onMouseDown = (e) => {
      if (this.isEditorActive) return;
      if (this.isPointerLocked && e.button === 0) {
        this.fire();
      }
    };

    this._onWheel = (e) => {
      if (this.isEditorActive) return;
      if (this.isPointerLocked) {
        e.preventDefault(); // Prevent page scrolling during weapon selection wheel
        if (e.deltaY > 0) {
          this.setWeapon((this.weapon + 1) % 3);
        } else if (e.deltaY < 0) {
          this.setWeapon((this.weapon + 2) % 3);
        }
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
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  requestPointerLock(element) {
    if (element && element.requestPointerLock) {
      element.requestPointerLock();
    }
  }

  update(dt) {
    if (this.isEditorActive) {
      // Suspend movement and firing, but maintain 20Hz network sync
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
            this.weapon
          );
        }
      }
      return;
    }

    // 0. Update firing cooldown, reload, and battery
    if (this.cool > 0) this.cool = Math.max(0, this.cool - dt);
    if (this.reloadT > 0) {
      this.reloadT = Math.max(0, this.reloadT - dt);
      if (this.reloadT === 0 && this.reloadWeapon >= 0) {
        this._finishReload();
      }
    }
    if (this.weapon === 2 && this.battery > 0) {
      this.battery = Math.max(0, this.battery - 0.25 * dt);
    }

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

    const curSpeed = this.isSprinting ? this.sprintSpeed : this.speed;

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

    // 2. Camera positioning & bobbing
    const bobY = len > 0 ? Math.sin(this.bob) * 0.04 : 0;
    this.camera.position.set(this.pos.x, 1.62 + bobY, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // 3. Gun bobbing
    const gb = len > 0 ? Math.sin(this.bob) * 0.01 : 0;
    this.gunGroup.position.set(0.34 + gb, -0.32 + Math.abs(Math.cos(this.bob)) * 0.01, -0.62);

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
          this.weapon
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
