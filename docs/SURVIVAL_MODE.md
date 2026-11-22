# Saber Killer — Survival Mode Architecture & Sanity System Guide

**Module**: Survival Mode (Solo & Cooperative Multiplayer)  
**Implementation**: [js/multiplayer/sanity_controller.js](file:///home/mhxxx/AI/test2/doom-zombies/js/multiplayer/sanity_controller.js) & [js/multiplayer/sanity_hud.js](file:///home/mhxxx/AI/test2/doom-zombies/js/multiplayer/sanity_hud.js)  
**Source Reference**: `Budget-Backrooms-main` (`P_Player.uasset`, `W_HUD.uasset`, `BPFL_OtherBP.uasset`)  
**Status**: Phase 1 Complete (Sanity System & Authentic HUD Verified)

---

## 1. Architectural Principles & Isolation

Survival Mode is an isolated gameplay layer built upon the Three.js r147 multiplayer/survival client architecture.

### Absolute Single-Player Story Mode Protection
- **Zero core file modifications**: `index.html`, `js/engine.js`, `js/levels/level0.js`, and `js/levels/level0_env.js` remain completely untouched.
- **Unified Solo & Co-op Runtime**: The sanity controller and HUD are completely decoupled from multiplayer networking and 3D rendering. A solo player session and a multi-player cooperative session instantiate and run the exact same `SanityController` instance.
- **No Shared Sanity Pollution**: Sanity is strictly individual. Player A's sanity loss does not directly modify Player B's sanity.

---

## 2. Original Budget-Backrooms Reference vs. Three.js Implementation

| Dimension | Original Budget-Backrooms (UE4.27) | Saber Killer Three.js Implementation |
|---|---|---|
| **Simulation Loop** | Looping `K2_SetTimer` @ `0.01s` (`100 Hz`) | Frame-rate independent delta-time simulation (`update(dt)` in render loop). |
| **Initial / Max Sanity**| `100.0` (clamped `0.0` to `100.0`) | `100.0` (clamped `0.0` to `100.0`). |
| **Passive Decay Rate** | `0.00035` per `0.01s` ($\approx 0.035$ / sec) | `0.035` sanity / second ($100\%$ to $0\%$ takes $\approx 47.6$ minutes). |
| **Rapid Recovery (Almond Water)**| `RegenSanity = true` adds `+0.5` per `0.01s` ($50.0$ / sec) | `startRapidRegen()` refills at $50.0$ sanity / sec until reaching $100.0$. |
| **State Thresholds** | Mild Paranoia: $< 80\%$<br>Panic: $\le 10\%$<br>Critical Collapse: $0\%$ | `NORMAL` ($> 80$)<br>`MILD_PARANOIA` ($\le 80$ and $> 10$)<br>`PANIC` ($\le 10$ and $> 0$)<br>`DEPLETED` ($0.0$) |
| **Visual Distortion Pipeline**| `pp_sanity` & `pp_sanityout` PostProcessComponent | Post-processing shader uniforms (`uSanityVignette`, `uSanityDesat`, `uBlackout`) integrated with approved Configuration D. |
| **Zero Sanity Consequence** | Hardcoded reload of map `M_LV0` | Isolated `onSanityDepleted` event hook (no hardcoded kicks or reloads in controller). |

---

## 3. Variables & Configuration Tuning

The `SanityController` supports full runtime configuration:

```javascript
export const DEFAULT_SANITY_CONFIG = Object.freeze({
  initialSanity: 100.0,
  maxSanity: 100.0,
  minSanity: 0.0,
  // 0.035 / sec matches 0.00035 per 0.01s tick in Budget-Backrooms
  passiveDrainPerSecond: 0.035,
  visualFxThreshold: 80.0,
  panicThreshold: 10.0,
  depletedThreshold: 0.0,
  // 50.0 / sec matches +0.5 per 0.01s tick in Budget-Backrooms Almond Water recovery
  rapidRegenRatePerSecond: 50.0
});
```

---

## 4. Public API & Event Interface

### Control Methods

- `pauseSanity()`: Suspends passive atmospheric decay (e.g. dialogue, safe zones). Emits `SANITY_PAUSED`.
- `resumeSanity()`: Resumes passive atmospheric decay. Emits `SANITY_RESUMED`.
- `togglePause()`: Toggles paused state.
- `restoreSanity(amount)`: Restores a discrete amount of sanity (clamped to `maxSanity`).
- `startRapidRegen()`: Activates continuous Almond Water recovery ($+50.0\text{ / s}$) until reaching $100.0$.
- `stopRapidRegen()`: Cancels rapid recovery.
- `drainSanity(amount, source)`: Drains an amount of sanity from a named source (e.g. `smiler_gaze`, `environmental_shock`).
- `setSanity(value)`: Sets sanity directly (clamped between `0.0` and `100.0`).
- `reset()`: Resets sanity to $100.0$, unpauses, and clears depletion state.

### Event Subscriptions

```javascript
import { SANITY_EVENTS } from './sanity_controller.js';

// Subscribe to state changes
sanityController.on(SANITY_EVENTS.CHANGED, (snapshot) => {
  console.log(`Sanity: ${snapshot.currentSanity.toFixed(1)}% [${snapshot.state}]`);
});

// Subscribe to threshold transitions
sanityController.on(SANITY_EVENTS.THRESHOLD_CHANGED, ({ state, previousState, currentSanity }) => {
  console.log(`Transition: ${previousState} -> ${state}`);
});

// Subscribe to critical collapse (fires exactly once upon reaching 0)
sanityController.on(SANITY_EVENTS.DEPLETED, () => {
  console.warn('Player collapsed due to insanity!');
});
```

---

## 5. Visual Effects & Post-Processing Integration

The visual effects build directly onto the approved **Configuration D — Combined Optimum** post-processing pipeline without introducing film grain (`uGrain = 0.0`) or chromatic aberration (`uFringe = 0.0`):

1. **NORMAL (> 80.0)**:
   - `uSanityVignette = 0.0`
   - `uSanityDesat = 0.0`
   - `uBlackout = 0.0`
   - 100% bit-for-bit identical to baseline approved clean rendering.
2. **MILD_PARANOIA (80.0 to 10.0)**:
   - Progressive vignette interpolation up to `+0.35` (total vignette $0.45 \to 0.80$).
   - Progressive desaturation up to `0.25` (saturation $1.25 \to 1.00$).
3. **PANIC (10.0 to 0.0)**:
   - Strong tunnel vision vignette interpolation up to `+0.80` (total vignette $0.80 \to 1.25$).
   - Further desaturation up to `0.60` (saturation $1.00 \to 0.65$).
   - Visual HUD pulsing alert (`.bb-panic`).
4. **DEPLETED (0.0)**:
   - Gradual visual blackout (`uBlackout` ramps smoothly from $0.0 \to 1.0$ over $\approx 1.2\text{ seconds}$).
   - Viewport fades into complete pitch black.
   - Upon recovery/reset, `uBlackout` smoothly fades back out.

---

## 6. Authentic Budget-Backrooms HUD (`W_HUD.uasset`)

The HUD is rendered in a dedicated DOM overlay anchored at **Top-Center**:

- **Brain Icon**: [assets/ui/icons/icons_twotone_brain.png](file:///home/mhxxx/AI/test2/doom-zombies/assets/ui/icons/icons_twotone_brain.png) (48x48 px).
- **Sanity Title**: `"Sanity"` in `Rubik-Medium` font (12px, letter-spacing 1px, `#edece6`).
- **Sanity Value**: Dynamic text formatted as `"{N}%"` (e.g. `"100%"`) in `Rubik-Medium` (16px).
- **Pause Indicator**: [assets/ui/icons/icons_twotone_pause_circle_white_48dp.png](file:///home/mhxxx/AI/test2/doom-zombies/assets/ui/icons/icons_twotone_pause_circle_white_48dp.png) (48x48 px, subtle 1.8s pulsing animation when paused).
- **Restrained Opacity**: Native `0.4` (40% opacity) matching original UMG `RenderOpacity = 0.4`.
- **Center Crosshair**: [assets/ui/icons/crosshair_smaller.png](file:///home/mhxxx/AI/test2/doom-zombies/assets/ui/icons/crosshair_smaller.png) (6x6 px central dot, opacity 0.45).

---

## 7. Developer Testing Controls

When the game server is launched with `--dev-rendering`, the developer panel includes a dedicated **SANITY SIMULATION [DEV]** section:

- **Buttons**:
  - `100%`: Resets sanity to maximum.
  - `50%`: Jumps to Mild Paranoia threshold.
  - `8% (Panic)`: Jumps to Panic threshold.
  - `0% (Void)`: Jumps to Critical Depletion / Blackout.
  - `Pause / Resume`: Toggles passive decay.
  - `Rapid Regen`: Triggers Almond Water recovery simulation.
- **Keyboard Shortcuts** (active in dev mode):
  - `[`: Drain 10 sanity.
  - `]`: Restore 10 sanity.
  - `\`: Toggle pause state.
  - `R`: Trigger rapid recovery.
  - `0`: Set sanity to 0.
  - `9`: Reset sanity to 100.
- **Console Access**: `window.survivalSanity` and `window.survivalHUD`.

---

## 8. Verification Results

### Unit Tests ([test_sanity_unit.js](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/scratch/test_sanity_unit.js))
- **Initialization**: 100.0 max, unpaused, not regenerating, NORMAL state. (PASS)
- **Frame-Rate Independence**: 30 FPS, 60 FPS, and 144 FPS yield identical $0.035$ decay per second. (PASS)
- **Pause & Resume**: Passive decay halts while paused; resumes cleanly. (PASS)
- **Discrete Clamping**: $0.0 \le \text{sanity} \le 100.0$. (PASS)
- **Rapid Regen**: Heals $+50.0\text{ / s}$ and auto-terminates at $100.0$. (PASS)
- **Threshold Transitions**: Exactly 4 discrete transition events across thresholds. (PASS)
- **Critical Collapse Trigger**: `onSanityDepleted` fires exactly once upon hitting 0; does not repeatedly fire while remaining at 0; rearms upon recovery. (PASS)
- **Player Isolation**: Player 1 sanity changes have zero impact on Player 2. (PASS)
- **Summary**: **40 / 40 Tests Passed**.

### End-to-End Browser Verification ([verify_survival_sanity.js](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/scratch/verify_survival_sanity.js))
- Controller initialized at 100.0 and running active decay: PASS
- Authentic Two-Tone Brain Icon (48x48): PASS
- Typography & Layout ("Sanity" & "100%"): PASS
- Authentic Dot Crosshair Found: PASS
- Mild Paranoia (50%) visual distortion: PASS
- Panic (8%) heavy vignette & HUD alert: PASS
- Depleted (0%) blackout & hook trigger: PASS
- Paused icon pulse & blackout clear: PASS
- Story Mode (`index.html`) zero errors: PASS
- **Overall Status**: **SUCCESS**.

---

## 9. Deferred Features & Future Roadmap

As strictly specified in Phase 1 scope:
- **Audio Integration**: Deferred to final polish phase. Event hooks (`SANITY_CHANGED`, `SANITY_THRESHOLD_CHANGED`, `SANITY_PAUSED`, `SANITY_RESUMED`, `SANITY_DEPLETED`) are fully exposed for future Web Audio / BiquadFilter binding.
- **Consumable Pickups**: Almond Water cans (`Pessi_Almond.uasset`) and vending machines (`PessiVend_Almond.uasset`) will be implemented in Phase 1B.
- **Inventory System**: Almond Water in Budget-Backrooms is consumed in-place without an inventory slot.
- **Keycard & Doors**: Keycard pickup (`Card.uasset`), Card Reader (`CardReader.uasset`), and locked door (`Door01.uasset`) will follow in Phase 1C.
- **Entity Proximity Damage**: Smiler and entity sanity damage APIs (`drainSanity(amount, source)`) are ready for AI integration.
