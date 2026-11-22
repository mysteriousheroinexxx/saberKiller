# Budget-Backrooms World Items & Props Asset Audit

## Overview
This audit catalogs physical world items, consumables, and environment props adapted from the Budget-Backrooms Unreal Engine 4 project (`/home/mhxxx/AI/test2/Budget-Backrooms-main/`) and converted for real-time WebGL PBR rendering in the Three.js Survival Mode multiplayer environment.

All assets are stored in `assets/items/` in standard binary glTF format (`.glb`) with embedded PBR textures, standard metric scales, and precomputed placement offsets for carpet floors, table tops, and metal shelving tiers.

---

## 1. Item & Prop Asset Specifications

### 1.1 First Aid Box (`first_aid.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/first_aid.glb`)
- **Source Origin**: Budget-Backrooms medical pickup prop / Sketchfab PBR asset
- **File Size**: 2.90 MB (3,037,928 bytes)
- **Canonical Dimensions**:
  - Width ($X$): $0.412\text{ m}$ ($41.2\text{ cm}$)
  - Height ($Y$): $0.128\text{ m}$ ($12.8\text{ cm}$)
  - Depth ($Z$): $0.217\text{ m}$ ($21.7\text{ cm}$)
- **Scale Factor**: `1.0` (Native metric scale)
- **Wrapper Pivot & Surface Contact**:
  - Normalized base contact: $Y_{\text{min}} = 0.000\text{ m}$
  - Horizontally centered: origin at $(0, 0, 0)$
  - Base rests flush at $Y = 0.000\text{ m}$ on floor, $0.936\text{ m}$ on table, or tier height on shelf
- **Materials & Textures**: Embedded PBR metallic-roughness material with BaseColor, Normal, and Roughness maps. White enamel case with red emergency cross decal.

---

### 1.2 Ammunition Shipping Crate (`ammo_crate.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/ammo_crate.glb`)
- **Source Origin**: Authentic Budget-Backrooms supply mesh `SM_Crate_01a` (`Content/AssetPacks/Construction_VOL1/Meshes/SM_Crate_01a.uasset`) and 2K PBR textures (`TX_Crates_01a_ALB.png`, `TX_Crates_01a_NRM.png`, `TX_Crates_01a_RMA.png`)
- **File Size**: 4.83 MB (5,067,572 bytes)
- **Canonical Dimensions**:
  - Width ($X$): $0.468\text{ m}$ ($46.8\text{ cm}$)
  - Height ($Y$): $0.362\text{ m}$ ($36.2\text{ cm}$)
  - Depth ($Z$): $0.309\text{ m}$ ($30.9\text{ cm}$)
- **Scale Factor**: `1.0` (Converted at $0.35\times$ to portable supply crate)
- **Wrapper Pivot & Surface Contact**:
  - Normalized base contact: $Y_{\text{min}} = 0.000\text{ m}$
  - Positioned flush on carpet floor or bottom shelf tier

---

### 1.3 .45 ACP Ammunition Box (`ammo_box.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/ammo_box.glb`)
- **Source Origin**: Authentic opened handgun cartridge box (`/home/mhxxx/AI/test2/assets/ammo_box.glb`)
- **File Size**: 13.77 MB (14,435,628 bytes)
- **Canonical Dimensions**:
  - Width ($X$): $0.177\text{ m}$ ($17.7\text{ cm}$)
  - Height ($Y$): $0.038\text{ m}$ ($3.8\text{ cm}$)
  - Depth ($Z$): $0.070\text{ m}$ ($7.0\text{ cm}$)
- **Mesh & Material Hierarchy**:
  - 53 distinct submeshes: outer cardboard box tray, folding wing lids, plastic cartridge grid, and 50 individually rendered .45 ACP brass cartridges with copper jacketed bullets.
  - 3 PBR materials: `Bullets_45ACP` (metallic brass cartridge casing and copper bullet tips), `material` (plastic divider tray), and `Box_wings` (printed commercial ammunition packaging).
- **Wrapper Pivot & Surface Contact**:
  - Normalized base contact: $Y_{\text{min}} = 0.000\text{ m}$
  - Sits flush on carpet floor ($Y=0.000$), tabletop ($Y=0.936$), and metal shelf tiers.

---

### 1.4 Almond Water Vending Machine (`vending_almond.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/vending_almond.glb`)
- **Source Origin**: Authentic Budget-Backrooms actor `PessiVend_Almond.uasset` referencing mesh `hl2/vending/vending.uasset` and textures `pessi_almond.png` & `pessi_normal.png`.
- **File Size**: 713 KB (730,512 bytes)
- **Canonical Dimensions**:
  - Width ($X$): $1.042\text{ m}$ ($104.2\text{ cm}$)
  - Height ($Y$): $1.920\text{ m}$ ($192.0\text{ cm}$)
  - Depth ($Z$): $0.857\text{ m}$ ($85.7\text{ cm}$)
- **Orientation & Wall Placement**:
  - Front face with illuminated Almond Water graphic banner and soda selection buttons points forward ($-Z$).
  - Positioned against North wall at $X = 41.5, Z = -185.45$, rotation `[0, 0, 0]`.
  - Wall clearance: $16.2\text{ cm}$ from North wall ($Z = -184.86$).
  - Hallway center clearance: $1.48\text{ m}$ clear walking path to center ($Z = -187.36$).

---

### 1.5 Almond Water Can (`almond_can.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/almond_can.glb`)
- **Source Origin**: Authentic Budget-Backrooms actor `Pessi_Almond.uasset` referencing raw static mesh `can.uasset` and texture `pessi_can_almond.uasset` (extracted via `umodel`).
- **File Size**: 45.4 KB (46,448 bytes)
- **Canonical Dimensions**:
  - Diameter ($X, Z$): $0.057\text{ m} \times 0.055\text{ m}$ ($5.7\text{ cm} \times 5.5\text{ cm}$)
  - Height ($Y$): $0.102\text{ m}$ ($10.2\text{ cm}$)
- **Wrapper Pivot & Surface Contact**:
  - Normalized base contact: $Y_{\text{min}} = 0.000\text{ m}$
  - Can rests flush on floor beside vending machine, on office desk, and on metal shelf tiers.

---

### 1.6 Sanity Consumables (`sanity_pill_bottle.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/sanity_pill_bottle.glb`)
- **Source Origin**: Budget-Backrooms sanity restoration consumable (`Sanity_Pill` actor reference)
- **File Size**: 5.29 MB (5,549,856 bytes)
- **Canonical Dimensions** (at $0.0008\times$ scale factor):
  - Width ($X$): $0.094\text{ m}$ ($9.4\text{ cm}$)
  - Height ($Y$): $0.127\text{ m}$ ($12.7\text{ cm}$)
  - Depth ($Z$): $0.139\text{ m}$ ($13.9\text{ cm}$)
- **Wrapper Pivot & Surface Contact**:
  - Normalized base contact: $Y_{\text{min}} = 0.000\text{ m}$
  - Rest flush on table, shelf, and floor.

---

### 1.7 Energy Drink (`energy_drink.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/energy_drink.glb`)
- **Source Origin**: Generic aluminum energy drink can
- **File Size**: 2.85 MB (2,989,592 bytes)
- **Canonical Dimensions**:
  - Diameter ($X, Z$): $0.0585\text{ m}$ ($5.85\text{ cm}$)
  - Height ($Y$): $0.172\text{ m}$ ($17.2\text{ cm}$)
- **Wrapper Pivot & Surface Contact**:
  - Normalized base contact: $Y_{\text{min}} = 0.000\text{ m}$

---

### 1.8 Flashlight Battery (`aa_battery.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/aa_battery.glb`)
- **Source Origin**: Budget-Backrooms flashlight battery replacement item
- **File Size**: 2.22 MB (2,332,192 bytes)
- **Canonical Dimensions**:
  - Width ($X$): $0.067\text{ m}$ ($6.7\text{ cm}$)
  - Height ($Y$): $0.045\text{ m}$ ($4.5\text{ cm}$)
  - Depth ($Z$): $0.045\text{ m}$ ($4.5\text{ cm}$)
- **Wrapper Pivot & Surface Contact**:
  - Normalized base contact: $Y_{\text{min}} = 0.000\text{ m}$

---

### 1.9 Door Key (`doorKey.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/doorKey.glb`)
- **Source Origin**: Budget-Backrooms door progression key
- **File Size**: 0.80 MB (839,796 bytes)
- **Canonical Dimensions**:
  - Length ($X$): $0.079\text{ m}$ ($7.9\text{ cm}$)
  - Thickness ($Y$): $0.012\text{ m}$ ($1.2\text{ cm}$)
  - Bow Width ($Z$): $0.034\text{ m}$ ($3.4\text{ cm}$)
- **Wrapper Pivot & Surface Contact**:
  - Normalized base contact: $Y_{\text{min}} = 0.000\text{ m}$

---

### 1.10 Office Table (`table.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/table.glb`)
- **Source Origin**: Budget-Backrooms office furniture prop
- **File Size**: 10.33 MB (10,835,608 bytes)
- **Canonical Dimensions**:
  - Length ($Z$ in raw model, aligned to $X$ upon placement): $1.966\text{ m}$
  - Depth ($X$ in raw model, aligned to $Z$ upon placement): $0.687\text{ m}$
  - Height ($Y$): $0.936\text{ m}$ ($93.6\text{ cm}$)
- **Surface Height**: $Y_{\text{surface}} = 0.936\text{ m}$
- **Orientation & Placement**:
  - Position: `[44.5, 0.0, -185.35]`, Rotation: `[0.0, -1.5708, 0.0]`
  - Back of table faces North wall ($Z = -184.86$) with $14.7\text{ cm}$ clearance.
  - Front with drawers faces South into corridor with $1.67\text{ m}$ clearance to hallway center.

---

### 1.11 Industrial Metal Shelf (`metal_shelf.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/metal_shelf.glb`)
- **Source Origin**: Budget-Backrooms storage shelving unit
- **File Size**: 2.05 MB (2,144,628 bytes)
- **Canonical Dimensions**:
  - Length ($Z$ in raw model, aligned to $X$ upon placement): $1.139\text{ m}$
  - Depth ($X$ in raw model, aligned to $Z$ upon placement): $0.405\text{ m}$
  - Height ($Y$): $2.124\text{ m}$
- **Measured Shelf Tier Contact Heights**:
  - **Tier 1 (Bottom shelf)**: $Y_1 = 0.243\text{ m}$
  - **Tier 2 (Low shelf)**: $Y_2 = 0.715\text{ m}$
  - **Tier 3 (Eye-level shelf)**: $Y_3 = 1.188\text{ m}$
  - **Tier 4 (High shelf)**: $Y_4 = 1.643\text{ m}$
  - **Tier 5 (Top shelf)**: $Y_5 = 2.097\text{ m}$
- **Orientation & Placement**:
  - Position: `[44.5, 0.0, -189.50]`, Rotation: `[0.0, 1.5708, 0.0]`
  - Back of shelf faces South wall ($Z = -189.86$) with $15.7\text{ cm}$ clearance.
  - Open front faces North into corridor with $1.94\text{ m}$ clearance to hallway center.

---

## 2. Furniture Root-Cause Analysis & Fixes

### 2.1 The "Sunken Block" Office Table
- **Root Cause**:
  In `assets/items/table.glb`, the underlying Sketchfab node matrix had an off-center origin:
  $X_{\text{center}} = +0.843\text{ m}$, $Y_{\text{min}} = +0.011\text{ m}$, $Z_{\text{center}} = -0.002\text{ m}$.
  When cloned directly without wrapper normalization and placed at $X = 44.5$:
  The actual table geometry was shifted to $X \in [45.0, 45.7]$.
  Items intended for the tabletop were placed at $X \in [44.3, 44.7]$, meaning they were floating in mid-air beside the desk.
  Furthermore, the table's raw orientation had its $1.97\text{ m}$ length along the corridor $Z$-axis, causing it to block the hallway.
- **The Fix**:
  1. Implemented `normalizeModel()`: wraps the model in a `THREE.Group` and shifts the child mesh by $(-X_{\text{center}}, -Y_{\text{min}}, -Z_{\text{center}})$. The wrapper group's local origin $(0, 0, 0)$ is precisely at the horizontal center and flat bottom ($Y = 0$).
  2. Rotated the desk by $-90^\circ$ (`[0.0, -1.5708, 0.0]`). Its $1.97\text{ m}$ width now runs parallel to the North wall, its back rests against the wall with $15\text{ cm}$ clearance, and its front faces South toward the player.
  3. Items on the desk now share the same normalized coordinates ($X \in [44.1, 44.8], Z \in [-185.45, -185.15], Y = 0.936$), resting flush on the walnut surface.

### 2.2 The "Sideways" Metal Shelf
- **Root Cause**:
  In raw `metal_shelf.glb`, the width ($1.139\text{ m}$) was along $Z$ and depth ($0.405\text{ m}$) was along $X$.
  In the initial prototype, rotating it by $+90^\circ$ without centering caused it to sit awkward and face sideways into the wall.
- **The Fix**:
  1. Normalized with `normalizeModel()`, placing base feet at $Y = 0$.
  2. Aligned length along the X-axis against the South wall ($Z = -189.50$), with $16\text{ cm}$ clearance from the wall and $1.94\text{ m}$ clearance to the corridor centerline.
  3. Extracted exact upward-facing face clusters to determine exact tier heights ($0.243\text{ m}, 0.715\text{ m}, 1.188\text{ m}, 1.643\text{ m}, 2.097\text{ m}$).

---

## 3. Refrigerator / Cooler Asset Investigation Report

A comprehensive audit was performed across the entire Budget-Backrooms source project (`/home/mhxxx/AI/test2/Budget-Backrooms-main/Content/`):
- Searched all `.uasset` static meshes, skeletal meshes, actor blueprints, and material instances for keywords: `fridge`, `refrigerator`, `cooler`, `icebox`, `chiller`, `freezer`.
- **Finding**: **No refrigerator or cooler model exists anywhere in Budget-Backrooms**.
- The only cooling / cold-beverage prop present in the original game is the `PessiVend` series of vending machines (`PessiVend_Almond.uasset`, `PessiVend_Soda.uasset`, etc.).
- Accordingly, the Almond Water Vending Machine (`assets/items/vending_almond.glb`) and authentic Almond Water can (`assets/items/almond_can.glb`) are the authentic canonical props representing chilled consumables in Level 0.

---

## 4. Wrapper Group Normalization Pattern

To avoid destructively re-exporting original GLB files or corrupting internal UV mappings, `WorldItemManager.js` implements a mathematical wrapper group normalization pattern:

```javascript
normalizeModel(instance, def) {
  const wrapper = new THREE.Group();

  if (def.scale) {
    instance.scale.set(def.scale[0], def.scale[1], def.scale[2]);
  }

  instance.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(instance);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);

  // Offset inner model so lowest point is at wrapper local Y = 0, and centered in X and Z
  instance.position.set(-center.x, -box.min.y, -center.z);
  wrapper.add(instance);
  wrapper.updateMatrixWorld(true);

  wrapper.userData.modelSize = {
    x: +size.x.toFixed(4),
    y: +size.y.toFixed(4),
    z: +size.z.toFixed(4)
  };
  wrapper.userData.surfaceHeight = +size.y.toFixed(4);

  return wrapper;
}
```

### Benefits:
1. **Zero Destructive Edits**: Original GLB assets retain exact vertex structures and materials.
2. **Deterministic Placement**: Setting `wrapper.position.y = surfaceHeight` guarantees $Y_{\text{min}} = \text{surfaceHeight}$ with $0.0000\text{ m}$ contact error.
3. **Centered Rotation**: Rotations around the Y-axis pivot cleanly around the center of the bounding box.

---

## 5. Browser Keyboard Shortcut Protection & Safeguards

In browser-based first-person games using Pointer Lock, accidental keystrokes like `Ctrl+W` (close tab), `Ctrl+R` (reload page), `Tab` (lose canvas focus), or mouse-wheel scrolling can abruptly terminate or disrupt multiplayer sessions.

### 5.1 Implementation Details (`js/multiplayer/player_controller.js`)
- **Capturing Listener**: Bound with `{ capture: true }` so input events are evaluated before browser chrome defaults.
- **Pointer Lock Gated**: Protection activates ONLY when `document.pointerLockElement` is active.
- **Intercepted Combinations**:
  - `Ctrl+W` / `Meta+W`: Prevents accidental window/tab closure while moving forward (`W`).
  - `Ctrl+R` / `Meta+R`: Prevents page reload while reloading weapon (`R`).
  - `Ctrl+S`, `Ctrl+D`, `Ctrl+A`: Prevents browser Save/Bookmark/Select-All while strafing.
  - `F5` / Function keys: Prevents accidental page reload.
  - `Tab`: Prevents focus cycling away from the WebGL canvas.
  - `Space`, `PageUp`, `PageDown`, `Home`, `End`: Prevents page scroll.
  - `wheel`: Prevents page scrolling during weapon selection wheel.
- **Escape Key Preservation**: `if (e.code === 'Escape') return;` is explicitly preserved so the browser and user can ALWAYS release pointer lock.
- **Input Field Preservation**: Key events originating from `INPUT` or `TEXTAREA` elements bypass interception to allow chat and code entry.
- **`navigator.keyboard.lock`**: Calls `navigator.keyboard.lock(['KeyW', 'KeyR'])` upon pointer lock acquisition where supported.

### 5.2 Unload Safeguard (`js/multiplayer/main.js`)
- Registered `window.addEventListener('beforeunload', ...)` when connected to an active room.
- Alerts the player if they attempt to navigate away during a live game session.

### 5.3 Web Standards vs OS-Level Hardwired Shortcuts
- **Web-Preventable**: `Ctrl+R`, `F5`, `Tab`, `Ctrl+S`, `Ctrl+D`, `Ctrl+W` (in progressive web apps and modern Chromium under keyboard lock) can be intercepted via `e.preventDefault()`.
- **Browser/OS Hardwired**: System-level combinations (such as `Ctrl+Alt+Del`, OS task switch `Alt+Tab`, or browser-level `Ctrl+N` / `Ctrl+Shift+I` depending on browser configuration) cannot be overridden by JavaScript without native wrapper encapsulation (Electron/Tauri) or specialized kiosk flags.

---

## 6. Placement Manifest Summary (`assets/data/world_items.json`)

| Placement ID | Type | Surface | Position ($X, Y, Z$) | Rotation ($Y$) | Wall Clearance & Surface Contact |
|---|---|---|---|---|---|
| `prop_table_01` | `table` | Floor | `[44.5, 0.0, -185.35]` | `-1.5708` ($-90^\circ$) | $14.7\text{ cm}$ North wall clearance. Flush on carpet ($Y=0.000$). |
| `prop_shelf_01` | `metal_shelf` | Floor | `[44.5, 0.0, -189.50]` | `+1.5708` ($+90^\circ$) | $15.7\text{ cm}$ South wall clearance. Flush on carpet ($Y=0.000$). |
| `prop_vending_01` | `vending_almond` | Floor | `[41.5, 0.0, -185.45]` | `0.0` ($0^\circ$) | $16.2\text{ cm}$ North wall clearance. Flush on carpet ($Y=0.000$). |
| `prop_crate_01` | `ammo_crate` | Floor | `[42.5, 0.0, -189.40]` | `+0.2` ($+11^\circ$) | $30.6\text{ cm}$ South wall clearance. Flush on carpet ($Y=0.000$). |
| `floor_first_aid_01` | `first_aid` | Floor | `[43.7, 0.0, -188.90]` | `+0.3` | South perimeter floor. Flush on carpet ($Y=0.000$, $\Delta Y=0.0000$). |
| `floor_ammo_crate_01` | `ammo_crate` | Floor | `[42.8, 0.0, -188.80]` | `-0.2` | South perimeter floor. Flush on carpet ($Y=0.000$, $\Delta Y=0.0000$). |
| `floor_ammo_box_01` | `ammo_box` | Floor | `[43.3, 0.0, -188.70]` | `+0.5` | South perimeter floor. Flush on carpet ($Y=0.000$, $\Delta Y=0.0000$). |
| `floor_almond_can_01` | `almond_can` | Floor | `[41.8, 0.0, -186.20]` | `+0.4` | Beside Almond Water vending machine. Flush ($Y=0.000$, $\Delta Y=0.0000$). |
| `floor_energy_drink_01` | `energy_drink` | Floor | `[42.2, 0.0, -186.10]` | `+0.8` | North perimeter floor. Flush on carpet ($Y=0.000$, $\Delta Y=0.0000$). |
| `floor_sanity_pill_01` | `sanity_pill` | Floor | `[42.6, 0.0, -186.00]` | `-0.5` | North perimeter floor. Flush on carpet ($Y=0.000$, $\Delta Y=0.0000$). |
| `floor_door_key_01` | `doorKey` | Floor | `[43.1, 0.0, -186.00]` | `+1.2` | North perimeter floor. Flush on carpet ($Y=0.000$, $\Delta Y=0.0000$). |
| `table_first_aid_01` | `first_aid` | Table | `[44.75, 0.936, -185.45]` | `+0.1` | Flush on desk top ($Y=0.936\text{m}$, $\Delta Y=0.0000$). |
| `table_ammo_box_01` | `ammo_box` | Table | `[44.35, 0.936, -185.45]` | `-0.3` | Flush on desk top ($Y=0.936\text{m}$, $\Delta Y=0.0000$). |
| `table_almond_can_01` | `almond_can` | Table | `[44.00, 0.936, -185.45]` | `+0.6` | Flush on desk top ($Y=0.936\text{m}$, $\Delta Y=0.0000$). |
| `table_battery_01` | `aa_battery` | Table | `[43.70, 0.936, -185.45]` | `+0.9` | Flush on desk top ($Y=0.936\text{m}$, $\Delta Y=0.0000$). |
| `table_sanity_pill_01` | `sanity_pill` | Table | `[44.55, 0.936, -185.20]` | `+0.5` | Flush on desk top ($Y=0.936\text{m}$, $\Delta Y=0.0000$). |
| `table_door_key_01` | `doorKey` | Table | `[44.15, 0.936, -185.20]` | `-1.1` | Flush on desk top ($Y=0.936\text{m}$, $\Delta Y=0.0000$). |
| `shelf_ammo_crate_tier1` | `ammo_crate` | Shelf T1 | `[44.5, 0.243, -189.50]` | `0.0` ($0^\circ$) | Aligned along shelf ($X$). Fits $0.405\text{m}$ depth without overhang. Flush on T1 ($Y=0.243$). |
| `shelf_ammo_box_tier2` | `ammo_box` | Shelf T2 | `[44.3, 0.715, -189.50]` | `+0.2` | Flush on Tier 2 ($Y=0.715\text{m}$, $\Delta Y=0.0000$). |
| `shelf_almond_can_tier2` | `almond_can` | Shelf T2 | `[44.7, 0.715, -189.50]` | `-0.4` | Flush on Tier 2 ($Y=0.715\text{m}$, $\Delta Y=0.0000$). |
| `shelf_sanity_pill_tier2` | `sanity_pill` | Shelf T2 | `[44.5, 0.715, -189.50]` | `-0.6` | Flush on Tier 2 ($Y=0.715\text{m}$, $\Delta Y=0.0000$). |
| `shelf_battery_tier3` | `aa_battery` | Shelf T3 | `[44.3, 1.188, -189.50]` | `+0.7` | Flush on Tier 3 ($Y=1.188\text{m}$, $\Delta Y=0.0000$). |
| `shelf_door_key_tier3` | `doorKey` | Shelf T3 | `[44.5, 1.188, -189.50]` | `-0.3` | Flush on Tier 3 ($Y=1.188\text{m}$, $\Delta Y=0.0000$). |
| `shelf_almond_can_tier3` | `almond_can` | Shelf T3 | `[44.7, 1.188, -189.50]` | `+0.5` | Flush on Tier 3 ($Y=1.188\text{m}$, $\Delta Y=0.0000$). |
| `shelf_first_aid_tier4` | `first_aid` | Shelf T4 | `[44.5, 1.643, -189.50]` | `0.0` ($0^\circ$) | Aligned along shelf ($X$). Fits $0.405\text{m}$ depth without overhang. Flush on T4 ($Y=1.643$). |

---

## 7. Reusable Placement Engine Architecture

The placement engine in `js/multiplayer/item_manager.js` resolves item positions in two phases rather than using hardcoded arbitrary offsets.

### 7.1 Two-Phase Spawning
1. **Pass 1 — Support Props**: Furniture items (`table`, `metal_shelf`, `vending_almond`, `ammo_crate`) are spawned first. Their world bounding boxes, support surfaces, and tier elevations are registered into a spatial lookup table.
2. **Pass 2 — Supported Items**: Consumables and items referencing support anchors are evaluated against registered props.
   - For `surface: "floor"`: Base height is computed via floor detection ($Y = 0.000$).
   - For `surface: "table"`: The tabletop elevation ($Y = 0.936$) is queried from the referenced table prop's actual transformed bounds.
   - For `surface: "shelf_tier"`: The exact tier elevation is retrieved from the shelf structure's tier height map ($T_1=0.243, T_2=0.715, T_3=1.188, T_4=1.643, T_5=2.097$).

### 7.2 Floor Height Detection (`detectFloorHeight`)
- Evaluates floor elevation at coordinate $(X, Z)$ using the scene collision ground plane.
- In Level 0, carpet elevation is uniformly $Y = 0.000\text{ m}$.
- Places the item wrapper group at $Y = \text{floorY}$, guaranteeing the model's base sits flush on the carpet with zero penetration and zero floating gap.

### 7.3 Furniture Surface Detection (`detectFurnitureSurface`)
- Queries the bounding box of the supporting furniture prop.
- Validates horizontal containment: ensures $(X, Z)$ lies within the table or shelf tier boundary plus safe margin.
- Returns the exact world $Y$ coordinate of the support surface.

### 7.4 Collision and Intersection Validation
- **Wall Intersection (`checkWallIntersection`)**: Evaluates the transformed bounding box against the Level 0 collision grid (`CollisionHandler.isPointInWall`). Checks corners and center points with a $0.05\text{m}$ buffer.
- **Object Overlap (`checkObjectOverlap`)**: Evaluates the transformed AABB against all previously spawned items and props. Detects and flags physical intersections.
- Every placed item records a `validation` object in `getPlacementTelemetry()`:
  ```json
  {
    "isValid": true,
    "wallIntersection": false,
    "overlappingItems": []
  }
  ```

---

## 8. Developer Debug Bounding Box Visualizer

To enable visual inspection of placements and immediate detection of floating or intersecting assets, `WorldItemManager` includes an interactive bounding box visualizer.

### 8.1 Visual Components
- **Support Planes**:
  - **Cyan Plane**: Tabletop support surface at $Y = 0.936\text{m}$.
  - **Yellow Planes**: Metal shelf tier levels ($Y = 0.243\text{m}, 0.715\text{m}, 1.188\text{m}, 1.643\text{m}$).
- **Item Bounding Boxes**:
  - **Green BoxHelper**: Valid placement resting on a support surface with zero wall/object intersections.
  - **Red BoxHelper**: Invalid placement (intersecting a wall or colliding with another object).

### 8.2 Developer Controls & Isolation
- Debug visualization is created in an isolated `debugContainer` (`THREE.Group`) added to the scene.
- **Hidden by Default**: `debugContainer.visible = false` during normal gameplay.
- **Toggle Button**: Accessible in the developer rendering panel (`--dev-rendering` mode) via the `[Toggle Debug Bounds]` button (`#dev-toggle-bounds`) or programmatically via `window.itemManager.toggleDebugVisuals()`.

---

## 9. Global Tone-Mapping Exposure Audit (0.50 Baseline)

### 9.1 Background & Purpose
Prior to lighting stabilization, individual rendering subsystems exhibited varying brightness levels. To establish the characteristic sickly yellow fluorescent office atmosphere of Level 0 without over-darkening or washing out textures, a baseline `toneMappingExposure = 0.50` was established.

### 9.2 Audit Across Rendering Paths

| Rendering Path | Target Subsystem | Exposure Scope & Effect |
|---|---|---|
| **1. Level 0 Geometry** | PBR walls, carpet, ceiling panels | Tone-mapped by Three.js `ACESFilmicToneMapping`. At exposure `0.50`, fluorescent ceiling fixtures generate bright illumination while wallpaper normal maps ($0.40$) and carpet normal maps ($0.60$) retain texture depth without clipping. |
| **2. Weapon Viewmodels** | First-person Pistol, Shotgun, Torch | Viewmodels reside in the camera view hierarchy of the WebGL scene. They share `renderer.toneMappingExposure = 0.50`, ensuring gunmetal finishes and torch reflector materials match the ambient room lighting naturally. |
| **3. World Props & Items** | Desks, shelves, crates, cans, ammo boxes | All items in `WorldItemsContainer` use standard Three.js `MeshStandardMaterial`. They inherit the `0.50` exposure, resulting in realistic metallic reflections on brass cartridges, cans, and shelf struts. |
| **4. Post-Processing Quad** | Fullscreen custom shader (`postShader`) | Post-processing pass samples `tDiffuse` (the tone-mapped 3D scene) to apply film grain (`0.0`), chromatic aberration (`0.0`), and subtle color grading. The shader itself operates on normalized color values and does not apply redundant tone mapping. |
| **5. 2D DOM HUD** | Health, Sanity, Stamina, Compass, Reticle | Pure HTML/CSS DOM overlays rendered above the WebGL `<canvas>`. Completely independent and unaffected by WebGL tone mapping, preserving crisp icon graphics and readable typography. |

### 9.3 Persistence & Configuration Lifecycle
- **Initialization**: `main.js` sets `renderer.toneMappingExposure = 0.50` upon WebGLRenderer instantiation.
- **Lighting Module Baseline**: `LIGHTING_DEFAULTS.exposure = 0.50` in `js/multiplayer/lighting.js`.
- **Profile D ("Combined Optimum")**: Applying render configuration D explicitly maintains exposure at `0.50`.
- **Reset Defaults**: Clicking "Reset Lighting" restores `renderer.toneMappingExposure = 0.50`.
- **Developer Panel**: The slider is labeled "Global Tone-Mapping Exposure" with tooltip explaining its scene-wide scope. Range is $[0.10, 2.50]$ with default position $0.50$.
- **Story Mode Isolation**: Single-player Story Mode uses its own independent renderer configuration in `js/engine.js` and is 100% unaffected.
