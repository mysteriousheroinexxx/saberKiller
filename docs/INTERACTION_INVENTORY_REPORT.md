# Saber Killer — Full Player Inventory & Hotbar Implementation Report

## 1. Executive Summary

This milestone completes the player-facing inventory experience for multiplayer Survival Mode on Level 0 in Saber Killer, featuring focused UI and input corrections:
- **Tab Key Inventory Opening & Input Control**: Resolved the critical bug where pressing `Tab` released pointer lock without making the inventory visible. Tab now reliably toggles the full 30-slot modal (`display: flex`), frees the pointer, clears held keys, suppresses WASD movement and weapon discharge, keeps the multiplayer simulation ticking at 20Hz, and restores controls upon closing.
- **Permanent Gameplay Hotbar Removed**: The 10-slot bar has been completely removed from the normal gameplay HUD. No permanent item bar or selected-item box clutters the screen. The authentic Health, Sanity, Ammo, and Stamina gauges remain untouched and fully visible.
- **Ten-Slot Quick-Access Row Inside Inventory**: The 10 quick-access slots (`1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`, `0`) are displayed exclusively inside the full inventory interface opened with `Tab`.
- **Drag-and-Drop Organization & Stack Merging**: Players can drag items from backpack storage into quick-access slots, move between hotbar slots, swap occupied slots, and move items back into storage. Compatible stacks merge seamlessly, and slot changes synchronize authoritatively to the server via `INVENTORY_SWAP_REQUEST`.
- **Dynamic Quick-Access Item Selection**: During active gameplay, pressing keys `1`–`9` and `0` dynamically equips whatever item is assigned to that quick-access slot. Beretta pistol (slot 1), Stagecoach shotgun (slot 2), and tactical flashlight (slot 3) function immediately from spawn, and moving or assigning consumables into hotbar slots enables left-click consumption and right-click dropping.
- **Two-Client Multiplayer Verification**: Tested and passed across 15 focused Tab & hotbar acceptance criteria and 21 regression scenarios using concurrent headless Chromium instances.
- **Zero Story Mode Regression**: Single-player Story Mode files (`index.html`, `js/engine.js`, `js/levels/level0.js`, `js/levels/level0_env.js`) maintain a strict 0-line diff against `master`.

---

## 2. Root Cause Analysis — Tab Key Investigation

### 2.1 The Issue
- When the player pressed `Tab` during active pointer lock, pointer lock was released, but the inventory modal did NOT appear.

### 2.2 Diagnostic Findings
1. **Competing Window Capture Listeners**:
   - Both `PlayerController._onKeyDown` and `InventoryUI._bindEvents` registered independent capture-phase `keydown` listeners on `window` listening for `e.code === 'Tab'`.
   - When `Tab` was pressed:
     1. `PlayerController`'s listener fired first and called `window.inventoryUI.toggle()`.
     2. `toggle()` saw `isOpen === false` and opened the modal (`isOpen = true`, `style.display = 'flex'`, called `document.exitPointerLock()`).
     3. Immediately afterward within the same event dispatch on `window`, `InventoryUI`'s listener fired and called `this.toggle()`.
     4. `toggle()` saw `isOpen === true` and closed the modal (`isOpen = false`, `style.display = 'none'`)!
     5. The modal was opened and closed in microseconds during the single keypress.
2. **Missing Repeat Guard**: Neither listener checked `e.repeat`, causing rapid toggling if Tab was held even momentarily.
3. **Missing Immediate Propagation Stop**: `e.stopPropagation()` does not cancel other listeners attached to the same DOM target (`window`); `e.stopImmediatePropagation()` was required.

### 2.3 The Correction
- Redundant `Tab` handling was eliminated from `PlayerController`.
- `InventoryUI._bindEvents` now serves as the sole, authoritative handler:
  ```javascript
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
  }, { capture: true });
  ```
- When `open()` executes:
  - Sets `isOpen = true` and `inventoryModalEl.style.display = 'flex'`.
  - Sets `player.isInventoryOpen = true` and clears `player.keys = {}`.
  - Calls `document.exitPointerLock()`.
  - Suppresses movement, firing, and reloading inside `PlayerController` (`fire()`, `startReload()`, `consumeHeldItem()`, `dropHeldItem()`).
- When `close()` executes:
  - Sets `isOpen = false` and `inventoryModalEl.style.display = 'none'`.
  - Sets `player.isInventoryOpen = false`.
  - Restores normal gameplay input; clicking the canvas re-acquires pointer lock.

---

## 3. UI Component System & Input Scheme

### 3.1 Clean Gameplay HUD (Permanent Hotbar Removed)
- `#bb-hotbar-container` has been completely removed from the gameplay DOM and CSS.
- The gameplay screen presents an uncluttered, atmospheric view with only:
  - Room info & player count header.
  - Centered crosshair.
  - Health & Sanity bars (top left).
  - Tactical flashlight battery / ammo counter (lower right).
  - Stamina gauge (bottom center, resting naturally at `bottom: 7px`).

### 3.2 Full Inventory Modal (`Tab` / `Escape`)
- **Container**: Translucent fullscreen overlay (`rgba(8, 8, 7, 0.72)`) hosting a centered modal window (`rgba(18, 18, 16, 0.96)`, border `#3a3832`).
- **Upper Section**: Quick-Access Hotbar row (10 slots, labeled `1`–`9`, `0`).
  - Slots display keycap badges, icons, stack quantity badges, and an `EQUIPPED` badge on the currently held slot.
- **Lower Section**: Backpack Storage grid (20 slots, indices `10`–`29`).
- **Right Panel**: Contextual Item Inspection Inspector displaying icon preview, item name, category badge, lore narrative, consumable stat effects, and direct action buttons.

### 3.3 Drag-and-Drop & Slot Reorganization
- Every grid slot supports native HTML5 Drag & Drop (`dragstart`, `dragover`, `dragleave`, `drop`, `dragend`).
- Visual feedback: dragging slot becomes translucent with dashed gold outline (`.dragging`); hovered destination slot highlights cyan with glow (`.drag-over`).
- Supported operations:
  - Storage $\to$ Quick-Access (assigning item for number-key use).
  - Quick-Access $\to$ Quick-Access (reordering loadout).
  - Quick-Access $\to$ Storage (storing items).
  - Storage $\to$ Storage (organizing backpack).
  - Compatible stack merging up to `maxStack`.
- Authoritative synchronization: slot moves trigger `INVENTORY_SWAP_REQUEST` to the server, ensuring client and server inventories match identically.

### 3.4 Key & Mouse Input Scheme

| Input | Normal Gameplay | Full Inventory Open (`Tab`) |
| :--- | :--- | :--- |
| `Tab` | Open Full Inventory Modal | Close Full Inventory Modal |
| `Escape` | Release pointer lock / Menu | Close Full Inventory Modal |
| `Keys 1`–`9`, `0` | Select assigned quick-access slot | Assign selected item to slot `1`–`0` |
| `Left Click` | Fire weapon / Consume held item | Select slot / Drag item / Click actions |
| `Right Click` | Drop 1 unit of held item into world | Open contextual item menu |
| `WASD` | Normal FPS Player Movement | Suppressed (movement locked) |
| `Mouse Look` | First-Person Camera Control | Pointer freed for UI interaction |

---

## 4. Item Definitions & Quick-Access Assignments

| Item ID | Display Name | Category | Stack | Effect / Resource Restored |
| :--- | :--- | :--- | :---: | :--- |
| `weapon_pistol` | Beretta Px4 Storm | `weapon` | 1 | 9mm Semi-Automatic Pistol (12-round mag). |
| `weapon_shotgun` | Stagecoach Shotgun | `weapon` | 1 | Double-barrel break-action shotgun (2 shells). |
| `equipment_torch`| Tactical Flashlight | `equipment`| 1 | High-intensity spotlight; consumes battery over time. |
| `first_aid` | First Aid Kit | `medical` | 1 | Restores $+50\text{ HP}$ (up to $100\text{ HP}$ maximum). |
| `almond_can` | Almond Water | `consumable`| 4 | Restores $+35\text{ Sanity}$ and $+50\text{ Hydration}$. |
| `sanity_pill` | Sanity Pills | `medical` | 4 | Restores $+60\text{ Sanity}$. |
| `energy_drink` | Energy Drink | `consumable`| 4 | $+100\text{ Stamina}$ and $+25\%\text{ Sprint Speed}$ for $15\text{s}$. |
| `aa_battery` | Battery Pack | `equipment`| 8 | Restores $+50\%\text{ Flashlight Battery Charge}$. |
| `ammo_box` | Ammunition Box | `consumable`| 4 | Restores $+12\text{ Pistol Rounds}$. |
| `doorKey` | Level 0 Keycard | `key` | 1 | Authoritative Level 0 security clearance. |

---

## 5. Verification Results

### 5.1 Focused Tab & Hotbar Correction Suite (`scratch/verify_tab_and_hotbar_correction.js`)

| # | Acceptance Criterion | Observed Result | Status |
| :-: | :--- | :--- | :---: |
| **1** | Start multiplayer and enter a room | Client A & Client B connected to `CORRECTROOM`. | **PASS** |
| **2** | Press Tab while pointer-locked | Pointer lock released without consuming event. | **PASS** |
| **3** | Confirm inventory visibly opens | Modal display transitioned to `flex`, `isOpen=true`. | **PASS** |
| **4** | Confirm pointer lock is released | `document.exitPointerLock()` executed cleanly. | **PASS** |
| **5** | Suppress WASD and weapon firing | Movement keys ignored; `fire()` returned `false`. | **PASS** |
| **6** | Confirm world continues running | 20Hz network sync and room simulation active. | **PASS** |
| **7** | Confirm 10-slot row inside inventory | 10 slots labeled `1`–`9`, `0` rendered in modal. | **PASS** |
| **8** | Drag item from storage into slot 4 | Almond Water dragged from slot 10 to slot 3. | **PASS** |
| **9** | Close inventory | Tab cleanly closed modal (`display: none`). | **PASS** |
| **10** | Confirm no permanent hotbar on HUD | `#bb-hotbar-container` is `null` on gameplay HUD. | **PASS** |
| **11** | Press 4 and confirm assigned item selected | Slot 3 selected; Almond Water held in hand. | **PASS** |
| **12** | Verify keys 1, 2, 3 control weapons/torch | Keys 1, 2, 3 activate pistol, shotgun, flashlight. | **PASS** |
| **13** | Reopen inventory and verify persistence | Slot 3 retains Almond Water upon reopening. | **PASS** |
| **14** | Test closing with Escape and Tab | Escape closes modal; Tab reopens and toggles. | **PASS** |
| **15** | Individual client state isolation | Client A and Client B maintain independent inventories. | **PASS** |

### 5.2 Full Regression Suite (`scratch/verify_inventory_hotbar.js`)
All 21 end-to-end scenarios (item pickup, simultaneous world despawn, item consumption, stack merging, physical world drop spawning, peer pickup of dropped items, invalid drop rejection, weapon ammo tracking, flashlight battery consumption, and screenshot generation) passed with exit code 0.

---

## 6. Generated Visual Artifacts

1. [inventory_01_gameplay_hotbar.png](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/inventory_01_gameplay_hotbar.png):
   Clean gameplay HUD showing removal of the permanent hotbar container while maintaining health, ammo, and stamina bars.
2. [inventory_02_full_inventory_modal.png](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/inventory_02_full_inventory_modal.png):
   Full inventory modal opened with `Tab`, showing the 10 quick-access hotbar slots in the top row and 20 storage slots below.
3. [inventory_03_item_inspection_details.png](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/inventory_03_item_inspection_details.png):
   Selected item inspection details panel showing Almond Water assigned into quick-access slot 4.
4. [inventory_04_context_menu_and_drop_modal.png](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/inventory_04_context_menu_and_drop_modal.png):
   Drop quantity selector modal displaying clamped numeric input.
5. [inventory_05_dropped_world_item_sync.png](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/inventory_05_dropped_world_item_sync.png):
   Synchronized 3D rendering of physical dropped item in world.

---

## 7. Scope Isolation & Git Verification

- **Story Mode Files**:
  - `index.html`: **0 diff lines**
  - `js/engine.js`: **0 diff lines**
  - `js/levels/level0.js`: **0 diff lines**
  - `js/levels/level0_env.js`: **0 diff lines**
- **Preserved Untracked Research**:
  - `docs/SABER_AI_IMPLEMENTATION_BRIEF.md`
  - `docs/SABER_AI_VALIDATION_REPORT.md`
  - `saber_eval.html`
  - `saber_prototype/`
  - `yuka/`
- **Branch**: `feature/interaction-inventory-foundation`
