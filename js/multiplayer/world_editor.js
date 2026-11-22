/**
 * Level 0 Developer World Placement Editor
 * Interactive 3D visual prop and item placement tool for Level 0 Backrooms.
 * Features:
 * - 3D raycast object selection with visual selection highlight
 * - Official Three.js r147 TransformControls (Translate, Rotate, Scale)
 * - 11 verified Backrooms assets palette (Furniture & Consumables)
 * - Surface snapping: Floor (Y=0.000), Tabletop (Y=0.936), Metal Shelf Tiers (1-5)
 * - Real-time physical validation: wall penetration, object overlap, support bounds
 * - Non-blocking experimentation with "Revert to Last Valid"
 * - Numbered, immutable JSON layout export via POST /api/developer/world-layout/export
 * - Layout iteration browsing and loading via GET /api/developer/world-layout/load
 * - Pointer-lock release and FPS control suspension during editing
 */

export class WorldPlacementEditor {
  constructor({ scene, camera, renderer, itemManager, localPlayer }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this._itemManager = itemManager;
    this.localPlayer = localPlayer;

    this.isOpen = false;
    this.selectedItem = null;
    this.selectedWrapper = null;
    this.lastValidTransforms = new Map(); // id -> { pos, rot, scale, anchor }

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Editor camera orbit state (Right-click drag)
    this.isOrbiting = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // TransformControls instance (vendored Three.js r147)
    if (typeof THREE.TransformControls === 'function') {
      this.transformControls = new THREE.TransformControls(this.camera, this.renderer.domElement);
      this.transformControls.size = 0.85;
      this.transformControls.space = 'world';
    } else {
      console.error('[WorldEditor] THREE.TransformControls is not defined. Ensure vendor/TransformControls.js is loaded.');
      this.transformControls = null;
    }

    this._buildUI();
    this._bindEvents();
  }

  get itemManager() {
    return this._itemManager || window.itemManager;
  }

  set itemManager(im) {
    this._itemManager = im;
  }

  _buildUI() {
    // Top-level container
    this.overlay = document.createElement('div');
    this.overlay.id = 'world-editor-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 9999;
      display: none;
      font-family: 'Rubik', monospace, sans-serif;
      color: #edece6;
      user-select: none;
    `;

    // 1. Top Header Bar
    const topBar = document.createElement('div');
    topBar.id = 'editor-topbar';
    topBar.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 48px;
      background: rgba(18, 17, 16, 0.94);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid rgba(212, 175, 55, 0.4);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      pointer-events: auto;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.7);
    `;
    topBar.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="color: #d4af37; font-weight: 600; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase;">
          Level 0 World Placement Editor [DEV]
        </span>
        <span style="color: #666; font-size: 12px;">|</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          <label style="font-size: 11px; color: #9c9a92; text-transform: uppercase;">Revision:</label>
          <select id="ed-layout-select" style="background: #111; color: #edece6; border: 1px solid #444; font-size: 11px; padding: 4px 8px; border-radius: 3px; font-family: monospace;">
            <option value="default">Default (world_items.json)</option>
          </select>
          <button id="ed-btn-load" style="background: rgba(212, 175, 55, 0.2); border: 1px solid #d4af37; color: #edece6; font-size: 11px; padding: 4px 10px; border-radius: 3px; cursor: pointer;">Load</button>
          <button id="ed-btn-refresh-list" style="background: #222; border: 1px solid #444; color: #aaa; font-size: 11px; padding: 4px 8px; border-radius: 3px; cursor: pointer;" title="Refresh Revision List">&#x21bb;</button>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <button id="ed-btn-export" style="background: #d4af37; color: #111; font-weight: 600; font-size: 11px; padding: 6px 14px; border: none; border-radius: 3px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;">
          Export Iteration JSON
        </button>
        <button id="ed-btn-close" style="background: rgba(200, 40, 40, 0.3); border: 1px solid #e53935; color: #ff8888; font-size: 11px; padding: 6px 12px; border-radius: 3px; cursor: pointer;">
          Exit Editor [Esc]
        </button>
      </div>
    `;

    // 2. Left Sidebar: Asset Palette
    const leftPanel = document.createElement('div');
    leftPanel.id = 'editor-palette-panel';
    leftPanel.style.cssText = `
      position: absolute;
      top: 58px;
      left: 12px;
      width: 260px;
      max-height: calc(100vh - 100px);
      overflow-y: auto;
      background: rgba(18, 17, 16, 0.90);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(212, 175, 55, 0.35);
      border-radius: 4px;
      padding: 14px;
      pointer-events: auto;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.8);
    `;
    leftPanel.innerHTML = `
      <div style="font-size: 11px; letter-spacing: 1.5px; color: #d4af37; font-weight: 600; text-transform: uppercase; margin-bottom: 10px; border-bottom: 1px solid rgba(212, 175, 55, 0.2); padding-bottom: 4px;">
        Asset Palette (11 Models)
      </div>

      <div style="font-size: 10px; color: #888; text-transform: uppercase; margin-bottom: 6px;">Furniture & Props</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 14px;">
        <button class="ed-palette-btn" data-type="table">Office Table</button>
        <button class="ed-palette-btn" data-type="metal_shelf">Metal Shelf</button>
        <button class="ed-palette-btn" data-type="vending_almond">Vending Mach.</button>
        <button class="ed-palette-btn" data-type="ammo_crate">Ammo Crate</button>
      </div>

      <div style="font-size: 10px; color: #888; text-transform: uppercase; margin-bottom: 6px;">Consumables & Items</div>
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <button class="ed-palette-btn" data-type="first_aid">First Aid Kit</button>
        <button class="ed-palette-btn" data-type="almond_can">Almond Water Can</button>
        <button class="ed-palette-btn" data-type="sanity_pill">Sanity Pills Bottle</button>
        <button class="ed-palette-btn" data-type="energy_drink">Energy Drink</button>
        <button class="ed-palette-btn" data-type="aa_battery">Flashlight Battery Pack</button>
        <button class="ed-palette-btn" data-type="ammo_box">.45 ACP Ammo Box</button>
        <button class="ed-palette-btn" data-type="doorKey">Brass Door Key</button>
      </div>

      <div style="margin-top: 14px; padding-top: 8px; border-top: 1px solid #333; font-size: 10px; color: #777;">
        Tip: Click any asset above to spawn it in front of the camera.
      </div>
    `;

    // 3. Right Sidebar: Inspector & Validation
    const rightPanel = document.createElement('div');
    rightPanel.id = 'editor-inspector-panel';
    rightPanel.style.cssText = `
      position: absolute;
      top: 58px;
      right: 12px;
      width: 320px;
      max-height: calc(100vh - 100px);
      overflow-y: auto;
      background: rgba(18, 17, 16, 0.90);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(212, 175, 55, 0.35);
      border-radius: 4px;
      padding: 14px;
      pointer-events: auto;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.8);
    `;
    rightPanel.innerHTML = `
      <div style="font-size: 11px; letter-spacing: 1.5px; color: #d4af37; font-weight: 600; text-transform: uppercase; margin-bottom: 10px; border-bottom: 1px solid rgba(212, 175, 55, 0.2); padding-bottom: 4px;">
        Inspector & Validation
      </div>

      <!-- Transform Mode Buttons -->
      <div style="font-size: 10px; color: #888; text-transform: uppercase; margin-bottom: 4px;">Gizmo Mode</div>
      <div style="display: flex; gap: 4px; margin-bottom: 12px;">
        <button class="ed-mode-btn active" id="ed-mode-translate" data-mode="translate">Translate (T)</button>
        <button class="ed-mode-btn" id="ed-mode-rotate" data-mode="rotate">Rotate (R)</button>
        <button class="ed-mode-btn" id="ed-mode-scale" data-mode="scale">Scale (S)</button>
      </div>

      <!-- Selected Item Info -->
      <div style="background: rgba(0,0,0,0.4); border: 1px solid #333; border-radius: 3px; padding: 8px; margin-bottom: 12px; font-size: 11px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
          <span style="color: #888;">ID:</span>
          <span id="ed-prop-id" style="color: #d4af37; font-family: monospace;">(None Selected)</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
          <span style="color: #888;">Type:</span>
          <span id="ed-prop-type" style="color: #edece6;">-</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #888;">Category:</span>
          <span id="ed-prop-category" style="color: #edece6;">-</span>
        </div>
      </div>

      <!-- Position Coordinates -->
      <div style="font-size: 10px; color: #888; text-transform: uppercase; margin-bottom: 4px;">Position (X, Y, Z)</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; margin-bottom: 10px;">
        <input class="ed-num-input" id="ed-pos-x" type="number" step="0.05" placeholder="X">
        <input class="ed-num-input" id="ed-pos-y" type="number" step="0.05" placeholder="Y">
        <input class="ed-num-input" id="ed-pos-z" type="number" step="0.05" placeholder="Z">
      </div>

      <!-- Rotation Angles -->
      <div style="font-size: 10px; color: #888; text-transform: uppercase; margin-bottom: 4px;">Rotation Degrees (X, Y, Z)</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; margin-bottom: 12px;">
        <input class="ed-num-input" id="ed-rot-x" type="number" step="15" placeholder="Rot X">
        <input class="ed-num-input" id="ed-rot-y" type="number" step="15" placeholder="Rot Y">
        <input class="ed-num-input" id="ed-rot-z" type="number" step="15" placeholder="Rot Z">
      </div>

      <!-- Snapping Controls -->
      <div style="font-size: 10px; color: #888; text-transform: uppercase; margin-bottom: 4px;">Surface Snapping</div>
      <div style="display: flex; gap: 4px; margin-bottom: 6px;">
        <button class="ed-action-btn" id="ed-snap-floor" style="flex:1;">Snap Floor (F)</button>
        <button class="ed-action-btn" id="ed-snap-table" style="flex:1;">Snap Table</button>
      </div>
      <div style="font-size: 9px; color: #888; margin-bottom: 3px;">Snap to Shelf Tier:</div>
      <div style="display: flex; gap: 3px; margin-bottom: 12px;">
        <button class="ed-tier-btn" data-tier="1">T1</button>
        <button class="ed-tier-btn" data-tier="2">T2</button>
        <button class="ed-tier-btn" data-tier="3">T3</button>
        <button class="ed-tier-btn" data-tier="4">T4</button>
        <button class="ed-tier-btn" data-tier="5">T5</button>
      </div>

      <!-- Actions: Duplicate, Delete, Revert -->
      <div style="font-size: 10px; color: #888; text-transform: uppercase; margin-bottom: 4px;">Item Actions</div>
      <div style="display: flex; gap: 4px; margin-bottom: 6px;">
        <button class="ed-action-btn" id="ed-btn-duplicate" style="flex:1;">Duplicate (Ctrl+D)</button>
        <button class="ed-action-btn" id="ed-btn-delete" style="flex:1; border-color: rgba(220,50,50,0.5); color: #ff8888;">Delete (Del)</button>
      </div>
      <button class="ed-action-btn" id="ed-btn-revert" style="width:100%; margin-bottom: 12px;">Revert to Last Valid (V)</button>

      <!-- Placement Validation Status -->
      <div style="font-size: 10px; color: #888; text-transform: uppercase; margin-bottom: 4px;">Validation Status</div>
      <div id="ed-val-badge" style="padding: 6px 10px; border-radius: 3px; font-size: 11px; font-weight: 600; text-align: center; text-transform: uppercase; letter-spacing: 1px; background: rgba(0, 255, 136, 0.15); border: 1px solid #00ff88; color: #00ff88; margin-bottom: 4px;">
        NO SELECTION
      </div>
      <div id="ed-val-reason" style="font-size: 10px; color: #9c9a92; font-family: monospace; min-height: 24px;">
        Select an object to inspect clearance & support.
      </div>
    `;

    // 4. Bottom Status & Shortcuts Bar
    const bottomBar = document.createElement('div');
    bottomBar.id = 'editor-bottombar';
    bottomBar.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 32px;
      background: rgba(18, 17, 16, 0.94);
      backdrop-filter: blur(10px);
      border-top: 1px solid rgba(212, 175, 55, 0.3);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      font-size: 11px;
      pointer-events: auto;
      box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.7);
    `;
    bottomBar.innerHTML = `
      <div style="color: #9c9a92;">
        Shortcuts: <span style="color: #d4af37;">T</span> Translate &middot;
        <span style="color: #d4af37;">R</span> Rotate &middot;
        <span style="color: #d4af37;">S</span> Scale &middot;
        <span style="color: #d4af37;">F</span> Floor Snap &middot;
        <span style="color: #d4af37;">Del</span> Delete &middot;
        <span style="color: #d4af37;">Ctrl+D</span> Duplicate &middot;
        <span style="color: #d4af37;">V</span> Revert &middot;
        <span style="color: #d4af37;">Esc</span> Exit
      </div>
      <div id="ed-status-msg" style="color: #00e5ff; font-family: monospace;"></div>
    `;

    // Inject Styles
    const style = document.createElement('style');
    style.textContent = `
      .ed-palette-btn {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(212, 175, 55, 0.25);
        color: #edece6;
        font-family: 'Rubik', monospace, sans-serif;
        font-size: 11px;
        padding: 7px 8px;
        border-radius: 3px;
        cursor: pointer;
        text-align: left;
        transition: background 0.15s, border-color 0.15s;
      }
      .ed-palette-btn:hover {
        background: rgba(212, 175, 55, 0.2);
        border-color: #d4af37;
        color: #fff;
      }
      .ed-mode-btn {
        flex: 1;
        background: #1e1e1e;
        border: 1px solid #444;
        color: #aaa;
        font-size: 11px;
        padding: 6px 0;
        border-radius: 3px;
        cursor: pointer;
        text-align: center;
      }
      .ed-mode-btn.active {
        background: rgba(212, 175, 55, 0.25);
        border-color: #d4af37;
        color: #d4af37;
        font-weight: 600;
      }
      .ed-action-btn {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid #555;
        color: #edece6;
        font-size: 11px;
        padding: 6px 8px;
        border-radius: 3px;
        cursor: pointer;
        transition: background 0.15s;
      }
      .ed-action-btn:hover {
        background: rgba(255, 255, 255, 0.15);
      }
      .ed-tier-btn {
        flex: 1;
        background: #222;
        border: 1px solid #444;
        color: #ddd;
        font-size: 10px;
        padding: 4px 0;
        border-radius: 2px;
        cursor: pointer;
      }
      .ed-tier-btn:hover {
        background: rgba(212, 175, 55, 0.3);
        border-color: #d4af37;
      }
      .ed-num-input {
        background: #111;
        border: 1px solid #444;
        color: #edece6;
        font-family: monospace;
        font-size: 11px;
        padding: 4px 6px;
        border-radius: 3px;
        outline: none;
        width: 100%;
        box-sizing: border-box;
      }
      .ed-num-input:focus {
        border-color: #d4af37;
      }
    `;

    document.head.appendChild(style);
    this.overlay.appendChild(topBar);
    this.overlay.appendChild(leftPanel);
    this.overlay.appendChild(rightPanel);
    this.overlay.appendChild(bottomBar);
    document.body.appendChild(this.overlay);

    // Cache element references
    this.ui = {
      layoutSelect: document.getElementById('ed-layout-select'),
      btnLoad: document.getElementById('ed-btn-load'),
      btnRefreshList: document.getElementById('ed-btn-refresh-list'),
      btnExport: document.getElementById('ed-btn-export'),
      btnClose: document.getElementById('ed-btn-close'),
      propId: document.getElementById('ed-prop-id'),
      propType: document.getElementById('ed-prop-type'),
      propCat: document.getElementById('ed-prop-category'),
      posX: document.getElementById('ed-pos-x'),
      posY: document.getElementById('ed-pos-y'),
      posZ: document.getElementById('ed-pos-z'),
      rotX: document.getElementById('ed-rot-x'),
      rotY: document.getElementById('ed-rot-y'),
      rotZ: document.getElementById('ed-rot-z'),
      btnTranslate: document.getElementById('ed-mode-translate'),
      btnRotate: document.getElementById('ed-mode-rotate'),
      btnScale: document.getElementById('ed-mode-scale'),
      btnSnapFloor: document.getElementById('ed-snap-floor'),
      btnSnapTable: document.getElementById('ed-snap-table'),
      btnDuplicate: document.getElementById('ed-btn-duplicate'),
      btnDelete: document.getElementById('ed-btn-delete'),
      btnRevert: document.getElementById('ed-btn-revert'),
      valBadge: document.getElementById('ed-val-badge'),
      valReason: document.getElementById('ed-val-reason'),
      statusMsg: document.getElementById('ed-status-msg')
    };
  }

  _bindEvents() {
    // 1. TransformControls Change & Dragging
    if (this.transformControls) {
      this.transformControls.addEventListener('change', () => {
        if (!this.selectedItem || !this.selectedWrapper) return;
        this.itemManager.updateItemTransform(
          this.selectedItem.id,
          this.selectedWrapper.position,
          this.selectedWrapper.rotation,
          this.selectedWrapper.scale
        );
        this._updateInspector();
      });

      this.transformControls.addEventListener('dragging-changed', (event) => {
        if (!event.value && this.selectedItem) {
          // Finished dragging: if placement is valid, save to lastValidTransforms
          if (this.selectedItem.validation?.isValid) {
            this._saveValidTransform(this.selectedItem);
          }
        }
      });
    }

    // 2. Palette Spawn Buttons
    const paletteButtons = this.overlay.querySelectorAll('.ed-palette-btn');
    paletteButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-type');
        this.spawnFromPalette(type);
      });
    });

    // 3. Gizmo Mode Buttons
    this.ui.btnTranslate.addEventListener('click', () => this.setMode('translate'));
    this.ui.btnRotate.addEventListener('click', () => this.setMode('rotate'));
    this.ui.btnScale.addEventListener('click', () => this.setMode('scale'));

    // 4. Snapping Buttons
    this.ui.btnSnapFloor.addEventListener('click', () => {
      if (this.selectedItem) {
        this.itemManager.snapItemToFloor(this.selectedItem.id);
        this._updateInspector();
        this._setStatus(`Snapped '${this.selectedItem.id}' to floor`);
      }
    });

    this.ui.btnSnapTable.addEventListener('click', () => {
      if (this.selectedItem) {
        this.itemManager.snapItemToTable(this.selectedItem.id);
        this._updateInspector();
        this._setStatus(`Snapped '${this.selectedItem.id}' to table`);
      }
    });

    const tierButtons = this.overlay.querySelectorAll('.ed-tier-btn');
    tierButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.selectedItem) {
          const tier = parseInt(btn.getAttribute('data-tier'), 10) || 1;
          this.itemManager.snapItemToShelfTier(this.selectedItem.id, tier);
          this._updateInspector();
          this._setStatus(`Snapped '${this.selectedItem.id}' to shelf tier ${tier}`);
        }
      });
    });

    // 5. Actions: Duplicate, Delete, Revert
    this.ui.btnDuplicate.addEventListener('click', () => this.duplicateSelected());
    this.ui.btnDelete.addEventListener('click', () => this.deleteSelected());
    this.ui.btnRevert.addEventListener('click', () => this.revertSelected());

    // 6. Manual Transform Inputs
    const onCoordChange = () => {
      if (!this.selectedItem) return;
      const px = parseFloat(this.ui.posX.value) || 0;
      const py = parseFloat(this.ui.posY.value) || 0;
      const pz = parseFloat(this.ui.posZ.value) || 0;
      const rx = (parseFloat(this.ui.rotX.value) || 0) * (Math.PI / 180);
      const ry = (parseFloat(this.ui.rotY.value) || 0) * (Math.PI / 180);
      const rz = (parseFloat(this.ui.rotZ.value) || 0) * (Math.PI / 180);

      this.itemManager.updateItemTransform(this.selectedItem.id, [px, py, pz], [rx, ry, rz]);
      this._updateInspector();
    };
    [this.ui.posX, this.ui.posY, this.ui.posZ, this.ui.rotX, this.ui.rotY, this.ui.rotZ].forEach(input => {
      input.addEventListener('change', onCoordChange);
    });

    // 7. Revision Controls: Refresh, Load, Export
    this.ui.btnRefreshList.addEventListener('click', () => this.fetchIterationsList());
    this.ui.btnLoad.addEventListener('click', () => {
      const selected = this.ui.layoutSelect.value;
      this.loadIteration(selected);
    });
    this.ui.btnExport.addEventListener('click', () => this.exportIteration());
    this.ui.btnClose.addEventListener('click', () => this.close());

    // 8. Canvas Pointer Selection & Orbit Handling
    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousedown', (e) => {
      if (!this.isOpen) return;

      if (e.button === 2) { // Right Click: Orbit Camera
        this.isOrbiting = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        e.preventDefault();
      } else if (e.button === 0) { // Left Click: Raycast Selection
        // If transform controls is being hovered or interacted with, ignore raycasting
        if (this.transformControls && (this.transformControls.dragging || this.transformControls.hovered)) {
          return;
        }

        const rect = canvas.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const hits = this.raycaster.intersectObjects(this.itemManager.container.children, true);

        if (hits.length > 0) {
          // Find root wrapper inside container
          let target = hits[0].object;
          while (target.parent && target.parent !== this.itemManager.container) {
            target = target.parent;
          }
          const item = this.itemManager.items.find(i => i.id === target.name || i.object === target);
          if (item) {
            this.selectItem(item);
          }
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isOpen || !this.isOrbiting) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y -= dx * 0.003;
      this.camera.rotation.x = Math.max(-1.48, Math.min(1.48, this.camera.rotation.x - dy * 0.003));
      if (this.localPlayer) {
        this.localPlayer.yaw = this.camera.rotation.y;
        this.localPlayer.pitch = this.camera.rotation.x;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) {
        this.isOrbiting = false;
      }
    });

    canvas.addEventListener('contextmenu', (e) => {
      if (this.isOpen) e.preventDefault();
    });

    // 9. Editor Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;

      // Ignore when typing in numeric inputs
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
        if (e.code === 'Escape') {
          e.target.blur();
        }
        return;
      }

      if (e.code === 'Escape') {
        this.close();
      } else if (e.code === 'KeyT') {
        this.setMode('translate');
      } else if (e.code === 'KeyR') {
        this.setMode('rotate');
      } else if (e.code === 'KeyS') {
        this.setMode('scale');
      } else if (e.code === 'KeyF') {
        if (this.selectedItem) {
          this.itemManager.snapItemToFloor(this.selectedItem.id);
          this._updateInspector();
        }
      } else if (e.code === 'KeyV') {
        this.revertSelected();
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        this.deleteSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
        e.preventDefault();
        this.duplicateSelected();
      }
    });
  }

  setMode(mode) {
    if (!this.transformControls) return;
    this.transformControls.setMode(mode);
    this.ui.btnTranslate.classList.toggle('active', mode === 'translate');
    this.ui.btnRotate.classList.toggle('active', mode === 'rotate');
    this.ui.btnScale.classList.toggle('active', mode === 'scale');
    this._setStatus(`Gizmo mode: ${mode.toUpperCase()}`);
  }

  selectItem(item) {
    this.selectedItem = item;
    this.selectedWrapper = item.object;

    if (this.transformControls) {
      this.transformControls.attach(item.object);
    }

    if (item.validation?.isValid) {
      this._saveValidTransform(item);
    }

    this._updateInspector();
    this._setStatus(`Selected '${item.id}' (${item.type})`);
  }

  deselect() {
    this.selectedItem = null;
    this.selectedWrapper = null;
    if (this.transformControls) {
      this.transformControls.detach();
    }
    this._updateInspector();
  }

  async spawnFromPalette(type) {
    // Determine spawn position: 2.2 meters in front of the camera, snapped to floor
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    forward.y = 0;
    forward.normalize();

    const spawnPos = new THREE.Vector3().copy(this.camera.position).addScaledVector(forward, 2.2);
    // Snap floor height
    const floorY = this.itemManager.detectFloorHeight(spawnPos.x, spawnPos.z);
    spawnPos.y = floorY;

    // Yaw match camera horizontal orientation
    const yaw = this.camera.rotation.y;

    const newItem = await this.itemManager.addPlacement(type, [spawnPos.x, spawnPos.y, spawnPos.z], [0, yaw, 0]);
    if (newItem) {
      this.selectItem(newItem);
      this._setStatus(`Added new ${newItem.type}: '${newItem.id}'`);
    }
  }

  async duplicateSelected() {
    if (!this.selectedItem) return;
    const newItem = await this.itemManager.duplicatePlacement(this.selectedItem.id);
    if (newItem) {
      this.selectItem(newItem);
      this._setStatus(`Duplicated to '${newItem.id}'`);
    }
  }

  deleteSelected() {
    if (!this.selectedItem) return;
    const id = this.selectedItem.id;
    this.deselect();
    this.itemManager.removePlacement(id);
    this._setStatus(`Deleted '${id}'`);
  }

  revertSelected() {
    if (!this.selectedItem) return;
    const lastValid = this.lastValidTransforms.get(this.selectedItem.id);
    if (lastValid) {
      this.itemManager.updateItemTransform(this.selectedItem.id, lastValid.pos, lastValid.rot, lastValid.scale);
      if (lastValid.anchor) {
        this.selectedItem.anchor = { ...lastValid.anchor };
      }
      this._updateInspector();
      this._setStatus(`Reverted '${this.selectedItem.id}' to last valid position`);
    } else {
      this._setStatus(`No valid transform record for '${this.selectedItem.id}'`);
    }
  }

  _saveValidTransform(item) {
    const obj = item.object;
    this.lastValidTransforms.set(item.id, {
      pos: [obj.position.x, obj.position.y, obj.position.z],
      rot: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
      scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      anchor: item.anchor ? { ...item.anchor } : null
    });
  }

  _updateInspector() {
    if (!this.selectedItem || !this.selectedWrapper) {
      this.ui.propId.textContent = '(None Selected)';
      this.ui.propType.textContent = '-';
      this.ui.propCat.textContent = '-';
      this.ui.posX.value = '';
      this.ui.posY.value = '';
      this.ui.posZ.value = '';
      this.ui.rotX.value = '';
      this.ui.rotY.value = '';
      this.ui.rotZ.value = '';
      this.ui.valBadge.textContent = 'NO SELECTION';
      this.ui.valBadge.style.background = 'rgba(100, 100, 100, 0.2)';
      this.ui.valBadge.style.borderColor = '#666';
      this.ui.valBadge.style.color = '#888';
      this.ui.valReason.textContent = 'Select an object to inspect clearance & support.';
      return;
    }

    const item = this.selectedItem;
    const obj = this.selectedWrapper;

    this.ui.propId.textContent = item.id;
    this.ui.propType.textContent = item.type;
    this.ui.propCat.textContent = item.category || 'item';

    this.ui.posX.value = obj.position.x.toFixed(3);
    this.ui.posY.value = obj.position.y.toFixed(3);
    this.ui.posZ.value = obj.position.z.toFixed(3);

    this.ui.rotX.value = ((obj.rotation.x * 180) / Math.PI).toFixed(1);
    this.ui.rotY.value = ((obj.rotation.y * 180) / Math.PI).toFixed(1);
    this.ui.rotZ.value = ((obj.rotation.z * 180) / Math.PI).toFixed(1);

    const val = item.validation || { isValid: true };
    if (val.isValid) {
      this.ui.valBadge.textContent = 'VALID PLACEMENT';
      this.ui.valBadge.style.background = 'rgba(0, 255, 136, 0.15)';
      this.ui.valBadge.style.borderColor = '#00ff88';
      this.ui.valBadge.style.color = '#00ff88';
      this.ui.valReason.textContent = 'Surface contact & boundary clearances confirmed.';
    } else {
      this.ui.valBadge.textContent = 'INVALID PLACEMENT';
      this.ui.valBadge.style.background = 'rgba(255, 34, 68, 0.25)';
      this.ui.valBadge.style.borderColor = '#ff2244';
      this.ui.valBadge.style.color = '#ff4466';
      this.ui.valReason.textContent = val.failureReason || 'Collision or boundary violation detected!';
    }
  }

  _setStatus(msg) {
    if (this.ui.statusMsg) {
      this.ui.statusMsg.textContent = msg;
    }
  }

  async fetchIterationsList() {
    try {
      const res = await fetch('/api/developer/world-layout/list');
      if (!res.ok) {
        console.warn('[WorldEditor] Could not fetch layout iterations:', res.status);
        return;
      }
      const data = await res.json();
      this.ui.layoutSelect.innerHTML = '<option value="default">Default (world_items.json)</option>';

      if (Array.isArray(data.iterations)) {
        data.iterations.forEach(iter => {
          const opt = document.createElement('option');
          opt.value = iter.filename;
          opt.textContent = `Iteration ${String(iter.iteration).padStart(4, '0')} (${(iter.size / 1024).toFixed(1)} KB)`;
          if (data.latest === iter.filename) {
            opt.textContent += ' [Latest]';
            opt.selected = true;
          }
          this.ui.layoutSelect.appendChild(opt);
        });
      }
      this._setStatus(`Loaded ${data.iterations?.length || 0} layout revisions`);
    } catch (err) {
      console.warn('[WorldEditor] Error fetching iteration list:', err);
    }
  }

  async loadIteration(filename) {
    try {
      this.deselect();
      let url = '/api/developer/world-layout/load';
      if (filename && filename !== 'default') {
        url += `?file=${encodeURIComponent(filename)}`;
      }
      this._setStatus(`Loading layout '${filename}'...`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const layoutData = await res.json();
      await this.itemManager.loadWorldItems(layoutData);
      this.itemManager.setDebugVisuals(true);
      this._setStatus(`Successfully loaded '${filename}' (${this.itemManager.items.length} items)`);
    } catch (err) {
      console.error('[WorldEditor] Failed to load layout:', err);
      this._setStatus(`Error loading layout: ${err.message}`);
    }
  }

  async exportIteration() {
    try {
      const exportDoc = this.itemManager.exportLayoutData(
        `Visual placement layout via Editor at ${new Date().toLocaleTimeString()}`,
        'developer'
      );
      this._setStatus('Exporting layout iteration...');

      const res = await fetch('/api/developer/world-layout/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportDoc)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const result = await res.json();
      this._setStatus(`Exported ${result.filename} (${result.itemCount} items)`);
      await this.fetchIterationsList();
      this.ui.layoutSelect.value = result.filename;
    } catch (err) {
      console.error('[WorldEditor] Export error:', err);
      this._setStatus(`Export failed: ${err.message}`);
    }
  }

  open() {
    this.isOpen = true;
    this.overlay.style.display = 'block';

    if (this.localPlayer) {
      this.localPlayer.setEditorActive(true);
    }

    if (this.transformControls && !this.transformControls.parent) {
      this.scene.add(this.transformControls);
    }

    this.itemManager.setDebugVisuals(true);
    this.fetchIterationsList();
    this._setStatus('Editor Active. Left-click to select, Right-drag to orbit.');
  }

  close() {
    this.isOpen = false;
    this.overlay.style.display = 'none';
    this.deselect();

    if (this.transformControls && this.transformControls.parent) {
      this.scene.remove(this.transformControls);
    }

    if (this.localPlayer) {
      this.localPlayer.setEditorActive(false);
    }
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
}
