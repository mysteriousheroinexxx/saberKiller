// Level 0 "The Lobby" — 1:1 Unreal Engine Map & Atmosphere Reconstruction
// Reconstructs the complete M_LV0 level (826 floors, 762 walls, 46 pillars, 344 lights,
// 17 decals, and props) with authentic PBR materials, physically correct shadow-casting PointLights,
// deep gloom falloff matching reference visual quality, and 1-meter sub-cell collision grid.

let envRoot = null;
let isLoaded = false;
let mapData = null;
let collisionHandler = null;

// Instanced meshes for ultra-high performance (single draw call per layer)
let instancedFloors = null;
let instancedCeilings = null;
let instancedWalls = null;
let instancedPillars = null;
let instancedLights = null;
let decalGroup = null;
let propsGroup = null;

// Dynamic real-time point lights pool (tracks fixtures closest to player and Artoria Lily)
let dynamicPointLights = [];
let flickerTimer = 0;

// Reconstructed PBR materials & textures
let floorMaterial = null;
let wallMaterial = null;
let ceilMaterial = null;
let lightPanelMaterial = null;
let decalMaterial = null;
let vendingMaterial = null;
let speakerMaterial = null;
let ladderMaterial = null;

let envInitPromise = null;

export function initLevel0Env(scene, onReady) {
  if (typeof THREE === 'undefined') return Promise.resolve(false);
  if (isLoaded) {
    if (scene && dynamicPointLights.length === 0) setupDynamicLighting(scene);
    if (onReady) onReady();
    return Promise.resolve(true);
  }
  if (envInitPromise) {
    if (onReady) envInitPromise.then(() => onReady());
    return envInitPromise;
  }

  const texLoader = new THREE.TextureLoader();

  function loadTex(url, srgb = true, rx = 1, rz = 1) {
    const t = texLoader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, rz);
    if (srgb) t.encoding = THREE.sRGBEncoding;
    return t;
  }

  // 1. Textures — Full authentic PBR suites extracted from Unreal Engine 4.27
  // Carpet PBR (512x512)
  const carpetBaseColor = loadTex('assets/level0/Carpet_INST_basecolor.png', true, 10, 10);
  const carpetNormal = loadTex('assets/level0/Carpet_INST_normal.png', false, 10, 10);
  const carpetRoughness = loadTex('assets/level0/Carpet_INST_roughness.png', false, 10, 10);
  const carpetAO = loadTex('assets/level0/Carpet_INST_ambientOcclusion.png', false, 10, 10);

  // Wall PBR (1024x1024)
  const wallBaseColor = loadTex('assets/level0/test3_basecolor.png', true, 1, 1);
  const wallNormal = loadTex('assets/level0/norm_1k_paperwalls.png', false, 1, 1);
  const wallRoughness = loadTex('assets/level0/test3_roughness.png', false, 1, 1);

  // Ceiling PBR (1024x1024 optimized)
  const ceilBaseColor = loadTex('assets/level0/OfficeCeiling001_4K_Color_1k.png', true, 5, 5);
  const ceilNormal = loadTex('assets/level0/OfficeCeiling001_4K_NormalGL_1k.png', false, 5, 5);
  const ceilRoughness = loadTex('assets/level0/OfficeCeiling001_4K_Roughness_1k.png', false, 5, 5);
  const ceilAO = loadTex('assets/level0/OfficeCeiling001_4K_AmbientOcclusion_1k.png', false, 5, 5);

  const decalAlbedo = texLoader.load('assets/level0/decals/Albedo_2K_ukxncbfcw.png');
  decalAlbedo.encoding = THREE.sRGBEncoding;
  const decalOpacity = texLoader.load('assets/level0/decals/Opacity_2K_ukxncbfcw.png');

  const pessiColor = texLoader.load('assets/level0/pessi.png');
  pessiColor.encoding = THREE.sRGBEncoding;
  const pessiNormal = texLoader.load('assets/level0/pessi_normal.png');

  // 2. Authentic PBR Materials
  floorMaterial = new THREE.MeshStandardMaterial({
    map: carpetBaseColor,
    normalMap: carpetNormal,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: carpetRoughness,
    roughness: 0.82,
    aoMap: carpetAO,
    aoMapIntensity: 1.0,
    metalness: 0.02
  });

  wallMaterial = new THREE.MeshStandardMaterial({
    map: wallBaseColor,
    normalMap: wallNormal,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughnessMap: wallRoughness,
    roughness: 0.85,
    metalness: 0.01,
    side: THREE.DoubleSide
  });

  ceilMaterial = new THREE.MeshStandardMaterial({
    map: ceilBaseColor,
    normalMap: ceilNormal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: ceilRoughness,
    roughness: 0.75,
    aoMap: ceilAO,
    aoMapIntensity: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide
  });

  lightPanelMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide
  });

  decalMaterial = new THREE.MeshStandardMaterial({
    map: decalAlbedo,
    alphaMap: decalOpacity,
    transparent: true,
    roughness: 0.82,
    metalness: 0.05,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide
  });

  vendingMaterial = new THREE.MeshStandardMaterial({
    map: pessiColor,
    normalMap: pessiNormal,
    roughness: 0.35,
    metalness: 0.25
  });

  speakerMaterial = new THREE.MeshStandardMaterial({
    color: 0x24201c,
    roughness: 0.55,
    metalness: 0.35
  });

  ladderMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d3830,
    roughness: 0.6,
    metalness: 0.7
  });

  envRoot = new THREE.Group();
  envRoot.name = 'Level0_Environment_Root';

  // 3. Load Map JSON and GLB in parallel
  envInitPromise = Promise.all([
    fetch('assets/level0/level0_map.json').then(r => r.json()),
    new Promise((resolve, reject) => {
      new THREE.GLTFLoader().load('assets/level0/lv0_scene.glb', resolve, undefined, reject);
    })
  ]).then(([mapJson, gltf]) => {
    mapData = mapJson;
    setupCollisionGrid(mapData);
    buildEnvironmentGeometry(mapData, gltf.scene);
    if (scene) setupDynamicLighting(scene);

    isLoaded = true;
    if (onReady) onReady();
    return true;
  }).catch(err => {
    console.error('Failed to initialize Level 0 Environment:', err);
    return false;
  });

  return envInitPromise;
}

function setupCollisionGrid(map) {
  const g = map.grid;
  const cols = g.cols;
  const rows = g.rows;
  const ox = g.originX;
  const oz = g.originZ;
  const cs = g.cellSize;

  // Decode RLE 0/1 array (173,711 cells)
  const cells = new Uint8Array(cols * rows);
  let idx = 0;
  for (const part of g.rle.split(',')) {
    const colon = part.indexOf(':');
    const val = parseInt(part.substring(0, colon), 10);
    const cnt = parseInt(part.substring(colon + 1), 10);
    cells.fill(val, idx, idx + cnt);
    idx += cnt;
  }

  // Pre-calculate reachable floor cells using flood fill from player start
  const psCol = Math.round((map.playerStart[0] - ox) / cs);
  const psRow = Math.round((map.playerStart[2] - oz) / cs);
  const visited = new Uint8Array(cols * rows);
  const q = [psCol, psRow];
  visited[psRow * cols + psCol] = 1;
  const reachableFloorCells = [];
  let head = 0;
  while (head < q.length) {
    const c = q[head++];
    const r = q[head++];
    reachableFloorCells.push([c, r]);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
        const nIdx = nr * cols + nc;
        if (!visited[nIdx] && cells[nIdx] === 0) {
          visited[nIdx] = 1;
          q.push(nc, nr);
        }
      }
    }
  }

  const isWall = (c, r) => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return true;
    return cells[r * cols + c] === 1;
  };

  const cellOfX = x => Math.floor((x - ox) / cs);
  const cellOfZ = z => Math.floor((z - oz) / cs);

  const cellCenter = (c, r) => [ox + c * cs + cs / 2, oz + r * cs + cs / 2];

  const circleHitsWall = (px, pz, radius) => {
    const cc = Math.floor((px - ox) / cs);
    const cr = Math.floor((pz - oz) / cs);
    const radCeil = Math.ceil(radius / cs);
    for (let r = cr - radCeil; r <= cr + radCeil; r++) {
      for (let c = cc - radCeil; c <= cc + radCeil; c++) {
        if (!isWall(c, r)) continue;
        const minX = ox + c * cs;
        const maxX = minX + cs;
        const minZ = oz + r * cs;
        const maxZ = minZ + cs;
        const nx = Math.max(minX, Math.min(px, maxX));
        const nz = Math.max(minZ, Math.min(pz, maxZ));
        if ((px - nx) ** 2 + (pz - nz) ** 2 < radius * radius) {
          return true;
        }
      }
    }
    return false;
  };

  const drawMinimap = (ctx, playerPos, playerYaw, exitPos, zombies, npcs) => {
    ctx.fillStyle = '#0b0d0a';
    ctx.fillRect(0, 0, 150, 150);

    // Radar circle outline
    ctx.strokeStyle = '#273620';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(75, 75, 71, 0, Math.PI * 2);
    ctx.stroke();

    const scale = 3.0; // 3 pixels per meter -> 50m diameter visible
    const pcX = cellOfX(playerPos.x);
    const pcZ = cellOfZ(playerPos.z);
    const range = 24;

    // Draw local walls
    ctx.fillStyle = '#3c4a28';
    for (let r = pcZ - range; r <= pcZ + range; r++) {
      for (let c = pcX - range; c <= pcX + range; c++) {
        if (!isWall(c, r)) continue;
        const [wx, wz] = cellCenter(c, r);
        const dx = (wx - playerPos.x) * scale;
        const dz = (wz - playerPos.z) * scale;
        if (dx * dx + dz * dz < 70 * 70) {
          ctx.fillRect(75 + dx - scale / 2, 75 + dz - scale / 2, scale, scale);
        }
      }
    }

    // Exit portal marker / direction chevron
    if (exitPos) {
      const edx = (exitPos.x - playerPos.x) * scale;
      const edz = (exitPos.z - playerPos.z) * scale;
      const edist = Math.hypot(edx, edz);
      if (edist < 68) {
        ctx.fillStyle = '#40d0e0';
        ctx.beginPath();
        ctx.arc(75 + edx, 75 + edz, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Clamp to edge
        const ang = Math.atan2(edz, edx);
        const bx = 75 + Math.cos(ang) * 66;
        const by = 75 + Math.sin(ang) * 66;
        ctx.fillStyle = '#40d0e0';
        ctx.beginPath();
        ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Summoner NPC
    if (npcs) {
      for (const n of npcs) {
        if (!n?.group) continue;
        const nx = (n.group.position.x - playerPos.x) * scale;
        const nz = (n.group.position.z - playerPos.z) * scale;
        if (nx * nx + nz * nz < 68 * 68) {
          ctx.fillStyle = '#60a0ff';
          ctx.beginPath();
          ctx.arc(75 + nx, 75 + nz, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Artoria Lily (zombies)
    if (zombies) {
      for (const zb of zombies) {
        if (!zb?.group || zb.state === 'dying') continue;
        const zx = (zb.group.position.x - playerPos.x) * scale;
        const zz = (zb.group.position.z - playerPos.z) * scale;
        if (zx * zx + zz * zz < 68 * 68) {
          ctx.fillStyle = '#e83030';
          ctx.beginPath();
          ctx.arc(75 + zx, 75 + zz, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Player arrow at center
    ctx.save();
    ctx.translate(75, 75);
    ctx.rotate(playerYaw);
    ctx.fillStyle = '#e0f060';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(0, 3);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  collisionHandler = {
    cols, rows, originX: ox, originZ: oz, cellSize: cs,
    isWall, cellOfX, cellOfZ, cellCenter, circleHitsWall,
    floorCells: reachableFloorCells,
    drawMinimap,
    getRaycastTargets: () => {
      const targets = [];
      if (instancedWalls) targets.push(instancedWalls);
      if (instancedPillars) targets.push(instancedPillars);
      return targets;
    }
  };
}

function buildEnvironmentGeometry(map, gltfScene) {
  // Use exact, closed box geometry with authentic PBR material for 100% solid walls
  const floorGeo = new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);
  floorGeo.setAttribute('uv2', floorGeo.attributes.uv);

  const ceilGeo = new THREE.PlaneGeometry(10, 10);
  ceilGeo.setAttribute('uv2', ceilGeo.attributes.uv);

  const wallGeo = new THREE.BoxGeometry(10, 4.0, 0.8).translate(0, 2.0, 0);
  const pillarGeo = new THREE.BoxGeometry(2.0, 4.0, 2.0).translate(0, 2.0, 0);

  const dummy = new THREE.Object3D();

  // 1. Floors (826 instances)
  const floors = map.floors || [];
  instancedFloors = new THREE.InstancedMesh(floorGeo, floorMaterial, floors.length);
  instancedFloors.receiveShadow = true;
  for (let i = 0; i < floors.length; i++) {
    const f = floors[i];
    dummy.position.set(f[0], 0, f[2]);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    instancedFloors.setMatrixAt(i, dummy.matrix);
  }
  instancedFloors.instanceMatrix.needsUpdate = true;
  envRoot.add(instancedFloors);

  // 2. Ceilings (826 instances at Y = 4.0m, rotated to face down)
  instancedCeilings = new THREE.InstancedMesh(ceilGeo, ceilMaterial, floors.length);
  instancedCeilings.receiveShadow = true;
  for (let i = 0; i < floors.length; i++) {
    const f = floors[i];
    dummy.position.set(f[0], 4.0, f[2]);
    dummy.rotation.set(Math.PI / 2, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    instancedCeilings.setMatrixAt(i, dummy.matrix);
  }
  instancedCeilings.instanceMatrix.needsUpdate = true;
  envRoot.add(instancedCeilings);

  // 3. Walls (762 instances)
  const walls = map.walls || [];
  instancedWalls = new THREE.InstancedMesh(wallGeo, wallMaterial, walls.length);
  instancedWalls.castShadow = true;
  instancedWalls.receiveShadow = true;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    dummy.position.set(w[0], w[1], w[2]);
    dummy.rotation.set(0, w[3], 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    instancedWalls.setMatrixAt(i, dummy.matrix);
  }
  instancedWalls.instanceMatrix.needsUpdate = true;
  envRoot.add(instancedWalls);

  // 4. Pillars (46 instances)
  const pillars = map.pillars || [];
  instancedPillars = new THREE.InstancedMesh(pillarGeo, wallMaterial, pillars.length);
  instancedPillars.castShadow = true;
  instancedPillars.receiveShadow = true;
  for (let i = 0; i < pillars.length; i++) {
    const p = pillars[i];
    dummy.position.set(p[0], 0, p[2]);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    instancedPillars.setMatrixAt(i, dummy.matrix);
  }
  instancedPillars.instanceMatrix.needsUpdate = true;
  envRoot.add(instancedPillars);

  // 5. Ceiling Light Fixtures (344 instances glowing pure ivory-white)
  const lights = map.lights || [];
  const lightPanelGeo = new THREE.PlaneGeometry(2.4, 1.2);
  lightPanelGeo.rotateX(Math.PI / 2);
  instancedLights = new THREE.InstancedMesh(lightPanelGeo, lightPanelMaterial, lights.length);
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    dummy.position.set(l[0], 3.98, l[2]);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    instancedLights.setMatrixAt(i, dummy.matrix);
  }
  instancedLights.instanceMatrix.needsUpdate = true;
  envRoot.add(instancedLights);

  // 6. Wall Decals (17 Megascans Damaged Painted Arrow signs)
  decalGroup = new THREE.Group();
  decalGroup.name = 'Level0_Decals';
  const decalGeo = new THREE.PlaneGeometry(2.2, 1.4);
  const decals = map.decals || [];
  for (const d of decals) {
    const m = new THREE.Mesh(decalGeo, decalMaterial);
    m.position.set(d.pos[0], d.pos[1], d.pos[2]);
    m.rotation.y = d.yaw;
    decalGroup.add(m);
  }
  envRoot.add(decalGroup);

  // 7. Props & Vending Machines
  propsGroup = new THREE.Group();
  propsGroup.name = 'Level0_Props';

  // Extract vending machines and speakers from gltfScene
  gltfScene.traverse(o => {
    if (!o.isMesh) return;
    const name = o.name || o.parent?.name || '';
    if (name.includes('Pessi') || name.includes('vending')) {
      o.material = vendingMaterial;
      const clone = o.clone();
      o.getWorldPosition(clone.position);
      o.getWorldQuaternion(clone.quaternion);
      propsGroup.add(clone);
    } else if (name.includes('Speaker')) {
      o.material = speakerMaterial;
      const clone = o.clone();
      o.getWorldPosition(clone.position);
      o.getWorldQuaternion(clone.quaternion);
      propsGroup.add(clone);
    }
  });

  // Ladder leading up to exit portal
  new THREE.BufferGeometryLoader().load('assets/level0/ladder.json', (ladderGeo) => {
    const ladderMesh = new THREE.Mesh(ladderGeo, ladderMaterial);
    ladderMesh.position.set(79.5, 1.0, 207.86);
    ladderMesh.rotation.y = Math.PI;
    propsGroup.add(ladderMesh);
  }, undefined, (err) => {
    console.warn('Failed to load ladder geometry:', err);
  });

  envRoot.add(propsGroup);
}

function setupDynamicLighting(scene) {
  // 8 PointLights: 4 shadow casters + 4 fill lights placed at Y = 2.2m (1.8m below ceiling)
  for (let i = 0; i < 8; i++) {
    const isShadow = (i < 4);
    const pl = new THREE.PointLight(0xfff6cf, 32.0, 22.0, 2.0);
    pl.castShadow = isShadow;
    if (isShadow) {
      pl.shadow.bias = -0.0015;
      pl.shadow.normalBias = 0.04;
      pl.shadow.mapSize.width = 512;
      pl.shadow.mapSize.height = 512;
      pl.shadow.camera.near = 0.2;
      pl.shadow.camera.far = 24.0;
    }
    scene.add(pl);
    dynamicPointLights.push(pl);
  }
}

export function getCollisionHandler() {
  return collisionHandler;
}

export function enterLevel0Env(scene, options = {}) {
  const { wallMeshes, floorMesh, ceilMesh, fluorescentGroup, outletGroup, propGroup, trimMeshes } = options;

  if (scene && dynamicPointLights.length === 0) {
    setupDynamicLighting(scene);
  }

  if (envRoot && scene && !envRoot.parent) {
    scene.add(envRoot);
  }
  if (envRoot) envRoot.visible = true;

  for (const pl of dynamicPointLights) {
    pl.visible = true;
  }

  // Hide procedural meshes from standard engine to completely eliminate Z-fighting
  if (floorMesh) floorMesh.visible = false;
  if (ceilMesh) ceilMesh.visible = false;
  if (fluorescentGroup) fluorescentGroup.visible = false;
  if (outletGroup) outletGroup.visible = false;
  if (propGroup) propGroup.visible = false;

  if (wallMeshes) {
    for (const wm of wallMeshes) {
      if (wm) wm.visible = false;
    }
  }
  if (trimMeshes) {
    for (const tm of trimMeshes) {
      if (tm) tm.visible = false;
    }
  }
}

export function updateLevel0Env(dt, playerPos, activeEnemies, playerYaw) {
  if (!isLoaded || !mapData) return;

  const lights = mapData.lights || [];
  if (lights.length === 0 || dynamicPointLights.length === 0) return;

  const px = playerPos?.x ?? 48.69;
  const pz = playerPos?.z ?? -187.65;

  // Find nearest Artoria Lily / enemy position if present
  let ex = null, ez = null;
  if (activeEnemies && activeEnemies.length) {
    let nearestDist = 1e9;
    for (const zb of activeEnemies) {
      if (!zb?.group || zb.state === 'dying') continue;
      const d = (zb.group.position.x - px) ** 2 + (zb.group.position.z - pz) ** 2;
      if (d < nearestDist) {
        nearestDist = d;
        ex = zb.group.position.x;
        ez = zb.group.position.z;
      }
    }
  }

  // Directional weighting: prioritize lights in the direction the player is looking
  const fwdX = playerYaw !== undefined ? -Math.sin(playerYaw) : 0;
  const fwdZ = playerYaw !== undefined ? -Math.cos(playerYaw) : -1;

  const sortedByPlayer = lights.map(l => {
    const dx = l[0] - px, dz = l[2] - pz;
    const d = Math.hypot(dx, dz);
    let dot = 0;
    if (d > 0.2) dot = (dx * fwdX + dz * fwdZ) / d;
    // Lights ahead receive higher priority (lower effective sorting distance)
    const weight = dot > 0.2 ? 0.65 : (dot < -0.2 ? 1.4 : 1.0);
    return { pos: l, priority: d * weight };
  }).sort((a, b) => a.priority - b.priority);

  // If Artoria Lily is nearby, assign light slot 1 to the fixture closest to her
  let assignedLights = [];
  if (ex !== null && ez !== null) {
    const sortedByEnemy = lights.map(l => ({
      pos: l,
      d2: (l[0] - ex) ** 2 + (l[2] - ez) ** 2
    })).sort((a, b) => a.d2 - b.d2);

    assignedLights.push(sortedByPlayer[0].pos); // light 0: closest to player (shadow-caster)
    assignedLights.push(sortedByEnemy[0].pos);  // light 1: closest to Artoria Lily (shadow-caster)
    for (const item of sortedByPlayer) {
      if (assignedLights.length >= 8) break;
      if (!assignedLights.includes(item.pos)) assignedLights.push(item.pos);
    }
  } else {
    assignedLights = sortedByPlayer.slice(0, 8).map(item => item.pos);
  }

  flickerTimer += dt;
  const microFlicker = Math.random() < 0.06 ? 6.0 : 0;

  for (let i = 0; i < dynamicPointLights.length; i++) {
    const pl = dynamicPointLights[i];
    if (i < assignedLights.length) {
      const targetPos = assignedLights[i];
      // Y = 2.2m (suspended 1.8m below ceiling, exactly matching Lights.uasset RelativeLocation)
      pl.position.set(targetPos[0], 2.2, targetPos[2]);
      pl.intensity = 32.0 - (i === 0 ? microFlicker : 0);
      pl.visible = true;
    } else {
      pl.visible = false;
    }
  }

  // Micro-variation on ceiling fixture panels to simulate authentic fluorescent ballast buzz
  if (flickerTimer > 0.1) {
    flickerTimer = 0;
    if (lightPanelMaterial && Math.random() < 0.1) {
      lightPanelMaterial.color.setHex(Math.random() < 0.5 ? 0xfffcf0 : 0xffffff);
    }
  }
}

export function leaveLevel0Env(scene, options = {}) {
  const { wallMeshes, floorMesh, ceilMesh } = options;

  if (envRoot) envRoot.visible = false;

  for (const pl of dynamicPointLights) {
    pl.visible = false;
  }

  // Restore procedural meshes for non-Level 0 levels
  if (floorMesh) floorMesh.visible = true;
  if (ceilMesh) ceilMesh.visible = true;
  if (wallMeshes) {
    for (const wm of wallMeshes) {
      if (wm) wm.visible = true;
    }
  }
}
