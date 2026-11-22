/**
 * Saber Killer — Inventory Controller
 * Client-side and server-side inventory data model supporting stacking, max stack limits,
 * unique instance IDs for non-stackable items, and serialization.
 */

import { getItemDefinition } from './item_catalog.js';

export class InventoryController {
  constructor(capacity = 12) {
    this.capacity = capacity;
    this.slots = new Array(capacity).fill(null);
    this.onChangeCallbacks = new Set();
    this.nextInstanceNum = 1;
  }

  /**
   * Generates a unique instance ID for an item entry
   */
  _generateInstanceId(typeId) {
    return `inst_${typeId}_${Date.now()}_${this.nextInstanceNum++}_${Math.floor(Math.random() * 1000)}`;
  }

  /**
   * Registers a listener for inventory mutations
   */
  subscribe(callback) {
    if (typeof callback === 'function') {
      this.onChangeCallbacks.add(callback);
    }
    return () => this.onChangeCallbacks.delete(callback);
  }

  _notifyChange(event = { type: 'change' }) {
    for (const cb of this.onChangeCallbacks) {
      try {
        cb(this.getSlots(), event);
      } catch (e) {
        console.error('[InventoryController] Error in change callback:', e);
      }
    }
  }

  /**
   * Adds an item to inventory, handling stacking and stack limits
   * @param {string} typeId
   * @param {number} quantity
   * @param {object} metadata
   * @returns {{ success: boolean, added: number, remaining: number }}
   */
  addItem(typeId, quantity = 1, metadata = {}) {
    const def = getItemDefinition(typeId);
    if (!def) {
      return { success: false, added: 0, remaining: quantity, reason: `Unknown item type '${typeId}'` };
    }

    if (typeof quantity !== 'number' || quantity <= 0) {
      return { success: false, added: 0, remaining: quantity, reason: 'Invalid quantity' };
    }

    let remaining = Math.floor(quantity);
    let added = 0;

    // 1. Try filling existing compatible stacks
    if (def.stackable) {
      for (let i = 0; i < this.capacity && remaining > 0; i++) {
        const slot = this.slots[i];
        if (slot && slot.typeId === typeId && slot.quantity < def.maxStack) {
          const space = def.maxStack - slot.quantity;
          const toAdd = Math.min(space, remaining);
          slot.quantity += toAdd;
          remaining -= toAdd;
          added += toAdd;
        }
      }
    }

    // 2. Place remaining quantity into empty slots
    while (remaining > 0) {
      const emptyIdx = this.slots.findIndex(s => s === null);
      if (emptyIdx === -1) {
        // Inventory is full
        break;
      }

      const countInSlot = def.stackable ? Math.min(def.maxStack, remaining) : 1;
      this.slots[emptyIdx] = {
        slotIndex: emptyIdx,
        typeId,
        instanceId: this._generateInstanceId(typeId),
        quantity: countInSlot,
        name: def.name,
        category: def.category,
        iconUrl: def.iconUrl,
        stackable: def.stackable,
        maxStack: def.maxStack,
        metadata: { ...def.metadata, ...metadata }
      };

      remaining -= countInSlot;
      added += countInSlot;
    }

    const success = added > 0;
    if (success) {
      this._notifyChange({ type: 'item_added', typeId, added, remaining });
    }

    return {
      success,
      added,
      remaining
    };
  }

  /**
   * Removes a specific quantity of an item from a designated slot
   */
  removeItem(slotIndex, quantity = 1) {
    if (slotIndex < 0 || slotIndex >= this.capacity) {
      return { success: false, removed: 0, reason: 'Index out of bounds' };
    }

    const slot = this.slots[slotIndex];
    if (!slot) {
      return { success: false, removed: 0, reason: 'Slot is empty' };
    }

    const toRemove = Math.min(slot.quantity, Math.max(1, Math.floor(quantity)));
    slot.quantity -= toRemove;
    const removedItem = { ...slot, quantity: toRemove };

    if (slot.quantity <= 0) {
      this.slots[slotIndex] = null;
    }

    this._notifyChange({ type: 'item_removed', slotIndex, removed: removedItem });
    return { success: true, removed: toRemove, item: removedItem };
  }

  /**
   * Removes item matching a specific unique instance ID
   */
  removeItemById(instanceId, quantity = 1) {
    const idx = this.slots.findIndex(s => s && s.instanceId === instanceId);
    if (idx === -1) {
      return { success: false, removed: 0, reason: 'Instance ID not found' };
    }
    return this.removeItem(idx, quantity);
  }

  /**
   * Returns a snapshot of all slots
   */
  getSlots() {
    return this.slots.map(s => (s ? { ...s, metadata: { ...s.metadata } } : null));
  }

  /**
   * Returns item at designated slot or null
   */
  getItem(slotIndex) {
    if (slotIndex < 0 || slotIndex >= this.capacity) return null;
    return this.slots[slotIndex] ? { ...this.slots[slotIndex] } : null;
  }

  /**
   * Returns total count of a given item type across all slots
   */
  getCount(typeId) {
    let total = 0;
    for (const slot of this.slots) {
      if (slot && slot.typeId === typeId) {
        total += slot.quantity;
      }
    }
    return total;
  }

  /**
   * Checks if inventory contains at least required quantity of an item type
   */
  hasItem(typeId, quantity = 1) {
    return this.getCount(typeId) >= quantity;
  }

  /**
   * Returns true if no empty slots are available
   */
  isFull() {
    return this.slots.every(s => s !== null);
  }

  /**
   * Merges stack from one slot into another if compatible
   */
  mergeSlots(fromIdx, toIdx) {
    if (fromIdx === toIdx) return false;
    const fromSlot = this.slots[fromIdx];
    const toSlot = this.slots[toIdx];
    if (!fromSlot || !toSlot) return false;
    if (fromSlot.typeId !== toSlot.typeId) return false;
    if (!toSlot.stackable) return false;

    const space = toSlot.maxStack - toSlot.quantity;
    if (space <= 0) return false;

    const toTransfer = Math.min(space, fromSlot.quantity);
    toSlot.quantity += toTransfer;
    fromSlot.quantity -= toTransfer;

    if (fromSlot.quantity <= 0) {
      this.slots[fromIdx] = null;
    }

    this._notifyChange({ type: 'stack_merged', fromIdx, toIdx, transferred: toTransfer });
    return true;
  }

  /**
   * Serializes current inventory state for network transmission or saving
   */
  serialize() {
    return {
      capacity: this.capacity,
      slots: this.slots.map(s => (s ? {
        slotIndex: s.slotIndex,
        typeId: s.typeId,
        instanceId: s.instanceId,
        quantity: s.quantity,
        metadata: s.metadata
      } : null))
    };
  }

  /**
   * Reconstructs inventory from serialized payload
   */
  deserialize(data) {
    if (!data || !Array.isArray(data.slots)) return false;
    this.capacity = data.capacity || this.capacity;
    this.slots = new Array(this.capacity).fill(null);

    for (let i = 0; i < Math.min(data.slots.length, this.capacity); i++) {
      const s = data.slots[i];
      if (s && s.typeId) {
        const def = getItemDefinition(s.typeId);
        if (def) {
          this.slots[i] = {
            slotIndex: i,
            typeId: s.typeId,
            instanceId: s.instanceId || this._generateInstanceId(s.typeId),
            quantity: Math.max(1, parseInt(s.quantity, 10) || 1),
            name: def.name,
            category: def.category,
            iconUrl: def.iconUrl,
            stackable: def.stackable,
            maxStack: def.maxStack,
            metadata: { ...def.metadata, ...(s.metadata || {}) }
          };
        }
      }
    }

    this._notifyChange({ type: 'deserialized' });
    return true;
  }

  /**
   * Empties all slots
   */
  clear() {
    this.slots.fill(null);
    this._notifyChange({ type: 'cleared' });
  }
}
