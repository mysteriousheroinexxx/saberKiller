# Level 0 Developer World Placement Editor (MVP)

**Feature Branch:** `feature/level0-placement-editor`  
**Base Commit:** `5e5bc5c` (World Items Foundation)  
**Status:** Completed & Verified  

---

## 1. Overview & Purpose

The **Level 0 Developer World Placement Editor** is a lightweight, interactive 3D in-engine tool integrated directly into the developer rendering mode (`--dev-rendering`). It empowers developers to visually arrange, validate, and serialize physical props, furniture, and item placements within the authentic Level 0 Backrooms environment using official Three.js r147 `TransformControls`.

### Key Capabilities
- **Interactive 3D Gizmos**: Translate (`T`), Rotate (`R`), and Scale (`S`) placed objects in real time.
- **11-Asset Palette**: Instant spawning of all verified Budget-Backrooms props and survival consumables.
- **Surface Snapping**: 1-click snapping to Floor ($Y=0.000\text{m}$), Tabletop ($Y=0.936\text{m}$), and Metal Shelf Tiers 1–5.
- **Real-Time Physical Validation**: Continuous raycast support checks, wall boundary collision detection ($Z \in [-189.86, -184.86]$), and AABB overlap detection with green (Valid) and red (Invalid) visual feedback.
- **Non-Blocking Experimentation**: Clear failure reason diagnostics with a 1-click **"Revert to Last Valid"** recovery action.
- **Numbered Immutable JSON Layouts**: Versioned layout export (`iteration_0001.json`, `iteration_0002.json`, ..., `latest.json`) where older revisions are strictly write-protected.
- **Multiplayer Room Synchronization**: Hosts can select layout revisions for custom rooms; joining clients automatically receive the revision ID and synchronize their Level 0 world state.
- **Strict Developer Isolation**: Available **only** when launched with `--dev-rendering`. Standard multiplayer games and Story Mode contain zero editor DOM elements, listeners, or shortcuts.

---

## 2. Developer-Only Activation

### Launching Dev Mode
```bash
cd doom-zombies
node server/index.js --dev-rendering
```

### Accessing the Editor
1. Open `http://localhost:8080/multiplayer.html` in the browser.
2. The Developer Rendering Panel (`H` or `F2`) contains a dedicated section: **`WORLD ITEMS PLACEMENT [DEV]`**.
3. Click the **`World Editor`** button (or press `F4`).
4. The editor overlay activates, suspending FPS player movement, releasing the mouse pointer, disabling weapon firing, and revealing the interactive editing HUD.
5. Pressing `Escape` or clicking **`Exit Editor [Esc]`** detaches the gizmo, hides the overlay, and restores normal first-person gameplay controls.

### Normal Mode Safeguards
When launched without `--dev-rendering` (`node server/index.js`):
- All `/api/developer/world-layout/*` endpoints return **`403 Forbidden`**.
- The editor overlay, dev panel toggle, and `#dev-comparison-panel` are completely stripped from the DOM.
- No editor keybindings or canvas click handlers are attached.
- Single-player Story Mode files (`index.html`, `js/engine.js`, `js/levels/level0.js`, `js/levels/level0_env.js`) are 100% untouched.

---

## 3. UI Layout & Controls

The editor overlay presents a dark gold / charcoal aesthetic matching the Level 0 office theme:

```
+-----------------------------------------------------------------------------------------------+
| LEVEL 0 WORLD PLACEMENT EDITOR [DEV]  | Revision: [iteration_0002.json v] [Load] [Refresh]   | [Export JSON] [Exit Esc] |
+-----------------------------------------------------------------------------------------------+
| ASSET PALETTE (11 Models)   |                                     | INSPECTOR & VALIDATION     |
| [Furniture & Props]         |                                     | [Translate (T)][Rotate][S] |
| - Office Table              |                                     | ID: prop_table_01          |
| - Metal Shelf               |                                     | Type: table (prop)         |
| - Vending Machine           |                                     | Pos: [44.200, 0.000, -185] |
| - Ammo Crate                |                                     | Rot: [0.0, -68.8, 0.0]     |
|                             |                                     | Snapping: [Floor][Table]   |
| [Consumables & Items]       |                                     | Shelf: [T1][T2][T3][T4][T5]|
| - First Aid Kit             |                                     | Actions: [Dup][Del][Revert]|
| - Almond Water Can          |                                     | Status: [VALID PLACEMENT]  |
| - Sanity Pills Bottle       |                                     | Surface clearances passed  |
| - Energy Drink              |                                     |                            |
| - Flashlight Battery Pack   |                                     |                            |
| - .45 ACP Ammo Box          |                                     |                            |
| - Brass Door Key            |                                     |                            |
+-----------------------------+-------------------------------------+----------------------------+
| Shortcuts: T=Translate · R=Rotate · S=Scale · F=Floor Snap · Del=Delete · Ctrl+D=Duplicate · V=Revert · Esc=Exit |
+-----------------------------------------------------------------------------------------------+
```

### Keyboard Shortcuts
| Key | Function |
| :--- | :--- |
| `T` | Set gizmo mode to **Translate** |
| `R` | Set gizmo mode to **Rotate** |
| `S` | Set gizmo mode to **Scale** |
| `F` | **Snap to Floor** at current horizontal coordinate |
| `Delete` / `Backspace` | **Delete** currently selected object |
| `Ctrl+D` / `Cmd+D` | **Duplicate** currently selected object with $+0.4\text{m}$ offset |
| `V` | **Revert to Last Valid** transform |
| `Escape` | **Exit Editor** and restore first-person player control |
| `Right-Click Drag` | **Orbit Camera View** freely without locking pointer |

---

## 4. Asset Palette (11 Verified Assets)

| Key | Asset Name | Category | Model GLB Path | Default Dimensions ($W \times H \times D$) |
| :--- | :--- | :--- | :--- | :--- |
| `table` | Office Table | prop | `assets/items/table.glb` | $0.80\text{m} \times 0.936\text{m} \times 1.20\text{m}$ |
| `metal_shelf` | Industrial Metal Shelf | prop | `assets/items/metal_shelf.glb` | $0.60\text{m} \times 2.400\text{m} \times 1.20\text{m}$ |
| `vending_almond` | Almond Vending Machine | prop | `assets/items/vending_almond.glb` | $0.90\text{m} \times 1.950\text{m} \times 0.90\text{m}$ |
| `ammo_crate` | Ammunition Crate | ammunition | `assets/items/ammo_crate.glb` | $0.50\text{m} \times 0.400\text{m} \times 0.70\text{m}$ |
| `first_aid` | First Aid Kit | medical | `assets/items/first_aid.glb` | $0.28\text{m} \times 0.120\text{m} \times 0.22\text{m}$ |
| `almond_can` | Almond Water Can | consumable | `assets/items/almond_can.glb` | $0.08\text{m} \times 0.140\text{m} \times 0.08\text{m}$ |
| `sanity_pill` | Sanity Pills Bottle | consumable | `assets/items/sanity_pill_bottle.glb` | $0.07\text{m} \times 0.110\text{m} \times 0.07\text{m}$ |
| `energy_drink` | Almond Water Energy Drink | consumable | `assets/items/energy_drink.glb` | $0.08\text{m} \times 0.160\text{m} \times 0.08\text{m}$ |
| `aa_battery` | Flashlight Battery Pack | battery | `assets/items/aa_battery.glb` | $0.12\text{m} \times 0.040\text{m} \times 0.08\text{m}$ |
| `ammo_box` | .45 ACP Ammunition Box | ammunition | `assets/items/ammo_box.glb` | $0.16\text{m} \times 0.080\text{m} \times 0.12\text{m}$ |
| `doorKey` | Brass Door Key | key | `assets/items/doorKey.glb` | $0.04\text{m} \times 0.015\text{m} \times 0.09\text{m}$ |

---

## 5. Physical Validation & Snapping Engine

### Surface Snapping Rules
1. **Floor Snapping (`F`)**: Downward raycast against floor mesh to detect exact floor carpet elevation ($Y = 0.000\text{m}$).
2. **Tabletop Snapping**: Queries parent table prop bounds; snaps item base flush to the wooden desktop surface ($Y = 0.936\text{m}$).
3. **Shelf Tier Snapping (Tiers 1–5)**: Snaps item base flush to the specified shelf tier height:
   - Tier 1: $Y = 0.243\text{m}$
   - Tier 2: $Y = 0.715\text{m}$
   - Tier 3: $Y = 1.188\text{m}$
   - Tier 4: $Y = 1.643\text{m}$
   - Tier 5: $Y = 2.097\text{m}$

### Collision & Clearance Auditing
- **Level 0 Hallway North Wall**: $Z = -184.86\text{m}$ (box maximum $Z > -184.84$ triggers `North Wall Penetration`).
- **Level 0 Hallway South Wall**: $Z = -189.86\text{m}$ (box minimum $Z < -189.88$ triggers `South Wall Penetration`).
- **Grid Cell Collision Map**: Raycasted into 2D collision cell raster ($0.3\text{m}$ grid cells) to ensure props do not penetrate solid walls.
- **AABB Object Overlap**: Intersects transformed bounding box against placed objects while ignoring legitimate vertical support contacts.
- **Visual Feedback**:
  - Valid: Bright Green wireframe box (`#00ff88`), green inspector badge.
  - Invalid: Bright Red wireframe box (`#ff2244`), red inspector badge with diagnostic text (e.g. `North Wall Penetration`).

---

## 6. Versioned JSON Layout Specification

Layouts are saved in `doom-zombies/world-layouts/level0/`. Iterations are strictly sequential and immutable.

### Document Schema
```json
{
  "schemaVersion": "1.0.0",
  "level": "level0",
  "iteration": 1,
  "createdAt": "2026-11-22T16:18:56.026Z",
  "author": "developer",
  "description": "Visual placement layout via Editor at 9:48:56 PM",
  "catalog": { ... },
  "placements": [
    {
      "id": "prop_table_01",
      "type": "table",
      "category": "prop",
      "placementMode": "fixed",
      "position": [44.2000, 0.0000, -185.5000],
      "rotation": [0.0000, -1.2000, 0.0000],
      "scale": [1.0000, 1.0000, 1.0000],
      "anchor": { "surface": "floor" },
      "tags": ["furniture", "obstacle"]
    }
  ],
  "spawnGroups": [
    {
      "id": "sg_hallway_consumables_01",
      "name": "Hallway Floor Consumables Pool",
      "eligibleTypes": ["almond_can", "energy_drink", "sanity_pill", "aa_battery"],
      "candidatePoints": [
        [41.8, 0.0, -186.2],
        [42.2, 0.0, -186.1],
        [42.6, 0.0, -186.0],
        [43.1, 0.0, -186.0],
        [43.3, 0.0, -188.7]
      ],
      "minCount": 2,
      "maxCount": 4,
      "surface": "floor",
      "probability": 0.85,
      "tags": ["consumable", "random_loot"]
    },
    {
      "id": "sg_tabletop_supplies_01",
      "name": "Office Tabletop Medical & Ammo Pool",
      "eligibleTypes": ["first_aid", "ammo_box", "sanity_pill", "doorKey"],
      "candidatePoints": [
        [44.75, 0.936, -185.45],
        [44.35, 0.936, -185.45],
        [44.00, 0.936, -185.45],
        [44.55, 0.936, -185.20],
        [44.15, 0.936, -185.20]
      ],
      "minCount": 2,
      "maxCount": 3,
      "surface": "table",
      "supportProp": "prop_table_01",
      "probability": 1.0,
      "tags": ["high_tier_loot", "loot_surface"]
    }
  ]
}
```

---

## 7. Developer REST Endpoints

All developer layout routes are served under `/api/developer/world-layout/` and return `403 Forbidden` if `--dev-rendering` is not active.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/developer/world-layout/list` | Returns array of existing numbered iterations, sizes, timestamps, and marks latest |
| `GET` | `/api/developer/world-layout/load` | Returns JSON of requested layout (`?file=iteration_XXXX.json` or `?iteration=N`). Falls back to `latest.json` or `world_items.json`. |
| `POST` | `/api/developer/world-layout/export` | Validates schema, calculates $N = \max(\text{existing}) + 1$, writes immutable `iteration_XXXX.json`, and atomically updates `latest.json`. |

---

## 8. Verification & Test Execution

### Running the Verification Suites
```bash
# 1. Run unit test suite (schema, contact math, wall boundaries, 11 assets)
node /home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/scratch/test_placement_editor_unit.js

# 2. Run API & access control suite (endpoints, iteration incrementing, immutability, 403 blocking)
node /home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/scratch/test_layout_api_endpoints.js

# 3. Run full E2E browser & CDP automated suite
fuser -k 8096/tcp 9226/tcp 8097/tcp 2>/dev/null || true
cd /home/mhxxx/AI/test2/doom-zombies
node /home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/scratch/verify_placement_editor_e2e.js
```
