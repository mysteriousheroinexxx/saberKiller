/**
 * Configurable Environmental Loot & Spawning Configuration for Level 0 (Multiplayer Survival Mode).
 * Shared cleanly between server (RoomManager) and client modules.
 */

export const APPROVED_KEY_SUPPORT_TYPES = new Set([
  'metal_shelf',
  'table',
  'vending_almond',
  'vending'
]);

export const APPROVED_KEY_ANCHOR_SURFACES = new Set([
  'shelf_tier',
  'table',
  'vending',
  'vending_top',
  'vending_around'
]);

export const APPROVED_CONSUMABLE_TYPES = new Set([
  'aa_battery',
  'almond_can',
  'energy_drink',
  'sanity_pill'
]);

export const DEFAULT_LOOT_CONFIG = {
  enabled: true,
  consumableSlotSpawnChance: 0.62,
  minConsumables: 16,
  maxConsumables: 30,
  consumableWeights: {
    aa_battery: 28,
    almond_can: 28,
    energy_drink: 24,
    sanity_pill: 20
  },
  maxPerType: {
    aa_battery: 10,
    almond_can: 10,
    energy_drink: 8,
    sanity_pill: 8
  },
  keyRules: {
    enforceSurfaceRestriction: true,
    randomizeKeys: true,
    preferDistinctHubs: true
  },
  healthPackRules: {
    randomizeHealthPacks: true,
    preferDistinctHubs: true
  }
};

export const LOOT_CONFIG = {
  enabled: DEFAULT_LOOT_CONFIG.enabled,
  consumableSlotSpawnChance: DEFAULT_LOOT_CONFIG.consumableSlotSpawnChance,
  minConsumables: DEFAULT_LOOT_CONFIG.minConsumables,
  maxConsumables: DEFAULT_LOOT_CONFIG.maxConsumables,
  consumableWeights: { ...DEFAULT_LOOT_CONFIG.consumableWeights },
  maxPerType: { ...DEFAULT_LOOT_CONFIG.maxPerType },
  keyRules: { ...DEFAULT_LOOT_CONFIG.keyRules },
  healthPackRules: { ...DEFAULT_LOOT_CONFIG.healthPackRules }
};

export function configureLootRules(opts = {}) {
  if (typeof opts.enabled === 'boolean') LOOT_CONFIG.enabled = opts.enabled;
  if (typeof opts.consumableSlotSpawnChance === 'number' && !Number.isNaN(opts.consumableSlotSpawnChance)) {
    LOOT_CONFIG.consumableSlotSpawnChance = Math.max(0, Math.min(1, opts.consumableSlotSpawnChance));
  }
  if (typeof opts.minConsumables === 'number' && !Number.isNaN(opts.minConsumables)) {
    LOOT_CONFIG.minConsumables = Math.max(0, Math.floor(opts.minConsumables));
  }
  if (typeof opts.maxConsumables === 'number' && !Number.isNaN(opts.maxConsumables)) {
    LOOT_CONFIG.maxConsumables = Math.max(LOOT_CONFIG.minConsumables, Math.floor(opts.maxConsumables));
  }
  if (LOOT_CONFIG.maxConsumables < LOOT_CONFIG.minConsumables) {
    LOOT_CONFIG.maxConsumables = LOOT_CONFIG.minConsumables;
  }
  if (opts.consumableWeights && typeof opts.consumableWeights === 'object') {
    for (const [k, v] of Object.entries(opts.consumableWeights)) {
      if (APPROVED_CONSUMABLE_TYPES.has(k) && typeof v === 'number' && v >= 0) {
        LOOT_CONFIG.consumableWeights[k] = v;
      }
    }
  }
  if (opts.maxPerType && typeof opts.maxPerType === 'object') {
    for (const [k, v] of Object.entries(opts.maxPerType)) {
      if (APPROVED_CONSUMABLE_TYPES.has(k) && typeof v === 'number' && v >= 0) {
        LOOT_CONFIG.maxPerType[k] = Math.floor(v);
      }
    }
  }
  if (opts.keyRules && typeof opts.keyRules === 'object') {
    LOOT_CONFIG.keyRules = { ...LOOT_CONFIG.keyRules, ...opts.keyRules };
  }
  if (opts.healthPackRules && typeof opts.healthPackRules === 'object') {
    LOOT_CONFIG.healthPackRules = { ...LOOT_CONFIG.healthPackRules, ...opts.healthPackRules };
  }
  return getLootConfigSnapshot();
}

export function resetLootConfig() {
  LOOT_CONFIG.enabled = DEFAULT_LOOT_CONFIG.enabled;
  LOOT_CONFIG.consumableSlotSpawnChance = DEFAULT_LOOT_CONFIG.consumableSlotSpawnChance;
  LOOT_CONFIG.minConsumables = DEFAULT_LOOT_CONFIG.minConsumables;
  LOOT_CONFIG.maxConsumables = DEFAULT_LOOT_CONFIG.maxConsumables;
  LOOT_CONFIG.consumableWeights = { ...DEFAULT_LOOT_CONFIG.consumableWeights };
  LOOT_CONFIG.maxPerType = { ...DEFAULT_LOOT_CONFIG.maxPerType };
  LOOT_CONFIG.keyRules = { ...DEFAULT_LOOT_CONFIG.keyRules };
  LOOT_CONFIG.healthPackRules = { ...DEFAULT_LOOT_CONFIG.healthPackRules };
  return getLootConfigSnapshot();
}

export function getLootConfigSnapshot() {
  return {
    enabled: LOOT_CONFIG.enabled,
    consumableSlotSpawnChance: LOOT_CONFIG.consumableSlotSpawnChance,
    minConsumables: LOOT_CONFIG.minConsumables,
    maxConsumables: LOOT_CONFIG.maxConsumables,
    consumableWeights: { ...LOOT_CONFIG.consumableWeights },
    maxPerType: { ...LOOT_CONFIG.maxPerType },
    keyRules: { ...LOOT_CONFIG.keyRules },
    healthPackRules: { ...LOOT_CONFIG.healthPackRules }
  };
}

/**
 * Validates that a key spawn slot strictly sits on or immediately around
 * a metal_shelf, table, or vending machine — NEVER on random floor points.
 */
export function isApprovedKeySlot(slot) {
  if (!slot || !Array.isArray(slot.position) || slot.position.length !== 3) return false;
  if (!slot.position.every(n => typeof n === 'number' && Number.isFinite(n))) return false;

  const supportType = slot.supportType || slot.anchor?.supportType || null;
  const anchorSurface = slot.anchor?.surface || slot.surfaceType || null;
  const supportProp = slot.supportProp || slot.anchor?.supportProp || null;

  if (!supportType || !APPROVED_KEY_SUPPORT_TYPES.has(supportType)) return false;
  if (!anchorSurface || !APPROVED_KEY_ANCHOR_SURFACES.has(anchorSurface)) return false;
  if (!supportProp || typeof supportProp !== 'string') return false;

  if (supportType === 'metal_shelf' && anchorSurface !== 'shelf_tier') return false;
  if (supportType === 'table' && anchorSurface !== 'table') return false;
  if ((supportType === 'vending' || supportType === 'vending_almond') &&
      anchorSurface !== 'vending' && anchorSurface !== 'vending_top' && anchorSurface !== 'vending_around') {
    return false;
  }

  return true;
}

export function shuffleWithRng(items, rng = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Selects `count` slots while spreading picks across distinct support hubs when possible.
 */
export function selectDistinctHubSlots(slots, count, rng = Math.random, preferDistinct = true) {
  if (!Array.isArray(slots) || slots.length === 0 || count <= 0) return [];
  const pool = shuffleWithRng(slots, rng);
  if (!preferDistinct) {
    return pool.slice(0, count);
  }

  const chosen = [];
  const chosenIds = new Set();
  const usedHubs = new Set();

  for (const s of pool) {
    if (chosen.length >= count) break;
    const hub = s.supportProp || s.anchor?.supportProp || s.id;
    if (!usedHubs.has(hub)) {
      usedHubs.add(hub);
      chosen.push(s);
      chosenIds.add(s.id);
    }
  }

  for (const s of pool) {
    if (chosen.length >= count) break;
    if (!chosenIds.has(s.id)) {
      chosen.push(s);
      chosenIds.add(s.id);
    }
  }

  return chosen;
}

export function pickWeightedConsumableType(allowedTypes, weights, currentCounts = {}, maxPerType = {}, rng = Math.random) {
  const candidates = (Array.isArray(allowedTypes) && allowedTypes.length > 0
    ? allowedTypes
    : [...APPROVED_CONSUMABLE_TYPES]
  ).filter(t => APPROVED_CONSUMABLE_TYPES.has(t));

  if (candidates.length === 0) return null;

  // Prefer types still under their per-type cap
  let eligible = candidates.filter(t => {
    const cap = maxPerType?.[t];
    return typeof cap !== 'number' || (currentCounts[t] || 0) < cap;
  });
  if (eligible.length === 0) {
    eligible = candidates;
  }

  let totalWeight = 0;
  for (const t of eligible) {
    totalWeight += Math.max(0, weights?.[t] ?? 1);
  }

  if (totalWeight <= 0) {
    return eligible[Math.floor(rng() * eligible.length)];
  }

  let roll = rng() * totalWeight;
  for (const t of eligible) {
    roll -= Math.max(0, weights?.[t] ?? 1);
    if (roll <= 0) return t;
  }
  return eligible[eligible.length - 1];
}
