import * as YUKA from '../../yuka/build/yuka.module.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * WallObstacle is a solid rectangular barrier that implements Yuka's lineOfSightTest
 * using an axis-aligned bounding box (AABB).
 */
export class WallObstacle extends YUKA.GameEntity {
  /**
   * @param {string} name
   * @param {number} x - Center X
   * @param {number} z - Center Z
   * @param {number} width - Size X
   * @param {number} depth - Size Z
   * @param {number} [height=3.0] - Wall height Y
   */
  constructor(name, x, z, width, depth, height = 3.0) {
    super();
    this.name = name;
    this.position.set(x, height / 2, z);
    this.width = width;
    this.depth = depth;
    this.height = height;
    this.active = true; // Can be toggled for testing LoS

    const halfW = width / 2;
    const halfD = depth / 2;

    this.aabb = new YUKA.AABB(
      new YUKA.Vector3(x - halfW, 0, z - halfD),
      new YUKA.Vector3(x + halfW, height, z + halfD)
    );
  }

  /**
   * Implements Yuka's obstacle interface for Vision component.
   * @param {YUKA.Ray} ray
   * @param {YUKA.Vector3} intersectionPoint
   * @returns {YUKA.Vector3|null}
   */
  lineOfSightTest(ray, intersectionPoint) {
    if (!this.active) return null;
    return ray.intersectAABB(this.aabb, intersectionPoint);
  }

  /**
   * Checks if a 2D point (x, z) with radius r intersects this wall.
   */
  intersectsCircle(x, z, radius = 0.5) {
    if (!this.active) return false;
    const minX = this.aabb.min.x - radius;
    const maxX = this.aabb.max.x + radius;
    const minZ = this.aabb.min.z - radius;
    const maxZ = this.aabb.max.z + radius;
    return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  }
}

/**
 * Level0PrototypeMap builds the verified prototype Backrooms Level 0 layout:
 * - Room 1 (West Gallery): [-24 to -6, Z: -20 to -4]
 * - Room 2 (East Office): [+6 to +24, Z: -20 to -4]
 * - Corridor & Junction: [-6 to +6, Z: -20 to 0]
 * - Room 3 (South Hall): [-20 to +20, Z: 2 to 22]
 * - Internal pillars providing concealment and line-of-sight breaking corners.
 */
export class Level0PrototypeMap {
  constructor() {
    this.bounds = { minX: -26, maxX: 26, minZ: -22, maxZ: 24 };
    this.obstacles = [];
    this.buildMapGeometry();
    this.buildPatrolRoutes();
  }

  buildMapGeometry() {
    // 1. Boundary Perimeter Walls
    this.addWall('bound_north', 0, -22, 52, 1.0);
    this.addWall('bound_south', 0, 24, 52, 1.0);
    this.addWall('bound_west', -26, 1, 1.0, 46);
    this.addWall('bound_east', 26, 1, 1.0, 46);

    // 2. Interior Dividing Walls
    this.addWall('div_west_top', -6, -17, 1.0, 10);
    this.addWall('div_west_bot', -6, -3, 1.0, 8);
    this.addWall('div_east_top', 6, -17, 1.0, 10);
    this.addWall('div_east_bot', 6, -3, 1.0, 8);

    // South Horizontal Wall
    this.addWall('div_south_left', -21, 1, 10, 1.0);
    this.addWall('div_south_midleft', -9, 1, 10, 1.0);
    this.addWall('div_south_midright', 9, 1, 10, 1.0);
    this.addWall('div_south_right', 21, 1, 10, 1.0);

    // 3. Occlusion Pillars
    this.addWall('pillar_w1', -16, -14, 2.0, 2.0);
    this.addWall('pillar_w2', -16, -6, 2.0, 2.0);
    this.addWall('pillar_e1', 16, -14, 2.0, 2.0);
    this.addWall('pillar_e2', 16, -6, 2.0, 2.0);
    this.addWall('pillar_s1', -8, 12, 2.5, 2.5);
    this.addWall('pillar_s2', 8, 12, 2.5, 2.5);
    this.addWall('divider_s_center', 0, 14, 1.0, 8.0);
  }

  addWall(name, x, z, w, d) {
    const wall = new WallObstacle(name, x, z, w, d);
    this.obstacles.push(wall);
    return wall;
  }

  setWallsActive(active = true) {
    for (const obstacle of this.obstacles) {
      obstacle.active = active;
    }
  }

  buildPatrolRoutes() {
    this.saberAlphaWaypoints = [
      new YUKA.Vector3(-16, 0, -18),
      new YUKA.Vector3(-22, 0, -10),
      new YUKA.Vector3(-10, 0, -10),
      new YUKA.Vector3(0, 0, -10),
      new YUKA.Vector3(0, 0, -2),
      new YUKA.Vector3(-12, 0, 7),
      new YUKA.Vector3(-14, 0, 18),
      new YUKA.Vector3(-4, 0, 18),
      new YUKA.Vector3(0, 0, 6)
    ];

    this.saberBetaWaypoints = [
      new YUKA.Vector3(16, 0, -18),
      new YUKA.Vector3(22, 0, -10),
      new YUKA.Vector3(10, 0, -10),
      new YUKA.Vector3(0, 0, -12),
      new YUKA.Vector3(0, 0, -4),
      new YUKA.Vector3(12, 0, 7),
      new YUKA.Vector3(16, 0, 18),
      new YUKA.Vector3(4, 0, 18),
      new YUKA.Vector3(0, 0, 4)
    ];
  }

  hasLineOfSight(from, to) {
    const toVec = new YUKA.Vector3().subVectors(to, from);
    const dist = toVec.length();
    if (dist < 0.001) return true;

    const dir = new YUKA.Vector3().copy(toVec).normalize();
    const ray = new YUKA.Ray(from, dir);
    const hitPoint = new YUKA.Vector3();

    for (const obstacle of this.obstacles) {
      if (!obstacle.active) continue;
      const hit = obstacle.lineOfSightTest(ray, hitPoint);
      if (hit !== null) {
        const hitDist = hitPoint.distanceTo(from);
        if (hitDist < dist - 0.05) {
          return false;
        }
      }
    }
    return true;
  }

  getSoundOcclusionFactor(soundPos, listenerPos) {
    const toVec = new YUKA.Vector3().subVectors(listenerPos, soundPos);
    const dist = toVec.length();
    if (dist < 0.001) return 1.0;

    const dir = new YUKA.Vector3().copy(toVec).normalize();
    const ray = new YUKA.Ray(soundPos, dir);
    const hitPoint = new YUKA.Vector3();
    let wallCuts = 0;

    for (const obstacle of this.obstacles) {
      if (!obstacle.active) continue;
      const hit = obstacle.lineOfSightTest(ray, hitPoint);
      if (hit !== null) {
        const hitDist = hitPoint.distanceTo(soundPos);
        if (hitDist < dist - 0.05) {
          wallCuts++;
        }
      }
    }

    if (wallCuts === 0) return 1.0;
    if (wallCuts === 1) return 0.70;
    return 0.45;
  }

  isWalkable(x, z, radius = 0.5) {
    if (x < this.bounds.minX || x > this.bounds.maxX || z < this.bounds.minZ || z > this.bounds.maxZ) {
      return false;
    }
    for (const obstacle of this.obstacles) {
      if (!obstacle.active) continue;
      if (obstacle.intersectsCircle(x, z, radius)) {
        return false;
      }
    }
    return true;
  }
}

/**
 * GridObstacle wraps a 2D tile/cell map for fast lineOfSightTest in Yuka Vision.
 */
export class GridObstacle extends YUKA.GameEntity {
  constructor(environment) {
    super();
    this.name = 'Level0_GridWalls';
    this.env = environment;
    this.active = true;
  }

  lineOfSightTest(ray, intersectionPoint) {
    if (!this.active || !this.env) return null;
    return this.env.raycastGrid(ray, intersectionPoint);
  }
}

/**
 * Level0Environment loads authentic Level 0 collision data from assets/level0/level0_map.json
 * providing ultra-fast 1-meter sub-cell grid collision and DDA raycasting.
 */
export class Level0Environment {
  constructor(options = {}) {
    this.usePrototypeMap = options.usePrototypeMap ?? false;
    this.isLoaded = false;
    this.obstacles = [];

    // Fallback to prototype map if explicitly requested
    if (this.usePrototypeMap) {
      this.protoMap = new Level0PrototypeMap();
      this.obstacles = this.protoMap.obstacles;
      this.bounds = this.protoMap.bounds;
      this.saberAlphaWaypoints = this.protoMap.saberAlphaWaypoints;
      this.saberBetaWaypoints = this.protoMap.saberBetaWaypoints;
      this.isLoaded = true;
      return;
    }

    this.protoMap = new Level0PrototypeMap();
    this.loadLevel0Map();
  }

  loadLevel0Map() {
    try {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const mapPath = path.resolve(__dirname, '../../assets/level0/level0_map.json');
      if (!fs.existsSync(mapPath)) {
        throw new Error(`File not found: ${mapPath}`);
      }
      const raw = fs.readFileSync(mapPath, 'utf8');
      const data = JSON.parse(raw);
      const g = data.grid;

      this.cols = g.cols;
      this.rows = g.rows;
      this.originX = g.originX;
      this.originZ = g.originZ;
      this.cellSize = g.cellSize;

      this.cells = new Uint8Array(this.cols * this.rows);
      let idx = 0;
      for (const part of g.rle.split(',')) {
        const colon = part.indexOf(':');
        const val = parseInt(part.substring(0, colon), 10);
        const cnt = parseInt(part.substring(colon + 1), 10);
        this.cells.fill(val, idx, idx + cnt);
        idx += cnt;
      }

      this.bounds = {
        minX: this.originX,
        maxX: this.originX + this.cols * this.cellSize,
        minZ: this.originZ,
        maxZ: this.originZ + this.rows * this.cellSize
      };

      // Register grid obstacle for Yuka Vision lineOfSightTest
      this.gridObstacle = new GridObstacle(this);
      this.obstacles = [this.gridObstacle];

      this.buildProductionPatrolRoutes();
      this.isLoaded = true;
    } catch (err) {
      console.warn('[Level0Environment] Could not load level0_map.json, falling back to prototype geometry:', err.message);
      this.protoMap = new Level0PrototypeMap();
      this.obstacles = this.protoMap.obstacles;
      this.bounds = this.protoMap.bounds;
      this.saberAlphaWaypoints = this.protoMap.saberAlphaWaypoints;
      this.saberBetaWaypoints = this.protoMap.saberBetaWaypoints;
      this.isLoaded = true;
    }
  }

  buildProductionPatrolRoutes() {
    // Saber Alpha: Patrolling the western corridors and hallway outside spawn room
    this.saberAlphaWaypoints = [
      new YUKA.Vector3(38.0, 0, -180.0),
      new YUKA.Vector3(45.0, 0, -175.0),
      new YUKA.Vector3(45.0, 0, -165.0),
      new YUKA.Vector3(38.0, 0, -165.0),
      new YUKA.Vector3(38.0, 0, -175.0)
    ];

    // Saber Beta: Patrolling the eastern and central corridors
    this.saberBetaWaypoints = [
      new YUKA.Vector3(60.0, 0, -160.0),
      new YUKA.Vector3(58.0, 0, -170.0),
      new YUKA.Vector3(52.0, 0, -175.0),
      new YUKA.Vector3(48.0, 0, -165.0),
      new YUKA.Vector3(55.0, 0, -160.0)
    ];
  }

  isWall(c, r) {
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return true;
    return this.cells[r * this.cols + c] === 1;
  }

  cellOfX(x) {
    return Math.floor((x - this.originX) / this.cellSize);
  }

  cellOfZ(z) {
    return Math.floor((z - this.originZ) / this.cellSize);
  }

  circleHitsWall(px, pz, radius = 0.5) {
    if (!this.cells) return this.protoMap ? !this.protoMap.isWalkable(px, pz, radius) : false;
    const cc = Math.floor((px - this.originX) / this.cellSize);
    const cr = Math.floor((pz - this.originZ) / this.cellSize);
    const radCeil = Math.ceil(radius / this.cellSize);

    for (let r = cr - radCeil; r <= cr + radCeil; r++) {
      for (let c = cc - radCeil; c <= cc + radCeil; c++) {
        if (!this.isWall(c, r)) continue;
        const minX = this.originX + c * this.cellSize;
        const maxX = minX + this.cellSize;
        const minZ = this.originZ + r * this.cellSize;
        const maxZ = minZ + this.cellSize;
        const nx = Math.max(minX, Math.min(px, maxX));
        const nz = Math.max(minZ, Math.min(pz, maxZ));
        if ((px - nx) ** 2 + (pz - nz) ** 2 < radius * radius) {
          return true;
        }
      }
    }
    return false;
  }

  isWalkable(x, z, radius = 0.5) {
    return !this.circleHitsWall(x, z, radius);
  }

  raycastGrid(ray, intersectionPoint) {
    if (!this.cells) return null;
    const x0 = ray.origin.x;
    const z0 = ray.origin.z;
    const dx = ray.direction.x;
    const dz = ray.direction.z;
    const maxDist = 30.0;
    const stepSize = 0.4;
    const steps = Math.floor(maxDist / stepSize);

    for (let i = 1; i <= steps; i++) {
      const curX = x0 + dx * (i * stepSize);
      const curZ = z0 + dz * (i * stepSize);
      const col = this.cellOfX(curX);
      const row = this.cellOfZ(curZ);
      if (this.isWall(col, row)) {
        if (intersectionPoint) {
          intersectionPoint.set(curX, ray.origin.y, curZ);
        }
        return intersectionPoint;
      }
    }
    return null;
  }

  hasLineOfSight(from, to) {
    if (!this.cells) return this.protoMap ? this.protoMap.hasLineOfSight(from, to) : true;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return true;

    const steps = Math.max(1, Math.floor(dist / 0.4));
    const stepX = dx / steps;
    const stepZ = dz / steps;

    for (let i = 1; i < steps; i++) {
      const px = from.x + stepX * i;
      const pz = from.z + stepZ * i;
      const c = this.cellOfX(px);
      const r = this.cellOfZ(pz);
      if (this.isWall(c, r)) {
        return false;
      }
    }
    return true;
  }

  getSoundOcclusionFactor(soundPos, listenerPos) {
    if (!this.cells) return this.protoMap ? this.protoMap.getSoundOcclusionFactor(soundPos, listenerPos) : 1.0;
    const dx = listenerPos.x - soundPos.x;
    const dz = listenerPos.z - soundPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return 1.0;

    const steps = Math.max(1, Math.floor(dist / 0.5));
    const stepX = dx / steps;
    const stepZ = dz / steps;
    let wallCuts = 0;
    let inWall = false;

    for (let i = 1; i < steps; i++) {
      const px = soundPos.x + stepX * i;
      const pz = soundPos.z + stepZ * i;
      const c = this.cellOfX(px);
      const r = this.cellOfZ(pz);
      const isW = this.isWall(c, r);
      if (isW && !inWall) {
        wallCuts++;
        inWall = true;
      } else if (!isW) {
        inWall = false;
      }
    }

    if (wallCuts === 0) return 1.0;
    if (wallCuts === 1) return 0.70;
    return 0.45;
  }

  setWallsActive(active = true) {
    if (this.gridObstacle) {
      this.gridObstacle.active = active;
    }
    if (this.protoMap) {
      this.protoMap.setWallsActive(active);
    }
  }
}
