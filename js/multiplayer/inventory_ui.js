/**
 * Saber Killer — Survival Mode Two-Panel Inventory UI
 *
 * Rebuilt around the authentic 1920x1080 two-panel SVG artwork skin:
 * - Left Panel: 30-slot Survival Inventory Grid (10 Hotbar + 20 Backpack Storage)
 * - Right Panel: Equipment Silhouette & 10 empty gear slots (retained from artwork)
 * - Dual Yellow X Close Buttons (one in each panel, both calling the same close functionality)
 * - Subheader Capacity & Status Indicator
 * - Selected Item Inspection & Contextual Actions Panel
 * - Full Keyboard & Drag-and-Drop Management (Tab, Escape, 1–9, 0)
 * - Distressed Dark Gunmetal Palette with Restrained Gold (#f0c64a / #d7a51e) Accents
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
    this.stageEl = null;
    this.bgArtwork = null;
    this.closeBtnLeft = null;
    this.closeBtnRight = null;
    this.capacityBarEl = null;
    this.slotElements = [];
    this.detailsPanelEl = null;

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
    this._hideContextMenu();
    this._hideDropModal();
    this.activeSwapSourceSlot = null;

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

      /* --- Subheader Capacity / Status Bar --- */
      .bb-inv-capacity-bar {
        position: absolute;
        left: 245px;
        top: 154px;
        width: 640px;
        height: 44px;
        z-index: 15;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 16px;
        background: rgba(14, 18, 25, 0.72);
        border: 1px solid rgba(88, 97, 110, 0.35);
        border-radius: 2px;
        color: #c8c6bc;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 1px;
        text-transform: uppercase;
        font-family: monospace;
      }

      .bb-inv-capacity-bar .gold-accent {
        color: #f0c64a;
        font-weight: 700;
      }

      .bb-inv-capacity-bar .hint-text {
        font-size: 10px;
        color: #77818f;
        letter-spacing: 0.5px;
      }

      /* --- Interactive 30-Slot Grid Elements --- */
      .bb-grid-slot {
        position: absolute;
        width: 95px;
        height: 95px;
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

      .bb-grid-slot:hover {
        border-color: rgba(240, 198, 74, 0.65);
        background: rgba(30, 38, 50, 0.4);
        box-shadow: inset 0 0 14px rgba(240, 198, 74, 0.2);
      }

      .bb-grid-slot.selected {
        border: 2px solid #edece6;
        box-shadow: inset 0 0 12px rgba(255, 255, 255, 0.2), 0 0 8px rgba(255, 255, 255, 0.3);
      }

      .bb-grid-slot.active-equipped {
        border: 2px solid #f0c64a;
        box-shadow: inset 0 0 14px rgba(240, 198, 74, 0.35), 0 0 10px rgba(240, 198, 74, 0.5);
      }

      .bb-grid-slot.swap-source {
        border: 2px dashed #f0c64a;
        animation: bbPulse 1.2s infinite ease-in-out;
      }

      .bb-grid-slot.drag-over {
        border: 2px solid #f0c64a;
        background: rgba(240, 198, 74, 0.25);
      }

      .bb-grid-slot.dragging {
        opacity: 0.35;
      }

      @keyframes bbPulse {
        0%, 100% { border-color: #f0c64a; }
        50% { border-color: rgba(240, 198, 74, 0.3); }
      }

      .bb-slot-key-badge {
        position: absolute;
        top: 4px;
        left: 6px;
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
        bottom: 4px;
        right: 6px;
        font-size: 13px;
        font-weight: 700;
        font-family: monospace;
        color: #edece6;
        text-shadow: 0 1px 3px #000, 0 0 5px #000;
        pointer-events: none;
        line-height: 1;
      }

      .bb-slot-icon {
        max-width: 58px;
        max-height: 58px;
        object-fit: contain;
        display: block;
        filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.85));
        pointer-events: none;
      }

      /* --- Selected Item Details & Actions Panel (Lower Left Panel) --- */
      .bb-inv-details-panel {
        position: absolute;
        left: 245px;
        top: 780px;
        width: 640px;
        height: 232px;
        z-index: 15;
        box-sizing: border-box;
        background: rgba(14, 18, 25, 0.88);
        border: 1px solid rgba(88, 97, 110, 0.38);
        border-radius: 2px;
        padding: 14px 18px;
        display: flex;
        gap: 18px;
        color: #edece6;
      }

      .bb-details-left {
        flex: 1.45;
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow: hidden;
      }

      .bb-details-header-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .bb-details-icon-box {
        width: 52px;
        height: 52px;
        flex-shrink: 0;
        background: rgba(8, 12, 18, 0.85);
        border: 1px solid rgba(88, 97, 110, 0.45);
        border-radius: 2px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .bb-details-icon {
        max-width: 42px;
        max-height: 42px;
        object-fit: contain;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.8));
      }

      .bb-details-meta {
        display: flex;
        flex-direction: column;
        gap: 3px;
        overflow: hidden;
      }

      .bb-details-name {
        font-size: 15px;
        font-weight: 700;
        letter-spacing: 0.5px;
        color: #f0f1f2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-transform: uppercase;
      }

      .bb-details-cat {
        font-size: 10px;
        font-weight: 600;
        color: #9c9a92;
        font-family: monospace;
        letter-spacing: 0.8px;
        text-transform: uppercase;
      }

      .bb-details-desc {
        font-size: 11px;
        color: #9c9a92;
        line-height: 1.45;
        max-height: 52px;
        overflow-y: auto;
      }

      .bb-details-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: auto;
      }

      .bb-stat-pill {
        background: rgba(24, 32, 42, 0.85);
        border: 1px solid rgba(240, 198, 74, 0.35);
        color: #f0c64a;
        font-size: 10px;
        font-weight: 600;
        font-family: monospace;
        padding: 3px 8px;
        border-radius: 2px;
        letter-spacing: 0.5px;
      }

      .bb-details-actions {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
        justify-content: center;
        border-left: 1px solid rgba(88, 97, 110, 0.25);
        padding-left: 18px;
      }

      .bb-action-btn {
        width: 100%;
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

      .bb-action-btn.primary:not(:disabled):hover {
        filter: brightness(1.15);
        box-shadow: 0 0 10px rgba(240, 198, 74, 0.5);
      }

      .bb-action-btn.secondary {
        background: rgba(22, 28, 38, 0.85);
        border: 1px solid rgba(88, 97, 110, 0.45);
        color: #edece6;
      }

      .bb-action-btn.secondary:not(:disabled):hover {
        border-color: #edece6;
        background: rgba(32, 40, 52, 0.95);
        color: #ffffff;
      }

      .bb-action-btn:disabled {
        opacity: 0.35;
        cursor: not-allowed;
        filter: grayscale(0.8);
      }

      .bb-actions-hint {
        font-size: 9.5px;
        color: #616b79;
        font-family: monospace;
        text-align: center;
        margin-top: 2px;
        letter-spacing: 0.3px;
      }

      /* --- Context Menu & Drop Quantity Modal --- */
      #bb-context-menu {
        position: fixed;
        background: rgba(18, 24, 33, 0.96);
        border: 1px solid rgba(240, 198, 74, 0.4);
        border-radius: 3px;
        padding: 4px 0;
        z-index: 1100;
        display: none;
        flex-direction: column;
        min-width: 150px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.85);
        font-family: 'Rubik', -apple-system, sans-serif;
      }

      .bb-context-item {
        padding: 7px 14px;
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

      .bb-context-divider {
        height: 1px;
        background: rgba(88, 97, 110, 0.25);
        margin: 3px 0;
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
    `;
    document.head.appendChild(style);
  }

  _initInventoryModalUI() {
    this.inventoryModalEl = document.createElement('div');
    this.inventoryModalEl.id = 'bb-inventory-modal';
    this.inventoryModalEl.style.display = 'none';

    // Clicking backdrop outside stage closes inventory
    this.inventoryModalEl.addEventListener('click', (e) => {
      if (e.target === this.inventoryModalEl) {
        this.close();
      }
    });

    // 1920x1080 Stage
    this.stageEl = document.createElement('div');
    this.stageEl.className = 'bb-inv-stage';
    this.stageEl.addEventListener('click', (e) => {
      e.stopPropagation();
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

    // Subheader Capacity Bar (Above 30-slot grid on Left Panel)
    this.capacityBarEl = document.createElement('div');
    this.capacityBarEl.className = 'bb-inv-capacity-bar';
    this.capacityBarEl.id = 'bb-inv-capacity-status';
    this.capacityBarEl.innerHTML = `
      <div>SLOTS: <span id="bb-inv-occupied" class="gold-accent">0</span> / 30 &middot; <span class="gold-accent">HOTBAR: 10</span> &middot; STORAGE: 20</div>
      <div class="hint-text">[ESC / TAB] CLOSE &middot; [1–0] ASSIGN</div>
    `;
    this.stageEl.appendChild(this.capacityBarEl);

    // 30 Inventory Grid Slots (6 columns x 5 rows, matching exact SVG slot coordinates)
    this.slotElements = [];
    for (let i = 0; i < 30; i++) {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const x = 245 + col * 109;
      const y = 228 + row * 109;

      const slot = this._createGridSlot(i, i < 10);
      slot.style.left = `${x}px`;
      slot.style.top = `${y}px`;

      this.slotElements.push(slot);
      this.stageEl.appendChild(slot);
    }

    // Selected Item Details & Actions Panel (Lower Left Panel, y: 780..1012)
    this.detailsPanelEl = document.createElement('div');
    this.detailsPanelEl.className = 'bb-inv-details-panel';
    this.detailsPanelEl.id = 'bb-inv-details-panel';

    const detailsLeft = document.createElement('div');
    detailsLeft.className = 'bb-details-left';

    const previewRow = document.createElement('div');
    previewRow.className = 'bb-details-header-row';

    const iconBox = document.createElement('div');
    iconBox.className = 'bb-details-icon-box';
    this.detailIcon = document.createElement('img');
    this.detailIcon.className = 'bb-details-icon';
    this.detailIcon.id = 'bb-details-icon';
    this.detailIcon.draggable = false;
    this.detailIcon.style.display = 'none';
    iconBox.appendChild(this.detailIcon);

    const metaCol = document.createElement('div');
    metaCol.className = 'bb-details-meta';
    this.detailName = document.createElement('div');
    this.detailName.className = 'bb-details-name';
    this.detailName.id = 'bb-details-name';
    this.detailName.textContent = 'SELECT AN ITEM';
    this.detailCat = document.createElement('div');
    this.detailCat.className = 'bb-details-cat';
    this.detailCat.id = 'bb-details-cat';
    this.detailCat.textContent = 'CLICK ANY SLOT TO INSPECT';
    metaCol.appendChild(this.detailName);
    metaCol.appendChild(this.detailCat);

    previewRow.appendChild(iconBox);
    previewRow.appendChild(metaCol);
    detailsLeft.appendChild(previewRow);

    this.detailDesc = document.createElement('div');
    this.detailDesc.className = 'bb-details-desc';
    this.detailDesc.id = 'bb-details-desc';
    this.detailDesc.textContent = 'Inspect item specifications, consumable attributes, and contextual actions.';
    detailsLeft.appendChild(this.detailDesc);

    this.detailStats = document.createElement('div');
    this.detailStats.className = 'bb-details-stats';
    this.detailStats.id = 'bb-details-stats';
    detailsLeft.appendChild(this.detailStats);

    this.detailsPanelEl.appendChild(detailsLeft);

    // Actions Column
    const actionsCol = document.createElement('div');
    actionsCol.className = 'bb-details-actions';

    this.btnUse = document.createElement('button');
    this.btnUse.className = 'bb-action-btn primary';
    this.btnUse.id = 'bb-action-use';
    this.btnUse.textContent = 'Use / Consume';
    this.btnUse.disabled = true;
    this.btnUse.addEventListener('click', () => this._handleUseSelected());

    this.btnDrop = document.createElement('button');
    this.btnDrop.className = 'bb-action-btn secondary';
    this.btnDrop.id = 'bb-action-drop';
    this.btnDrop.textContent = 'Drop Item';
    this.btnDrop.disabled = true;
    this.btnDrop.addEventListener('click', () => this._handleDropSelected());

    this.btnAssignHotbar = document.createElement('button');
    this.btnAssignHotbar.className = 'bb-action-btn secondary';
    this.btnAssignHotbar.id = 'bb-action-assign';
    this.btnAssignHotbar.textContent = 'Assign to Hotbar';
    this.btnAssignHotbar.disabled = true;
    this.btnAssignHotbar.addEventListener('click', () => this._handleAssignHotbar());

    const hintEl = document.createElement('div');
    hintEl.className = 'bb-actions-hint';
    hintEl.textContent = 'HINT: Press 1–9, 0 to assign';

    actionsCol.appendChild(this.btnUse);
    actionsCol.appendChild(this.btnDrop);
    actionsCol.appendChild(this.btnAssignHotbar);
    actionsCol.appendChild(hintEl);

    this.detailsPanelEl.appendChild(actionsCol);
    this.stageEl.appendChild(this.detailsPanelEl);

    // Append stage to modal root and parent
    this.inventoryModalEl.appendChild(this.stageEl);
    this.parent.appendChild(this.inventoryModalEl);

    // Responsive window auto-scaling
    window.addEventListener('resize', () => this._updateScale());
    this._updateScale();
  }

  _createGridSlot(slotIdx, isHotbar) {
    const slot = document.createElement('div');
    slot.className = 'bb-grid-slot';
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

    const occEl = document.getElementById('bb-inv-occupied');
    if (occEl) {
      occEl.textContent = String(occupied);
    }
    const capEl = document.getElementById('bb-inv-capacity-status');
    if (capEl && !occEl) {
      capEl.textContent = `SLOTS: ${occupied} / ${this.inventory.capacity} (HOTBAR: 10, BACKPACK: ${this.inventory.capacity - 10})`;
    }

    // Render all 30 slots
    for (let i = 0; i < 30; i++) {
      if (this.slotElements && this.slotElements[i]) {
        this._renderGridSlotElement(i, slots[i], this.slotElements[i]);
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
      this.detailName.textContent = 'SELECT AN ITEM';
      this.detailCat.textContent = 'CLICK ANY SLOT TO INSPECT';
      this.detailDesc.textContent = 'Inspect item specifications, consumable attributes, and contextual actions.';
      this.detailStats.innerHTML = '';
      this.btnUse.disabled = true;
      this.btnDrop.disabled = true;
      this.btnAssignHotbar.disabled = true;
      return;
    }

    const slot = this.inventory.getItem(this.selectedInventorySlot);
    if (!slot) {
      this.detailIcon.style.display = 'none';
      this.detailName.textContent = `SLOT #${this.selectedInventorySlot + 1} (EMPTY)`;
      this.detailCat.textContent = this.selectedInventorySlot < 10 ? 'HOTBAR SLOT (KEYS 1-9, 0)' : 'STORAGE SLOT';
      this.detailDesc.textContent = 'This slot is currently empty. Collected world items will automatically occupy this slot.';
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
    this.detailCat.textContent = `${(slot.category || def.category || 'ITEM').toUpperCase()} // STACK: ${slot.quantity}/${slot.maxStack || 1} ${this.selectedInventorySlot < 10 ? '(HOTBAR)' : '(BACKPACK)'}`;
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
