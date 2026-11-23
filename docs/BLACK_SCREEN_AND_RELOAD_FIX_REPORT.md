# Saber Killer — Black Screen & Weapon Reload Bugfix Report

## 1. Executive Summary

This report documents the diagnosis, root causes, surgical fixes, and end-to-end verification for two critical issues observed following commit `57f4936`:
1. **Black Screen in Multiplayer Survival Mode**: The 3D Level 0 Backrooms environment failed to render (displaying pure black canvas), while the DOM HUD remained visible.
2. **Persistent Weapon Reload State**: After firing the first shot, the pistol appeared stuck with the HUD displaying `RELOADING...` alongside `11 / 36` ammunition and was unable to discharge further.

Both issues were traced to initialization and render loop halts that prevented `renderer.render()` from executing and stopped `player.update(dt)` from ticking cooldown and reload countdowns.

---

## 2. Root Cause Analysis

### 2.1 The Black Screen Root Causes

Diagnostic inspection using Chrome DevTools Protocol (CDP) capturing console errors and WebGL renderer telemetry revealed two fatal exceptions:

#### A. Sprite Raycasting Dereference Crash in `WorldItemManager.detectFloorHeight`
- **Mechanism**: In commit `57f4936`, an authentic procedural muzzle flash billboard sprite (`THREE.Sprite`) was attached to the player's weapon viewmodel group (`gunGroup`), which resides within `camera`, which resides within `scene.children`.
- During `init()`, `itemManager.loadWorldItems()` is invoked to place world items and props from `assets/data/world_items.json`. For items requiring floor alignment (`snapToFloor: true`), `itemManager.detectFloorHeight()` executed:
  ```javascript
  const hits = this.raycaster.intersectObjects(this.scene.children, true);
  ```
- In Three.js, `Sprite.prototype.raycast` requires `raycaster.camera` to project coordinates. Because `itemManager.raycaster.camera` was uninitialized (`null`), Three.js logged:
  `THREE.Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.`
  and immediately threw an unhandled exception:
  `TypeError: Cannot read properties of null (reading 'matrixWorld')`.
- This unhandled rejection aborted `init()` at line 387/391, preventing execution from reaching line 504 (`requestAnimationFrame(loop)`). The render loop was never started (`renderer.info.render.frame == 0`), leaving the 3D canvas black.

#### B. Variable Scope ReferenceError in `main.js` Render Loop
- **Mechanism**: In `main.js`, `devToolsEnabled` was declared locally inside `async function init()`:
  ```javascript
  const devToolsEnabled = await checkDevToolsConfig();
  ```
- In `loop(timestamp)`, line 1765 attempted to check:
  ```javascript
  if (devToolsEnabled && mpManager?.localPlayer) { ... }
  ```
- Because `loop()` is declared at module scope outside `init()`, accessing `devToolsEnabled` threw:
  `ReferenceError: devToolsEnabled is not defined`.
- In standard module scripts, uncaught ReferenceErrors inside a frame callback prevent `renderScene()` (line 1789) from ever being reached, immediately freezing the rendering loop.

---

### 2.2 The Weapon Reload State Root Cause

- When `loop()` failed to run:
  - `mpManager.update(dt)` was never called.
  - `localPlayer.update(dt)` was never called.
- When the player discharged the first shot with LMB:
  - `mag.bullets` decremented from 12 to 11.
  - `cool` was set to 0.21s.
- When the player attempted a second shot immediately, `if (this.cool > 0)` rejected the click with `COOLDOWN_ACTIVE (0.21s)`. Because `update(dt)` was halted, `this.cool` never decayed.
- When the player subsequently pressed `R` to reload:
  - `startReload()` accepted the request (`needed = 12 - 11 = 1 > 0`).
  - `this.reloadT` was set to 1.15s and `this.reloadWeapon = 0`.
  - `SanityHUD` updated to display `this.resourceLabel.textContent = 'Reloading...'` with `11 / 36`.
  - Because `update(dt)` was completely halted, `this.reloadT` remained permanently at `1.15s`, leaving the HUD frozen on `Reloading...` and all future shots rejected with `RELOAD_IN_PROGRESS`.

---

## 3. Surgical Fix Implementation

### 3.1 Bypass Sprite Raycasting (`js/multiplayer/player_controller.js`)
- Overrode the raycast method on `this.muzzleSprite`:
  ```javascript
  this.muzzleSprite.raycast = () => {}; // Ephemeral billboard flash; bypass Raycaster camera requirement
  ```
  This ensures no scene-wide raycasting (floor detection, item targeting, interaction) attempts to project or intersect the ephemeral muzzle flash sprite.

### 3.2 Defensive Camera Fallback (`js/multiplayer/item_manager.js`)
- Added defensive assignment in `detectFloorHeight`:
  ```javascript
  if (!this.raycaster.camera && window.camera) {
    this.raycaster.camera = window.camera;
  }
  ```

### 3.3 Module Scope for Developer Flags (`js/multiplayer/main.js`)
- Declared `let devToolsEnabled = false;` at the top level of `main.js`.
- Replaced `const devToolsEnabled = await checkDevToolsConfig();` in `init()` with module assignment `devToolsEnabled = await checkDevToolsConfig();`.
- Guaranteed that `loop()` safely accesses `devToolsEnabled` on every frame without throwing `ReferenceError`.

---

## 4. Verification & Automated Test Results

Automated headless Chromium testing across both server operating modes confirmed complete resolution:

### 4.1 Normal Gameplay Mode (No `--dev-rendering`)
- **Environment Rendering**: Level 0 loaded and rendered continuously (`renderer.info.render.frame > 400`).
- **Dev Overlay**: `#dev-weapon-hud-diag` was completely pruned from DOM.
- **Repeated Firing**:
  - Shot 1: Fired, mag `11 / 36`, cool set to `0.21s`.
  - 300ms delay: Cooldown expired naturally via `loop()`.
  - Shot 2: Fired, mag `10 / 36`, cool set to `0.21s`.
  - 300ms delay: Cooldown expired naturally via `loop()`.
  - Shot 3: Fired, mag `9 / 36`, cool set to `0.21s`.
- **Manual Reload (`R`)**:
  - `startReload()` initiated, `reloadT = 1.15s`, HUD label displayed `Reloading...`.
  - 1300ms delay: Countdown ticked to 0, ammunition transferred (mag 12, reserve 33).
  - HUD label cleanly reverted from `Reloading...` to `Pistol`.
  - Next shot fired immediately with mag decremented to 11.
- **Screenshot Evidence**: [`normal_mode_level0_fixed.png`](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/normal_mode_level0_fixed.png).

### 4.2 Developer Mode (`--dev-rendering`)
- **Environment Rendering**: Level 0 loaded with developer revision `iteration_0007.json` (`frame > 380`).
- **Dev HUD Badge**: `#dev-weapon-hud-diag` visible at `bottom: 94px; left: 20px` reflecting real-time diagnostics.
- **Shotgun Mechanics**: Switched to shotgun (slot 1), fired repeatedly with 0.95s cooldown enforcement.
- **Screenshot Evidence**: [`dev_mode_level0_fixed.png`](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/dev_mode_level0_fixed.png).

### 4.3 Multiplayer Regression Suites
- `scratch/verify_weapon_firing.js`: All 13 steps passed with 100% success rate.
- `scratch/verify_tab_and_hotbar_correction.js`: All 15 criteria passed with 100% success rate.

---

## 5. Modified Files & Safety

- `js/multiplayer/player_controller.js`: Line 256 (`this.muzzleSprite.raycast = () => {};`).
- `js/multiplayer/item_manager.js`: Lines 235-237 (`if (!this.raycaster.camera && window.camera) this.raycaster.camera = window.camera;`).
- `js/multiplayer/main.js`: Line 35 (`let devToolsEnabled = false;`) and Line 228 (`devToolsEnabled = await checkDevToolsConfig();`).
- **Story Mode Isolation**: Exact 0-line diff against `master` across all single-player files (`index.html`, `js/engine.js`, `js/levels/level0.js`, `js/levels/level0_env.js`).
