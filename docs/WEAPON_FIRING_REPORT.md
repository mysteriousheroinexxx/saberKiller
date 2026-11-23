# Saber Killer — Phase 1: Weapon Firing Restoration Report

## 1. Executive Summary

This report documents the restoration and validation of player weapon firing (Beretta Px4 pistol and Stagecoach coach gun) in Saber Killer multiplayer Survival Mode on Level 0 (`feature/interaction-inventory-foundation` branch).

Prior to this phase, weapon discharge was non-functional or imperceptible due to lack of visual/lighting feedback, unhandled pointer-lock states after inventory interaction, asynchronous HUD display lag, and reload priority checks.

All firing mechanics, ammunition bookkeeping, reload cycles, visual effects (point light + billboard sprite muzzle flashes, weapon recoil kick, camera pitch kick), input suppression, and developer diagnostics have been restored to full functionality matching single-player canon (`js/engine.js`), without altering Story Mode or breaking existing inventory, pickup, or multiplayer synchronisation.

### Core Deliverables
- **Beretta Px4 Pistol (Slot 1)**: Fires with LMB at 0.21s cooldown, consumes 1 bullet per shot, stops when magazine empty, triggers auto-reload, reloads manually with `R`, tracks `12 / 36` ammo, authentic amber muzzle flash (`0xffb040`, 11m radius, 45ms duration) and billboard sprite at `(0, 0.08, -0.36)`, gun recoil kick (`-0.04m`), and camera pitch kick (`+0.016 rad`).
- **Stagecoach Shotgun (Slot 2)**: Fires with LMB at 0.95s cooldown, consumes 1 shell per shot, stops when magazine empty, triggers auto-reload, reloads manually with `R`, tracks `6 / 2` ammo, authentic amber muzzle flash (`0xffb040`, 11m radius, 45ms duration) and billboard sprite at `(0, 0.02, -0.44)`, gun recoil kick (`-0.09m`), and camera pitch kick (`+0.038 rad`).
- **Ammunition & Reload Integrity**: Magazine and reserve ammo are tracked strictly without loss or duplication across weapon switching (`1` <-> `2` <-> `3`), never become negative, and immediately update the gameplay HUD (`SanityHUD`).
- **Strict Input Suppression**: Firing and reloading are suppressed while the inventory modal (`Tab`) is open, when downed/dead (`hp <= 0` or `isDowned/isDead`), inside the Level 0 visual placement editor, or when pointer lock is unengaged. Weapon controls resume immediately upon closing the inventory.
- **Multiplayer Independence**: Two concurrent clients fire independently without cross-contaminating ammunition counters, viewmodels, or reload timers.
- **Developer HUD Diagnostics (`--dev-rendering`)**: Real-time diagnostic badge (`#dev-weapon-hud-diag`) displays weapon index, mag/reserve ammo, cooldown timer, reload state, last input, and rejection reason. Completely pruned from the DOM in normal gameplay mode.
- **Zero Story Mode Regression**: 0-line diff against `master` across all single-player Story Mode files (`index.html`, `js/engine.js`, `js/levels/level0.js`, `js/levels/level0_env.js`).

---

## 2. Root Cause Analysis of Firing Failure

Investigation into `js/multiplayer/player_controller.js`, `main.js`, and `mp_manager.js` revealed four interconnected root causes:

### 2.1 Lack of Visual and Sensory Feedback (Imperceptible Firing)
- In single-player Story Mode (`js/engine.js`), weapon firing triggers a dynamic `THREE.PointLight` (`0xffb040`, intensity 11) and a procedural billboard sprite muzzle flash with radial gradient falloff, plus gun recoil displacement and camera pitch kick.
- In `player_controller.js`, firing merely decremented numerical ammo properties and set a cooldown timer. There was no muzzle light, no flash sprite, no weapon recoil animation, and no camera pitch kick. Viewmodels remained completely static, giving the impression that clicking LMB did nothing.

### 2.2 Pointer Lock State Post-Inventory Closure
- After closing the inventory modal (`Tab` or `Escape`), browser pointer lock is exited.
- The `_onMouseDown` handler in `player_controller.js` checked `if (this.pointerLocked) this.fire()`. When pointer lock was lost, clicking LMB had no effect and logged no diagnostic reason, leaving the user unaware of why firing was rejected until re-clicking the canvas to acquire lock.

### 2.3 Unsynchronized HUD Update Loop
- Ammo readout on `SanityHUD` previously relied solely on the `requestAnimationFrame` loop without event-driven notifications. When firing or reloading rapidly, HUD state updates lagged behind actual controller state, failing to visibly reflect bullet consumption or reload progress.

### 2.4 Reload Priority Ordering in Firing Check
- In `fire()`, the cooldown timer check (`if (this.cool > 0) return`) preceded the reload state check (`if (this.reloadT > 0) return`). If a player attempted to fire while reloading, the rejection reported `COOLDOWN_ACTIVE` rather than `RELOAD_IN_PROGRESS`.

### 2.5 Dev Overlay DOM Cleanup Timing
- Under normal gameplay (without `--dev-rendering`), developer overlays were originally cleaned up late in `init()` after level geometry loading, allowing an intermittent race condition where test runners detected unpruned dev badges.

---

## 3. Technical Implementation & Restoration

### 3.1 Muzzle Flash & Visual Effects (`player_controller.js`)
- **Point Light**: Created `THREE.PointLight(0xffb040, 0, 11, 2)` attached to `this.gunGroup`.
- **Billboard Sprite**: Created procedural radial gradient texture canvas with amber-white core (`rgba(255, 240, 180, 1)` -> `rgba(255, 176, 64, 0.8)` -> `rgba(255, 120, 20, 0)`) attached to `this.gunGroup`.
- **Muzzle Coordinates**:
  - Pistol: `(0, 0.08, -0.36)`
  - Shotgun: `(0, 0.02, -0.44)`
- **Duration**: Timed flash of 45ms per shot via `_triggerMuzzleFlash(weaponIdx)`.
- **Recoil Kick & Pitch Recovery**:
  - Pistol: `this.recoilKick = 0.04m`, `this.pitch += 0.016 rad`.
  - Shotgun: `this.recoilKick = 0.09m`, `this.pitch += 0.038 rad`.
  - In `update(dt)`: `this.recoilKick = Math.max(0, this.recoilKick - dt * 0.45)`. Gun group position incorporates `this.recoilKick` along Z-axis.

### 3.2 Ammunition State & Reload Lifecycle
- **Pistol (Beretta Px4)**:
  - Magazine capacity: 12. Reserve start: 36.
  - Cooldown: 0.21s (`COOLDOWNS[0]`).
  - Reload duration: 1.5s (`RELOAD_TIMES[0]`).
- **Shotgun (Stagecoach)**:
  - Magazine capacity: 6. Reserve start: 2.
  - Cooldown: 0.95s (`COOLDOWNS[1]`).
  - Reload duration: 2.2s (`RELOAD_TIMES[1]`).
- **Auto-Reload**: Automatically triggers when the last bullet/shell in a magazine is fired and reserve ammo is available (`> 0`).
- **Manual Reload (`R` / `KeyR`)**: Triggered at any time if magazine is below capacity and reserve ammo is available.
- **HUD Synchronization**: Direct calls to `this.hud?.updatePlayer(this)` on firing and reload transitions ensure zero-latency UI updates. `SanityHUD` displays `Reloading...` during active reload.

### 3.3 Input Suppression & Safety Checks
`fire()` and `startReload()` enforce the following guards with diagnostic reasons:
1. `DOWNED_OR_DEAD`: If `this.isDead || this.isDowned || this.hp <= 0`.
2. `EDITOR_ACTIVE`: If `window.worldEditor?.active`.
3. `INVENTORY_OPEN`: If `window.inventoryUI?.isOpen`.
4. `NO_POINTER_LOCK`: If `!this.pointerLocked`.
5. `RELOAD_IN_PROGRESS`: If `this.reloadT > 0`.
6. `COOLDOWN_ACTIVE`: If `this.cool > 0`.
7. `MAGAZINE_EMPTY`: If magazine ammo is 0.
8. `MAGAZINE_FULL` / `NO_RESERVE_AMMO`: For manual reload.

### 3.4 Developer HUD Diagnostics (`--dev-rendering`)
- Created `#dev-weapon-hud-diag` in `multiplayer.html` positioned at `bottom: 94px; left: 20px`.
- Real-time display of:
  - `WEAPON`: Selected weapon name and index (e.g., `PISTOL (0)`, `SHOTGUN (1)`, `FLASHLIGHT (2)`).
  - `AMMO`: `[mag] / [reserve]`.
  - `COOLDOWN`: Remaining cooldown time formatted to 2 decimals.
  - `RELOAD`: Reload state (`IDLE` or `RELOADING (X.XXs)`).
  - `LAST INPUT`: Source of last firing attempt (`LMB`, `KEY_E`, etc.).
  - `REJECTION`: Rejection reason code (`NONE`, `NO_POINTER_LOCK`, `COOLDOWN_ACTIVE`, `RELOAD_IN_PROGRESS`, `MAGAZINE_EMPTY`, `INVENTORY_OPEN`, etc.).
- Pruned cleanly from DOM on startup when `--dev-rendering` is not supplied.

---

## 4. Verification & Automated Test Results

An automated end-to-end verification suite (`scratch/verify_weapon_firing.js`) was executed across developer and normal server modes, using concurrent Chromium instances communicating via Chrome DevTools Protocol (CDP).

### 4.1 Step-by-Step Test Results (13/13 Passed)

| Step | Test Description | Expected Result | Status |
| :--- | :--- | :--- | :--- |
| **Step 1** | Launch server (`--dev-rendering`) and join room with two clients | Both clients spawn in room `TEST_WEAPON_DEV` | **PASS** |
| **Step 2** | Inspect initial loadout and developer diagnostics | Pistol equipped (slot 0), ammo `12 / 36`, HUD badge visible | **PASS** |
| **Step 3** | LMB Firing (Pistol) — visual effects & ammo decrement | Bullet consumed (`11 / 36`), cooldown active (`0.21s`), muzzle flash point light intensity > 0, sprite visible | **PASS** |
| **Step 4** | Pistol Cooldown & Rapid Click Enforcement | Rapid clicks within 0.21s rejected with `COOLDOWN_ACTIVE`, ammo remains 11 | **PASS** |
| **Step 5** | Pistol Manual Reload (`R`) | Pressing `R` starts 1.5s reload; mag restored to 12, reserve decremented to 35 | **PASS** |
| **Step 6** | Weapon Switching to Shotgun (`2`) | Viewmodel switches to coach gun; HUD and dev diag show Shotgun (slot 1), ammo `6 / 2` | **PASS** |
| **Step 7** | Shotgun LMB Firing — visual effects & ammo decrement | Shell consumed (`5 / 2`), cooldown active (`0.95s`), muzzle flash active, recoil kick applied | **PASS** |
| **Step 8** | Shotgun Cooldown Enforcement | Rapid clicks within 0.95s rejected with `COOLDOWN_ACTIVE`, ammo remains 5 | **PASS** |
| **Step 9** | Weapon Switching Persistence (`1` <-> `2` <-> `3`) | Pistol keeps `12 / 35`, Shotgun keeps `5 / 2`, Flashlight shows no ammo | **PASS** |
| **Step 10** | Input Suppression — Inventory Open (`Tab`) | Opening inventory suppresses LMB firing (`INVENTORY_OPEN`); ammo does not change | **PASS** |
| **Step 11** | Input Restoration — Inventory Closed (`Tab`) | Closing inventory and re-locking pointer restores immediate firing | **PASS** |
| **Step 12** | Multiplayer Independence (Client A vs Client B) | Client A fires pistol; Client B ammo (`12 / 36`) and viewmodel unaffected | **PASS** |
| **Step 13** | Normal Mode Verification (no `--dev-rendering`) | `#dev-weapon-hud-diag` is completely removed from DOM; firing works normally | **PASS** |

### 4.2 Visual Artifacts Generated

1. `pistol_firing_muzzle_flash.png`: Demonstrates Beretta Px4 discharge with amber muzzle light, procedural billboard sprite, and HUD ammo readout.
2. `shotgun_firing_muzzle_flash.png`: Demonstrates Stagecoach coach gun discharge with large muzzle light, sprite flash, and recoil displacement.
3. `dev_weapon_firing_diagnostics.png`: Captures `#dev-weapon-hud-diag` in active gameplay displaying real-time weapon, ammo, cooldown, and rejection telemetry.
4. `normal_mode_weapon_firing.png`: Confirms normal gameplay HUD with `#dev-weapon-hud-diag` completely absent from the DOM.

---

## 5. Modified Files & Git Safety

### Modified Tracked Files
- `js/multiplayer/player_controller.js`: Added muzzle flash light/sprite, recoil kick, firing diagnostics, cooldown/reload guards, keybindings, and event handlers.
- `js/multiplayer/sanity_hud.js`: Dynamic `Reloading...` label during active reload.
- `js/multiplayer/main.js`: Real-time diagnostic telemetry binding and early dev HUD DOM cleanup.
- `js/multiplayer/mp_manager.js`: Viewmodel synchronization upon room join.
- `multiplayer.html`: Added `#dev-weapon-hud-diag` HUD badge template.

### Untracked Files Preserved
- `docs/SABER_AI_IMPLEMENTATION_BRIEF.md`
- `docs/SABER_AI_VALIDATION_REPORT.md`
- `saber_eval.html`
- `saber_prototype/`
- `yuka/`

### Story Mode Isolation
- Strict 0-line diff against `master` for `index.html`, `js/engine.js`, `js/levels/level0.js`, and `js/levels/level0_env.js`.
