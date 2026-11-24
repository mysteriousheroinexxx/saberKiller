// Client-Side Saber Monster Manager
// Loads and manages the authentic Saber Mixamo-animated GLB character models,
// independent AnimationMixers for Alpha & Beta, TransformInterpolator smoothing,
// hitboxes, and developer Three.js debug aids.

import { TransformInterpolator } from './interpolation.js';

let sharedSaberTemplatePromise = null;

function skinnedWorldBox(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const bm = new THREE.Matrix4();
  root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    const pos = o.geometry.attributes.position.array;
    const si = o.geometry.attributes.skinIndex.array;
    const sw = o.geometry.attributes.skinWeight.array;
    const bones = o.skeleton.boneMatrices;
    const n = o.geometry.attributes.position.count;
    for (let i = 0; i < n; i++) {
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(o.bindMatrixInverse);
      let x = 0, y = 0, z = 0;
      const tx = v.x, ty = v.y, tz = v.z;
      for (let j = 0; j < 4; j++) {
        const w = sw[i * 4 + j];
        if (w === 0) continue;
        bm.fromArray(bones, si[i * 4 + j] * 16);
        const e = bm.elements;
        x += (e[0] * tx + e[4] * ty + e[8] * tz + e[12]) * w;
        y += (e[1] * tx + e[5] * ty + e[9] * tz + e[13]) * w;
        z += (e[2] * tx + e[6] * ty + e[10] * tz + e[14]) * w;
      }
      v.set(x, y, z).applyMatrix4(o.bindMatrix).applyMatrix4(o.matrixWorld);
      box.expandByPoint(v);
    }
  });
  return box;
}

export function preloadSaberAssets() {
  if (sharedSaberTemplatePromise) return sharedSaberTemplatePromise;

  const loader = new THREE.GLTFLoader();
  const targetHeight = 1.85; // Matches authentic Story Mode ZMODEL.height

  sharedSaberTemplatePromise = Promise.all([
    loader.loadAsync('assets/saber.glb'),
    loader.loadAsync('assets/saberWalking_clean.glb'),
    loader.loadAsync('assets/saberJumpKickAndPunch_clean.glb'),
    loader.loadAsync('assets/saberFalling_clean.glb'),
    loader.loadAsync('assets/saberPunches_clean.glb')
  ]).then(([orig, w, a, f, p]) => {
    // 1. Map original texture maps by mesh-name leading digit (Mixamo stripped textures)
    const byPrefix = {};
    orig.scene.traverse(o => {
      if (o.isMesh) {
        const m = o.name.match(/^(\d+)/);
        if (m && o.material && o.material.map) {
          byPrefix[m[1]] = o.material;
        }
      }
    });

    // 2. Wrap and normalize base skinned mesh
    const model = w.scene;
    const wrap = new THREE.Group();
    wrap.add(model);

    // Compute bounding box and ground feet at Y = 0
    let bb = skinnedWorldBox(wrap);
    const rawH = Math.max(0.001, bb.max.y - bb.min.y);
    const s = targetHeight / rawH;
    wrap.scale.setScalar(s);
    bb = skinnedWorldBox(wrap);
    model.position.y = -bb.min.y / s;
    wrap.updateMatrixWorld(true);

    // 3. Strip /Hips.position$/ translation tracks to eliminate in-place sliding
    const strip = cl => {
      const cloned = cl.clone();
      cloned.tracks = cloned.tracks.filter(t => !/Hips\.position$/.test(t.name));
      return cloned;
    };

    const walkClip = strip(w.animations[0]);
    walkClip.name = 'walk';

    const jumpPunchClip = strip(a.animations[0]);
    jumpPunchClip.name = 'jump_punch';

    const punchesClip = strip(p.animations[0]);
    punchesClip.name = 'punch';

    const deathClip = f.animations.reduce((x, y) =>
      Math.abs(y.duration - 2.17) < Math.abs(x.duration - 2.17) ? y : x
    ).clone();
    deathClip.name = 'falling';

    return {
      template: wrap,
      byPrefix,
      clips: {
        walk: walkClip,
        punch: punchesClip,
        jumpPunch: jumpPunchClip,
        falling: deathClip
      }
    };
  }).catch(err => {
    console.error('[SaberManager] Failed to load Saber GLB assets:', err);
    return null;
  });

  return sharedSaberTemplatePromise;
}

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

    // Animation & GLB state
    this.mixer = null;
    this.actions = {};
    this.currentClipName = 'idle';
    this.isModelLoaded = false;
    this.attackAnimT = 0;

    // Root group
    this.group = new THREE.Group();
    this.group.name = `Saber_${id}`;
    this.group.visible = false; // Hidden until match start / snapshot

    // Visual model container
    this.visualGroup = new THREE.Group();
    this.group.add(this.visualGroup);

    // Hitbox for weapon hitscan raycasting
    this._buildHitbox();
    this._buildDebugAids();

    this.scene.add(this.group);
    this._initGLBModel();
  }

  _buildHitbox() {
    // 2.0m height, 0.45m radius cylindrical hitbox
    const hitboxGeo = new THREE.CylinderGeometry(0.45, 0.45, 2.0, 12);
    const hitboxMat = new THREE.MeshBasicMaterial({
      visible: false,
      wireframe: true,
      color: 0xff0000
    });
    this.hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
    this.hitbox.position.y = 1.0;
    this.hitbox.userData = {
      isMonster: true,
      monsterId: this.id,
      saber: this
    };
    this.group.add(this.hitbox);
  }

  _initGLBModel() {
    preloadSaberAssets().then(assetData => {
      if (!assetData || !assetData.template) return;

      const { template, byPrefix, clips } = assetData;

      // Clone rigged model with its own independent skeleton
      const clone = THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(template) : template.clone(true);

      // Re-apply original textures and setup PBR/Lambert materials
      const isAlpha = (this.colorHex === 0xef4444);
      clone.traverse(o => {
        if (o.isMesh) {
          const m = o.name.match(/^(\d+)/);
          const src = m && byPrefix[m[1]];
          const mat = new THREE.MeshLambertMaterial({
            map: src ? src.map : null,
            color: src ? src.color.clone() : new THREE.Color(0x8899aa),
            emissive: isAlpha ? 0x220505 : 0x051525,
            transparent: src ? src.transparent : false,
            alphaTest: src ? (src.alphaTest || 0) : 0
          });
          o.material = mat;
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;
        }
      });

      // Attach glowing visor and PointLight directly to Mixamo head bone
      const headBone = clone.getObjectByName('mixamorigHead');
      if (headBone) {
        // Glowing visor bar on face
        const visorGeo = new THREE.BoxGeometry(0.18, 0.04, 0.08);
        this.visorMat = new THREE.MeshBasicMaterial({ color: this.colorHex });
        const visorMesh = new THREE.Mesh(visorGeo, this.visorMat);
        visorMesh.position.set(0, 0.12, 0.14);
        headBone.add(visorMesh);
        this.visorMesh = visorMesh;

        // Ominous point light casting local glow
        this.eyeLight = new THREE.PointLight(this.colorHex, 2.2, 7.5, 1.8);
        this.eyeLight.position.set(0, 0.12, 0.22);
        headBone.add(this.eyeLight);
      }

      // Initialize independent AnimationMixer
      this.mixer = new THREE.AnimationMixer(clone);
      this.actions = {
        walk: this.mixer.clipAction(clips.walk),
        punch: this.mixer.clipAction(clips.punch),
        jumpPunch: this.mixer.clipAction(clips.jumpPunch),
        falling: this.mixer.clipAction(clips.falling)
      };

      this.actions.walk.play();
      this.actions.punch.setLoop(THREE.LoopOnce, 1);
      this.actions.punch.clampWhenFinished = true;
      this.actions.jumpPunch.setLoop(THREE.LoopOnce, 1);
      this.actions.jumpPunch.clampWhenFinished = true;
      this.actions.falling.setLoop(THREE.LoopOnce, 1);
      this.actions.falling.clampWhenFinished = true;

      // Handle attack animation completion
      this.mixer.addEventListener('finished', e => {
        if (e.action === this.actions.punch || e.action === this.actions.jumpPunch) {
          this.actions.walk.reset().play();
          e.action.crossFadeTo(this.actions.walk, 0.15);
          this.currentClipName = this.currentSpeed > 0.3 ? 'walk' : 'idle';
        }
      });

      this.visualGroup.add(clone);
      this.isModelLoaded = true;
    });
  }

  _buildDebugAids() {
    this.debugGroup = new THREE.Group();
    this.debugGroup.name = `DebugAids_${this.id}`;
    this.debugGroup.visible = false;

    // 1. Human-like ~180° FOV Vision Cone (radius = 35m)
    const fovAngle = Math.PI; // 180 degrees
    const range = 35.0;
    const conePoints = [new THREE.Vector3(0, 1.8, 0)];
    const segments = 32;
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

    // 2. Forward Direction Arrow (2.8m length at eye height 1.8m)
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

    // 4. Dijkstra Path Line in 3D (shows active navigation route)
    const pathGeo = new THREE.BufferGeometry();
    const pathMat = new THREE.LineBasicMaterial({
      color: this.colorHex,
      transparent: true,
      opacity: 0.85,
      linewidth: 3
    });
    this.pathLine = new THREE.Line(pathGeo, pathMat);
    this.pathLine.visible = false;
    this.scene.add(this.pathLine);

    this.group.add(this.debugGroup);
  }

  setDebugVisible(visible) {
    this.debugVisible = Boolean(visible);
    if (this.debugGroup) this.debugGroup.visible = this.debugVisible;
    if (this.hitbox && this.hitbox.material) {
      this.hitbox.material.visible = this.debugVisible;
    }
    if (!this.debugVisible) {
      if (this.losLine) this.losLine.visible = false;
      if (this.pathLine) this.pathLine.visible = false;
    }
  }

  setPathVisualization(waypoints) {
    if (!this.debugVisible || !this.pathLine) return;
    if (Array.isArray(waypoints) && waypoints.length >= 2) {
      const pts = waypoints.map(w => new THREE.Vector3(w.x, (w.y || 0) + 0.25, w.z));
      this.pathLine.geometry.setFromPoints(pts);
      this.pathLine.visible = true;
    } else {
      this.pathLine.visible = false;
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

    const prevState = this.state;
    this.state = data.state || 'PATROL';
    this.health = (typeof data.health === 'number') ? data.health : 100;
    this.isInvulnerable = Boolean(data.isInvulnerable);
    this.targetId = data.targetId || null;
    this.currentSpeed = (typeof data.speed === 'number') ? data.speed : (data.currentSpeed || 0);

    // Trigger state-specific animation transitions
    if (this.isModelLoaded && this.actions.walk) {
      if (this.state === 'ATTACK' && prevState !== 'ATTACK') {
        // Trigger attack punch or jump punch
        const isJump = (Math.random() > 0.5) || (this.currentSpeed > 3.0);
        const action = isJump ? this.actions.jumpPunch : this.actions.punch;
        this.currentClipName = isJump ? 'jump_punch' : 'punch';
        action.reset().play();
        this.actions.walk.crossFadeTo(action, 0.1);
      } else if (this.state === 'STAGGERED' && prevState !== 'STAGGERED') {
        // Trigger collapse / falling animation
        this.currentClipName = 'falling';
        this.actions.falling.reset().play();
        this.actions.walk.crossFadeTo(this.actions.falling, 0.2);
      } else if (this.state === 'RECOVER' && prevState === 'STAGGERED') {
        // Stand back up from stagger
        this.currentClipName = 'recover';
        this.actions.walk.reset().play();
        this.actions.falling.crossFadeTo(this.actions.walk, 0.4);
      }
    }

    this.group.visible = true;
  }

  update(dt, targetPlayerPos = null) {
    const s = this.interpolator.update(dt);

    // Update root group transform
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.y = s.yaw;

    // Advance independent AnimationMixer
    if (this.mixer) {
      this.mixer.update(dt);
    }

    // Synchronize animation playback speed and transitions
    this._updateAnimationState(dt);

    // Update Line of Sight debug ray
    if (this.debugVisible && this.losLine) {
      if (targetPlayerPos && (this.state === 'CHASE' || this.state === 'ATTACK' || this.state === 'STALK')) {
        const eyePos = new THREE.Vector3(s.x, s.y + 1.8, s.z);
        const targetChest = new THREE.Vector3(targetPlayerPos.x, targetPlayerPos.y + 1.4, targetPlayerPos.z);
        this.losLine.geometry.setFromPoints([eyePos, targetChest]);
        this.losMat.color.setHex(0x4ade80);
        this.losLine.visible = true;
      } else {
        this.losLine.visible = false;
      }
    }
  }

  _updateAnimationState(dt) {
    if (!this.isModelLoaded || !this.actions.walk) return;

    const time = Date.now() * 0.001;

    if (this.state === 'STAGGERED') {
      // Visor flickers erratically while collapsed
      if (this.eyeLight) {
        this.eyeLight.intensity = Math.random() > 0.5 ? 0.2 : 1.2;
      }
      this.currentClipName = 'falling';
    } else if (this.state === 'RECOVER') {
      // Visor pulses smoothly while rising
      if (this.eyeLight) {
        this.eyeLight.intensity = 1.2 + Math.sin(time * 6.0) * 1.0;
      }
      this.currentClipName = 'recover';
    } else if (this.state === 'ATTACK') {
      if (this.eyeLight) this.eyeLight.intensity = 4.0;
      if (this.visorMat) this.visorMat.color.setHex(0xffffff); // White-hot strike flash
    } else {
      // Locomotion (PATROL, CHASE, STALK, INVESTIGATE_SOUND)
      if (this.visorMat) this.visorMat.color.setHex(this.colorHex);

      if (this.currentSpeed > 0.3) {
        if (this.state === 'CHASE') {
          // Fast pursuit sprint
          this.actions.walk.timeScale = Math.max(1.5, this.currentSpeed / 3.8);
          if (this.eyeLight) this.eyeLight.intensity = 3.5;
          this.currentClipName = 'chase';
        } else if (this.state === 'STALK') {
          // Stalking stride
          this.actions.walk.timeScale = Math.max(1.0, this.currentSpeed / 4.5);
          if (this.eyeLight) this.eyeLight.intensity = 1.2;
          this.currentClipName = 'stalk';
        } else {
          // Normal patrol / investigation walk
          this.actions.walk.timeScale = Math.max(0.7, this.currentSpeed / 2.8);
          if (this.eyeLight) this.eyeLight.intensity = 2.0;
          this.currentClipName = 'walk';
        }
      } else {
        // Stationary idle
        this.actions.walk.timeScale = 0.0;
        if (this.eyeLight) this.eyeLight.intensity = 1.6;
        this.currentClipName = 'idle';
      }
    }
  }

  triggerHitEffect(point) {
    if (this.visorMat) this.visorMat.color.setHex(0xffffff);
    if (this.eyeLight) this.eyeLight.intensity = 5.0;
    setTimeout(() => {
      if (this.state !== 'STAGGERED' && this.visorMat) {
        this.visorMat.color.setHex(this.colorHex);
        if (this.eyeLight) this.eyeLight.intensity = 2.2;
      }
    }, 120);
  }

  destroy() {
    if (this.scene) {
      this.scene.remove(this.group);
      if (this.losLine) this.scene.remove(this.losLine);
      if (this.pathLine) this.scene.remove(this.pathLine);
    }
    if (this.mixer) {
      this.mixer.stopAllAction();
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

    preloadSaberAssets();
  }

  handleSnapshot(payload) {
    if (!payload || !Array.isArray(payload.monsters)) return;

    for (const data of payload.monsters) {
      const saber = this.sabers.get(data.id);
      if (saber) {
        saber.pushSnapshot(data);
        if (data.pathWaypoints) {
          saber.setPathVisualization(data.pathWaypoints);
        }
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
