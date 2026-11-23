/**
 * World Item Manager — Data-Driven Item Placement & Prop Management for Survival Mode
 * Features:
 * - Dynamic wrapper-based model normalization (non-destructive pivot centering & surface snapping)
 * - Reusable surface placement engine with floor raycasting and furniture surface detection
 * - Physical support validation and wall/object intersection audits
 * - Developer-only debug bounding box visualization (hidden by default during normal play)
 * - Placement anchors and telemetry reporting for runtime validation
 */

import { getItemDefinition } from './item_catalog.js';

export class WorldItemManager {
  constructor(scene, collisionHandler = null) {
    this.scene = scene;
    this.collisionHandler = collisionHandler;
    this.container = new THREE.Group();
    this.container.name = 'WorldItemsContainer';
    if (this.scene) {
      this.scene.add(this.container);
    }

    // Developer-only debug bounding box visualization group (hidden by default)
    this.debugContainer = new THREE.Group();
    this.debugContainer.name = 'WorldItemsDebugContainer';
    this.debugContainer.visible = false;
    if (this.scene) {
      this.scene.add(this.debugContainer);
    }

    this.loader = new THREE.GLTFLoader();
    this.raycaster = new THREE.Raycaster();
    this.templates = new Map(); // url -> THREE.Group
    this.catalog = {};
    this.items = []; // list of instantiated item objects
    this.propMap = new Map(); // propId -> wrapper
    this.isLoaded = false;
    this.debugVisualsActive = false;
    this.collectedItemIds = new Set();

    // Obstacle geometry cache for high-precision narrow-phase collision (SAT)
    this.obstacles = [];
    this.obstaclesLoaded = false;
  }

  setCollisionHandler(ch) {
    this.collisionHandler = ch;
  }

  /**
   * Initializes physical level obstacle bounds from map JSON (walls & pillars)
   */
  async initObstacles(map = null) {
    if (this.obstaclesLoaded && this.obstacles.length > 0) return;
    try {
      let mapData = map;
      if (!mapData) {
        const res = await fetch('assets/level0/level0_map.json');
        mapData = await res.json();
      }
      this._buildObstaclesFromMap(mapData);
      this.obstaclesLoaded = true;
    } catch (e) {
      console.warn('[WorldItemManager] Failed to load obstacles from level0_map.json:', e);
    }
  }

  _buildObstaclesFromMap(map) {
    this.obstacles = [];
    if (!map) return;

    // 1. Level 0 Walls (BoxGeometry 10.0 x 4.0 x 0.8 translated by [0, 2.0, 0])
    const walls = map.walls || [];
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      const cx = w[0], cy = (w[1] || 0) + 2.0, cz = w[2];
      const rotY = w[3] || 0;
      const hx = 5.0, hy = 2.0, hz = 0.4;
      const cos = Math.cos(rotY);
      const sin = Math.sin(rotY);
      const corners = [
        { x: cx - hx * cos + hz * sin, z: cz - hx * sin - hz * cos },
        { x: cx + hx * cos + hz * sin, z: cz + hx * sin - hz * cos },
        { x: cx + hx * cos - hz * sin, z: cz + hx * sin + hz * cos },
        { x: cx - hx * cos - hz * sin, z: cz - hx * sin + hz * cos }
      ];
      const axes = [
        { x: cos, z: sin },
        { x: -sin, z: cos }
      ];
      const xs = corners.map(c => c.x);
      const zs = corners.map(c => c.z);
      this.obstacles.push({
        id: `Wall #${i}`,
        type: 'wall',
        cx, cy, cz,
        minY: (w[1] || 0),
        maxY: (w[1] || 0) + 4.0,
        corners,
        axes,
        aabb: {
          minX: Math.min(...xs),
          maxX: Math.max(...xs),
          minZ: Math.min(...zs),
          maxZ: Math.max(...zs),
          minY: (w[1] || 0),
          maxY: (w[1] || 0) + 4.0
        }
      });
    }

    // 2. Level 0 Pillars (BoxGeometry 2.0 x 4.0 x 2.0 translated by [0, 2.0, 0])
    const pillars = map.pillars || [];
    for (let i = 0; i < pillars.length; i++) {
      const p = pillars[i];
      const cx = p[0], cy = (p[1] || 0) + 2.0, cz = p[2];
      const hx = 1.0, hy = 2.0, hz = 1.0;
      const corners = [
        { x: cx - hx, z: cz - hz },
        { x: cx + hx, z: cz - hz },
        { x: cx + hx, z: cz + hz },
        { x: cx - hx, z: cz + hz }
      ];
      const axes = [
        { x: 1, z: 0 },
        { x: 0, z: 1 }
      ];
      this.obstacles.push({
        id: `Pillar #${i}`,
        type: 'pillar',
        cx, cy, cz,
        minY: (p[1] || 0),
        maxY: (p[1] || 0) + 4.0,
        corners,
        axes,
        aabb: {
          minX: cx - hx,
          maxX: cx + hx,
          minZ: cz - hz,
          maxZ: cz + hz,
          minY: (p[1] || 0),
          maxY: (p[1] || 0) + 4.0
        }
      });
    }
    console.log(`[WorldItemManager] Cached ${this.obstacles.length} narrow-phase obstacle geometries for Level 0`);
  }

  /**
   * Preloads a single GLB template model and prepares shadow casting/receiving
   */
  async preloadTemplate(url) {
    if (this.templates.has(url)) {
      return this.templates.get(url);
    }

    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          const root = gltf.scene;
          root.traverse((node) => {
            if (node.isMesh) {
              node.castShadow = true;
              node.receiveShadow = true;

              if (node.material) {
                // Ensure material handles light correctly under Configuration D
                if (Array.isArray(node.material)) {
                  node.material.forEach((mat) => {
                    mat.needsUpdate = true;
                  });
                } else {
                  node.material.needsUpdate = true;
                }
              }
            }
          });
          this.templates.set(url, root);
          resolve(root);
        },
        undefined,
        (err) => {
          console.error(`[WorldItemManager] Failed to load model template: ${url}`, err);
          reject(err);
        }
      );
    });
  }

  /**
   * Creates a normalized wrapper group for a model instance.
   * Aligns internal geometry so that the wrapper's local origin (0, 0, 0)
   * is centered horizontally (X=0, Z=0) and sits flush at the lowest point (Y=0).
   * This non-destructively preserves the original GLB while eliminating floating and clipping.
   */
  normalizeModel(instance, def) {
    const wrapper = new THREE.Group();

    // Apply catalog scale to inner model before measuring bounds
    if (def.scale) {
      instance.scale.set(def.scale[0], def.scale[1], def.scale[2]);
    }

    instance.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(instance);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);

    // Offset inner model so lowest point is at wrapper local Y = 0, and centered in X and Z
    instance.position.set(-center.x, -box.min.y, -center.z);
    wrapper.add(instance);
    wrapper.updateMatrixWorld(true);

    // Store measured dimensional metadata
    wrapper.userData.modelSize = {
      x: +size.x.toFixed(4),
      y: +size.y.toFixed(4),
      z: +size.z.toFixed(4)
    };
    wrapper.userData.surfaceHeight = +size.y.toFixed(4);

    return wrapper;
  }

  /**
   * Raycasts downward from ceiling height to detect exact floor surface height at (x, z)
   */
  detectFloorHeight(x, z) {
    let detectedY = 0.000;

    if (this.scene) {
      this.raycaster.set(new THREE.Vector3(x, 4.0, z), new THREE.Vector3(0, -1, 0));
      const hits = this.raycaster.intersectObjects(this.scene.children, true);
      for (const hit of hits) {
        if (hit.object &&
            !this.container.getObjectById(hit.object.id) &&
            !this.debugContainer.getObjectById(hit.object.id)) {
          if (hit.point.y >= -0.2 && hit.point.y <= 0.5) {
            detectedY = +hit.point.y.toFixed(4);
            break;
          }
        }
      }
    }

    return detectedY;
  }

  /**
   * Detects support surface height and horizontal footprint boundary of a furniture prop
   */
  detectFurnitureSurface(supportPropId, surfaceType, tierIndex = null) {
    const parentProp = this.propMap.get(supportPropId);
    if (!parentProp) {
      console.warn(`[WorldItemManager] Support prop '${supportPropId}' not found in propMap`);
      return { surfaceY: 0.000, bounds: null, isValidSupport: false };
    }

    parentProp.object.updateMatrixWorld(true);
    const propBox = new THREE.Box3().setFromObject(parentProp.object);
    const propDef = parentProp.definition || parentProp.object?.userData?.definition || (this.catalog && this.catalog[parentProp.type]);

    let surfaceY = propBox.max.y;
    let tierHeight = null;

    if (surfaceType === 'shelf_tier' || (propDef && propDef.tiers)) {
      const tiers = propDef?.tiers || [0.243, 0.715, 1.188, 1.643, 2.097];
      const tIdx = Math.max(1, Math.min(tiers.length, tierIndex || 1));
      tierHeight = tiers[tIdx - 1];
      surfaceY = +(parentProp.object.position.y + tierHeight).toFixed(4);
    } else {
      surfaceY = +(propBox.max.y).toFixed(4);
    }

    const bounds = {
      minX: +propBox.min.x.toFixed(4),
      maxX: +propBox.max.x.toFixed(4),
      minZ: +propBox.min.z.toFixed(4),
      maxZ: +propBox.max.z.toFixed(4),
      surfaceY
    };

    return { surfaceY, bounds, tierHeight, isValidSupport: true, parentProp };
  }

  /**
   * Computes exact 2D Oriented Bounding Box (OBB) on XZ plane for an item or prop
   */
  _getItemOBB(obj, box) {
    obj.updateMatrixWorld(true);
    const pos = obj.position;
    const rotY = obj.rotation.y || 0;
    const scale = obj.scale || { x: 1, y: 1, z: 1 };
    const modelSize = obj.userData?.modelSize;

    let hx, hz;
    if (modelSize) {
      hx = (modelSize.x * scale.x) / 2;
      hz = (modelSize.z * scale.z) / 2;
    } else {
      const size = new THREE.Vector3();
      box.getSize(size);
      hx = size.x / 2;
      hz = size.z / 2;
    }

    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const cx = pos.x;
    const cz = pos.z;

    const corners = [
      { x: cx - hx * cos + hz * sin, z: cz - hx * sin - hz * cos },
      { x: cx + hx * cos + hz * sin, z: cz + hx * sin - hz * cos },
      { x: cx + hx * cos - hz * sin, z: cz + hx * sin + hz * cos },
      { x: cx - hx * cos - hz * sin, z: cz - hx * sin + hz * cos }
    ];
    const axes = [
      { x: cos, z: sin },
      { x: -sin, z: cos }
    ];

    return {
      cx, cz,
      minY: box.min.y,
      maxY: box.max.y,
      corners,
      axes,
      hx, hz, rotY
    };
  }

  /**
   * Separating Axis Theorem (SAT) evaluation for two 2D oriented bounding boxes on XZ plane
   */
  _testOBBSAT2D(boxA, boxB) {
    const axes = [boxA.axes[0], boxA.axes[1], boxB.axes[0], boxB.axes[1]];
    let minOverlap = Infinity;
    let isSeparated = false;
    let maxClearance = 0;

    for (let i = 0; i < axes.length; i++) {
      const axis = axes[i];
      let minA = Infinity, maxA = -Infinity;
      for (let j = 0; j < boxA.corners.length; j++) {
        const dot = boxA.corners[j].x * axis.x + boxA.corners[j].z * axis.z;
        if (dot < minA) minA = dot;
        if (dot > maxA) maxA = dot;
      }

      let minB = Infinity, maxB = -Infinity;
      for (let j = 0; j < boxB.corners.length; j++) {
        const dot = boxB.corners[j].x * axis.x + boxB.corners[j].z * axis.z;
        if (dot < minB) minB = dot;
        if (dot > maxB) maxB = dot;
      }

      const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (overlap <= 0) {
        isSeparated = true;
        const clearance = Math.max(minA - maxB, minB - maxA);
        if (clearance > maxClearance) {
          maxClearance = clearance;
        }
      } else {
        if (overlap < minOverlap) {
          minOverlap = overlap;
        }
      }
    }

    if (isSeparated) {
      return { intersects: false, clearance: maxClearance, penetration: 0 };
    } else {
      return { intersects: true, clearance: 0, penetration: minOverlap };
    }
  }

  /**
   * Checks whether an object collides with Level 0 architectural geometry (walls and pillars)
   * Separates broad-phase candidate filtering from narrow-phase 2D SAT evaluation.
   * Tolerances:
   * - <= 0.01m (1cm): Contact tolerance (touching, valid)
   * - < 0.08m (8cm): Proximity warning (close to wall, advisory only)
   * - > 0.02m (2cm): Confirmed penetration (invalid)
   */
  checkWallIntersection(box, obj = null) {
    if (!this.obstacles || this.obstacles.length === 0) {
      return { status: 'valid', intersects: false, reason: null, clearance: Infinity, penetration: 0 };
    }

    // 1. Broad Phase: Candidate filtering using expanded 2D AABB
    const BROAD_PHASE_MARGIN = 0.25; // 25cm candidate radius
    const itemMinX = box.min.x - BROAD_PHASE_MARGIN;
    const itemMaxX = box.max.x + BROAD_PHASE_MARGIN;
    const itemMinZ = box.min.z - BROAD_PHASE_MARGIN;
    const itemMaxZ = box.max.z + BROAD_PHASE_MARGIN;
    const itemMinY = box.min.y;
    const itemMaxY = box.max.y;

    const candidateObstacles = [];
    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      // Vertical range check
      if (itemMaxY < obs.minY || itemMinY > obs.maxY) continue;
      // Horizontal AABB check
      if (itemMaxX < obs.aabb.minX || itemMinX > obs.aabb.maxX ||
          itemMaxZ < obs.aabb.minZ || itemMinZ > obs.aabb.maxZ) continue;

      candidateObstacles.push(obs);
    }

    // If broad phase detects no obstacles within candidate margin, return immediately as VALID
    if (candidateObstacles.length === 0) {
      return { status: 'valid', intersects: false, reason: null, clearance: BROAD_PHASE_MARGIN, penetration: 0 };
    }

    // 2. Narrow Phase: Precise Oriented Bounding Box (OBB) evaluation using SAT
    const itemOBB = obj ? this._getItemOBB(obj, box) : {
      corners: [
        { x: box.min.x, z: box.min.z },
        { x: box.max.x, z: box.min.z },
        { x: box.max.x, z: box.max.z },
        { x: box.min.x, z: box.max.z }
      ],
      axes: [
        { x: 1, z: 0 },
        { x: 0, z: 1 }
      ]
    };

    let confirmedInvalid = null;
    let closestWarning = null;
    let minOverallClearance = Infinity;

    const CONTACT_TOLERANCE = 0.01;      // <= 1cm touching tolerance
    const PENETRATION_TOLERANCE = 0.02;  // > 2cm confirmed penetration
    const PROXIMITY_WARNING = 0.08;      // < 8cm proximity warning

    for (const obs of candidateObstacles) {
      const sat = this._testOBBSAT2D(itemOBB, obs);
      if (sat.intersects) {
        if (sat.penetration > PENETRATION_TOLERANCE) {
          if (!confirmedInvalid || sat.penetration > confirmedInvalid.penetration) {
            confirmedInvalid = {
              status: 'invalid',
              intersects: true,
              obstacleId: obs.id,
              penetration: sat.penetration,
              clearance: 0,
              reason: `Wall penetration: ${(sat.penetration * 100).toFixed(1)}cm into ${obs.id}`
            };
          }
        } else if (sat.penetration > CONTACT_TOLERANCE) {
          if (!closestWarning) {
            closestWarning = {
              status: 'warning',
              intersects: false,
              obstacleId: obs.id,
              penetration: sat.penetration,
              clearance: 0,
              reason: `Touching wall face (${obs.id})`
            };
          }
        }
      } else {
        if (sat.clearance < minOverallClearance) {
          minOverallClearance = sat.clearance;
        }
        if (sat.clearance < PROXIMITY_WARNING) {
          if (!closestWarning || sat.clearance < closestWarning.clearance) {
            closestWarning = {
              status: 'warning',
              intersects: false,
              obstacleId: obs.id,
              penetration: 0,
              clearance: sat.clearance,
              reason: `Close to wall (${(sat.clearance * 100).toFixed(1)}cm clearance to ${obs.id})`
            };
          }
        }
      }
    }

    if (confirmedInvalid) {
      return confirmedInvalid;
    }
    if (closestWarning) {
      return closestWarning;
    }
    return {
      status: 'valid',
      intersects: false,
      reason: null,
      clearance: minOverallClearance,
      penetration: 0
    };
  }

  /**
   * Checks whether an item resting on furniture stays reliably on the support plane
   * Categories:
   * - VALID: Footprint fully contained on support surface
   * - WARNING: Minor overhang <= 5cm, support contact still solid
   * - INVALID: Significant overhang > 12cm or center of mass completely off surface
   */
  checkSupportBounds(box, item) {
    const surfaceType = item.anchor?.surface || item.surfaceType || 'floor';
    if (surfaceType === 'floor') {
      return { status: 'valid', isSupported: true, reason: null, overhang: 0 };
    }

    let surf = null;
    if (surfaceType === 'table') {
      const propId = item.anchor?.supportProp || 'prop_table_01';
      surf = this.detectFurnitureSurface(propId, 'table');
    } else if (surfaceType === 'shelf_tier') {
      const propId = item.anchor?.supportProp || 'prop_shelf_01';
      const tier = item.anchor?.tier || item.shelfTier || 1;
      surf = this.detectFurnitureSurface(propId, 'shelf_tier', tier);
    }

    if (!surf || !surf.bounds || !surf.isValidSupport) {
      return { status: 'invalid', isSupported: false, reason: 'Missing Support Furniture', overhang: 0 };
    }

    const b = surf.bounds;
    const OVERHANG_WARNING = 0.05; // 5cm overhang warning threshold
    const OVERHANG_INVALID = 0.12; // 12cm overhang confirmed invalid

    const leftOverhang = b.minX - box.min.x;
    const rightOverhang = box.max.x - b.maxX;
    const frontOverhang = b.minZ - box.min.z;
    const backOverhang = box.max.z - b.maxZ;
    const maxOverhang = Math.max(0, leftOverhang, rightOverhang, frontOverhang, backOverhang);

    const center = new THREE.Vector3();
    box.getCenter(center);
    const centerOffSurface = (center.x < b.minX || center.x > b.maxX || center.z < b.minZ || center.z > b.maxZ);

    if (centerOffSurface || maxOverhang > OVERHANG_INVALID) {
      return {
        status: 'invalid',
        isSupported: false,
        reason: `Off Support Surface Bounds (${(maxOverhang * 100).toFixed(1)}cm overhang)`,
        overhang: maxOverhang
      };
    }

    if (maxOverhang > 0.01) {
      return {
        status: 'warning',
        isSupported: true,
        reason: `Near support edge (${(maxOverhang * 100).toFixed(1)}cm overhang)`,
        overhang: maxOverhang
      };
    }

    return { status: 'valid', isSupported: true, reason: null, overhang: 0 };
  }

  /**
   * Checks for 3D AABB overlap with other placed items (excluding supporting/supported furniture)
   */
  checkObjectOverlap(itemBox, currentItemId, currentCategory = null, currentSupportProp = null) {
    const currentItem = this.getItemById(currentItemId);
    const isCurrentProp = (currentCategory || currentItem?.category) === 'prop';
    const supportProp = currentSupportProp || currentItem?.anchor?.supportProp;

    let maxOverlapDepth = 0;
    let collidingId = null;

    for (const other of this.items) {
      if (other.id === currentItemId) continue;
      // Do not flag overlap between a prop and items resting on top of it
      if (isCurrentProp && other.anchor?.supportProp === currentItemId) continue;
      // Do not flag overlap between a supported item and its supporting prop
      if (supportProp === other.id) continue;
      // If current item is a prop, only check collision against other props
      if (isCurrentProp && other.category !== 'prop') continue;
      // If current item is a consumable/item, don't flag against support furniture
      if (!isCurrentProp && other.category === 'prop') continue;

      other.object.updateMatrixWorld(true);
      const otherBox = new THREE.Box3().setFromObject(other.object);
      if (itemBox.intersectsBox(otherBox)) {
        // Calculate 3D penetration depth
        const overlapX = Math.min(itemBox.max.x, otherBox.max.x) - Math.max(itemBox.min.x, otherBox.min.x);
        const overlapY = Math.min(itemBox.max.y, otherBox.max.y) - Math.max(itemBox.min.y, otherBox.min.y);
        const overlapZ = Math.min(itemBox.max.z, otherBox.max.z) - Math.max(itemBox.min.z, otherBox.min.z);
        const depth = Math.min(overlapX, overlapY, overlapZ);

        // Contact tolerance: <= 1cm touching is allowed
        if (depth > 0.02) {
          return {
            status: 'invalid',
            overlaps: true,
            otherId: other.id,
            depth,
            reason: `Intersects Object (${other.id}) by ${(depth * 100).toFixed(1)}cm`
          };
        } else if (depth > 0.005) {
          maxOverlapDepth = depth;
          collidingId = other.id;
        }
      }
    }

    if (collidingId) {
      return {
        status: 'warning',
        overlaps: false,
        otherId: collidingId,
        depth: maxOverlapDepth,
        reason: `Touching adjacent item (${collidingId})`
      };
    }
    return { status: 'valid', overlaps: false, otherId: null, depth: 0, reason: null };
  }

  /**
   * Harmonizes automated validation results with developer-authoritative overrides
   */
  evaluatePlacementStatus(item, wallCheck, supportCheck, overlapCheck) {
    const isOverridden = item.override === true || item.validation?.developerApproved === true;

    // Determine auto-status before override
    let autoStatus = 'valid';
    let autoReason = null;

    if (wallCheck.status === 'invalid') {
      autoStatus = 'invalid';
      autoReason = wallCheck.reason;
    } else if (supportCheck.status === 'invalid') {
      autoStatus = 'invalid';
      autoReason = supportCheck.reason;
    } else if (overlapCheck.status === 'invalid') {
      autoStatus = 'invalid';
      autoReason = overlapCheck.reason;
    } else if (wallCheck.status === 'warning') {
      autoStatus = 'warning';
      autoReason = wallCheck.reason;
    } else if (supportCheck.status === 'warning') {
      autoStatus = 'warning';
      autoReason = supportCheck.reason;
    } else if (overlapCheck.status === 'warning') {
      autoStatus = 'warning';
      autoReason = overlapCheck.reason;
    }

    if (isOverridden) {
      return {
        status: 'overridden',
        isValid: true,
        developerApproved: true,
        originalStatus: autoStatus,
        reason: autoReason || 'Developer approved placement',
        failureReason: null,
        wallCheck,
        supportCheck,
        overlapCheck
      };
    }

    return {
      status: autoStatus,
      isValid: autoStatus !== 'invalid',
      developerApproved: false,
      originalStatus: autoStatus,
      reason: autoReason,
      failureReason: autoStatus === 'invalid' ? autoReason : null,
      warningReason: autoStatus === 'warning' ? autoReason : null,
      wallCheck,
      supportCheck,
      overlapCheck
    };
  }

  /**
   * Developer-authoritative override toggle for placement validation
   */
  setPlacementOverride(id, approved, reason = null) {
    const item = this.getItemById(id);
    if (!item) return null;

    item.override = !!approved;
    if (approved) {
      const prevVal = item.validation || {};
      item.validation = {
        ...prevVal,
        status: 'overridden',
        isValid: true,
        developerApproved: true,
        originalStatus: prevVal.status || 'invalid',
        reason: reason || prevVal.failureReason || prevVal.reason || 'Developer approved placement',
        failureReason: null
      };
    } else {
      item.override = false;
      if (item.validation) {
        item.validation.developerApproved = false;
      }
      this.updateItemTransform(id, item.object.position, item.object.rotation, item.object.scale);
    }

    if (item.userData) {
      item.userData.validation = item.validation;
    }

    const helper = this.debugContainer.getObjectByName(`debug_box_${item.id}`);
    if (helper && helper.material) {
      let color = 0x00ff88;
      if (item.validation.status === 'overridden' || item.validation.developerApproved) color = 0x00e5ff;
      else if (item.validation.status === 'invalid') color = 0xff2244;
      else if (item.validation.status === 'warning') color = 0xffbb00;
      helper.material.color.setHex(color);
    }

    return item.validation;
  }

  /**
   * Loads world items definition JSON (or object) and spawns all catalogued props and items
   */
  async loadWorldItems(manifestOrUrl = 'assets/data/world_items.json') {
    try {
      let data;
      if (typeof manifestOrUrl === 'string') {
        console.log(`[WorldItemManager] Fetching placement manifest from: ${manifestOrUrl}`);
        const res = await fetch(manifestOrUrl);
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status} while fetching ${manifestOrUrl}`);
        }
        data = await res.json();
      } else if (manifestOrUrl && typeof manifestOrUrl === 'object') {
        data = manifestOrUrl;
      } else {
        throw new Error('Invalid manifest parameter supplied to loadWorldItems');
      }
      this.currentManifest = data;
      this.catalog = data.catalog || {};
      const placements = data.placements || [];

      // 1. Preload all unique model URLs and initialize obstacle geometries
      await this.initObstacles();

      const uniqueUrls = new Set();
      for (const key of Object.keys(this.catalog)) {
        if (this.catalog[key].modelUrl) {
          uniqueUrls.add(this.catalog[key].modelUrl);
        }
      }

      console.log(`[WorldItemManager] Preloading ${uniqueUrls.size} unique model templates...`);
      for (const url of uniqueUrls) {
        await this.preloadTemplate(url);
      }

      // 2. Clear existing instances if re-loading
      this.clear();

      // 3. First pass: Instantiate and place all PROPS so support surfaces exist
      const propPlacements = placements.filter(p => this.catalog[p.type]?.category === 'prop');
      const itemPlacements = placements.filter(p => this.catalog[p.type]?.category !== 'prop');

      for (const p of propPlacements) {
        this._instantiatePlacement(p);
      }

      // 4. Second pass: Instantiate and place items using detected support surfaces
      for (const p of itemPlacements) {
        this._instantiatePlacement(p);
      }

      this.container.updateMatrixWorld(true);

      // 5. Build developer debug bounding box visualization
      this.buildDebugVisuals();

      this.isLoaded = true;
      console.log(`[WorldItemManager] Successfully spawned and validated ${this.items.length} items & props in Level 0`);
      return this.items;
    } catch (err) {
      console.error('[WorldItemManager] Error during item placement:', err);
      throw err;
    }
  }

  /**
   * Instantiates a single placement with surface detection, anchor resolution, and validation
   */
  _instantiatePlacement(p) {
    const def = this.catalog[p.type] || getItemDefinition(p.type);
    if (!def) {
      console.warn(`[WorldItemManager] Unknown item type '${p.type}' for placement '${p.id}'`);
      return null;
    }
    if (!this.catalog[p.type]) {
      this.catalog[p.type] = def;
    }

    const template = this.templates.get(def.modelUrl);
    if (!template) {
      console.warn(`[WorldItemManager] Template for '${def.modelUrl}' not found`);
      return null;
    }

    const rawInstance = template.clone(true);
    const wrapper = this.normalizeModel(rawInstance, def);
    wrapper.name = p.id;

    const pos = p.position || [0, 0, 0];
    const anchor = p.anchor || {};
    const surfaceType = anchor.surface || p.surfaceType || 'floor';

    let targetY = pos[1];
    let detectedSurface = null;
    let isSupported = true;

    // Detect exact surface height from furniture support or floor
    if (surfaceType === 'table') {
      const supportPropId = anchor.supportProp || p.propId || 'prop_table_01';
      detectedSurface = this.detectFurnitureSurface(supportPropId, 'table');
      if (detectedSurface.isValidSupport) {
        targetY = detectedSurface.surfaceY;
      }
    } else if (surfaceType === 'shelf_tier') {
      const supportPropId = anchor.supportProp || p.propId || 'prop_shelf_01';
      const tierIndex = anchor.tier || p.shelfTier || 1;
      detectedSurface = this.detectFurnitureSurface(supportPropId, 'shelf_tier', tierIndex);
      if (detectedSurface.isValidSupport) {
        targetY = detectedSurface.surfaceY;
      }
    } else if (surfaceType === 'floor') {
      targetY = this.detectFloorHeight(pos[0], pos[2]);
    }

    wrapper.position.set(pos[0], targetY, pos[2]);

    if (p.rotation) {
      wrapper.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2]);
    }

    wrapper.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrapper);

    // 1. Wall intersection check with broad-phase + narrow-phase SAT
    const wallCheck = this.checkWallIntersection(box, wrapper);

    // 2. Support bounds check
    const supportCheck = this.checkSupportBounds(box, { anchor, surfaceType, shelfTier: p.shelfTier || anchor.tier });

    // 3. Overlap check
    const overlapCheck = this.checkObjectOverlap(box, p.id, def.category, anchor.supportProp);

    // 4. Harmonize validation with developer-authoritative overrides
    const isOverridden = !!(p.validation?.developerApproved || p.validation?.status === 'overridden');
    const validation = this.evaluatePlacementStatus(
      { override: isOverridden, validation: p.validation },
      wallCheck,
      supportCheck,
      overlapCheck
    );

    wrapper.userData = {
      ...wrapper.userData,
      id: p.id,
      type: p.type,
      name: def.name,
      category: def.category,
      surfaceType,
      surfaceName: p.surfaceName || surfaceType,
      shelfTier: p.shelfTier || anchor.tier || null,
      anchor,
      definition: def,
      validation
    };

    const itemEntry = {
      id: p.id,
      type: p.type,
      name: def.name,
      category: def.category,
      surfaceType,
      surfaceName: p.surfaceName || surfaceType,
      shelfTier: p.shelfTier || anchor.tier || null,
      anchor,
      definition: def,
      override: isOverridden,
      userData: wrapper.userData,
      object: wrapper,
      validation
    };

    if (def.category === 'prop') {
      this.propMap.set(p.id, itemEntry);
    }

    if (this.collectedItemIds.has(p.id)) {
      wrapper.visible = false;
      itemEntry.isCollected = true;
    }

    this.container.add(wrapper);
    this.items.push(itemEntry);

    return itemEntry;
  }

  /**
   * Finds an item entry by ID
   */
  getItemById(id) {
    if (!id) return null;
    return this.items.find(i => i.id === id) || null;
  }

  /**
   * Hides a collected item from the world and marks it unavailable
   */
  hideItem(id) {
    if (!id) return false;
    this.collectedItemIds.add(id);
    const item = this.getItemById(id);
    if (item) {
      if (item.object) {
        item.object.visible = false;
      }
      item.isCollected = true;
      return true;
    }
    return false;
  }

  /**
   * Spawns a physical world item dynamically (e.g. dropped by a player)
   */
  async spawnWorldItem(itemData) {
    if (!itemData || !itemData.id) return null;

    // If item already exists in scene, unhide it
    const existing = this.getItemById(itemData.id);
    if (existing) {
      if (existing.object) existing.object.visible = true;
      existing.isCollected = false;
      this.collectedItemIds.delete(itemData.id);
      return existing;
    }

    const def = (this.catalog && this.catalog[itemData.type]) || getItemDefinition(itemData.type);
    if (!def) {
      console.warn(`[WorldItemManager] Unknown item type '${itemData.type}' for spawnWorldItem`);
      return null;
    }

    if (def.modelUrl && !this.templates.has(def.modelUrl)) {
      await this.preloadTemplate(def.modelUrl);
    }

    const placement = {
      id: itemData.id,
      type: itemData.type,
      position: itemData.position || [0, 0.02, 0],
      rotation: itemData.rotation || [0, 0, 0],
      surfaceType: 'floor',
      anchor: { surface: 'floor' },
      isDropped: true
    };

    const entry = this._instantiatePlacement(placement);
    if (entry) {
      this.collectedItemIds.delete(itemData.id);
      console.log(`[WorldItemManager] Spawned dropped world item: ${itemData.id} (${itemData.type}) at [${placement.position.join(', ')}]`);
    }
    return entry;
  }

  /**
   * Sets initial collection state for a list of collected item IDs
   */
  setCollectedItems(ids) {
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      this.hideItem(id);
    }
  }

  /**
   * Restores all world items to visible/uncollected state
   */
  resetCollectedItems() {
    this.collectedItemIds.clear();
    for (const item of this.items) {
      if (item.isCollected) {
        item.isCollected = false;
        if (item.object) item.object.visible = true;
      }
    }
  }

  /**
   * Builds developer-only bounding box wireframes and surface outlines:
   * - Valid items: bright green wireframe box
   * - Invalid / intersecting items: bright red wireframe box
   * - Furniture support planes: cyan (table) and yellow (shelf tiers)
   */
  buildDebugVisuals() {
    while (this.debugContainer.children.length > 0) {
      const child = this.debugContainer.children[0];
      this.debugContainer.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    this.container.updateMatrixWorld(true);

    // 1. Draw Support Planes for furniture props
    for (const [propId, propEntry] of this.propMap.entries()) {
      const obj = propEntry.object;
      obj.updateMatrixWorld(true);
      const propBox = new THREE.Box3().setFromObject(obj);
      const def = propEntry.userData.definition;

      if (def.category === 'prop') {
        if (propEntry.type === 'table') {
          // Tabletop support plane (cyan)
          const supportBox = new THREE.Box3(
            new THREE.Vector3(propBox.min.x + 0.04, propBox.max.y - 0.005, propBox.min.z + 0.04),
            new THREE.Vector3(propBox.max.x - 0.04, propBox.max.y + 0.005, propBox.max.z - 0.04)
          );
          const helper = new THREE.Box3Helper(supportBox, 0x00e5ff);
          helper.name = `debug_support_${propId}`;
          this.debugContainer.add(helper);
        } else if (propEntry.type === 'metal_shelf' && def.tiers) {
          // Shelf tier support planes (yellow)
          def.tiers.forEach((tierH, idx) => {
            const tierY = obj.position.y + tierH;
            const tierBox = new THREE.Box3(
              new THREE.Vector3(propBox.min.x + 0.02, tierY - 0.005, propBox.min.z + 0.02),
              new THREE.Vector3(propBox.max.x - 0.02, tierY + 0.005, propBox.max.z - 0.02)
            );
            const helper = new THREE.Box3Helper(tierBox, 0xffea00);
            helper.name = `debug_tier_${propId}_${idx + 1}`;
            this.debugContainer.add(helper);
          });
        }
      }
    }

    // 2. Draw Item Bounding Boxes (Green = Valid, Amber = Warning, Red = Invalid, Cyan = Developer Approved)
    for (const item of this.items) {
      const obj = item.object;
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);

      let color = 0x00ff88; // Default valid green
      const v = item.validation;
      if (item.override || (v && (v.status === 'overridden' || v.developerApproved))) {
        color = 0x00e5ff; // Cyan: Developer Approved
      } else if (v && v.status === 'invalid') {
        color = 0xff2244; // Red: Invalid collision or boundary violation
      } else if (v && v.status === 'warning') {
        color = 0xffbb00; // Amber: Proximity or support edge warning
      }

      const helper = new THREE.Box3Helper(box, color);
      helper.name = `debug_box_${item.id}`;
      this.debugContainer.add(helper);
    }
  }

  setDebugVisuals(visible) {
    this.debugVisualsActive = !!visible;
    this.debugContainer.visible = this.debugVisualsActive;
    if (this.debugVisualsActive) {
      this.buildDebugVisuals();
    }
    console.log(`[WorldItemManager] Debug visuals ${this.debugVisualsActive ? 'ENABLED' : 'DISABLED'}`);
    return this.debugVisualsActive;
  }

  toggleDebugVisuals() {
    return this.setDebugVisuals(!this.debugVisualsActive);
  }

  /**
   * Returns placement telemetry: world coordinates, bounding boxes, vertical contacts, and validation
   */
  getPlacementTelemetry() {
    this.container.updateMatrixWorld(true);
    const telemetry = [];

    for (const item of this.items) {
      const obj = item.object;
      obj.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      box.getSize(size);

      telemetry.push({
        id: item.id,
        type: item.type,
        name: item.name,
        category: item.category,
        surfaceType: item.surfaceType,
        surfaceName: item.surfaceName,
        shelfTier: item.shelfTier,
        anchor: item.anchor,
        position: {
          x: +obj.position.x.toFixed(4),
          y: +obj.position.y.toFixed(4),
          z: +obj.position.z.toFixed(4)
        },
        boundingBox: {
          min: {
            x: +box.min.x.toFixed(4),
            y: +box.min.y.toFixed(4),
            z: +box.min.z.toFixed(4)
          },
          max: {
            x: +box.max.x.toFixed(4),
            y: +box.max.y.toFixed(4),
            z: +box.max.z.toFixed(4)
          },
          size: {
            x: +size.x.toFixed(4),
            y: +size.y.toFixed(4),
            z: +size.z.toFixed(4)
          }
        },
        bottomY: +box.min.y.toFixed(4),
        topY: +box.max.y.toFixed(4),
        validation: item.validation || { isValid: true }
      });
    }

    return telemetry;
  }

  /**
   * Retrieves an item instance by ID
   */
  getItemById(id) {
    return this.items.find(i => i.id === id) || null;
  }

  /**
   * Dynamically adds a new placement instance to the scene
   */
  async addPlacement(type, position = [45.0, 0.0, -187.0], rotation = [0, 0, 0], anchor = { surface: 'floor' }, scale = [1, 1, 1], tags = null) {
    const def = this.catalog[type];
    if (!def) {
      console.warn(`[WorldItemManager] Catalog missing definition for '${type}'`);
      return null;
    }

    if (!this.templates.has(def.modelUrl)) {
      await this.preloadTemplate(def.modelUrl);
    }

    const existingIds = new Set(this.items.map(i => i.id));
    let count = 1;
    let newId = `${type}_${String(count).padStart(2, '0')}`;
    while (existingIds.has(newId)) {
      count++;
      newId = `${type}_${String(count).padStart(2, '0')}`;
    }

    const p = {
      id: newId,
      type,
      position: [position[0] ?? position.x, position[1] ?? position.y, position[2] ?? position.z],
      rotation: [rotation[0] ?? rotation.x, rotation[1] ?? rotation.y, rotation[2] ?? rotation.z],
      scale: [scale[0] ?? scale.x ?? 1, scale[1] ?? scale.y ?? 1, scale[2] ?? scale.z ?? 1],
      anchor,
      tags: tags || (def.category === 'prop' ? ['furniture', 'obstacle'] : ['consumable', 'pickup'])
    };

    const itemEntry = this._instantiatePlacement(p);
    if (this.debugVisualsActive) {
      this.buildDebugVisuals();
    }
    return itemEntry;
  }

  /**
   * Removes an existing placement by ID
   */
  removePlacement(id) {
    const idx = this.items.findIndex(i => i.id === id);
    if (idx === -1) return false;

    const item = this.items[idx];
    if (item.object) {
      this.container.remove(item.object);
      item.object.traverse(node => {
        if (node.isMesh) {
          if (node.geometry) node.geometry.dispose();
          if (node.material) {
            if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
            else node.material.dispose();
          }
        }
      });
    }

    this.items.splice(idx, 1);
    if (this.propMap.has(id)) {
      this.propMap.delete(id);
    }

    if (this.debugVisualsActive) {
      this.buildDebugVisuals();
    }
    return true;
  }

  /**
   * Duplicates an item placement with a slight position offset
   */
  async duplicatePlacement(id, offset = [0.4, 0, 0.4]) {
    const item = this.getItemById(id);
    if (!item) return null;

    const obj = item.object;
    const newPos = [
      obj.position.x + (offset[0] || 0.4),
      obj.position.y + (offset[1] || 0.0),
      obj.position.z + (offset[2] || 0.4)
    ];
    const newRot = [obj.rotation.x, obj.rotation.y, obj.rotation.z];
    const newScale = [obj.scale.x, obj.scale.y, obj.scale.z];
    const newAnchor = item.anchor ? { ...item.anchor } : { surface: item.surfaceType || 'floor' };
    const newTags = item.tags ? [...item.tags] : undefined;

    return await this.addPlacement(item.type, newPos, newRot, newAnchor, newScale, newTags);
  }

  /**
   * Updates an item's transform (position, rotation, scale) and recomputes real-time validation
   */
  updateItemTransform(id, position = null, rotation = null, scale = null) {
    const item = this.getItemById(id);
    if (!item) return null;

    const obj = item.object;
    if (position) {
      obj.position.set(
        position.x ?? position[0],
        position.y ?? position[1],
        position.z ?? position[2]
      );
    }
    if (rotation) {
      obj.rotation.set(
        rotation.x ?? rotation[0],
        rotation.y ?? rotation[1],
        rotation.z ?? rotation[2]
      );
    }
    if (scale) {
      obj.scale.set(
        scale.x ?? scale[0],
        scale.y ?? scale[1],
        scale.z ?? scale[2]
      );
    }

    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);

    // 1. Wall intersection check with broad-phase + narrow-phase SAT
    const wallCheck = this.checkWallIntersection(box, obj);

    // 2. Support bounds check
    const supportCheck = this.checkSupportBounds(box, item);

    // 3. Overlap check
    const overlapCheck = this.checkObjectOverlap(box, item.id, item.category, item.anchor?.supportProp);

    // 4. Harmonize validation with developer-authoritative overrides
    item.validation = this.evaluatePlacementStatus(item, wallCheck, supportCheck, overlapCheck);
    if (item.userData) {
      item.userData.validation = item.validation;
    }

    // Update bounding box wireframe if debug visual container exists
    const helper = this.debugContainer.getObjectByName(`debug_box_${item.id}`);
    if (helper && helper.box) {
      helper.box.copy(box);
      if (helper.material && helper.material.color) {
        let color = 0x00ff88;
        if (item.override || item.validation.status === 'overridden' || item.validation.developerApproved) {
          color = 0x00e5ff;
        } else if (item.validation.status === 'invalid') {
          color = 0xff2244;
        } else if (item.validation.status === 'warning') {
          color = 0xffbb00;
        }
        helper.material.color.setHex(color);
      }
    }

    // If item is a prop, rebuild debug visuals so support planes follow
    if (item.category === 'prop' && this.debugVisualsActive) {
      this.buildDebugVisuals();
    }

    return item.validation;
  }

  /**
   * Snaps item height to floor level at its current horizontal coordinates
   */
  snapItemToFloor(id) {
    const item = this.getItemById(id);
    if (!item) return null;

    const fy = this.detectFloorHeight(item.object.position.x, item.object.position.z);
    item.object.position.y = fy;
    item.anchor = { surface: 'floor' };
    item.surfaceType = 'floor';
    item.shelfTier = null;
    return this.updateItemTransform(id, item.object.position, item.object.rotation);
  }

  /**
   * Snaps item height to table surface
   */
  snapItemToTable(id, tableId = null) {
    const item = this.getItemById(id);
    if (!item) return null;

    let targetPropId = tableId;
    if (!targetPropId) {
      let minDist = Infinity;
      for (const [propId, propEntry] of this.propMap.entries()) {
        if (propEntry.type === 'table') {
          const d = Math.hypot(
            propEntry.object.position.x - item.object.position.x,
            propEntry.object.position.z - item.object.position.z
          );
          if (d < minDist) {
            minDist = d;
            targetPropId = propId;
          }
        }
      }
      targetPropId = targetPropId || 'prop_table_01';
    }

    const surf = this.detectFurnitureSurface(targetPropId, 'table');
    if (surf && surf.isValidSupport) {
      item.object.position.y = surf.surfaceY;
    }
    item.anchor = { surface: 'table', supportProp: targetPropId };
    item.surfaceType = 'table';
    item.shelfTier = null;
    return this.updateItemTransform(id, item.object.position, item.object.rotation);
  }

  /**
   * Snaps item height to shelf tier
   */
  snapItemToShelfTier(id, tierIndex = 1, shelfId = null) {
    const item = this.getItemById(id);
    if (!item) return null;

    let targetPropId = shelfId;
    if (!targetPropId) {
      let minDist = Infinity;
      for (const [propId, propEntry] of this.propMap.entries()) {
        if (propEntry.type === 'metal_shelf') {
          const d = Math.hypot(
            propEntry.object.position.x - item.object.position.x,
            propEntry.object.position.z - item.object.position.z
          );
          if (d < minDist) {
            minDist = d;
            targetPropId = propId;
          }
        }
      }
      targetPropId = targetPropId || 'prop_shelf_01';
    }

    const surf = this.detectFurnitureSurface(targetPropId, 'shelf_tier', tierIndex);
    if (surf && surf.isValidSupport) {
      item.object.position.y = surf.surfaceY;
    }
    item.anchor = { surface: 'shelf_tier', supportProp: targetPropId, tier: tierIndex };
    item.surfaceType = 'shelf_tier';
    item.shelfTier = tierIndex;
    return this.updateItemTransform(id, item.object.position, item.object.rotation);
  }

  /**
   * Exports full layout document conforming to the versioned layout schema
   */
  exportLayoutData(description = 'Level 0 Visual Placement Layout', author = 'developer') {
    this.container.updateMatrixWorld(true);
    const placements = this.items.map(item => {
      const obj = item.object;
      obj.updateMatrixWorld(true);
      return {
        id: item.id,
        type: item.type,
        category: item.category || (this.catalog[item.type]?.category) || 'prop',
        placementMode: item.placementMode || 'fixed',
        position: [
          +obj.position.x.toFixed(4),
          +obj.position.y.toFixed(4),
          +obj.position.z.toFixed(4)
        ],
        rotation: [
          +obj.rotation.x.toFixed(4),
          +obj.rotation.y.toFixed(4),
          +obj.rotation.z.toFixed(4)
        ],
        scale: [
          +obj.scale.x.toFixed(4),
          +obj.scale.y.toFixed(4),
          +obj.scale.z.toFixed(4)
        ],
        anchor: item.anchor || { surface: item.surfaceType || 'floor' },
        tags: item.tags || (item.category === 'prop' ? ['furniture', 'obstacle'] : ['consumable', 'pickup']),
        validation: item.validation ? {
          status: item.validation.status || 'valid',
          developerApproved: !!item.validation.developerApproved,
          originalStatus: item.validation.originalStatus || null,
          reason: item.validation.reason || item.validation.failureReason || null
        } : { status: 'valid', developerApproved: false }
      };
    });

    return {
      schemaVersion: '1.0.0',
      level: 'level0',
      author,
      description,
      catalog: this.catalog,
      placements,
      spawnGroups: [
        {
          id: 'sg_hallway_consumables_01',
          name: 'Hallway Floor Consumables Pool',
          eligibleTypes: ['almond_can', 'energy_drink', 'sanity_pill', 'aa_battery'],
          candidatePoints: [
            [41.8, 0.0, -186.2],
            [42.2, 0.0, -186.1],
            [42.6, 0.0, -186.0],
            [43.1, 0.0, -186.0],
            [43.3, 0.0, -188.7]
          ],
          minCount: 2,
          maxCount: 4,
          surface: 'floor',
          probability: 0.85,
          tags: ['consumable', 'random_loot']
        },
        {
          id: 'sg_tabletop_supplies_01',
          name: 'Office Tabletop Medical & Ammo Pool',
          eligibleTypes: ['first_aid', 'ammo_box', 'sanity_pill', 'doorKey'],
          candidatePoints: [
            [44.75, 0.936, -185.45],
            [44.35, 0.936, -185.45],
            [44.00, 0.936, -185.45],
            [44.55, 0.936, -185.20],
            [44.15, 0.936, -185.20]
          ],
          minCount: 2,
          maxCount: 3,
          surface: 'table',
          supportProp: 'prop_table_01',
          probability: 1.0,
          tags: ['high_tier_loot', 'loot_surface']
        }
      ]
    };
  }

  /**
   * Cleans up placed objects and debug visuals from the scene
   */
  clear() {
    while (this.container.children.length > 0) {
      const child = this.container.children[0];
      this.container.remove(child);
      child.traverse((node) => {
        if (node.isMesh) {
          if (node.geometry) node.geometry.dispose();
          if (node.material) {
            if (Array.isArray(node.material)) {
              node.material.forEach(m => m.dispose());
            } else {
              node.material.dispose();
            }
          }
        }
      });
    }

    while (this.debugContainer.children.length > 0) {
      const child = this.debugContainer.children[0];
      this.debugContainer.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    this.items = [];
    this.propMap.clear();
    this.isLoaded = false;
  }
}
