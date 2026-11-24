/**
 * Saber Killer — Level 0 Exit Door Manager
 * Authoritative client representation, 3D industrial door entity,
 * dynamic indicator lighting, hinge swing animation, and interaction wiring.
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
    this.indicatorLight = null;
    this.indicatorBulb = null;
    this.targetAngle = 0;
    this.currentAngle = 0;
    this.escapeTriggered = false;

    this._createDoorMesh();
    this._registerInteraction();
  }

  _createDoorMesh() {
    const pos = this.doorState.position;
    this.rootGroup = new THREE.Group();
    this.rootGroup.position.set(pos[0], pos[1], pos[2]);
    this.rootGroup.name = 'level0_exit_door';
    this.rootGroup.userData = { id: 'level0_exit_door', type: 'exit_door' };

    // 1. Industrial Steel Frame Materials
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x22252a,
      roughness: 0.5,
      metalness: 0.8
    });

    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x4b5563,
      roughness: 0.35,
      metalness: 0.85
    });

    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      roughness: 0.6,
      metalness: 0.7
    });

    // 2. Door Frame Posts (Left & Right) and Lintel (Top)
    // Door opening: width 1.8m, height 2.5m
    const leftPostGeo = new THREE.BoxGeometry(0.14, 2.65, 0.22);
    const leftPost = new THREE.Mesh(leftPostGeo, frameMat);
    leftPost.position.set(-0.97, 1.325, 0);
    this.rootGroup.add(leftPost);

    const rightPostGeo = new THREE.BoxGeometry(0.14, 2.65, 0.22);
    const rightPost = new THREE.Mesh(rightPostGeo, frameMat);
    rightPost.position.set(0.97, 1.325, 0);
    this.rootGroup.add(rightPost);

    const lintelGeo = new THREE.BoxGeometry(2.08, 0.16, 0.24);
    const lintel = new THREE.Mesh(lintelGeo, frameMat);
    lintel.position.set(0, 2.73, 0);
    this.rootGroup.add(lintel);

    // 3. Illuminated "EXIT" Sign above lintel
    const signBoardGeo = new THREE.BoxGeometry(0.8, 0.25, 0.08);
    const signBoardMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.7 });
    const signBoard = new THREE.Mesh(signBoardGeo, signBoardMat);
    signBoard.position.set(0, 2.95, 0.08);
    this.rootGroup.add(signBoard);

    const signTextGeo = new THREE.PlaneGeometry(0.72, 0.20);
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
    signFace.position.set(0, 2.95, 0.125);
    this.rootGroup.add(signFace);

    // 4. Status Indicator Bulb & Light (Red = Locked, Green = Unlocked)
    const bulbGeo = new THREE.SphereGeometry(0.06, 16, 16);
    this.indicatorBulb = new THREE.Mesh(bulbGeo, new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1.5,
      roughness: 0.2
    }));
    this.indicatorBulb.position.set(0.82, 2.5, 0.12);
    this.rootGroup.add(this.indicatorBulb);

    this.indicatorLight = new THREE.PointLight(0xef4444, 1.2, 5.0);
    this.indicatorLight.position.set(0.82, 2.5, 0.25);
    this.rootGroup.add(this.indicatorLight);

    // 5. Door Panel / Leaf attached to left hinge pivot
    this.doorPivot = new THREE.Group();
    this.doorPivot.position.set(-0.90, 0, 0); // Left hinge line

    // Door slab: width 1.80m, height 2.60m, depth 0.08m
    const slabGeo = new THREE.BoxGeometry(1.80, 2.60, 0.08);
    const slab = new THREE.Mesh(slabGeo, doorMat);
    slab.position.set(0.90, 1.30, 0); // Centered relative to hinge
    this.doorPivot.add(slab);

    // Reinforcement steel crossbars
    const barGeo = new THREE.BoxGeometry(1.72, 0.08, 0.09);
    const barTop = new THREE.Mesh(barGeo, trimMat);
    barTop.position.set(0.90, 2.10, 0);
    this.doorPivot.add(barTop);

    const barMid = new THREE.Mesh(barGeo, trimMat);
    barMid.position.set(0.90, 1.30, 0);
    this.doorPivot.add(barMid);

    const barBottom = new THREE.Mesh(barGeo, trimMat);
    barBottom.position.set(0.90, 0.50, 0);
    this.doorPivot.add(barBottom);

    // Handle fixture on right edge
    const handleGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.35, 12);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.2, metalness: 0.95 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(1.68, 1.25, 0.08);
    this.doorPivot.add(handle);

    // Heavy keyhole plate
    const plateGeo = new THREE.BoxGeometry(0.12, 0.20, 0.02);
    const plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.3, metalness: 0.85 }));
    plate.position.set(1.68, 1.05, 0.05);
    this.doorPivot.add(plate);

    this.rootGroup.add(this.doorPivot);
    this.scene.add(this.rootGroup);
  }

  _registerInteraction() {
    if (!this.interactionManager) return;
    this.interactionManager.registerInteractable('level0_exit_door', {
      id: 'level0_exit_door',
      type: 'exit_door',
      category: 'environmental',
      object: this.rootGroup,
      maxDistance: 3.2,
      getActionText: () => {
        if (!this.doorState.locked) {
          return 'Escape';
        }
        const hasKey = (window.mpManager?.inventory?.hasItem('doorKey'));
        return hasKey ? 'Unlock' : 'Locked — Requires Key';
      },
      getName: () => {
        if (!this.doorState.locked) {
          return 'Level 0';
        }
        return 'Exit Door';
      }
    });
  }

  initDoors(doorsList) {
    if (!Array.isArray(doorsList)) return;
    for (const d of doorsList) {
      if (d.id === 'level0_exit_door') {
        this.setDoorState(d.id, d.locked, d.unlockedBy);
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
      // Unlocked: swing door open into the exit ladder vestibule (-85 degrees)
      this.targetAngle = -1.48; // ~-85 degrees
      if (this.indicatorBulb) {
        this.indicatorBulb.material.color.setHex(0x22c55e);
        this.indicatorBulb.material.emissive.setHex(0x22c55e);
      }
      if (this.indicatorLight) {
        this.indicatorLight.color.setHex(0x22c55e);
        this.indicatorLight.intensity = 1.8;
      }
      console.log('[ExitDoorManager] Door UNLOCKED authoritatively; swinging open');
    } else {
      // Locked: close door
      this.targetAngle = 0;
      if (this.indicatorBulb) {
        this.indicatorBulb.material.color.setHex(0xef4444);
        this.indicatorBulb.material.emissive.setHex(0xef4444);
      }
      if (this.indicatorLight) {
        this.indicatorLight.color.setHex(0xef4444);
        this.indicatorLight.intensity = 1.2;
      }
    }
  }

  update(delta = 0.016, playerPos = null) {
    // Smooth door swing animation
    if (this.doorPivot && Math.abs(this.currentAngle - this.targetAngle) > 0.001) {
      this.currentAngle += (this.targetAngle - this.currentAngle) * Math.min(1.0, delta * 6.0);
      this.doorPivot.rotation.y = this.currentAngle;
    }

    // Proximity doorway walk-through escape check
    if (!this.doorState.locked && !this.escapeTriggered && playerPos && window.mpManager?.network?.isConnected) {
      const dPos = this.doorState.position;
      const dx = playerPos.x - dPos[0];
      const dz = playerPos.z - dPos[2];
      const dist2D = Math.hypot(dx, dz);

      // Crossing or standing within 1.6m of the open doorway
      if (dist2D < 1.6) {
        this.escapeTriggered = true;
        console.log('[ExitDoorManager] Player walked through open exit doorway; requesting escape');
        window.mpManager.network.requestEscape('level0_exit_door', {
          x: +playerPos.x.toFixed(3),
          y: +(playerPos.y || 0).toFixed(3),
          z: +playerPos.z.toFixed(3)
        });
      }
    }
  }
}
