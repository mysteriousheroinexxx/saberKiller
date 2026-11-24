// Client-Side Saber Monster Manager
// Handles 3D visual representations, TransformInterpolator smoothing,
// animations, hitboxes, and developer Three.js debug aids for persistent Sabers (Alpha & Beta).

import { TransformInterpolator } from './interpolation.js';

class SaberEntity {
  constructor(id, name, colorHex, scene) {
    this.id = id;
    this.name = name;
    this.colorHex = colorHex;
    this.scene = scene;

    this.interpolator = new TransformInterpolator({ interpolationDelay: 80 });
    this.state = 'PATROL';
    this.health = 100;
    this.isInvulnerable = false;
    this.targetId = null;
    this.currentSpeed = 0;
    this.debugVisible = false;

    // Root group
    this.group = new THREE.Group();
    this.group.name = `Saber_${id}`;
    this.group.visible = false; // Hidden until match starts or snapshot received

    // Procedural humanoid rig
    this.meshGroup = new THREE.Group();
    this.group.add(this.meshGroup);

    this._buildMesh();
    this._buildDebugAids();

    this.scene.add(this.group);
  }

  _buildMesh() {
    // 1. Torso / Body
    const torsoGeo = new THREE.BoxGeometry(0.55, 0.95, 0.35);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1f2429,
      roughness: 0.5,
      metalness: 0.6
    });
    this.torso = new THREE.Mesh(torsoGeo, bodyMat);
    this.torso.position.y = 1.15;
    this.torso.castShadow = true;
    this.torso.receiveShadow = true;
    this.meshGroup.add(this.torso);

    // Armor plate on chest
    const chestPlateGeo = new THREE.BoxGeometry(0.48, 0.5, 0.08);
    const chestPlateMat = new THREE.MeshStandardMaterial({
      color: this.colorHex,
      roughness: 0.35,
      metalness: 0.7
    });
    const chestPlate = new THREE.Mesh(chestPlateGeo, chestPlateMat);
    chestPlate.position.set(0, 0.12, 0.18);
    this.torso.add(chestPlate);

    // 2. Head & Visor
    const headGeo = new THREE.BoxGeometry(0.32, 0.35, 0.32);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x15181b,
      roughness: 0.4,
      metalness: 0.7
    });
    this.head = new THREE.Mesh(headGeo, headMat);
    this.head.position.set(0, 0.68, 0.02);
    this.head.castShadow = true;
    this.torso.add(this.head);

    // Visor strip (Emissive glowing eye)
    const visorGeo = new THREE.BoxGeometry(0.28, 0.08, 0.06);
    this.visorMat = new THREE.MeshBasicMaterial({ color: this.colorHex });
    this.visor = new THREE.Mesh(visorGeo, this.visorMat);
    this.visor.position.set(0, 0.04, 0.16);
    this.head.add(this.visor);

    // Visor point light (illuminates surroundings)
    this.eyeLight = new THREE.PointLight(this.colorHex, 2.5, 8.0, 1.8);
    this.eyeLight.position.set(0, 0.04, 0.35);
    this.head.add(this.eyeLight);

    // 3. Arms (left & right)
    const armGeo = new THREE.BoxGeometry(0.18, 0.85, 0.18);
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x242a30,
      roughness: 0.55,
      metalness: 0.5
    });

    this.leftArmPivot = new THREE.Group();
    this.leftArmPivot.position.set(-0.38, 0.38, 0);
    this.leftArm = new THREE.Mesh(armGeo, armMat);
    this.leftArm.position.y = -0.38;
    this.leftArm.castShadow = true;
    this.leftArmPivot.add(this.leftArm);
    this.torso.add(this.leftArmPivot);

    this.rightArmPivot = new THREE.Group();
    this.rightArmPivot.position.set(0.38, 0.38, 0);
    this.rightArm = new THREE.Mesh(armGeo, armMat);
    this.rightArm.position.y = -0.38;
    this.rightArm.castShadow = true;
    this.rightArmPivot.add(this.rightArm);
    this.torso.add(this.rightArmPivot);

    // 4. Legs (left & right)
    const legGeo = new THREE.BoxGeometry(0.2, 0.85, 0.22);
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x181c20,
      roughness: 0.6,
      metalness: 0.4
    });

    this.leftLegPivot = new THREE.Group();
    this.leftLegPivot.position.set(-0.18, 0.85, 0);
    this.leftLeg = new THREE.Mesh(legGeo, legMat);
    this.leftLeg.position.y = -0.42;
    this.leftLeg.castShadow = true;
    this.leftLegPivot.add(this.leftLeg);
    this.meshGroup.add(this.leftLegPivot);

    this.rightLegPivot = new THREE.Group();
    this.rightLegPivot.position.set(0.18, 0.85, 0);
    this.rightLeg = new THREE.Mesh(legGeo, legMat);
    this.rightLeg.position.y = -0.42;
    this.rightLeg.castShadow = true;
    this.rightLegPivot.add(this.rightLeg);
    this.meshGroup.add(this.rightLegPivot);

    // 5. Hitbox Mesh (used for weapon raycasting)
    const hitboxGeo = new THREE.CylinderGeometry(0.48, 0.48, 2.1, 12);
    const hitboxMat = new THREE.MeshBasicMaterial({
      visible: false,
      wireframe: true,
      color: 0xff0000
    });
    this.hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    this.hitbox.position.y = 1.05;
    this.hitbox.userData = {
      isMonster: true,
      monsterId: this.id,
      saber: this
    };
    this.group.add(this.hitbox);
  }

  _buildDebugAids() {
    this.debugGroup = new THREE.Group();
    this.debugGroup.name = `DebugAids_${this.id}`;
    this.debugGroup.visible = false;

    // 1. Vision Cone (110° FOV, 22m range at eye height 1.8m)
    const fovAngle = Math.PI * 0.61; // 110 deg
    const range = 22.0;
    const conePoints = [new THREE.Vector3(0, 1.8, 0)];
    const segments = 24;
    for (let i = 0; i <= segments; i++) {
      const theta = -fovAngle / 2 + (fovAngle * i / segments);
      conePoints.push(new THREE.Vector3(
        Math.sin(theta) * range,
        1.8,
        Math.cos(theta) * range
      ));
    }
    const coneGeo = new THREE.BufferGeometry().setFromPoints(conePoints);
    this.coneLine = new THREE.LineLoop(
      coneGeo,
      new THREE.LineBasicMaterial({
        color: this.colorHex,
        transparent: true,
        opacity: 0.65,
        linewidth: 2
      })
    );
    this.debugGroup.add(this.coneLine);

    // 2. Forward Heading Arrow (2.8m length at eye height 1.8m)
    this.arrowHelper = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1.8, 0),
      2.8,
      this.colorHex,
      0.6,
      0.35
    );
    this.debugGroup.add(this.arrowHelper);

    // 3. Line of Sight Ray (eye height 1.8m to target)
    const losGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 1.8, 0),
      new THREE.Vector3(0, 1.4, 0)
    ]);
    this.losMat = new THREE.LineBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.85,
      linewidth: 2
    });
    this.losLine = new THREE.Line(losGeo, this.losMat);
    this.losLine.visible = false;
    this.scene.add(this.losLine);

    this.group.add(this.debugGroup);
  }

  setDebugVisible(visible) {
    this.debugVisible = Boolean(visible);
    if (this.debugGroup) this.debugGroup.visible = this.debugVisible;
    if (this.hitbox && this.hitbox.material) {
      this.hitbox.material.visible = this.debugVisible;
    }
    if (!this.debugVisible && this.losLine) {
      this.losLine.visible = false;
    }
  }

  pushSnapshot(data) {
    const posX = (typeof data.x === 'number') ? data.x : (data.position?.x ?? 0);
    const posY = (typeof data.y === 'number') ? data.y : (data.position?.y ?? 0);
    const posZ = (typeof data.z === 'number') ? data.z : (data.position?.z ?? 0);
    let rotYaw = 0;
    if (typeof data.yaw === 'number') {
      rotYaw = data.yaw;
    } else if (data.rotation) {
      const q = data.rotation;
      rotYaw = 2 * Math.atan2(q.y || 0, q.w ?? 1);
    }

    this.interpolator.pushSnapshot({
      x: posX,
      y: posY,
      z: posZ,
      yaw: rotYaw,
      pitch: data.pitch || 0,
      timestamp: data.timestamp || Date.now()
    });

    this.state = data.state || 'PATROL';
    this.health = (typeof data.health === 'number') ? data.health : 100;
    this.isInvulnerable = Boolean(data.isInvulnerable);
    this.targetId = data.targetId || null;
    this.currentSpeed = (typeof data.speed === 'number') ? data.speed : (data.currentSpeed || 0);

    this.group.visible = true;
  }

  update(dt, targetPlayerPos = null) {
    const s = this.interpolator.update(dt);

    // Update root group transform
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.y = s.yaw;

    // Animate limbs & state visual poses
    this._animateState(dt);

    // Update Line of Sight debug ray if enabled
    if (this.debugVisible && this.losLine) {
      if (targetPlayerPos && (this.state === 'CHASE' || this.state === 'ATTACK' || this.state === 'STALK')) {
        const eyePos = new THREE.Vector3(s.x, s.y + 1.8, s.z);
        const targetChest = new THREE.Vector3(targetPlayerPos.x, targetPlayerPos.y + 1.4, targetPlayerPos.z);
        this.losLine.geometry.setFromPoints([eyePos, targetChest]);
        this.losMat.color.setHex(0x4ade80); // Clear green
        this.losLine.visible = true;
      } else {
        this.losLine.visible = false;
      }
    }
  }

  _animateState(dt) {
    const walkFreq = 8.0;
    const walkAmp = 0.35;
    const isMoving = this.currentSpeed > 0.4;
    const time = Date.now() * 0.001;

    if (this.state === 'STAGGERED') {
      // Collapsed / hunched posture (10s stagger window)
      this.torso.rotation.x = THREE.MathUtils.lerp(this.torso.rotation.x, 0.75, dt * 6.0);
      this.torso.position.y = THREE.MathUtils.lerp(this.torso.position.y, 0.75, dt * 6.0);
      this.leftArmPivot.rotation.x = 0.2;
      this.rightArmPivot.rotation.x = 0.2;
      this.leftLegPivot.rotation.x = -0.5;
      this.rightLegPivot.rotation.x = -0.5;
      // Visor flickers erratically
      this.eyeLight.intensity = Math.random() > 0.5 ? 0.3 : 1.8;
      this.visorMat.color.setHex(Math.random() > 0.5 ? 0x441111 : this.colorHex);
    } else if (this.state === 'RECOVER') {
      // Standing back up, visor pulses smoothly
      this.torso.rotation.x = THREE.MathUtils.lerp(this.torso.rotation.x, 0.1, dt * 3.0);
      this.torso.position.y = THREE.MathUtils.lerp(this.torso.position.y, 1.15, dt * 3.0);
      this.eyeLight.intensity = 1.5 + Math.sin(time * 6.0) * 1.0;
      this.visorMat.color.setHex(this.colorHex);
    } else if (this.state === 'ATTACK') {
      // Aggressive strike posture / lunge
      this.torso.rotation.x = 0.35;
      this.torso.position.y = 1.15;
      this.rightArmPivot.rotation.x = -1.6; // Right arm raised forward for slash
      this.leftArmPivot.rotation.x = 0.4;
      this.eyeLight.intensity = 4.0;
      this.visorMat.color.setHex(0xffffff); // White-hot strike flash
    } else if (this.state === 'CHASE') {
      // Forward aggressive run tilt
      this.torso.rotation.x = 0.22;
      this.torso.position.y = 1.15;
      this.eyeLight.intensity = 3.2;
      this.visorMat.color.setHex(this.colorHex);

      // Rapid limb swing
      const swing = Math.sin(time * walkFreq * 1.5) * walkAmp * 1.4;
      this.leftArmPivot.rotation.x = swing;
      this.rightArmPivot.rotation.x = -swing;
      this.leftLegPivot.rotation.x = -swing;
      this.rightLegPivot.rotation.x = swing;
    } else {
      // PATROL, SEARCH, INVESTIGATE_SOUND, STALK
      this.torso.rotation.x = THREE.MathUtils.lerp(this.torso.rotation.x, 0.0, dt * 4.0);
      this.torso.position.y = THREE.MathUtils.lerp(this.torso.position.y, 1.15, dt * 4.0);
      this.eyeLight.intensity = (this.state === 'STALK') ? 1.0 : 2.0;
      this.visorMat.color.setHex(this.colorHex);

      if (isMoving) {
        const swing = Math.sin(time * walkFreq) * walkAmp;
        this.leftArmPivot.rotation.x = swing;
        this.rightArmPivot.rotation.x = -swing;
        this.leftLegPivot.rotation.x = -swing;
        this.rightLegPivot.rotation.x = swing;
      } else {
        // Idle breathing
        this.leftArmPivot.rotation.x = THREE.MathUtils.lerp(this.leftArmPivot.rotation.x, 0, dt * 4.0);
        this.rightArmPivot.rotation.x = THREE.MathUtils.lerp(this.rightArmPivot.rotation.x, 0, dt * 4.0);
        this.leftLegPivot.rotation.x = THREE.MathUtils.lerp(this.leftLegPivot.rotation.x, 0, dt * 4.0);
        this.rightLegPivot.rotation.x = THREE.MathUtils.lerp(this.rightLegPivot.rotation.x, 0, dt * 4.0);
      }
    }
  }

  triggerHitEffect(point) {
    // Temporary flash on hit
    this.visorMat.color.setHex(0xffffff);
    this.eyeLight.intensity = 5.0;
    setTimeout(() => {
      if (this.state !== 'STAGGERED') {
        this.visorMat.color.setHex(this.colorHex);
        this.eyeLight.intensity = 2.5;
      }
    }, 120);
  }

  destroy() {
    if (this.scene) {
      this.scene.remove(this.group);
      if (this.losLine) this.scene.remove(this.losLine);
    }
  }
}

export class SaberManager {
  constructor(scene) {
    this.scene = scene;
    this.sabers = new Map();
    this.soundPulses = [];
    this.debugAidsVisible = false;

    // Instantiate exactly two persistent Sabers
    // Saber Alpha: Crimson / Red (Menace)
    this.saberAlpha = new SaberEntity('saber_alpha', 'Saber Alpha (Menace)', 0xef4444, this.scene);
    this.sabers.set('saber_alpha', this.saberAlpha);

    // Saber Beta: Cyan / Blue (Stalker)
    this.saberBeta = new SaberEntity('saber_beta', 'Saber Beta (Stalker)', 0x3b82f6, this.scene);
    this.sabers.set('saber_beta', this.saberBeta);
  }

  handleSnapshot(payload) {
    if (!payload || !Array.isArray(payload.monsters)) return;

    for (const data of payload.monsters) {
      const saber = this.sabers.get(data.id);
      if (saber) {
        saber.pushSnapshot(data);
      }
    }
  }

  handleSoundEvent(event) {
    if (!event || !this.debugAidsVisible) return;
    const pos = event.worldPosition || event.stimulus?.worldPosition;
    if (!pos) return;
    const radius = event.detectionRadius || event.stimulus?.detectionRadius || 20;
    const isGunshot = (event.soundType || event.stimulus?.soundType || '').includes('GUNSHOT');
    const color = isGunshot ? 0xef4444 : (event.isSprint ? 0xf59e0b : 0x06b6d4);
    this.spawnSoundPulse(pos, radius, color);
  }

  spawnSoundPulse(pos, maxRadius, colorHex = 0xf59e0b) {
    const pulseGeo = new THREE.RingGeometry(0.2, 0.5, 32);
    const pulseMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95
    });
    const ring = new THREE.Mesh(pulseGeo, pulseMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.1, pos.z);
    this.scene.add(ring);
    this.soundPulses.push({
      mesh: ring,
      maxRadius: Math.min(maxRadius, 50),
      currentRadius: 0.5,
      opacity: 1.0
    });
  }

  getHitboxes() {
    const boxes = [];
    for (const saber of this.sabers.values()) {
      if (saber.group.visible && saber.hitbox) {
        boxes.push(saber.hitbox);
      }
    }
    return boxes;
  }

  triggerHitEffect(monsterId, worldPoint) {
    const saber = this.sabers.get(monsterId);
    if (saber) {
      saber.triggerHitEffect(worldPoint);
    }
  }

  setDebugAidsVisible(visible) {
    this.debugAidsVisible = Boolean(visible);
    for (const saber of this.sabers.values()) {
      saber.setDebugVisible(this.debugAidsVisible);
    }
    if (!this.debugAidsVisible) {
      for (const p of this.soundPulses) {
        this.scene.remove(p.mesh);
      }
      this.soundPulses.length = 0;
    }
  }

  update(dt, localPlayerPos = null) {
    // Update individual Sabers
    for (const saber of this.sabers.values()) {
      saber.update(dt, localPlayerPos);
    }

    // Update sound pulse ripples
    if (this.soundPulses.length > 0) {
      for (let i = this.soundPulses.length - 1; i >= 0; i--) {
        const p = this.soundPulses[i];
        p.currentRadius += dt * 30.0;
        p.opacity -= dt * 1.4;

        if (p.opacity <= 0 || p.currentRadius >= p.maxRadius) {
          this.scene.remove(p.mesh);
          this.soundPulses.splice(i, 1);
        } else {
          const s = p.currentRadius / 0.5;
          p.mesh.scale.set(s, s, 1);
          p.mesh.material.opacity = Math.max(0, p.opacity);
        }
      }
    }
  }

  destroy() {
    for (const saber of this.sabers.values()) {
      saber.destroy();
    }
    this.sabers.clear();
    for (const p of this.soundPulses) {
      this.scene.remove(p.mesh);
    }
    this.soundPulses.length = 0;
  }
}
