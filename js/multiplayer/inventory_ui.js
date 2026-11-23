/**
 * Saber Killer — Survival Mode Refined Two-Panel Inventory UI
 *
 * Clean, minimal interface built around authentic 1920x1080 two-panel SVG artwork:
 * - INVENTORY Panel (Left):
 *     - 20 Backpack Storage Slots (4 columns x 5 rows) in the main grid
 * - EQUIPMENT Panel (Right):
 *     - 10 Quick-Access Hotbar Slots in the baked-in vertical column at X = 1020px
 *     - Human silhouette and equipment artwork preserved
 * - Dual Yellow X Close Buttons (one in each panel, both fully functional)
 * - Interaction modes:
 *     - Hover: Tooltip describing item in <= 10 words
 *     - Right-click: Contextual action menu (Use, Drop, Assign to Hotbar)
 *     - Left-click and hold: Drag-and-drop between storage and hotbar
 * - Context menu auto-close:
 *     - Left-clicking empty inventory space
 *     - Cursor moves away and remains outside for > 3 seconds (stays open while interacting)
 * - Distressed dark gunmetal palette with restrained yellow (#f0c64a / #d7a51e) accents
 */

import { getItemDefinition, ITEM_EFFECTS_CONFIG } from './item_catalog.js';

/**
 * Concise descriptions strictly under 10 words for every known survival item.
 */
const ITEM_TOOLTIP_DESCRIPTIONS = {
  first_aid: 'Medical kit. Restores 50 physical health.',
  almond_can: 'Almond Water. Stabilizes sanity and restores stamina.',
  sanity_pill: 'Sedative pills. Restores 60 sanity and calms paranoia.',
  energy_drink: 'Energy drink. Restores stamina and boosts sprint speed.',
  aa_battery: 'Battery pack. Restores 50% flashlight charge.',
  ammo_box: 'Ammunition box. 12 rounds of .45 ACP pistol ammo.',
  weapon_pistol: 'Compact semi-automatic service pistol. Standard sidearm.',
  weapon_shotgun: 'Break-action coach shotgun. High close-range pellet damage.',
  equipment_torch: 'Tactical flashlight. Illuminates dense darkness.',
  doorKey: 'Brass key. Unlocks secured level transit doors.',
  vending_almond: 'Commercial vending machine. Dispenses Almond Water.'
};

/**
 * Return a concise item description guaranteed to be 10 words or fewer.
 * @param {Object} item
 * @param {Object} def
 * @returns {string}
 */
export function getShortItemDescription(item, def) {
  if (item && item.typeId && ITEM_TOOLTIP_DESCRIPTIONS[item.typeId]) {
    return ITEM_TOOLTIP_DESCRIPTIONS[item.typeId];
  }
  const raw = def?.metadata?.description || item?.metadata?.description || def?.description || 'Survival equipment.';
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 10) return words.join(' ');
  return words.slice(0, 10).join(' ');
}

export class InventoryUI {
  /**
   * @param {import('./inventory_controller.js').InventoryController} inventory
   * @param {import('./player_controller.js').LocalPlayerController} player
   * @param {import('./network_client.js').NetworkClient} networkClient
   * @param {HTMLElement} [parentContainer=document.body]
   */
  constructor(inventory, player, networkClient, parentContainer = document.body) {
    this.inventory = inventory;
    this.player = player;
    this.networkClient = networkClient;
    this.parent = parentContainer;

    this.isOpen = false;
    this.selectedHotbarSlot = 0; // 0..9
    this.hoveredSlotIndex = null;
    this.contextSlotIdx = null;
    this.draggedSlotIndex = null;
    this.contextMenuTimer = null;

    // Drop quantity state
    this.dropModalSlotIndex = null;
    this.dropQuantity = 1;

    // DOM Elements
    this.inventoryModalEl = null;
    this.stageEl = null;
    this.bgArtwork = null;
    this.closeBtnLeft = null;
    this.closeBtnRight = null;
    this.slotElements = [];

    this.tooltipEl = null;
    this.tooltipTitleEl = null;
    this.tooltipDescEl = null;

    this.contextMenuEl = null;
    this.dropModalEl = null;

    this._injectStyles();
    this._initInventoryModalUI();
    this._initContextMenuUI();
    this._initDropModalUI();
    this._bindEvents();

    // Subscribe to inventory data changes
    if (this.inventory) {
      this.inventory.subscribe(() => {
        this.render();
      });
    }

    this.render();
  }

  setPlayer(player) {
    this.player = player;
  }

  setNetworkClient(nc) {
    this.networkClient = nc;
  }

  setSelectedSlot(slotIdx) {
    this.selectedHotbarSlot = Math.max(0, Math.min(9, slotIdx));
    if (this.isOpen) {
      this.renderInventoryModal();
    }
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this.isOpen = true;
    if (this.inventoryModalEl) {
      this.inventoryModalEl.style.display = 'flex';
      this._updateScale();
    }
    if (this.player) {
      this.player.isInventoryOpen = true;
      this.player.keys = {};
      if (this.player.isPointerLocked || document.pointerLockElement) {
        try {
          document.exitPointerLock();
        } catch (e) {}
      }
    }
    this.render();
  }

  close() {
    this.isOpen = false;
    if (this.inventoryModalEl) {
      this.inventoryModalEl.style.display = 'none';
    }
    this._hideTooltip();
    this._hideContextMenu();
    this._hideDropModal();
    this.hoveredSlotIndex = null;
    this.draggedSlotIndex = null;

    if (this.player) {
      this.player.isInventoryOpen = false;
    }
  }

  _updateScale() {
    if (!this.stageEl) return;
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    this.stageEl.style.transform = `scale(${scale})`;
  }

  get invHotbarGrid() {
    return { children: this.slotElements.slice(0, 10) };
  }

  get invStorageGrid() {
    return { children: this.slotElements.slice(10, 30) };
  }

  _injectStyles() {
    if (document.getElementById('bb-inventory-styles')) {
      document.getElementById('bb-inventory-styles').remove();
    }

    const style = document.createElement('style');
    style.id = 'bb-inventory-styles';
    style.textContent = `
      /* --- Root Fullscreen Modal --- */
      #bb-inventory-modal {
        position: fixed;
        inset: 0;
        background: rgba(3, 5, 8, 0.78);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 950;
        user-select: none;
        backdrop-filter: blur(6px);
        font-family: 'Rubik', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overflow: hidden;
      }

      /* --- 1920x1080 Responsive Stage --- */
      .bb-inv-stage {
        position: relative;
        width: 1920px;
        height: 1080px;
        flex-shrink: 0;
        transform-origin: center center;
        user-select: none;
      }

      /* --- SVG Background Artwork Skin --- */
      .bb-inv-artwork {
        position: absolute;
        top: 0;
        left: 0;
        width: 1920px;
        height: 1080px;
        pointer-events: none;
        z-index: 1;
      }

      /* --- Yellow X Close Buttons (Overlaid on SVG Artwork) --- */
      .bb-inv-close-btn {
        position: absolute;
        z-index: 25;
        cursor: pointer;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 3px;
        padding: 0;
        margin: 0;
        outline: none;
        transition: all 0.15s ease-in-out;
      }

      .bb-inv-close-left {
        left: 877px;
        top: 69px;
        width: 36px;
        height: 36px;
      }

      .bb-inv-close-right {
        left: 1667px;
        top: 69px;
        width: 36px;
        height: 36px;
      }

      .bb-inv-close-btn:hover {
        background: rgba(240, 198, 74, 0.18);
        border-color: rgba(240, 198, 74, 0.6);
        box-shadow: 0 0 12px rgba(240, 198, 74, 0.45);
      }

      .bb-inv-close-btn:active {
        background: rgba(240, 198, 74, 0.35);
        transform: scale(0.96);
      }

      /* --- Interactive Slot Elements --- */
      .bb-grid-slot {
        position: absolute;
        z-index: 15;
        box-sizing: border-box;
        background: rgba(16, 22, 30, 0.28);
        border: 1px solid transparent;
        border-radius: 2px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      /* 20 Storage Slots (4 columns x 5 rows) */
      .bb-grid-slot.storage-slot {
        width: 95px;
        height: 95px;
      }

      /* 10 Quick-Access Hotbar Slots (Vertical Column in the EQUIPMENT Panel at X = 1020px) */
      .bb-grid-slot.hotbar-slot {
        width: 68px;
        height: 68px;
      }

      .bb-grid-slot:hover {
        border-color: rgba(240, 198, 74, 0.65);
        background: rgba(30, 38, 50, 0.4);
        box-shadow: inset 0 0 14px rgba(240, 198, 74, 0.2);
      }

      .bb-grid-slot.active-equipped {
        border: 2px solid #f0c64a;
        box-shadow: inset 0 0 14px rgba(240, 198, 74, 0.35), 0 0 10px rgba(240, 198, 74, 0.5);
      }

      .bb-grid-slot.drag-over {
        border: 2px solid #f0c64a;
        background: rgba(240, 198, 74, 0.25);
      }

      .bb-grid-slot.dragging {
        opacity: 0.35;
      }

      .bb-slot-key-badge {
        position: absolute;
        top: 3px;
        left: 5px;
        font-size: 11px;
        font-weight: 700;
        font-family: monospace;
        color: #9c9a92;
        pointer-events: none;
        line-height: 1;
        text-shadow: 0 1px 2px rgba(0,0,0,0.9);
      }

      .bb-grid-slot.active-equipped .bb-slot-key-badge {
        color: #f0c64a;
      }

      .bb-slot-qty-badge {
        position: absolute;
        bottom: 3px;
        right: 5px;
        font-size: 11px;
        font-weight: 700;
        font-family: monospace;
        color: #edece6;
        text-shadow: 0 1px 3px #000, 0 0 5px #000;
        pointer-events: none;
        line-height: 1;
      }

      .bb-grid-slot.storage-slot .bb-slot-icon {
        max-width: 58px;
        max-height: 58px;
        object-fit: contain;
        display: block;
        filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.85));
        pointer-events: none;
      }

      .bb-grid-slot.hotbar-slot .bb-slot-icon {
        max-width: 44px;
        max-height: 44px;
        object-fit: contain;
        display: block;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.85));
        pointer-events: none;
      }

      /* --- Lightweight Information Tooltip (Hover Interaction) --- */
      #bb-inv-tooltip {
        position: absolute;
        pointer-events: none;
        z-index: 1000;
        display: none;
        flex-direction: column;
        gap: 3px;
        background: rgba(14, 18, 25, 0.95);
        border: 1px solid rgba(240, 198, 74, 0.55);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.88);
        border-radius: 3px;
        padding: 6px 10px;
        max-width: 230px;
        box-sizing: border-box;
        font-family: 'Rubik', -apple-system, sans-serif;
        color: #edece6;
        transition: opacity 0.1s ease;
      }

      .bb-tooltip-title {
        font-size: 11px;
        font-weight: 700;
        color: #f0c64a;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .bb-tooltip-desc {
        font-size: 10.5px;
        line-height: 1.35;
        color: #c8c6bc;
        word-wrap: break-word;
      }

      /* --- Context Menu & Drop Quantity Modal --- */
      #bb-context-menu {
        position: fixed;
        background: rgba(18, 24, 33, 0.96);
        border: 1px solid rgba(240, 198, 74, 0.45);
        border-radius: 3px;
        padding: 4px 0;
        z-index: 1100;
        display: none;
        flex-direction: column;
        min-width: 155px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.85);
        font-family: 'Rubik', -apple-system, sans-serif;
      }

      .bb-context-item {
        padding: 8px 14px;
        font-size: 11px;
        font-weight: 600;
        color: #edece6;
        cursor: pointer;
        letter-spacing: 0.5px;
        transition: all 0.15s ease;
      }

      .bb-context-item:hover {
        background: rgba(240, 198, 74, 0.18);
        color: #f0c64a;
      }

      #bb-drop-modal {
        position: fixed;
        inset: 0;
        background: rgba(5, 8, 13, 0.85);
        z-index: 1200;
        display: none;
        align-items: center;
        justify-content: center;
      }

      .bb-drop-dialog {
        background: rgba(18, 24, 33, 0.96);
        border: 1px solid rgba(240, 198, 74, 0.45);
        border-radius: 4px;
        padding: 20px 24px;
        width: 280px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.9);
        display: flex;
        flex-direction: column;
        gap: 14px;
        font-family: 'Rubik', -apple-system, sans-serif;
      }

      .bb-drop-title {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 1px;
        color: #f0c64a;
        text-transform: uppercase;
      }

      .bb-drop-counter-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .bb-drop-counter-btn {
        background: rgba(30, 38, 50, 0.8);
        border: 1px solid rgba(88, 97, 110, 0.5);
        color: #edece6;
        width: 32px;
        height: 32px;
        border-radius: 2px;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .bb-drop-counter-btn:hover {
        border-color: #f0c64a;
        color: #f0c64a;
      }

      .bb-drop-input {
        flex: 1;
        background: rgba(10, 14, 20, 0.8);
        border: 1px solid rgba(88, 97, 110, 0.5);
        color: #edece6;
        height: 32px;
        text-align: center;
        font-size: 14px;
        font-weight: 700;
        font-family: monospace;
        border-radius: 2px;
        outline: none;
      }

      .bb-drop-input:focus {
        border-color: #f0c64a;
      }

      .bb-drop-btn-row {
        display: flex;
        gap: 8px;
      }

      .bb-action-btn {
        flex: 1;
        padding: 8px 12px;
        border-radius: 2px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.8px;
        cursor: pointer;
        text-transform: uppercase;
        transition: all 0.15s ease;
        box-sizing: border-box;
      }

      .bb-action-btn.primary {
        background: linear-gradient(135deg, #f0c64a 0%, #d7a51e 50%, #986d12 100%);
        color: #0c1118;
        border: none;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
      }

      .bb-action-btn.primary:hover {
        filter: brightness(1.15);
        box-shadow: 0 0 10px rgba(240, 198, 74, 0.5);
      }

      .bb-action-btn.secondary {
        background: rgba(22, 28, 38, 0.85);
        border: 1px solid rgba(88, 97, 110, 0.45);
        color: #edece6;
      }

      .bb-action-btn.secondary:hover {
        border-color: #edece6;
        background: rgba(32, 40, 52, 0.95);
        color: #ffffff;
      }
    `;
    document.head.appendChild(style);
  }

  _initInventoryModalUI() {
    this.inventoryModalEl = document.createElement('div');
    this.inventoryModalEl.id = 'bb-inventory-modal';
    this.inventoryModalEl.style.display = 'none';

    // Left-clicking backdrop outside stage closes inventory
    this.inventoryModalEl.addEventListener('click', (e) => {
      if (e.target === this.inventoryModalEl) {
        this.close();
      }
    });

    // 1920x1080 Stage
    this.stageEl = document.createElement('div');
    this.stageEl.className = 'bb-inv-stage';

    // Left-clicking empty stage space closes context menu
    this.stageEl.addEventListener('click', (e) => {
      if (this.contextMenuEl && !this.contextMenuEl.contains(e.target)) {
        this._hideContextMenu();
      }
    });

    // SVG Background Artwork Skin
    this.bgArtwork = document.createElement('img');
    this.bgArtwork.className = 'bb-inv-artwork';
    this.bgArtwork.src = 'assets/ui/inventory_equipment_hud.svg';
    this.bgArtwork.alt = 'Survival Inventory & Equipment HUD';
    this.bgArtwork.draggable = false;
    this.stageEl.appendChild(this.bgArtwork);

    // Left Panel Yellow X Close Button (Centered on SVG path M885 77l20 20m0-20l-20 20)
    this.closeBtnLeft = document.createElement('button');
    this.closeBtnLeft.className = 'bb-inv-close-btn bb-inv-close-left';
    this.closeBtnLeft.id = 'bb-inv-close-left';
    this.closeBtnLeft.style.left = '877px';
    this.closeBtnLeft.style.top = '69px';
    this.closeBtnLeft.title = 'Close Inventory [Esc / Tab]';
    this.closeBtnLeft.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    this.stageEl.appendChild(this.closeBtnLeft);

    // Right Panel Yellow X Close Button (Centered on SVG path M1675 77l20 20m0-20l-20 20)
    this.closeBtnRight = document.createElement('button');
    this.closeBtnRight.className = 'bb-inv-close-btn bb-inv-close-right';
    this.closeBtnRight.id = 'bb-inv-close-right';
    this.closeBtnRight.style.left = '1667px';
    this.closeBtnRight.style.top = '69px';
    this.closeBtnRight.title = 'Close Inventory [Esc / Tab]';
    this.closeBtnRight.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    this.stageEl.appendChild(this.closeBtnRight);

    // Build 30 slots:
    // Slots 0..9: 10 Quick-Access Hotbar slots in the EQUIPMENT Panel at X = 1020px
    // Slots 10..29: 20 Storage slots (4 columns x 5 rows) in the INVENTORY Panel at X = [245, 354, 463, 572]
    this.slotElements = new Array(30);

    // 10 Hotbar Slots (Indexes 0..9) in the EQUIPMENT Panel
    for (let i = 0; i < 10; i++) {
      const x = 1020;
      const y = 164 + i * 82;
      const slot = this._createGridSlot(i, true);
      slot.style.left = `${x}px`;
      slot.style.top = `${y}px`;
      this.slotElements[i] = slot;
      this.stageEl.appendChild(slot);
    }

    // 20 Storage Slots (Indexes 10..29)
    for (let k = 0; k < 20; k++) {
      const slotIdx = 10 + k;
      const col = k % 4;
      const row = Math.floor(k / 4);
      const x = 245 + col * 109;
      const y = 228 + row * 109;

      const slot = this._createGridSlot(slotIdx, false);
      slot.style.left = `${x}px`;
      slot.style.top = `${y}px`;
      this.slotElements[slotIdx] = slot;
      this.stageEl.appendChild(slot);
    }

    // Tooltip Element (Hover interaction: <= 10 words description)
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.id = 'bb-inv-tooltip';
    this.tooltipTitleEl = document.createElement('div');
    this.tooltipTitleEl.className = 'bb-tooltip-title';
    this.tooltipDescEl = document.createElement('div');
    this.tooltipDescEl.className = 'bb-tooltip-desc';
    this.tooltipEl.appendChild(this.tooltipTitleEl);
    this.tooltipEl.appendChild(this.tooltipDescEl);
    this.stageEl.appendChild(this.tooltipEl);

    // Append stage to modal root and parent
    this.inventoryModalEl.appendChild(this.stageEl);
    this.parent.appendChild(this.inventoryModalEl);

    // Responsive window auto-scaling
    window.addEventListener('resize', () => this._updateScale());
    this._updateScale();
  }

  _createGridSlot(slotIdx, isHotbar) {
    const slot = document.createElement('div');
    slot.className = `bb-grid-slot ${isHotbar ? 'hotbar-slot' : 'storage-slot'}`;
    slot.dataset.slotIndex = String(slotIdx);
    slot.id = `bb-slot-${slotIdx}`;

    if (isHotbar) {
      const keyBadge = document.createElement('div');
      keyBadge.className = 'bb-slot-key-badge';
      keyBadge.textContent = slotIdx === 9 ? '0' : String(slotIdx + 1);
      slot.appendChild(keyBadge);
    }

    const qtyBadge = document.createElement('div');
    qtyBadge.className = 'bb-slot-qty-badge';
    qtyBadge.id = `bb-grid-qty-${slotIdx}`;
    slot.appendChild(qtyBadge);

    const iconImg = document.createElement('img');
    iconImg.className = 'bb-slot-icon';
    iconImg.id = `bb-grid-icon-${slotIdx}`;
    iconImg.draggable = false;
    iconImg.style.display = 'none';
    slot.appendChild(iconImg);

    // Hover Interaction: Show lightweight info tooltip <= 10 words
    slot.addEventListener('mouseenter', () => {
      this.hoveredSlotIndex = slotIdx;
      this._showTooltip(slotIdx, slot);
    });

    slot.addEventListener('mouseleave', () => {
      if (this.hoveredSlotIndex === slotIdx) {
        this.hoveredSlotIndex = null;
      }
      this._hideTooltip();
    });

    // Left click on empty slot closes context menu
    slot.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = this.inventory ? this.inventory.getItem(slotIdx) : null;
      if (!item) {
        this._hideContextMenu();
      }
    });

    // Right-click: Open contextual action menu
    slot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._handleSlotRightClick(slotIdx, e.clientX, e.clientY);
    });

    // Left-click and hold: Drag the item to another slot or hotbar slot
    slot.addEventListener('dragstart', (e) => {
      const item = this.inventory ? this.inventory.getItem(slotIdx) : null;
      if (!item) {
        e.preventDefault();
        return;
      }
      this._hideTooltip();
      this._hideContextMenu();
      this.draggedSlotIndex = slotIdx;
      e.dataTransfer.setData('text/plain', String(slotIdx));
      e.dataTransfer.effectAllowed = 'move';
      slot.classList.add('dragging');
    });

    slot.addEventListener('dragend', () => {
      slot.classList.remove('dragging');
      this.draggedSlotIndex = null;
      document.querySelectorAll('.bb-grid-slot.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      slot.classList.add('drag-over');
    });

    slot.addEventListener('dragleave', (e) => {
      if (!slot.contains(e.relatedTarget)) {
        slot.classList.remove('drag-over');
      }
    });

    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      slot.classList.remove('drag-over');

      let fromIdx = this.draggedSlotIndex;
      if (fromIdx === null || fromIdx === undefined) {
        const text = e.dataTransfer.getData('text/plain');
        if (text) fromIdx = parseInt(text, 10);
      }

      if (typeof fromIdx === 'number' && !isNaN(fromIdx) && fromIdx !== slotIdx) {
        this.moveOrSwapSlots(fromIdx, slotIdx);
      }
      this.draggedSlotIndex = null;
    });

    return slot;
  }

  _showTooltip(slotIdx, slotEl) {
    if (!this.inventory || !this.tooltipEl) return;
    const item = this.inventory.getItem(slotIdx);
    if (!item) {
      this._hideTooltip();
      return;
    }

    const def = getItemDefinition(item.typeId) || {};
    const title = (item.name || def.name || 'Item').toUpperCase();
    const desc = getShortItemDescription(item, def);

    this.tooltipTitleEl.textContent = title;
    this.tooltipDescEl.textContent = desc;
    this.tooltipEl.style.display = 'flex';

    const isHotbar = slotIdx < 10;
    if (isHotbar) {
      // Position to the right of the hotbar column in the EQUIPMENT panel
      this.tooltipEl.style.left = `${slotEl.offsetLeft + 78}px`;
      this.tooltipEl.style.top = `${slotEl.offsetTop + 4}px`;
    } else {
      // Storage slots: position above (or below for top row)
      if (slotEl.offsetTop >= 240) {
        this.tooltipEl.style.left = `${slotEl.offsetLeft}px`;
        this.tooltipEl.style.top = `${slotEl.offsetTop - 54}px`;
      } else {
        this.tooltipEl.style.left = `${slotEl.offsetLeft}px`;
        this.tooltipEl.style.top = `${slotEl.offsetTop + slotEl.offsetHeight + 6}px`;
      }
    }
  }

  _hideTooltip() {
    if (this.tooltipEl) {
      this.tooltipEl.style.display = 'none';
    }
  }

  _initContextMenuUI() {
    this.contextMenuEl = document.createElement('div');
    this.contextMenuEl.id = 'bb-context-menu';

    // Keep context menu open while cursor interacts with it
    this.contextMenuEl.addEventListener('mouseenter', () => {
      this._clearContextMenuTimer();
    });

    // Close when cursor moves away and remains outside for > 3 seconds
    this.contextMenuEl.addEventListener('mouseleave', () => {
      this._startContextMenuTimer();
    });

    this.ctxUse = document.createElement('div');
    this.ctxUse.className = 'bb-context-item';
    this.ctxUse.textContent = 'Use / Consume';
    this.ctxUse.addEventListener('click', () => {
      const idx = this.contextSlotIdx;
      this._hideContextMenu();
      if (idx !== null) this._executeUse(idx);
    });

    this.ctxDrop = document.createElement('div');
    this.ctxDrop.className = 'bb-context-item';
    this.ctxDrop.textContent = 'Drop...';
    this.ctxDrop.addEventListener('click', () => {
      const idx = this.contextSlotIdx;
      this._hideContextMenu();
      if (idx !== null) this._executeDrop(idx);
    });

    this.ctxAssign = document.createElement('div');
    this.ctxAssign.className = 'bb-context-item';
    this.ctxAssign.textContent = 'Assign to Hotbar';
    this.ctxAssign.addEventListener('click', () => {
      const idx = this.contextSlotIdx;
      this._hideContextMenu();
      if (idx !== null) this._executeAssignHotbar(idx);
    });

    this.contextMenuEl.appendChild(this.ctxUse);
    this.contextMenuEl.appendChild(this.ctxDrop);
    this.contextMenuEl.appendChild(this.ctxAssign);

    document.body.appendChild(this.contextMenuEl);

    // Global click listener to close context menu when clicking outside
    document.addEventListener('click', (e) => {
      if (this.contextMenuEl && !this.contextMenuEl.contains(e.target)) {
        this._hideContextMenu();
      }
    });
  }

  _startContextMenuTimer() {
    this._clearContextMenuTimer();
    this.contextMenuTimer = setTimeout(() => {
      this._hideContextMenu();
    }, 3000);
  }

  _clearContextMenuTimer() {
    if (this.contextMenuTimer) {
      clearTimeout(this.contextMenuTimer);
      this.contextMenuTimer = null;
    }
  }

  _handleSlotRightClick(slotIdx, clientX, clientY) {
    const slot = this.inventory ? this.inventory.getItem(slotIdx) : null;
    if (!slot) {
      this._hideContextMenu();
      return;
    }

    this.contextSlotIdx = slotIdx;

    const def = getItemDefinition(slot.typeId);
    const isConsumable = !!(def && def.consumable);
    const isDroppable = !!(def && def.droppable !== false);
    const isStorage = slotIdx >= 10;

    this.ctxUse.style.display = isConsumable ? 'flex' : 'none';
    this.ctxDrop.style.display = isDroppable ? 'flex' : 'none';
    this.ctxAssign.style.display = isStorage ? 'flex' : 'none';

    this.contextMenuEl.style.display = 'flex';
    this.contextMenuEl.style.left = `${Math.min(window.innerWidth - 170, clientX)}px`;
    this.contextMenuEl.style.top = `${Math.min(window.innerHeight - 130, clientY)}px`;

    // Start 3-second auto-close timer (cancelled if mouse enters menu)
    this._startContextMenuTimer();
  }

  _hideContextMenu() {
    this._clearContextMenuTimer();
    this.contextSlotIdx = null;
    if (this.contextMenuEl) {
      this.contextMenuEl.style.display = 'none';
    }
  }

  _initDropModalUI() {
    this.dropModalEl = document.createElement('div');
    this.dropModalEl.id = 'bb-drop-modal';

    const dialog = document.createElement('div');
    dialog.className = 'bb-drop-dialog';

    this.dropTitle = document.createElement('div');
    this.dropTitle.className = 'bb-drop-title';
    this.dropTitle.textContent = 'DROP QUANTITY';
    dialog.appendChild(this.dropTitle);

    const counterRow = document.createElement('div');
    counterRow.className = 'bb-drop-counter-row';

    const btnMinus = document.createElement('button');
    btnMinus.className = 'bb-drop-counter-btn';
    btnMinus.textContent = '-';
    btnMinus.addEventListener('click', () => {
      this.dropQuantity = Math.max(1, this.dropQuantity - 1);
      this.dropInput.value = this.dropQuantity;
    });

    this.dropInput = document.createElement('input');
    this.dropInput.className = 'bb-drop-input';
    this.dropInput.type = 'number';
    this.dropInput.min = '1';
    this.dropInput.value = '1';
    this.dropInput.addEventListener('input', () => {
      const val = parseInt(this.dropInput.value, 10);
      if (!isNaN(val)) {
        const slot = this.inventory ? this.inventory.getItem(this.dropModalSlotIndex) : null;
        const max = slot ? slot.quantity : 1;
        this.dropQuantity = Math.max(1, Math.min(max, val));
        this.dropInput.value = this.dropQuantity;
      }
    });

    const btnPlus = document.createElement('button');
    btnPlus.className = 'bb-drop-counter-btn';
    btnPlus.textContent = '+';
    btnPlus.addEventListener('click', () => {
      const slot = this.inventory ? this.inventory.getItem(this.dropModalSlotIndex) : null;
      const max = slot ? slot.quantity : 1;
      this.dropQuantity = Math.min(max, this.dropQuantity + 1);
      this.dropInput.value = this.dropQuantity;
    });

    const btnMax = document.createElement('button');
    btnMax.className = 'bb-drop-counter-btn';
    btnMax.textContent = 'MAX';
    btnMax.style.width = '44px';
    btnMax.style.fontSize = '11px';
    btnMax.addEventListener('click', () => {
      const slot = this.inventory ? this.inventory.getItem(this.dropModalSlotIndex) : null;
      if (slot) {
        this.dropQuantity = slot.quantity;
        this.dropInput.value = this.dropQuantity;
      }
    });

    counterRow.appendChild(btnMinus);
    counterRow.appendChild(this.dropInput);
    counterRow.appendChild(btnPlus);
    counterRow.appendChild(btnMax);
    dialog.appendChild(counterRow);

    const btnRow = document.createElement('div');
    btnRow.className = 'bb-drop-btn-row';

    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'bb-action-btn primary';
    btnConfirm.textContent = 'CONFIRM DROP';
    btnConfirm.addEventListener('click', () => {
      this._confirmDrop();
    });

    const btnCancel = document.createElement('button');
    btnCancel.className = 'bb-action-btn secondary';
    btnCancel.textContent = 'CANCEL';
    btnCancel.addEventListener('click', () => {
      this._hideDropModal();
    });

    btnRow.appendChild(btnConfirm);
    btnRow.appendChild(btnCancel);
    dialog.appendChild(btnRow);

    this.dropModalEl.appendChild(dialog);
    document.body.appendChild(this.dropModalEl);
  }

  _bindEvents() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (e.repeat) return;
        this.toggle();
        return;
      }
      if (e.code === 'Escape') {
        if (this.isOpen) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          if (e.repeat) return;
          this.close();
          return;
        }
      }

      // Hotbar number key selection & assignment (1–9, 0)
      const numMap = {
        Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4,
        Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9
      };
      if (numMap[e.code] !== undefined && !e.repeat) {
        const targetHotbar = numMap[e.code];
        if (this.isOpen) {
          // If hovering over a storage item or right-clicked on storage item, assign it to hotbar slot
          const sourceSlot = (this.hoveredSlotIndex !== null && this.hoveredSlotIndex >= 10)
            ? this.hoveredSlotIndex
            : (this.contextSlotIdx !== null && this.contextSlotIdx >= 10 ? this.contextSlotIdx : null);

          if (sourceSlot !== null) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.moveOrSwapSlots(sourceSlot, targetHotbar);
          } else {
            // Also allow selecting active hotbar slot via number key
            this.setSelectedSlot(targetHotbar);
            if (this.player && this.player.selectHotbarSlot) {
              this.player.selectHotbarSlot(targetHotbar);
            }
          }
        }
      }
    }, { capture: true });
  }

  moveOrSwapSlots(fromIdx, toIdx) {
    if (!this.inventory) return false;
    if (fromIdx < 0 || fromIdx >= this.inventory.capacity || toIdx < 0 || toIdx >= this.inventory.capacity) {
      return false;
    }
    if (fromIdx === toIdx) return false;

    const fromItem = this.inventory.getItem(fromIdx);
    if (!fromItem) return false;

    const success = this.inventory.swapSlots(fromIdx, toIdx);
    if (success) {
      if (this.networkClient && this.networkClient.isConnected) {
        this.networkClient.send('INVENTORY_SWAP_REQUEST', { fromSlot: fromIdx, toSlot: toIdx });
      }
      if (this.player && (fromIdx === this.player.selectedHotbarSlot || toIdx === this.player.selectedHotbarSlot)) {
        this.player.selectHotbarSlot(this.player.selectedHotbarSlot);
      }
      this.render();
      if (this.hoveredSlotIndex !== null && this.slotElements[this.hoveredSlotIndex]) {
        this._showTooltip(this.hoveredSlotIndex, this.slotElements[this.hoveredSlotIndex]);
      }
    }
    return success;
  }

  _openDropModal(slotIdx) {
    const slot = this.inventory ? this.inventory.getItem(slotIdx) : null;
    if (!slot) return;

    this.dropModalSlotIndex = slotIdx;
    this.dropQuantity = 1;
    this.dropTitle.textContent = `DROP: ${slot.name}`;
    this.dropInput.value = '1';
    this.dropInput.max = String(slot.quantity);

    if (this.dropModalEl) {
      this.dropModalEl.style.display = 'flex';
    }
  }

  _hideDropModal() {
    this.dropModalSlotIndex = null;
    this.dropQuantity = 1;
    if (this.dropModalEl) {
      this.dropModalEl.style.display = 'none';
    }
  }

  _confirmDrop() {
    if (this.dropModalSlotIndex === null) return;
    const slotIdx = this.dropModalSlotIndex;
    const qty = this.dropQuantity;
    this._hideDropModal();
    this._executeDropConfirmed(slotIdx, qty);
  }

  _executeUse(slotIdx) {
    const slot = this.inventory ? this.inventory.getItem(slotIdx) : null;
    if (!slot) return;

    if (this.networkClient) {
      this.networkClient.requestItemUse(slotIdx, slot.instanceId);
    }
  }

  _executeDrop(slotIdx) {
    const slot = this.inventory ? this.inventory.getItem(slotIdx) : null;
    if (!slot) return;

    if (slot.quantity === 1) {
      // Single-item stack: drop immediately without selector
      this._executeDropConfirmed(slotIdx, 1);
    } else {
      // Multi-item stack: open quantity selector
      this._openDropModal(slotIdx);
    }
  }

  _executeDropConfirmed(slotIdx, qty) {
    const slot = this.inventory ? this.inventory.getItem(slotIdx) : null;
    if (!slot) return;

    const pPos = this.player ? this.player.pos : null;
    const pYaw = this.player ? this.player.yaw : 0;

    if (this.networkClient) {
      this.networkClient.requestItemDrop(slotIdx, slot.instanceId, qty, pPos, pYaw);
    }
  }

  _executeAssignHotbar(slotIdx) {
    if (slotIdx < 10) return; // Already on hotbar
    // Find first empty hotbar slot
    const slots = this.inventory.getSlots();
    let targetSlot = -1;
    for (let i = 0; i < 10; i++) {
      if (slots[i] === null) {
        targetSlot = i;
        break;
      }
    }
    if (targetSlot === -1) {
      targetSlot = this.selectedHotbarSlot; // Replace currently selected hotbar slot if all full
    }
    this.moveOrSwapSlots(slotIdx, targetSlot);
  }

  render() {
    if (this.isOpen) {
      this.renderInventoryModal();
    }
  }

  renderInventoryModal() {
    if (!this.inventory) return;
    const slots = this.inventory.getSlots();

    // Render all 30 slots
    for (let i = 0; i < 30; i++) {
      if (this.slotElements && this.slotElements[i]) {
        this._renderGridSlotElement(i, slots[i], this.slotElements[i]);
      }
    }
  }

  _renderGridSlotElement(slotIdx, slotData, slotEl) {
    if (!slotEl) return;

    slotEl.classList.toggle('active-equipped', slotIdx < 10 && slotIdx === this.selectedHotbarSlot);

    if (slotData) {
      slotEl.setAttribute('draggable', 'true');
      slotEl.style.cursor = 'grab';
    } else {
      slotEl.setAttribute('draggable', 'false');
      slotEl.style.cursor = 'pointer';
    }

    const iconImg = document.getElementById(`bb-grid-icon-${slotIdx}`);
    const qtyBadge = document.getElementById(`bb-grid-qty-${slotIdx}`);

    if (slotData) {
      if (iconImg) {
        iconImg.src = slotData.iconUrl || 'assets/ui/icons/hud_ammo.svg';
        iconImg.style.display = 'block';
      }
      if (qtyBadge) {
        qtyBadge.textContent = slotData.quantity > 1 ? `x${slotData.quantity}` : '';
      }
    } else {
      if (iconImg) iconImg.style.display = 'none';
      if (qtyBadge) qtyBadge.textContent = '';
    }
  }
}
