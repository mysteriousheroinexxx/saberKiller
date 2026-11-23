# Saber Killer — Vending Machine Stock & Level 0 Lighting Fix Report

**Branch:** `feature/interaction-inventory-foundation`  
**Target Project:** `doom-zombies`  
**Multiplayer Entrypoint:** `js/multiplayer/main.js` & `server/index.js`

---

## 1. Overview & Commitments

This report documents the resolution of two critical issues in Survival Mode:
1. **Configurable Vending Machine Stock**: Replacing unlimited Almond Water dispensing with an authoritative, shared room stock counter that decrements only on successful dispense, rejects further interactions when depleted, and is configurable via code, CLI flags (`--vending-stock=N`), or environment variables.
2. **Ceiling/Rooftop Bulbs Switching Off Fix**: Resolving the visual anomaly where approaching any ceiling light fixture in Level 0 caused its illumination to abruptly switch off.

Zero modifications were made to Story Mode files (`index.html`, `js/engine.js`, `js/levels/level0.js`, `js/levels/level0_env.js` remain at 0 diff against `master`). All untracked research and prototype files were strictly preserved.

---

## 2. Root Cause Analysis: Rooftop Bulbs Switching Off

### Investigation
In Level 0, 344 fluorescent light troffers are placed at $Y=3.98\text{m}$ across the ceiling. In multiplayer Survival Mode, `js/multiplayer/lighting.js` manages a dynamic pool of 38 `PointLight` instances that track fixtures nearest to the player(s) each frame.

Inspecting runtime scene lights via Chromium CDP revealed:
```json
pointLights[0]: {
  "name": "MP_LocalPlayerMuzzleLight",
  "x": 48.269, "y": 3.35, "z": -187.698,
  "intensity": 160,
  "distance": 36,
  "castShadow": true
}
```

### The Bug Mechanism
1. In `js/multiplayer/lighting.js`, `initMultiplayerLighting()` called `scene.traverse()` to gather room point lights added by `level0_env.js`:
   ```javascript
   const existingLights = [];
   scene.traverse(o => {
     if (o.isPointLight && o.name !== 'PlayerLight' && o.name !== 'MP_LocalPlayerLight') {
       existingLights.push(o);
     }
   });
   dynamicPointLights = [...existingLights];
   ```
2. Because `this.muzzleLight = new THREE.PointLight(..., 0, 11, 2)` was named `'MP_LocalPlayerMuzzleLight'` and parented to `this.camera` (which was already added to `scene`), `scene.traverse` encountered it and added it as the **first element** (`dynamicPointLights[0]`).
3. In `updateMultiplayerLighting(dt, localPos, remotePlayers)`, the ceiling fixture closest to the local player is assigned to **Slot 0**:
   ```javascript
   assigned.push(sortedByLocal[0].pos);
   ```
4. `dynamicPointLights[0]` (`muzzleLight`) had its position set to the closest fixture: `pl.position.set(target[0], 3.35, target[2])`.
5. **Because `muzzleLight` was parented to `camera`, setting its position in camera coordinates displaced it hundreds of meters away into the void** ($X_{\text{world}} = X_{\text{cam}} + X_{\text{target}}$).
6. Additionally, weapon firing and idle logic continuously reset `muzzleLight.intensity = 0`.
7. **Result**: Whichever fixture the player walked towards was assigned to Slot 0 (`muzzleLight`), meaning the PointLight for that fixture was displaced into outer space and zeroed out. The fixture directly above the player went completely dark. As soon as the player walked away, that fixture was demoted to a genuine scene light (Slot 1..37), causing it to suddenly switch back on.

### The Fix
In `js/multiplayer/lighting.js`:
- Strictly filtered `scene.traverse` to scene-rooted environment lights (`o.parent === scene` and `!o.name.includes('Player') && !o.name.includes('Muzzle')`).
- Labeled room lights explicitly as `MP_DynamicRoomLight_N`.
- Ensured all 38 lights in `dynamicPointLights` are genuine direct children of `scene`, leaving `MP_LocalPlayerMuzzleLight` completely isolated on the camera.

---

## 3. Configurable Vending Machine Stock Implementation

### Server Authoritative Architecture
1. **Configurable Settings**:
   In `server/room_manager.js`:
   ```javascript
   export const VENDING_CONFIG = {
     defaultMaxStock: 5,
     cooldownMs: 1000,
     maxInteractionDistance: 2.8
   };

   export function configureVendingMachine(opts = {}) {
     if (typeof opts.defaultMaxStock === 'number') {
       VENDING_CONFIG.defaultMaxStock = Math.max(0, opts.defaultMaxStock);
     }
     ...
     return { ...VENDING_CONFIG };
   }
   ```
2. **CLI & Environment Variable Binding**:
   In `server/index.js`:
   - Supports `--vending-stock=N` command-line argument.
   - Supports `VENDING_MAX_STOCK=N` environment variable.
3. **Room World Items Initialization**:
   In `createRoom()` (`server/room_manager.js`), placements of type `vending_almond` initialize `stock: VENDING_CONFIG.defaultMaxStock` and `maxStock: VENDING_CONFIG.defaultMaxStock`.
4. **Validation & Atomic Consumption**:
   In `handleVendingDispense(ws, machineId, clientPosition)`:
   - Rejects immediately if `machine.stock <= 0` with `'Vending machine is out of stock'`.
   - Validates 1.0s cooldown and proximity.
   - **Failed/rejected requests do not consume stock**.
   - On successful dispense authorization, decrements `machine.stock = Math.max(0, machine.stock - 1)`.
   - Returns `remainingStock` and broadcasts updated state to all clients in the room via `VENDING_DISPENSE_RESPONSE` and `ITEM_SPAWNED`.
5. **Client Diagnostics & Feedback**:
   In `js/multiplayer/interaction_manager.js`, `handleVendingDispenseResponse` displays remaining stock (e.g. `ACCEPTED — Dispensed from prop_vending_01 (2 left)`) or `REJECTED — Vending machine is out of stock`.

---

## 4. Verification & Automated Test Results

The suite `scratch/verify_vending_stock_and_lights.js` was executed with two simultaneous headless Chromium clients against a server configured with `--vending-stock=3`.

| Test Step | Description | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Test 1** | Client A Dispense #1 | Accepted, stock decrements 3 -> 2 | `ACCEPTED (2 left)` | **PASS** |
| **Test 2** | Client A Dispense #2 | Accepted after 1.1s cooldown, 2 -> 1 | `ACCEPTED (1 left)` | **PASS** |
| **Test 3** | Client A Dispense #3 | Accepted, final item, 1 -> 0 | `ACCEPTED (0 left)` | **PASS** |
| **Test 4** | Client A Dispense #4 | Rejected, machine empty | `REJECTED — Vending machine is out of stock` | **PASS** |
| **Test 5** | Client B Shared Stock Check | Rejected, authoritative shared room state | `REJECTED — Vending machine is out of stock` | **PASS** |
| **Test 6** | Failed Requests Idempotency | Rejections do not alter stock counter | Stock remains 0 without underflow/corruption | **PASS** |
| **Test 7a** | Light Pool Validation | 38 scene lights, no camera lights | 38 `MP_DynamicRoomLight_*` children of `scene` | **PASS** |
| **Test 7b** | Approach Bulb #317 (Spawn) | Approached from 6m to 0m | Intensity 160.0, visible, distance < 0.1m | **PASS** |
| **Test 7c** | Approach Bulb #65 (Alcove) | Approached from 6m to 0m | Intensity 160.0, visible, distance < 0.1m | **PASS** |
| **Test 7d** | Approach Bulb #267 (South) | Approached from 6m to 0m | Intensity 160.0, visible, distance < 0.1m | **PASS** |

### Regression Suites
- `scratch/verify_tab_and_hotbar_correction.js`: 15/15 tests passed (100%).
- `scratch/verify_weapon_firing.js`: 13/13 tests passed (100%).
- `scratch/verify_vending_and_consumable.js`: 9/9 tests passed (100%).
- Story Mode Diff against `master`: 0 diff.
