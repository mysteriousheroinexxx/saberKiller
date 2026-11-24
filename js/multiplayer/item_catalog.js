/**
 * Saber Killer — Central Item Catalog
 * Data-driven item definitions for Level 0 Survival Mode world items and player inventory.
 */

export const ITEM_CATEGORIES = {
  WEAPON: 'weapon',
  EQUIPMENT: 'equipment',
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
    name: 'Almond Water',
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
    name: 'Energy Drink',
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
    consumable: true,
    equippable: false,
    droppable: true,
    metadata: {
      caliber: '.45 ACP',
      roundsPerBox: 2,
      compatibleWeapons: ['pistol'],
      description: 'Box containing 2 rounds of .45 ACP ammunition.'
    }
  },

  pistol_ammo: {
    id: 'pistol_ammo',
    name: 'Pistol Ammunition',
    category: ITEM_CATEGORIES.AMMUNITION,
    modelUrl: 'assets/items/ammo_box.glb',
    iconUrl: 'assets/ui/icons/item_ammo_box.svg',
    isPickup: true,
    stackable: true,
    maxStack: 24,
    consumable: true,
    equippable: false,
    droppable: true,
    metadata: {
      caliber: '.45 ACP',
      rounds: 2,
      compatibleWeapon: 'weapon_pistol',
      ammoType: 'bullets',
      description: 'Box containing 2 rounds of .45 ACP pistol ammunition.'
    }
  },

  shotgun_ammo: {
    id: 'shotgun_ammo',
    name: 'Shotgun Ammunition',
    category: ITEM_CATEGORIES.AMMUNITION,
    modelUrl: 'assets/items/ammo_box.glb',
    iconUrl: 'assets/ui/icons/item_ammo_box.svg',
    isPickup: true,
    stackable: true,
    maxStack: 10,
    consumable: true,
    equippable: false,
    droppable: true,
    metadata: {
      caliber: '12 Gauge',
      rounds: 2,
      compatibleWeapon: 'weapon_shotgun',
      ammoType: 'shells',
      description: 'Box containing 2 rounds of 12-gauge shotgun ammunition.'
    }
  },

  weapon_pistol: {
    id: 'weapon_pistol',
    name: 'Beretta Px4 Storm',
    category: ITEM_CATEGORIES.WEAPON,
    modelUrl: 'assets/beretta_px4_storm_compact.glb',
    iconUrl: 'assets/ui/icons/weapon_pistol.svg',
    isPickup: true,
    stackable: false,
    maxStack: 1,
    consumable: false,
    equippable: true,
    droppable: true,
    weaponIndex: 0,
    metadata: {
      caliber: '.45 ACP',
      magCapacity: 12,
      description: 'Compact semi-automatic service pistol. Standard issue sidearm.'
    }
  },

  weapon_shotgun: {
    id: 'weapon_shotgun',
    name: 'Stagecoach Shotgun',
    category: ITEM_CATEGORIES.WEAPON,
    modelUrl: 'assets/stagecoach_shotgun.glb',
    iconUrl: 'assets/ui/icons/weapon_shotgun.svg',
    isPickup: true,
    stackable: false,
    maxStack: 1,
    consumable: false,
    equippable: true,
    droppable: true,
    weaponIndex: 1,
    metadata: {
      caliber: '12 Gauge',
      magCapacity: 6,
      description: 'Short-barreled break-action coach shotgun. Devastating close-range spread.'
    }
  },

  equipment_torch: {
    id: 'equipment_torch',
    name: 'Tactical Flashlight',
    category: ITEM_CATEGORIES.EQUIPMENT,
    modelUrl: 'assets/torch.glb',
    iconUrl: 'assets/ui/icons/item_torch.svg',
    isPickup: true,
    stackable: false,
    maxStack: 1,
    consumable: false,
    equippable: true,
    droppable: false,
    weaponIndex: 2,
    metadata: {
      batteryDrainRate: 0.25,
      description: 'High-intensity tactical flashlight. Illuminates dense darkness of Level 0.'
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
      promptText: 'Use',
      description: 'Vintage commercial vending unit. Dispenses cold Almond Water.'
    }
  },

  exit_door: {
    id: 'exit_door',
    name: 'Level 0 Exit Door',
    category: ITEM_CATEGORIES.ENVIRONMENTAL,
    modelUrl: 'assets/items/metalDoor.glb',
    iconUrl: 'assets/ui/icons/item_key.svg',
    isPickup: false,
    isInteractable: true,
    stackable: false,
    maxStack: 0,
    consumable: false,
    equippable: false,
    droppable: false,
    metadata: {
      requiredKey: 'doorKey',
      promptTextLocked: 'Unlock Door',
      promptTextUnlocked: 'Escape Level 0',
      description: 'Reinforced security exit door. Requires Brass Door Key to unlock.'
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
 * Central consumable effect configuration
 */
export const ITEM_EFFECTS_CONFIG = {
  first_aid: {
    healAmount: 50,
    requiresMissingHp: true,
    description: 'Restores 50 HP (cannot exceed 100 HP)'
  },
  almond_can: {
    sanityRestore: 35,
    staminaBoost: 25,
    requiresMissingSanity: false,
    description: 'Restores 35 Sanity & 25 Stamina'
  },
  sanity_pill: {
    sanityRestore: 60,
    requiresMissingSanity: false,
    description: 'Restores 60 Sanity'
  },
  energy_drink: {
    staminaBoost: 100,
    speedMultiplier: 1.25,
    durationSeconds: 15,
    sanityRestore: 15,
    description: 'Boosts stamina by 100 and movement speed by +25% for 15s'
  },
  aa_battery: {
    batteryCharge: 50,
    requiresMissingBattery: true,
    description: 'Recharges tactical flashlight battery by +50%'
  },
  ammo_box: {
    rounds: 2,
    weapon: 'pistol',
    ammoKey: 'bullets',
    ammoType: 'bullets',
    maxReserve: 48,
    description: 'Consumes box to add 2 rounds of .45 ACP pistol ammunition'
  },
  pistol_ammo: {
    rounds: 2,
    weapon: 'pistol',
    ammoKey: 'bullets',
    ammoType: 'bullets',
    maxReserve: 48,
    description: 'Consumes box to add 2 rounds of .45 ACP pistol ammunition'
  },
  shotgun_ammo: {
    rounds: 2,
    weapon: 'shotgun',
    ammoKey: 'shells',
    ammoType: 'shells',
    maxReserve: 12,
    description: 'Consumes box to add 2 rounds of 12-gauge shotgun ammunition'
  }
};

