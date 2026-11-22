/**
 * Saber Killer — Central Item Catalog
 * Data-driven item definitions for Level 0 Survival Mode world items and player inventory.
 */

export const ITEM_CATEGORIES = {
  MEDICAL: 'medical',
  CONSUMABLE: 'consumable',
  AMMUNITION: 'ammunition',
  BATTERY: 'battery',
  KEY: 'key',
  PROP: 'prop',
  ENVIRONMENTAL: 'environmental'
};

export const ITEM_DEFINITIONS = {
  first_aid: {
    id: 'first_aid',
    name: 'First Aid Kit',
    category: ITEM_CATEGORIES.MEDICAL,
    modelUrl: 'assets/items/first_aid.glb',
    iconUrl: 'assets/ui/icons/item_first_aid.svg',
    isPickup: true,
    stackable: false,
    maxStack: 1,
    consumable: true,
    equippable: false,
    droppable: true,
    metadata: {
      healAmount: 50,
      description: 'Standard emergency medical kit. Restores physical health.'
    }
  },

  almond_can: {
    id: 'almond_can',
    name: 'Almond Water Can',
    category: ITEM_CATEGORIES.CONSUMABLE,
    modelUrl: 'assets/items/almond_can.glb',
    iconUrl: 'assets/ui/icons/item_almond_can.svg',
    isPickup: true,
    stackable: true,
    maxStack: 4,
    consumable: true,
    equippable: false,
    droppable: true,
    metadata: {
      sanityRestore: 35,
      hydration: 50,
      description: 'Purified Backrooms Almond Water. Stabilizes sanity and relieves exhaustion.'
    }
  },

  sanity_pill: {
    id: 'sanity_pill',
    name: 'Sanity Pills Bottle',
    category: ITEM_CATEGORIES.CONSUMABLE,
    modelUrl: 'assets/items/sanity_pill_bottle.glb',
    iconUrl: 'assets/ui/icons/item_sanity_pill.svg',
    isPickup: true,
    stackable: true,
    maxStack: 3,
    consumable: true,
    equippable: false,
    droppable: true,
    metadata: {
      sanityRestore: 60,
      description: 'Prescription sedative capsules. Rapidly calms paranoid psychosis.'
    }
  },

  energy_drink: {
    id: 'energy_drink',
    name: 'Almond Water Energy Drink',
    category: ITEM_CATEGORIES.CONSUMABLE,
    modelUrl: 'assets/items/energy_drink.glb',
    iconUrl: 'assets/ui/icons/item_energy_drink.svg',
    isPickup: true,
    stackable: true,
    maxStack: 4,
    consumable: true,
    equippable: false,
    droppable: true,
    metadata: {
      staminaBoost: 100,
      sanityRestore: 15,
      speedMultiplier: 1.25,
      durationSeconds: 15,
      description: 'Caffeinated Almond Water infusion. Temporarily elevates sprint endurance.'
    }
  },

  aa_battery: {
    id: 'aa_battery',
    name: 'Flashlight Battery Pack',
    category: ITEM_CATEGORIES.BATTERY,
    modelUrl: 'assets/items/aa_battery.glb',
    iconUrl: 'assets/ui/icons/item_battery.svg',
    isPickup: true,
    stackable: true,
    maxStack: 6,
    consumable: true,
    equippable: false,
    droppable: true,
    metadata: {
      batteryCharge: 50,
      description: 'Heavy-duty alkaline cells. Restores tactical flashlight charge.'
    }
  },

  ammo_box: {
    id: 'ammo_box',
    name: '.45 ACP Ammunition Box',
    category: ITEM_CATEGORIES.AMMUNITION,
    modelUrl: 'assets/items/ammo_box.glb',
    iconUrl: 'assets/ui/icons/item_ammo_box.svg',
    isPickup: true,
    stackable: true,
    maxStack: 5,
    consumable: false,
    equippable: false,
    droppable: true,
    metadata: {
      caliber: '.45 ACP',
      roundsPerBox: 12,
      compatibleWeapons: ['pistol'],
      description: 'Box of 12 rounds of .45 ACP ammunition for semi-automatic sidearm.'
    }
  },

  doorKey: {
    id: 'doorKey',
    name: 'Brass Door Key',
    category: ITEM_CATEGORIES.KEY,
    modelUrl: 'assets/items/doorKey.glb',
    iconUrl: 'assets/ui/icons/item_key.svg',
    isPickup: true,
    stackable: false,
    maxStack: 1,
    consumable: false,
    equippable: false,
    droppable: true,
    metadata: {
      doorId: 'level0_exit_door',
      description: 'A heavy brass key with ornate cuts. Unlocks secured level transit doors.'
    }
  },

  // Environmental interactables (not inventory pickups)
  vending_almond: {
    id: 'vending_almond',
    name: 'Almond Water Vending Machine',
    category: ITEM_CATEGORIES.ENVIRONMENTAL,
    modelUrl: 'assets/items/vending_almond.glb',
    iconUrl: 'assets/ui/icons/item_almond_can.svg',
    isPickup: false,
    isInteractable: true,
    stackable: false,
    maxStack: 0,
    consumable: false,
    equippable: false,
    droppable: false,
    metadata: {
      requiresPower: true,
      dispensesItem: 'almond_can',
      promptText: 'Inspect Vending Machine',
      description: 'Vintage commercial vending unit. Dispenses cold Almond Water.'
    }
  }
};

/**
 * Returns definition for a given type ID or null
 */
export function getItemDefinition(typeId) {
  return ITEM_DEFINITIONS[typeId] || null;
}

/**
 * Checks if an item type is a collectible physical pickup
 */
export function isPickupItem(typeId) {
  const def = getItemDefinition(typeId);
  return !!(def && def.isPickup);
}

/**
 * Validates requested quantity against item stack constraints
 */
export function validateItemQuantity(typeId, qty) {
  if (typeof qty !== 'number' || !Number.isInteger(qty) || qty <= 0) return false;
  const def = getItemDefinition(typeId);
  if (!def) return false;
  if (!def.stackable && qty > 1) return false;
  if (def.stackable && qty > def.maxStack) return false;
  return true;
}
