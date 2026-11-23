/**
 * Saber Killer — Survival Mode Polished Inventory & Hotbar UI
 *
 * Implements:
 * - 10-slot persistent gameplay Hotbar anchored above the stamina bar (keys 1-9, 0)
 * - Full Inventory interface (Tab / Escape) with Hotbar + 20-slot Storage grid
 * - Selected item details inspection panel
 * - Right-click contextual action menu (Use, Drop, Assign to Hotbar, Inspect)
 * - Dynamic drop quantity selector for stacked items (default 1, clamped, immediate single drop)
 * - Click-to-swap / click-to-move slot management
 * - Authentic Budget-Backrooms visual aesthetic (#ffcc00 accent, Rubik typography, monochromatic SVGs)
 */

import { getItemDefinition, ITEM_EFFECTS_CONFIG } from './item_catalog.js';

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
    this.selectedInventorySlot = null; // 0..29
    this.activeSwapSourceSlot = null; // For click-to-swap

    // Drop quantity state
    this.dropModalSlotIndex = null;
    this.dropQuantity = 1;
    this.draggedSlotIndex = null;

    // DOM Elements
    this.inventoryModalEl = null;
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
    this._hideContextMenu();
    this._hideDropModal();
    this.activeSwapSourceSlot = null;

    if (this.player) {
      this.player.isInventoryOpen = false;
    }
  }

  _injectStyles() {
    if (document.getElementById('bb-inventory-styles')) return;

    const style = document.createElement('style');
    style.id = 'bb-inventory-styles';
    style.textContent = `
      /* --- Badge and Icon Elements --- */
      .bb-slot-key-badge {
        position: absolute;
        top: 2px;
        left: 4px;
        font-size: 10px;
        font-weight: 700;
        color: #9c9a92;
        pointer-events: none;
        line-height: 1;
      }

      .bb-slot-qty-badge {
        position: absolute;
        bottom: 2px;
        right: 4px;
        font-size: 11px;
        font-weight: 700;
        color: #edece6;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
        pointer-events: none;
        line-height: 1;
      }

      .bb-slot-icon {
        width: 32px;
        height: 32px;
        object-fit: contain;
        display: block;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.8));
        pointer-events: none;
      }

      /* --- Full Inventory Modal (Tab) --- */
      #bb-inventory-modal {
        position: fixed;
        inset: 0;
        background: rgba(8, 8, 7, 0.72);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 950;
        user-select: none;
        backdrop-filter: blur(5px);
        font-family: 'Rubik', -apple-system, BlinkMacSystemFont, sans-serif;
      }

      .bb-inv-window {
        width: min(840px, 94vw);
        max-height: 90vh;
        background: rgba(18, 18, 16, 0.96);
        border: 1px solid rgba(255, 204, 0, 0.45);
        border-radius: 8px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.88);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .bb-inv-header {
        padding: 12px 18px;
        background: rgba(28, 28, 24, 0.95);
        border-bottom: 1px solid rgba(255, 204, 0, 0.25);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .bb-inv-title-group {
        display: flex;
        align-items: baseline;
        gap: 12px;
      }

      .bb-inv-title {
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 1.5px;
        color: #ffcc00;
        text-transform: uppercase;
      }

      .bb-inv-subtitle {
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.8px;
        color: #9c9a92;
        text-transform: uppercase;
      }

      .bb-inv-close-btn {
        background: transparent;
        border: 1px solid rgba(237, 236, 230, 0.25);
        color: #edece6;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.5px;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .bb-inv-close-btn:hover {
        border-color: #ffcc00;
        color: #ffcc00;
      }

      .bb-inv-body {
        padding: 18px;
        display: flex;
        gap: 20px;
        overflow-y: auto;
      }

      .bb-inv-left-col {
        flex: 1.35;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      .bb-inv-section-label {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 1px;
        color: #c8c6bc;
        text-transform: uppercase;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .bb-inv-section-hint {
        font-size: 10px;
        color: #7a7972;
        text-transform: none;
        letter-spacing: 0;
      }

      .bb-inv-hotbar-grid {
        display: grid;
        grid-template-columns: repeat(10, 1fr);
        gap: 6px;
        background: rgba(24, 24, 22, 0.6);
        padding: 8px;
        border-radius: 6px;
        border: 1px solid rgba(237, 236, 230, 0.12);
      }

      .bb-inv-backpack-grid {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 8px;
        background: rgba(24, 24, 22, 0.6);
        padding: 10px;
        border-radius: 6px;
        border: 1px solid rgba(237, 236, 230, 0.12);
      }

      .bb-grid-slot {
        aspect-ratio: 1 / 1;
        background: rgba(30, 30, 27, 0.85);
        border: 1px solid rgba(237, 236, 230, 0.16);
        border-radius: 4px;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .bb-grid-slot:hover {
        border-color: rgba(255, 204, 0, 0.7);
        background: rgba(42, 42, 38, 0.95);
      }

      .bb-grid-slot.selected {
        border: 2px solid #ffcc00;
        box-shadow: 0 0 10px rgba(255, 204, 0, 0.4);
        background: rgba(50, 48, 35, 0.95);
      }

      .bb-grid-slot.swap-source {
        border: 2px dashed #00e5ff;
        box-shadow: 0 0 8px rgba(0, 229, 255, 0.4);
        background: rgba(20, 45, 50, 0.9);
      }

      .bb-grid-slot.dragging {
        opacity: 0.45;
        border: 2px dashed #ffcc00;
      }

      .bb-grid-slot.drag-over {
        border: 2px solid #00e5ff;
        box-shadow: 0 0 12px rgba(0, 229, 255, 0.6);
        background: rgba(30, 60, 65, 0.95);
        transform: scale(1.04);
      }

      .bb-grid-slot.active-equipped {
        border-color: #ffcc00;
        box-shadow: 0 0 8px rgba(255, 204, 0, 0.45);
      }

      .bb-grid-slot.active-equipped::after {
        content: 'EQUIPPED';
        position: absolute;
        bottom: 2px;
        left: 3px;
        font-size: 7px;
        font-weight: 700;
        letter-spacing: 0.5px;
        color: #ffcc00;
        pointer-events: none;
      }

      .bb-grid-slot .bb-slot-icon {
        width: 32px;
        height: 32px;
      }

      .bb-inv-right-col {
        flex: 0.95;
        background: rgba(24, 24, 22, 0.85);
        border: 1px solid rgba(237, 236, 230, 0.15);
        border-radius: 6px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }

      .bb-item-detail-top {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .bb-item-detail-preview {
        display: flex;
        align-items: center;
        gap: 14px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(237, 236, 230, 0.12);
      }

      .bb-detail-icon-box {
        width: 60px;
        height: 60px;
        background: rgba(35, 35, 30, 0.9);
        border: 1px solid rgba(255, 204, 0, 0.35);
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .bb-detail-icon {
        width: 44px;
        height: 44px;
        object-fit: contain;
      }

      .bb-detail-name {
        font-size: 16px;
        font-weight: 700;
        color: #ffcc00;
        line-height: 1.2;
      }

      .bb-detail-cat {
        font-size: 11px;
        font-weight: 600;
        color: #9c9a92;
        text-transform: uppercase;
        margin-top: 2px;
      }

      .bb-detail-desc {
        font-size: 12px;
        color: #edece6;
        line-height: 1.45;
      }

      .bb-detail-stats {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 6px;
      }

      .bb-stat-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(255, 204, 0, 0.12);
        border: 1px solid rgba(255, 204, 0, 0.28);
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 600;
        color: #ffcc00;
      }

      .bb-detail-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 16px;
      }

      .bb-action-btn {
        width: 100%;
        padding: 8px 14px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.15s ease;
      }

      .bb-action-btn.primary {
        background: #ffcc00;
        border: 1px solid #ffcc00;
        color: #121210;
      }

      .bb-action-btn.primary:hover:not(:disabled) {
        background: #ffd633;
        box-shadow: 0 0 10px rgba(255, 204, 0, 0.5);
      }

      .bb-action-btn.secondary {
        background: rgba(45, 45, 40, 0.85);
        border: 1px solid rgba(237, 236, 230, 0.25);
        color: #edece6;
      }

      .bb-action-btn.secondary:hover:not(:disabled) {
        border-color: #ffcc00;
        color: #ffcc00;
      }

      .bb-action-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      /* --- Right Click Context Menu --- */
      #bb-context-menu {
        position: fixed;
        display: none;
        flex-direction: column;
        background: rgba(22, 22, 19, 0.98);
        border: 1px solid rgba(255, 204, 0, 0.5);
        border-radius: 4px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.85);
        padding: 4px 0;
        z-index: 1000;
        min-width: 140px;
        font-family: 'Rubik', -apple-system, BlinkMacSystemFont, sans-serif;
      }

      .bb-context-item {
        padding: 7px 14px;
        font-size: 12px;
        font-weight: 600;
        color: #edece6;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: background 0.1s ease, color 0.1s ease;
      }

      .bb-context-item:hover {
        background: rgba(255, 204, 0, 0.18);
        color: #ffcc00;
      }

      .bb-context-item.disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      .bb-context-divider {
        height: 1px;
        background: rgba(237, 236, 230, 0.1);
        margin: 4px 0;
      }

      /* --- Drop Quantity Modal --- */
      #bb-drop-modal {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 1050;
        backdrop-filter: blur(4px);
        font-family: 'Rubik', -apple-system, BlinkMacSystemFont, sans-serif;
      }

      .bb-drop-dialog {
        width: 320px;
        background: rgba(20, 20, 18, 0.98);
        border: 1px solid #ffcc00;
        border-radius: 6px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.9);
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .bb-drop-title {
        font-size: 14px;
        font-weight: 700;
        color: #ffcc00;
        text-transform: uppercase;
        letter-spacing: 0.8px;
      }

      .bb-drop-counter-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        background: rgba(30, 30, 26, 0.9);
        padding: 6px 10px;
        border-radius: 4px;
        border: 1px solid rgba(237, 236, 230, 0.15);
      }

      .bb-drop-counter-btn {
        width: 32px;
        height: 32px;
        background: rgba(45, 45, 40, 0.85);
        border: 1px solid rgba(237, 236, 230, 0.2);
        color: #edece6;
        border-radius: 4px;
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .bb-drop-counter-btn:hover {
        border-color: #ffcc00;
        color: #ffcc00;
      }

      .bb-drop-input {
        flex: 1;
        text-align: center;
        background: transparent;
        border: none;
        color: #ffcc00;
        font-size: 18px;
        font-weight: 700;
        font-family: inherit;
        outline: none;
      }

      .bb-drop-btn-row {
        display: flex;
        gap: 8px;
      }
    `;
    document.head.appendChild(style);
  }

  _initInventoryModalUI() {
    this.inventoryModalEl = document.createElement('div');
    this.inventoryModalEl.id = 'bb-inventory-modal';
    this.inventoryModalEl.style.display = 'none';

    const win = document.createElement('div');
    win.className = 'bb-inv-window';

    // Header
    const header = document.createElement('div');
    header.className = 'bb-inv-header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'bb-inv-title-group';
    const title = document.createElement('div');
    title.className = 'bb-inv-title';
    title.textContent = 'SURVIVOR INVENTORY';
    const subtitle = document.createElement('div');
    subtitle.className = 'bb-inv-subtitle';
    subtitle.id = 'bb-inv-capacity-status';
    subtitle.textContent = 'CAPACITY: 10 HOTBAR + 20 STORAGE';
    titleGroup.appendChild(title);
    titleGroup.appendChild(subtitle);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bb-inv-close-btn';
    closeBtn.textContent = 'CLOSE [ESC / TAB]';
    closeBtn.addEventListener('click', () => this.close());

    header.appendChild(titleGroup);
    header.appendChild(closeBtn);
    win.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'bb-inv-body';

    // Left Col: Hotbar Row + Storage Grid
    const leftCol = document.createElement('div');
    leftCol.className = 'bb-inv-left-col';

    // Hotbar section
    const hotbarSection = document.createElement('div');
    const hotbarLabel = document.createElement('div');
    hotbarLabel.className = 'bb-inv-section-label';
    hotbarLabel.innerHTML = '<span>Quick-Access Hotbar</span><span class="bb-inv-section-hint">Keys 1–9, 0</span>';
    hotbarSection.appendChild(hotbarLabel);

    this.invHotbarGrid = document.createElement('div');
    this.invHotbarGrid.className = 'bb-inv-hotbar-grid';
    for (let i = 0; i < 10; i++) {
      const slot = this._createGridSlot(i, true);
      this.invHotbarGrid.appendChild(slot);
    }
    hotbarSection.appendChild(this.invHotbarGrid);
    leftCol.appendChild(hotbarSection);

    // Storage section (20 slots: 10..29)
    const storageSection = document.createElement('div');
    const storageLabel = document.createElement('div');
    storageLabel.className = 'bb-inv-section-label';
    storageLabel.innerHTML = '<span>Backpack Storage</span><span class="bb-inv-section-hint">Click to move / Right-click for options</span>';
    storageSection.appendChild(storageLabel);

    this.invStorageGrid = document.createElement('div');
    this.invStorageGrid.className = 'bb-inv-backpack-grid';
    for (let i = 10; i < 30; i++) {
      const slot = this._createGridSlot(i, false);
      this.invStorageGrid.appendChild(slot);
    }
    storageSection.appendChild(this.invStorageGrid);
    leftCol.appendChild(storageSection);

    body.appendChild(leftCol);

    // Right Col: Item Details & Actions
    this.rightCol = document.createElement('div');
    this.rightCol.className = 'bb-inv-right-col';

    const detailTop = document.createElement('div');
    detailTop.className = 'bb-item-detail-top';

    const previewRow = document.createElement('div');
    previewRow.className = 'bb-item-detail-preview';

    const iconBox = document.createElement('div');
    iconBox.className = 'bb-detail-icon-box';
    this.detailIcon = document.createElement('img');
    this.detailIcon.className = 'bb-detail-icon';
    this.detailIcon.draggable = false;
    iconBox.appendChild(this.detailIcon);

    const nameCol = document.createElement('div');
    this.detailName = document.createElement('div');
    this.detailName.className = 'bb-detail-name';
    this.detailName.textContent = 'Select an Item';
    this.detailCat = document.createElement('div');
    this.detailCat.className = 'bb-detail-cat';
    this.detailCat.textContent = 'NO ITEM SELECTED';
    nameCol.appendChild(this.detailName);
    nameCol.appendChild(this.detailCat);

    previewRow.appendChild(iconBox);
    previewRow.appendChild(nameCol);
    detailTop.appendChild(previewRow);

    this.detailDesc = document.createElement('div');
    this.detailDesc.className = 'bb-detail-desc';
    this.detailDesc.textContent = 'Click on an inventory or hotbar item to inspect its specifications, consumable attributes, and actions.';
    detailTop.appendChild(this.detailDesc);

    this.detailStats = document.createElement('div');
    this.detailStats.className = 'bb-detail-stats';
    detailTop.appendChild(this.detailStats);

    this.rightCol.appendChild(detailTop);

    // Actions Row
    const actionRow = document.createElement('div');
    actionRow.className = 'bb-detail-actions';

    this.btnUse = document.createElement('button');
    this.btnUse.className = 'bb-action-btn primary';
    this.btnUse.textContent = 'Use / Consume';
    this.btnUse.disabled = true;
    this.btnUse.addEventListener('click', () => this._handleUseSelected());

    this.btnDrop = document.createElement('button');
    this.btnDrop.className = 'bb-action-btn secondary';
    this.btnDrop.textContent = 'Drop Item';
    this.btnDrop.disabled = true;
    this.btnDrop.addEventListener('click', () => this._handleDropSelected());

    this.btnAssignHotbar = document.createElement('button');
    this.btnAssignHotbar.className = 'bb-action-btn secondary';
    this.btnAssignHotbar.textContent = 'Assign to Hotbar';
    this.btnAssignHotbar.disabled = true;
    this.btnAssignHotbar.addEventListener('click', () => this._handleAssignHotbar());

    actionRow.appendChild(this.btnUse);
    actionRow.appendChild(this.btnDrop);
    actionRow.appendChild(this.btnAssignHotbar);
    this.rightCol.appendChild(actionRow);

    body.appendChild(this.rightCol);
    win.appendChild(body);
    this.inventoryModalEl.appendChild(win);
    this.parent.appendChild(this.inventoryModalEl);
  }

  _createGridSlot(slotIdx, isHotbar) {
    const slot = document.createElement('div');
    slot.className = 'bb-grid-slot';
    slot.dataset.slotIndex = String(slotIdx);

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
    slot.appendChild(iconImg);

    // Left click: select or click-to-swap
    slot.addEventListener('click', (e) => {
      e.stopPropagation();
      this._handleSlotClick(slotIdx);
    });

    // Right click: contextual menu
    slot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._handleSlotRightClick(slotIdx, e.clientX, e.clientY);
    });

    // Drag & Drop
    slot.addEventListener('dragstart', (e) => {
      const item = this.inventory ? this.inventory.getItem(slotIdx) : null;
      if (!item) {
        e.preventDefault();
        return;
      }
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

  _initContextMenuUI() {
    this.contextMenuEl = document.createElement('div');
    this.contextMenuEl.id = 'bb-context-menu';

    this.ctxUse = document.createElement('div');
    this.ctxUse.className = 'bb-context-item';
    this.ctxUse.textContent = 'Use / Consume';
    this.ctxUse.addEventListener('click', () => {
      this._hideContextMenu();
      if (this.contextSlotIdx !== null) this._executeUse(this.contextSlotIdx);
    });

    this.ctxDrop = document.createElement('div');
    this.ctxDrop.className = 'bb-context-item';
    this.ctxDrop.textContent = 'Drop...';
    this.ctxDrop.addEventListener('click', () => {
      this._hideContextMenu();
      if (this.contextSlotIdx !== null) this._executeDrop(this.contextSlotIdx);
    });

    this.ctxAssign = document.createElement('div');
    this.ctxAssign.className = 'bb-context-item';
    this.ctxAssign.textContent = 'Assign to Hotbar';
    this.ctxAssign.addEventListener('click', () => {
      this._hideContextMenu();
      if (this.contextSlotIdx !== null) this._executeAssignHotbar(this.contextSlotIdx);
    });

    this.ctxInspect = document.createElement('div');
    this.ctxInspect.className = 'bb-context-item';
    this.ctxInspect.textContent = 'Inspect Details';
    this.ctxInspect.addEventListener('click', () => {
      this._hideContextMenu();
      if (this.contextSlotIdx !== null) this._selectSlot(this.contextSlotIdx);
    });

    this.contextMenuEl.appendChild(this.ctxUse);
    this.contextMenuEl.appendChild(this.ctxDrop);
    this.contextMenuEl.appendChild(this.ctxAssign);
    const div = document.createElement('div');
    div.className = 'bb-context-divider';
    this.contextMenuEl.appendChild(div);
    this.contextMenuEl.appendChild(this.ctxInspect);

    document.body.appendChild(this.contextMenuEl);

    document.addEventListener('click', () => this._hideContextMenu());
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
      if (this.isOpen && this.selectedInventorySlot !== null && !e.repeat) {
        const numMap = {
          Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4,
          Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9
        };
        if (numMap[e.code] !== undefined) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const targetSlot = numMap[e.code];
          this.moveOrSwapSlots(this.selectedInventorySlot, targetSlot);
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
      this._selectSlot(toIdx);
      if (this.player && (fromIdx === this.player.selectedHotbarSlot || toIdx === this.player.selectedHotbarSlot)) {
        this.player.selectHotbarSlot(this.player.selectedHotbarSlot);
      }
      this.render();
    }
    return success;
  }

  _handleSlotClick(slotIdx) {
    this._hideContextMenu();

    // If already in a swap operation
    if (this.activeSwapSourceSlot !== null) {
      const from = this.activeSwapSourceSlot;
      this.activeSwapSourceSlot = null;
      if (from !== slotIdx) {
        this.moveOrSwapSlots(from, slotIdx);
        return;
      }
    }

    this._selectSlot(slotIdx);
  }

  _selectSlot(slotIdx) {
    this.selectedInventorySlot = slotIdx;
    this.render();
  }

  _handleSlotRightClick(slotIdx, clientX, clientY) {
    this.contextSlotIdx = slotIdx;
    this._selectSlot(slotIdx);

    const slot = this.inventory ? this.inventory.getItem(slotIdx) : null;
    if (!slot) {
      this._hideContextMenu();
      return;
    }

    const def = getItemDefinition(slot.typeId);
    const isConsumable = !!(def && def.consumable);
    const isDroppable = !!(def && def.droppable !== false);
    const isBackpack = slotIdx >= 10;

    this.ctxUse.style.display = isConsumable ? 'flex' : 'none';
    this.ctxDrop.style.display = isDroppable ? 'flex' : 'none';
    this.ctxAssign.style.display = isBackpack ? 'flex' : 'none';

    this.contextMenuEl.style.display = 'flex';
    this.contextMenuEl.style.left = `${Math.min(window.innerWidth - 160, clientX)}px`;
    this.contextMenuEl.style.top = `${Math.min(window.innerHeight - 150, clientY)}px`;
  }

  _hideContextMenu() {
    if (this.contextMenuEl) {
      this.contextMenuEl.style.display = 'none';
    }
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
      targetSlot = 3; // Default replace slot 4 if hotbar full
    }
    this.moveOrSwapSlots(slotIdx, targetSlot);
  }

  _handleUseSelected() {
    if (this.selectedInventorySlot !== null) {
      this._executeUse(this.selectedInventorySlot);
    }
  }

  _handleDropSelected() {
    if (this.selectedInventorySlot !== null) {
      this._executeDrop(this.selectedInventorySlot);
    }
  }

  _handleAssignHotbar() {
    if (this.selectedInventorySlot !== null && this.selectedInventorySlot >= 10) {
      this._executeAssignHotbar(this.selectedInventorySlot);
    }
  }

  render() {
    if (this.isOpen) {
      this.renderInventoryModal();
    }
  }

  renderInventoryModal() {
    if (!this.inventory) return;
    const slots = this.inventory.getSlots();
    const occupied = slots.filter(s => s !== null).length;

    const capEl = document.getElementById('bb-inv-capacity-status');
    if (capEl) {
      capEl.textContent = `SLOTS: ${occupied} / ${this.inventory.capacity} (HOTBAR: 10, BACKPACK: ${this.inventory.capacity - 10})`;
    }

    // Render Hotbar Grid Slots (0..9)
    if (this.invHotbarGrid) {
      for (let i = 0; i < 10; i++) {
        this._renderGridSlotElement(i, slots[i], this.invHotbarGrid.children[i]);
      }
    }

    // Render Storage Grid Slots (10..29)
    if (this.invStorageGrid) {
      for (let i = 10; i < Math.min(30, this.inventory.capacity); i++) {
        const childIdx = i - 10;
        this._renderGridSlotElement(i, slots[i], this.invStorageGrid.children[childIdx]);
      }
    }

    // Render Details Panel for selected item
    this._renderItemDetails();
  }

  _renderGridSlotElement(slotIdx, slotData, slotEl) {
    if (!slotEl) return;

    slotEl.classList.toggle('selected', slotIdx === this.selectedInventorySlot);
    slotEl.classList.toggle('swap-source', slotIdx === this.activeSwapSourceSlot);
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

  _renderItemDetails() {
    if (this.selectedInventorySlot === null) {
      this.detailIcon.style.display = 'none';
      this.detailName.textContent = 'Select an Item';
      this.detailCat.textContent = 'NO ITEM SELECTED';
      this.detailDesc.textContent = 'Click on any inventory slot to inspect details or right-click to execute contextual actions.';
      this.detailStats.innerHTML = '';
      this.btnUse.disabled = true;
      this.btnDrop.disabled = true;
      this.btnAssignHotbar.disabled = true;
      return;
    }

    const slot = this.inventory.getItem(this.selectedInventorySlot);
    if (!slot) {
      this.detailIcon.style.display = 'none';
      this.detailName.textContent = `Slot #${this.selectedInventorySlot + 1} (Empty)`;
      this.detailCat.textContent = this.selectedInventorySlot < 10 ? 'HOTBAR SLOT' : 'STORAGE SLOT';
      this.detailDesc.textContent = 'This slot is currently empty. Collected items will automatically occupy this slot.';
      this.detailStats.innerHTML = '';
      this.btnUse.disabled = true;
      this.btnDrop.disabled = true;
      this.btnAssignHotbar.disabled = true;
      return;
    }

    const def = getItemDefinition(slot.typeId) || {};
    const effect = ITEM_EFFECTS_CONFIG[slot.typeId] || def.metadata || {};

    this.detailIcon.src = slot.iconUrl || def.iconUrl || 'assets/ui/icons/hud_ammo.svg';
    this.detailIcon.style.display = 'block';
    this.detailName.textContent = slot.name || def.name;
    this.detailCat.textContent = `${(slot.category || def.category || 'ITEM').toUpperCase()} // STACK: ${slot.quantity}/${slot.maxStack || 1}`;
    this.detailDesc.textContent = def.metadata?.description || slot.metadata?.description || 'Standard Level 0 survival item.';

    let statsHtml = '';
    if (effect.healAmount) {
      statsHtml += `<div class="bb-stat-pill">+${effect.healAmount} HEALTH RESTORATION</div>`;
    }
    if (effect.sanityRestore) {
      statsHtml += `<div class="bb-stat-pill">+${effect.sanityRestore} SANITY RESTORATION</div>`;
    }
    if (effect.staminaBoost) {
      statsHtml += `<div class="bb-stat-pill">+${effect.staminaBoost} STAMINA RECOVERY</div>`;
    }
    if (effect.speedMultiplier) {
      statsHtml += `<div class="bb-stat-pill">+${Math.round((effect.speedMultiplier - 1) * 100)}% SPRINT SPEED (${effect.durationSeconds || 15}s)</div>`;
    }
    if (effect.batteryCharge) {
      statsHtml += `<div class="bb-stat-pill">+${effect.batteryCharge}% FLASHLIGHT BATTERY</div>`;
    }
    if (effect.rounds) {
      statsHtml += `<div class="bb-stat-pill">+${effect.rounds} ROUNDS (.45 ACP PISTOL)</div>`;
    }
    this.detailStats.innerHTML = statsHtml;

    this.btnUse.disabled = !def.consumable;
    this.btnDrop.disabled = def.droppable === false;
    this.btnAssignHotbar.disabled = this.selectedInventorySlot < 10;
  }
}
