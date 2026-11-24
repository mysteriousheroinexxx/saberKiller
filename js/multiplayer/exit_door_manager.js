/**
 * Saber Killer — Level 0 Exit Door Manager
 * Loads authentic commercial metallic exit door model (assets/items/metalDoor.glb),
 * separates door leaf and frame for realistic hinge opening, provides dynamic
 * indicator lighting, collision gating, and escape objective integration.
 */

export class ExitDoorManager {
  constructor(scene, interactionManager) {
    this.scene = scene;
    this.interactionManager = interactionManager;
    this.doorState = {
      id: 'level0_exit_door',
      locked: true,
      position: [79.55, 0.0, 207.0],
      unlockedBy: null
    };

    this.rootGroup = null;
    this.doorPivot = null;
    this.doorLeafMesh = null;
    this.frameMesh = null;
    this.glassMesh = null;
    this.indicatorLight = null;
    this.indicatorBulb = null;
    this.targetAngle = 0;
    this.currentAngle = 0;
    this.escapeTriggered = false;
    this.isModelLoaded = false;
    this.doorScale = 0.0115; // Realistic scale: width ~1.38m, height ~2.78m

    this._createDoorStructure();
    this._loadMetalDoorModel();
    this._registerInteraction();
  }

  _createDoorStructure() {
    const pos = this.doorState.position;
    this.rootGroup = new THREE.Group();
    this.rootGroup.position.set(pos[0], pos[1], pos[2]);
    this.rootGroup.name = 'level0_exit_door';
    this.rootGroup.userData = { id: 'level0_exit_door', type: 'exit_door' };

    // 1. Illuminated "EXIT →" Sign board mounted above lintel
    const signBoardGeo = new THREE.BoxGeometry(0.85, 0.26, 0.08);
    const signBoardMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.7,
      metalness: 0.5
    });
    const signBoard = new THREE.Mesh(signBoardGeo, signBoardMat);
    signBoard.position.set(0, 2.95, 0.06);
    this.rootGroup.add(signBoard);

    const signTextGeo = new THREE.PlaneGeometry(0.78, 0.22);
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 256;
    signCanvas.height = 64;
    const ctx = signCanvas.getContext('2d');
    ctx.fillStyle = '#064e3b';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXIT →', 128, 32);

    const signTex = new THREE.CanvasTexture(signCanvas);
    const signMat = new THREE.MeshBasicMaterial({ map: signTex });
    const signFace = new THREE.Mesh(signTextGeo, signMat);
    signFace.position.set(0, 2.95, 0.105);
    this.rootGroup.add(signFace);

    // 2. Status Indicator Bulb & Light (Red = Locked, Green = Unlocked)
    const bulbGeo = new THREE.SphereGeometry(0.06, 16, 16);
    this.indicatorBulb = new THREE.Mesh(bulbGeo, new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1.8,
      roughness: 0.2
    }));
    this.indicatorBulb.position.set(0.68, 2.85, 0.12);
    this.rootGroup.add(this.indicatorBulb);

    this.indicatorLight = new THREE.PointLight(0xef4444, 1.4, 5.0);
    this.indicatorLight.position.set(0.68, 2.85, 0.25);
    this.rootGroup.add(this.indicatorLight);

    // 3. Fallback / interim door leaf until GLB finishes loading
    this.doorPivot = new THREE.Group();
    const halfWidth = 50.0 * this.doorScale;
    this.doorPivot.position.set(-halfWidth, 0, 0); // Left hinge line
    this.rootGroup.add(this.doorPivot);

    this.scene.add(this.rootGroup);
  }

  _loadMetalDoorModel() {
    const loader = new THREE.GLTFLoader();
    const modelUrl = 'assets/items/metalDoor.glb';

    loader.load(
      modelUrl,
      (gltf) => {
        this._setupModelHierarchy(gltf);
      },
      undefined,
      (err) => {
        console.warn(`[ExitDoorManager] Failed to load ${modelUrl}, trying fallback assets/metalDoor.glb:`, err);
        loader.load(
          'assets/metalDoor.glb',
          (gltf) => {
            this._setupModelHierarchy(gltf);
          },
          undefined,
          (err2) => {
            console.error('[ExitDoorManager] Critical: Failed to load metalDoor.glb:', err2);
          }
        );
      }
    );
  }

  _setupModelHierarchy(gltf) {
    const root = gltf.scene;
    let mainMesh = null;
    let glassMesh = null;

    root.traverse((child) => {
      if (child.isMesh) {
        if (child.name === 'Object_3') {
          mainMesh = child;
        } else if (child.name === 'Object_2') {
          glassMesh = child;
        }
      }
    });

    if (!mainMesh) {
      console.warn('[ExitDoorManager] Object_3 not found in metalDoor.glb; attaching entire scene');
      this.rootGroup.add(root);
      this.isModelLoaded = true;
      return;
    }

    const baseGeo = mainMesh.geometry;
    const pos = baseGeo.attributes.position;
    const index = baseGeo.index;

    // Geometric separation: triangles with |X| > 50.001 or Z > 232.075 form the outer frame
    const frameIndices = [];
    const doorIndices = [];

    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);

      const ax = pos.getX(a), az = pos.getZ(a);
      const bx = pos.getX(b), bz = pos.getZ(b);
      const cx = pos.getX(c), cz = pos.getZ(c);

      const isFrame = (Math.abs(ax) > 50.001 || az > 232.075) ||
                      (Math.abs(bx) > 50.001 || bz > 232.075) ||
                      (Math.abs(cx) > 50.001 || cz > 232.075);

      if (isFrame) {
        frameIndices.push(a, b, c);
      } else {
        doorIndices.push(a, b, c);
      }
    }

    const scale = this.doorScale;
    const material = mainMesh.material;
    if (material) {
      material.roughness = 0.35;
      material.metalness = 0.85;
      material.needsUpdate = true;
    }

    // 1. Static Door Frame
    const frameGeo = baseGeo.clone();
    frameGeo.setIndex(new THREE.BufferAttribute(new Uint16Array(frameIndices), 1));
    this.frameMesh = new THREE.Mesh(frameGeo, material);
    this.frameMesh.name = 'metal_door_frame';
    this.frameMesh.castShadow = true;
    this.frameMesh.receiveShadow = true;
    this.frameMesh.userData = { id: 'level0_exit_door', type: 'exit_door' };

    const frameGroup = new THREE.Group();
    // Rotate -90 deg on X to convert Z-up model to Y-up
    frameGroup.rotation.x = -Math.PI / 2;
    frameGroup.scale.set(scale, scale, scale);
    frameGroup.add(this.frameMesh);
    this.rootGroup.add(frameGroup);

    // 2. Movable Door Leaf (Panel, Window Trim, Panic Push Bar)
    const doorGeo = baseGeo.clone();
    doorGeo.setIndex(new THREE.BufferAttribute(new Uint16Array(doorIndices), 1));
    this.doorLeafMesh = new THREE.Mesh(doorGeo, material);
    this.doorLeafMesh.name = 'metal_door_leaf';
    this.doorLeafMesh.castShadow = true;
    this.doorLeafMesh.receiveShadow = true;
    this.doorLeafMesh.userData = { id: 'level0_exit_door', type: 'exit_door' };

    const leafGroup = new THREE.Group();
    // Shift relative to hinge: hinge is at x = -50cm (-50*scale), so shift +50*scale
    leafGroup.position.set(50.0 * scale, 0, 0);
    leafGroup.rotation.x = -Math.PI / 2;
    leafGroup.scale.set(scale, scale, scale);
    leafGroup.add(this.doorLeafMesh);

    // 3. Security Glass Window Pane
    if (glassMesh) {
      this.glassMesh = glassMesh.clone();
      if (this.glassMesh.material) {
        this.glassMesh.material.transparent = true;
        this.glassMesh.material.opacity = 0.65;
        this.glassMesh.material.roughness = 0.1;
      }
      this.glassMesh.userData = { id: 'level0_exit_door', type: 'exit_door' };
      leafGroup.add(this.glassMesh);
    }

    // Attach leafGroup to the left hinge pivot
    const halfWidth = 50.0 * scale;
    this.doorPivot.position.set(-halfWidth, 0, 0);
    this.doorPivot.add(leafGroup);

    this.isModelLoaded = true;
    console.log('[ExitDoorManager] Authentic metallic door model (metalDoor.glb) loaded and integrated successfully');

    // If door is already unlocked upon load completion, apply open angle immediately
    if (!this.doorState.locked) {
      this.targetAngle = -1.52; // ~-87 degrees swing open
      this.currentAngle = this.targetAngle;
      this.doorPivot.rotation.y = this.currentAngle;
    }
  }

  _registerInteraction() {
    if (!this.interactionManager) return;
    this.interactionManager.registerInteractable('level0_exit_door', {
      id: 'level0_exit_door',
      type: 'exit_door',
      category: 'environmental',
      object: this.rootGroup,
      maxDistance: 3.5,
      getActionText: () => {
        if (!this.doorState.locked) {
          return 'Escape';
        }
        const carriedKeys = (window.mpManager?.inventory?.getCount('doorKey')) || 0;
        const requiredKeys = this.doorState.requiredKeys || 1;
        if (carriedKeys >= requiredKeys) {
          return (requiredKeys > 1) ? `Unlock (${carriedKeys}/${requiredKeys} Keys)` : 'Unlock';
        }
        return (requiredKeys > 1)
          ? `Locked (${carriedKeys}/${requiredKeys} Keys)`
          : 'Locked — Requires Key';
      },
      getName: () => {
        if (!this.doorState.locked) {
          return 'Level 0';
        }
        return 'Metallic Exit Door';
      }
    });
  }

  /**
   * Collision check for player movement.
   * When door is locked (closed), prevents player circle from walking through doorway.
   * When door is unlocked (open), allows passage through the doorway.
   * @param {number} px Player X
   * @param {number} pz Player Z
   * @param {number} radius Player collision radius
   * @returns {boolean} True if collides with closed door
   */
  collidesWithDoor(px, pz, radius = 0.35) {
    if (!this.doorState.locked) {
      // Unlocked: door has swung open; doorway passage is free
      return false;
    }

    const pos = this.doorState.position; // [79.55, 0.0, 207.0]
    const halfWidth = 60.0 * this.doorScale; // ~0.69m
    const minX = pos[0] - halfWidth - 0.05; // ~78.81
    const maxX = pos[0] + halfWidth + 0.05; // ~80.29
    const minZ = pos[2] - 0.15; // 206.85
    const maxZ = pos[2] + 0.15; // 207.15

    // Check circle-AABB intersection
    const testX = Math.max(minX, Math.min(px, maxX));
    const testZ = Math.max(minZ, Math.min(pz, maxZ));
    const distX = px - testX;
    const distZ = pz - testZ;
    const distSq = distX * distX + distZ * distZ;

    return distSq < (radius * radius);
  }

  initDoors(doorsList) {
    if (!Array.isArray(doorsList)) return;
    for (const d of doorsList) {
      if (d.id === 'level0_exit_door') {
        this.setDoorState(d.id, d.locked, d.unlockedBy);
        if (typeof d.requiredKeys === 'number') {
          this.doorState.requiredKeys = d.requiredKeys;
        }
        if (Array.isArray(d.position) && this.rootGroup) {
          this.rootGroup.position.set(d.position[0], d.position[1], d.position[2]);
          this.doorState.position = d.position;
        }
      }
    }
  }

  getDoor(doorId) {
    if (doorId === 'level0_exit_door' || !doorId) {
      return this.doorState;
    }
    return null;
  }

  setDoorState(doorId, locked, unlockedBy = null) {
    if (doorId !== 'level0_exit_door' && doorId) return;
    this.doorState.locked = Boolean(locked);
    this.doorState.unlockedBy = unlockedBy;

    if (!this.doorState.locked) {
      // Unlocked: swing door leaf open into the exit vestibule (-87 degrees)
      this.targetAngle = -1.52;
      if (this.indicatorBulb) {
        this.indicatorBulb.material.color.setHex(0x22c55e);
        this.indicatorBulb.material.emissive.setHex(0x22c55e);
      }
      if (this.indicatorLight) {
        this.indicatorLight.color.setHex(0x22c55e);
        this.indicatorLight.intensity = 1.8;
      }
      console.log('[ExitDoorManager] Metallic Exit Door UNLOCKED authoritatively; swinging open');
    } else {
      // Locked: close door
      this.targetAngle = 0;
      if (this.indicatorBulb) {
        this.indicatorBulb.material.color.setHex(0xef4444);
        this.indicatorBulb.material.emissive.setHex(0xef4444);
      }
      if (this.indicatorLight) {
        this.indicatorLight.color.setHex(0xef4444);
        this.indicatorLight.intensity = 1.4;
      }
    }
  }

  update(delta = 0.016, playerPos = null) {
    // Smooth door swing animation
    if (this.doorPivot && Math.abs(this.currentAngle - this.targetAngle) > 0.001) {
      this.currentAngle += (this.targetAngle - this.currentAngle) * Math.min(1.0, delta * 5.0);
      this.doorPivot.rotation.y = this.currentAngle;
    }

    // Proximity doorway walk-through escape check
    if (!this.doorState.locked && !this.escapeTriggered && playerPos && window.mpManager?.network?.isConnected) {
      const dPos = this.doorState.position;
      const dx = playerPos.x - dPos[0];
      const dz = playerPos.z - dPos[2];
      const dist2D = Math.hypot(dx, dz);

      // Crossing or standing within 1.6m of the open doorway into the exit vestibule
      if (dist2D < 1.6 && playerPos.z >= dPos[2] - 0.4) {
        this.escapeTriggered = true;
        console.log('[ExitDoorManager] Player walked through open metallic doorway; requesting escape');
        window.mpManager.network.requestEscape('level0_exit_door', {
          x: +playerPos.x.toFixed(3),
          y: +(playerPos.y || 0).toFixed(3),
          z: +playerPos.z.toFixed(3)
        });
      }
    }
  }
}
