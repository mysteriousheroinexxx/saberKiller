// Local First-Person Player Controller for Multiplayer
// Handles input, camera orientation, wall collision via level0_env, viewmodel, and 20Hz network updates

export class LocalPlayerController {
  constructor(camera, scene, networkClient, collisionHandler) {
    this.camera = camera;
    this.scene = scene;
    this.networkClient = networkClient;
    this.collisionHandler = collisionHandler;

    this.pos = new THREE.Vector3(48.69, 0.0, -187.65);
    this.yaw = 0.0;
    this.pitch = 0.0;
    this.weapon = 0; // 0 = pistol

    this.keys = {};
    this.mouseSensitivity = 0.0022;
    this.isPointerLocked = false;

    this.bob = 0;
    this.speed = 5.2;
    this.sprintSpeed = 7.6;
    this.radius = 0.32;

    this.updateTimer = 0;
    this.updateInterval = 0.05; // 20Hz network update

    this.gunGroup = new THREE.Group();
    this.camera.add(this.gunGroup);
    this._buildLocalViewmodel();

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

  _buildLocalViewmodel() {
    this.gunGroup.position.set(0.34, -0.32, -0.62);

    const loader = new THREE.GLTFLoader();
    loader.load('assets/beretta_px4_storm_compact.glb', (gltf) => {
      const weaponMesh = gltf.scene;
      weaponMesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(weaponMesh);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const s = 0.36 / (Math.max(size.x, size.y, size.z) || 1);

      weaponMesh.position.set(-center.x, -center.y + 2.5, -center.z);
      weaponMesh.traverse(o => {
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
      wrap.add(weaponMesh);
      wrap.rotation.set(0, Math.PI, 0);
      wrap.scale.setScalar(s);
      wrap.position.set(0, 0.02, -0.16);
      this.gunGroup.add(wrap);
    }, undefined, () => {
      // Fallback box weapon
      const dark = new THREE.MeshBasicMaterial({ color: 0x333338 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.3), dark);
      b.position.set(0, 0, -0.15);
      this.gunGroup.add(b);
    });
  }

  _bindEvents() {
    this._onKeyDown = (e) => {
      this.keys[e.code] = true;
    };
    this._onKeyUp = (e) => {
      this.keys[e.code] = false;
    };
    this._onMouseMove = (e) => {
      if (!this.isPointerLocked) return;
      this.yaw -= e.movementX * this.mouseSensitivity;
      this.pitch -= e.movementY * this.mouseSensitivity;
      // Clamp pitch (-85° to +85°)
      this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch));
    };
    this._onPointerLockChange = () => {
      this.isPointerLocked = (document.pointerLockElement !== null);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  requestPointerLock(element) {
    if (element && element.requestPointerLock) {
      element.requestPointerLock();
    }
  }

  update(dt) {
    // 1. Movement input
    const isSprint = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const curSpeed = isSprint ? this.sprintSpeed : this.speed;

    let fx = 0, fz = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) fz -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) fz += 1;
    if (this.keys['KeyA']) fx -= 1;
    if (this.keys['KeyD']) fx += 1;

    // Arrow keys turning when not using mouse
    if (this.keys['ArrowLeft']) this.yaw += 2.2 * dt;
    if (this.keys['ArrowRight']) this.yaw -= 2.2 * dt;

    const len = Math.hypot(fx, fz);
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

      this.bob += dt * (isSprint ? 11 : 8);
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
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
  }
}
