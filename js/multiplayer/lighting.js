// Saber Killer — Multiplayer Dedicated Lighting Controller
// Provides authentic brightly illuminated Backrooms Level 0 atmosphere
// Overwhelming sickly yellow fluorescent office lighting with natural falloff and spatial depth

const THREE = window.THREE;

let savedScene = null;
let savedRenderer = null;
let savedPlayerLight = null;

let hemiLight = null;
let ambientLight = null;
let dynamicPointLights = [];
let isLightingInitialized = false;
let mapLights = null;

const TOTAL_LIGHTS = 38;
const SHADOW_LIGHTS_COUNT = 2;

// Fluorescent fixture downlight parameters
const LIGHT_Y = 3.35;           // 65cm below 4.0m ceiling (true troffer downlight)
const LIGHT_DISTANCE = 36.0;    // Broad spatial reach
const LIGHT_DECAY = 1.8;        // Realistic diffuse luminaire dispersion

// Standard established Level 0 bright fluorescent D-profile defaults
export const LIGHTING_DEFAULTS = {
  exposure: 1.35,
  ambientIntensity: 0.9,
  hemiIntensity: 1.8,
  pointIntensity: 160.0,
  lightColorHex: '#fdf7a8',
  playerLightIntensity: 3.5
};

let currentConfig = { ...LIGHTING_DEFAULTS };

export function getLightingConfig() {
  return { ...currentConfig };
}

export function setExposure(val) {
  currentConfig.exposure = Math.max(0.1, Number(val) || 1.35);
  if (savedRenderer) {
    savedRenderer.toneMappingExposure = currentConfig.exposure;
  }
}

export function setAmbientIntensity(val) {
  currentConfig.ambientIntensity = Math.max(0, Number(val) || 0);
  currentConfig.hemiIntensity = currentConfig.ambientIntensity * 2.0;
  if (ambientLight) {
    ambientLight.intensity = currentConfig.ambientIntensity;
  }
  if (hemiLight) {
    hemiLight.intensity = currentConfig.hemiIntensity;
  }
}

export function setPointIntensity(val) {
  currentConfig.pointIntensity = Math.max(0, Number(val) || 0);
  for (const pl of dynamicPointLights) {
    pl.intensity = currentConfig.pointIntensity;
  }
}

export function setLightColor(hexStr) {
  currentConfig.lightColorHex = hexStr;
  const col = new THREE.Color(hexStr);
  for (const pl of dynamicPointLights) {
    pl.color.copy(col);
  }
  if (hemiLight) {
    hemiLight.color.copy(col);
  }
}

export function setPlayerLightIntensity(val) {
  currentConfig.playerLightIntensity = Math.max(0, Number(val) || 0);
  if (savedPlayerLight) {
    savedPlayerLight.intensity = currentConfig.playerLightIntensity;
  }
}

export function resetLighting() {
  currentConfig = { ...LIGHTING_DEFAULTS };
  if (savedRenderer) savedRenderer.toneMappingExposure = currentConfig.exposure;
  if (ambientLight) ambientLight.intensity = currentConfig.ambientIntensity;
  if (hemiLight) {
    hemiLight.intensity = currentConfig.hemiIntensity;
    hemiLight.color.setHex(0xfcf2a5);
  }
  const defaultCol = new THREE.Color(LIGHTING_DEFAULTS.lightColorHex);
  for (const pl of dynamicPointLights) {
    pl.intensity = currentConfig.pointIntensity;
    pl.color.copy(defaultCol);
  }
  if (savedPlayerLight) savedPlayerLight.intensity = currentConfig.playerLightIntensity;
  return { ...currentConfig };
}

export function initMultiplayerLighting(scene, renderer, playerLight = null) {
  if (isLightingInitialized) return;

  savedScene = scene;
  savedRenderer = renderer;
  savedPlayerLight = playerLight || scene.getObjectByName('MP_LocalPlayerLight');

  // 1. Atmosphere: Sickly drab ochre/yellow-green background and fog
  // Eliminates pitch-black void; corridors fade into endless yellow haze
  const fogColor = new THREE.Color(0x4a3d12);
  scene.background = fogColor;
  scene.fog = new THREE.FogExp2(fogColor, 0.0055);

  // 2. Exposure Calibration: Lift midtones out of ACES Filmic dark-toe
  renderer.toneMappingExposure = currentConfig.exposure;

  // 3. Diffuse Indirect GI Field (Simulates 3-5 Lightmass bounces off yellow wallpaper & carpet)
  // Upper hemisphere: warm fluorescent downlight. Lower hemisphere: olive carpet bounce.
  hemiLight = new THREE.HemisphereLight(0xfcf2a5, 0x8c7928, currentConfig.hemiIntensity);
  hemiLight.name = 'MP_Hemi_GI';
  scene.add(hemiLight);

  // General warm ambient fill
  ambientLight = new THREE.AmbientLight(0xfff0aa, currentConfig.ambientIntensity);
  ambientLight.name = 'MP_Ambient_Fill';
  scene.add(ambientLight);

  // 4. Gather existing PointLights from scene (added by level0_env.js)
  const existingLights = [];
  scene.traverse(o => {
    if (o.isPointLight && o.name !== 'PlayerLight' && o.name !== 'MP_LocalPlayerLight') {
      existingLights.push(o);
    }
  });

  dynamicPointLights = [...existingLights];

  const lightColorObj = new THREE.Color(currentConfig.lightColorHex);

  // Configure existing lights
  for (let i = 0; i < dynamicPointLights.length; i++) {
    const pl = dynamicPointLights[i];
    pl.color.copy(lightColorObj);
    pl.intensity = currentConfig.pointIntensity;
    pl.distance = LIGHT_DISTANCE;
    pl.decay = LIGHT_DECAY;
    const isShadow = (i < SHADOW_LIGHTS_COUNT);
    pl.castShadow = isShadow;
    if (isShadow) {
      pl.shadow.bias = -0.0015;
      pl.shadow.normalBias = 0.04;
      pl.shadow.mapSize.width = 512;
      pl.shadow.mapSize.height = 512;
      pl.shadow.camera.near = 0.2;
      pl.shadow.camera.far = 36.0;
    }
  }

  // 5. Add extra fill lights to reach TOTAL_LIGHTS (38)
  while (dynamicPointLights.length < TOTAL_LIGHTS) {
    const pl = new THREE.PointLight(lightColorObj, currentConfig.pointIntensity, LIGHT_DISTANCE, LIGHT_DECAY);
    pl.castShadow = false;
    scene.add(pl);
    dynamicPointLights.push(pl);
  }

  // 6. Tune Level 0 PBR materials for optimal fluorescent response
  scene.traverse(o => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.color) {
          const hex = m.color.getHex();
          if (hex === 0xd6ce88) {
            // Wallpaper
            m.roughness = 0.72;
          } else if (hex === 0xbfae6d) {
            // Carpet
            m.roughness = 0.78;
            if (m.aoMapIntensity !== undefined) m.aoMapIntensity = 0.65;
          } else if (hex === 0xebe9d6) {
            // Ceiling
            m.roughness = 0.70;
            if (m.aoMapIntensity !== undefined) m.aoMapIntensity = 0.65;
          }
        }
      }
    }
  });

  isLightingInitialized = true;
  console.log(`[MP LIGHTING] Initialized with ${dynamicPointLights.length} dynamic PointLights + Hemi/Ambient GI field.`);
}

export function setMapLights(lightsArray) {
  mapLights = lightsArray;
}

export function updateMultiplayerLighting(dt, localPos, remotePlayers) {
  if (!mapLights || mapLights.length === 0 || dynamicPointLights.length === 0) return;

  const lx = localPos?.x ?? 48.69;
  const lz = localPos?.z ?? -187.65;

  // Remote player position for second shadow caster
  let rx = null, rz = null;
  if (remotePlayers && remotePlayers.size > 0) {
    const firstRemote = remotePlayers.values().next().value;
    if (firstRemote?.group) {
      rx = firstRemote.group.position.x;
      rz = firstRemote.group.position.z;
    }
  }

  // Sort fixtures by distance to local player
  const sortedByLocal = mapLights.map(l => {
    const dx = l[0] - lx, dz = l[2] - lz;
    return { pos: l, d2: dx * dx + dz * dz };
  }).sort((a, b) => a.d2 - b.d2);

  const assigned = [];

  // Slot 0: Closest fixture to local player (Shadow Caster 1)
  assigned.push(sortedByLocal[0].pos);

  // Slot 1: Closest fixture to remote peer (Shadow Caster 2)
  if (rx !== null && rz !== null) {
    const sortedByRemote = mapLights.map(l => {
      const dx = l[0] - rx, dz = l[2] - rz;
      return { pos: l, d2: dx * dx + dz * dz };
    }).sort((a, b) => a.d2 - b.d2);

    for (const item of sortedByRemote) {
      if (!assigned.includes(item.pos)) {
        assigned.push(item.pos);
        break;
      }
    }
  }

  // Fill remaining slots from fixtures nearest to local player
  for (const item of sortedByLocal) {
    if (assigned.length >= TOTAL_LIGHTS) break;
    if (!assigned.includes(item.pos)) {
      assigned.push(item.pos);
    }
  }

  const activeColor = new THREE.Color(currentConfig.lightColorHex);

  // Position and update dynamic lights
  for (let i = 0; i < dynamicPointLights.length; i++) {
    const pl = dynamicPointLights[i];
    if (i < assigned.length) {
      const target = assigned[i];
      // Position at Y = 3.35 (directly below ceiling fixture)
      pl.position.set(target[0], LIGHT_Y, target[2]);
      pl.intensity = currentConfig.pointIntensity;
      pl.color.copy(activeColor);
      pl.distance = LIGHT_DISTANCE;
      pl.decay = LIGHT_DECAY;
      pl.visible = true;
    } else {
      pl.visible = false;
    }
  }
}
