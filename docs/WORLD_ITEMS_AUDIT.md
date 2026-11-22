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
- **Pivot & Vertical Alignment**:
  - Base contact: $Y_{\text{min}} = 0.000\text{ m}$
  - Pivot is centered in $X/Z$, flush at bottom base ($Y = 0.000\text{ m}$)
  - Surface contact offset: $\Delta Y = 0.000\text{ m}$
- **Materials & Textures**:
  - Embedded PBR metallic-roughness material with BaseColor, Normal, and Metallic/Roughness maps
  - White enamel case with red emergency cross decal and metal corner latches
- **Placement Surfaces**:
  - Carpet Floor: $Y = 0.000\text{ m}$
  - Tabletop: $Y = 0.940\text{ m}$
  - Metal Shelf (Tier 1/2/3): $Y = 0.250\text{ m} / 0.740\text{ m} / 1.230\text{ m}$

---

### 1.2 Ammunition Box (`ammo_crate.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/ammo_crate.glb`)
- **Source Origin**: Authentic Budget-Backrooms supply mesh `SM_Crate_01a` (`Content/AssetPacks/Construction_VOL1/Meshes/SM_Crate_01a.uasset`) and 2K PBR textures (`TX_Crates_01a_ALB.png`, `TX_Crates_01a_NRM.png`, `TX_Crates_01a_RMA.png`)
- **File Size**: 4.83 MB (5,067,572 bytes)
- **Canonical Dimensions**:
  - Width ($X$): $0.468\text{ m}$ ($46.8\text{ cm}$)
  - Height ($Y$): $0.362\text{ m}$ ($36.2\text{ cm}$)
  - Depth ($Z$): $0.309\text{ m}$ ($30.9\text{ cm}$)
- **Scale Factor**: `1.0` (Converted at $0.35\times$ from bulk shipping container to portable ammo crate)
- **Pivot & Vertical Alignment**:
  - Base contact: $Y_{\text{min}} = 0.000\text{ m}$
  - Pivot is centered at base ($Y = 0.000\text{ m}$)
  - Surface contact offset: $\Delta Y = 0.000\text{ m}$
- **Materials & Textures**:
  - Material `M_Crate` with high-resolution diffuse/albedo texture, normal map, metallic factor `0.10`, roughness `0.70`
  - Olive drab / dark industrial military crate with stenciled reinforcement corners
- **Placement Surfaces**:
  - Carpet Floor: $Y = 0.000\text{ m}$
  - Tabletop: $Y = 0.940\text{ m}$
  - Metal Shelf (Tier 1/2): $Y = 0.250\text{ m} / 0.740\text{ m}$

---

### 1.3 Sanity Consumables (`sanity_pill_bottle.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/sanity_pill_bottle.glb`)
- **Source Origin**: Budget-Backrooms sanity restoration consumable (`Sanity_Pill` actor reference)
- **File Size**: 5.29 MB (5,549,856 bytes)
- **Canonical Dimensions** (at $0.0008\times$ scale factor):
  - Width ($X$): $0.077\text{ m}$ ($7.7\text{ cm}$)
  - Height ($Y$): $0.115\text{ m}$ ($11.5\text{ cm}$)
  - Depth ($Z$): $0.064\text{ m}$ ($6.4\text{ cm}$)
- **Scale Factor**: `0.0008` (Normalizes centimeter-based FBX source with internal $100\times$ node matrix to standard $11.5\text{ cm}$ prescription bottle)
- **Pivot & Vertical Alignment**:
  - Raw unscaled min $Y = -79.625\text{ m}$ (in local units)
  - In Three.js bounding box calculation, the bottom base aligns flush with origin ($Y_{\text{min}} \approx 0.000\text{ m}$)
  - Calibrated surface contact offset: $\Delta Y = 0.000\text{ m}$ relative to object origin
- **Materials & Textures**:
  - 5 sub-materials: `pillbottle` (amber translucent resin), `pillbottlecap` (white childproof ribbed lid), `pillbottlelabel` (faded pharmaceutical label), `pilltop` (crimson capsule half), `pillbottom` (white capsule half)
  - Contains visible internal 3D capsules
- **Placement Surfaces**:
  - Tabletop: $Y = 0.940\text{ m}$
  - Metal Shelf (Tier 2/3): $Y = 0.740\text{ m} / 1.230\text{ m}$
  - Carpet Floor: $Y = 0.000\text{ m}$

---

### 1.4 Energy Drink / Almond Water (`energy_drink.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/energy_drink.glb`)
- **Source Origin**: Budget-Backrooms stamina / almond water can consumable
- **File Size**: 2.85 MB (2,989,592 bytes)
- **Canonical Dimensions**:
  - Diameter ($X, Z$): $0.0585\text{ m}$ ($5.85\text{ cm}$)
  - Height ($Y$): $0.172\text{ m}$ ($17.2\text{ cm}$)
- **Scale Factor**: `1.0` (Accurate 1:1 metric scale for standard 500 mL aluminum beverage can)
- **Pivot & Vertical Alignment**:
  - Origin centered at can midpoint ($Y_{\text{center}} \approx 0.000\text{ m}$)
  - Base contact: $Y_{\text{min}} = -0.0849\text{ m}$
  - Surface contact offset: $\Delta Y = +0.0849\text{ m}$
- **Materials & Textures**:
  - 4 sub-materials: `label` (high-gloss printed aluminum, roughness `0.27`), `silver` (brushed aluminum rim), `top_part` (stamped pull-tab lid, metallic `0.46`, roughness `0.18`), `material` (inner lip)
- **Placement Surfaces**:
  - Tabletop: $Y = 0.940 + 0.085 = 1.025\text{ m}$
  - Metal Shelf (Tier 2/3/4): $Y = 0.740 + 0.085 = 0.825\text{ m} / 1.230 + 0.085 = 1.315\text{ m}$
  - Carpet Floor: $Y = 0.000 + 0.085 = 0.085\text{ m}$

---

### 1.5 Flashlight Battery (`aa_battery.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/aa_battery.glb`)
- **Source Origin**: Budget-Backrooms flashlight battery replacement item
- **File Size**: 2.22 MB (2,332,192 bytes)
- **Canonical Dimensions**:
  - Width ($X$): $0.078\text{ m}$ ($7.8\text{ cm}$)
  - Height ($Y$): $0.082\text{ m}$ ($8.2\text{ cm}$)
  - Depth ($Z$): $0.034\text{ m}$ ($3.4\text{ cm}$)
- **Scale Factor**: `1.0` (Cluster of AA cylindrical cells arranged for clear player discovery and interaction)
- **Pivot & Vertical Alignment**:
  - Base contact aligns flush with object origin ($Y_{\text{min}} \approx 0.000\text{ m}$)
  - Surface contact offset: $\Delta Y = 0.000\text{ m}$
- **Materials & Textures**:
  - Material `M_AA_Battery`: PBR black/gold metallic casing with copper positive terminal nibs
- **Placement Surfaces**:
  - Metal Shelf (Tier 2/3/4): $Y = 0.740\text{ m} / 1.230\text{ m}$
  - Tabletop: $Y = 0.940\text{ m}$
  - Carpet Floor: $Y = 0.000\text{ m}$

---

### 1.6 Door Key (`doorKey.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/doorKey.glb`)
- **Source Origin**: Budget-Backrooms door progression key
- **File Size**: 0.80 MB (839,796 bytes)
- **Canonical Dimensions**:
  - Length ($X$): $0.079\text{ m}$ ($7.9\text{ cm}$)
  - Thickness ($Y$): $0.012\text{ m}$ ($1.2\text{ cm}$)
  - Bow Width ($Z$): $0.034\text{ m}$ ($3.4\text{ cm}$)
- **Scale Factor**: `1.0` (Accurate 1:1 metric scale)
- **Pivot & Vertical Alignment**:
  - Key rests flat horizontally
  - Base contact: $Y_{\text{min}} = -0.0050\text{ m}$
  - Surface contact offset: $\Delta Y = +0.0050\text{ m}$
- **Materials & Textures**:
  - Material `M_Key_01_6AE97BB6_Mid`: PBR antique brass/bronze with tarnished edge highlights
- **Placement Surfaces**:
  - Tabletop: $Y = 0.940 + 0.005 = 0.945\text{ m}$
  - Metal Shelf (Tier 3 eye-level): $Y = 1.230 + 0.005 = 1.235\text{ m}$
  - Carpet Floor: $Y = 0.000 + 0.005 = 0.005\text{ m}$

---

### 1.7 Office Table (`table.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/table.glb`)
- **Source Origin**: Budget-Backrooms office furniture prop
- **File Size**: 10.33 MB (10,835,608 bytes)
- **Canonical Dimensions**:
  - Width ($Z$ in world space): $1.966\text{ m}$
  - Depth ($X$ in world space): $0.993\text{ m}$
  - Height ($Y$ in world space): $0.940\text{ m}$ ($94.0\text{ cm}$)
- **Scale Factor**: `1.0`
- **Pivot & Vertical Alignment**:
  - Legs rest flush on carpet: $Y_{\text{min}} = 0.000\text{ m}$
  - Top work surface: $Y_{\text{surface}} = +0.940\text{ m}$
  - Surface contact offset for items placed on top: $Y = 0.940\text{ m} + \Delta Y_{\text{item}}$
- **Materials & Textures**:
  - PBR laminated walnut desktop, powder-coated steel legs, and drawer hardware
- **Placement Surface**: Carpet Floor ($Y = 0.000\text{ m}$)

---

### 1.8 Industrial Metal Shelf (`metal_shelf.glb`)
- **File Format & Path**: glTF 2.0 Binary (`assets/items/metal_shelf.glb`)
- **Source Origin**: Budget-Backrooms storage shelving unit
- **File Size**: 2.05 MB (2,144,628 bytes)
- **Canonical Dimensions**:
  - Width ($Z$ in world space): $1.139\text{ m}$
  - Depth ($X$ in world space): $0.405\text{ m}$
  - Height ($Y$ in world space): $2.124\text{ m}$
- **Scale Factor**: `1.0`
- **Pivot & Vertical Alignment**:
  - Base feet rest flush on carpet: $Y_{\text{min}} = 0.000\text{ m}$
  - **Shelf Tier Heights**:
    - **Tier 1 (Bottom shelf)**: $Y_1 = 0.250\text{ m}$
    - **Tier 2 (Low shelf)**: $Y_2 = 0.740\text{ m}$
    - **Tier 3 (Eye-level shelf)**: $Y_3 = 1.230\text{ m}$
    - **Tier 4 (High shelf)**: $Y_4 = 1.720\text{ m}$
    - **Tier 5 (Top shelf)**: $Y_5 = 2.160\text{ m}$
- **Materials & Textures**:
  - Material `Edge_Wear_Dull_Gray`: Galvanized steel with weathered edges and perforated uprights
- **Placement Surface**: Carpet Floor ($Y = 0.000\text{ m}$)

---

## 2. World Placement Coordinate System & Offsets Summary

| Asset Key | Model Path | Scaled Dim ($W \times H \times D$) | Floor Pos ($Y$) | Tabletop Pos ($Y$) | Shelf Tier 3 Pos ($Y$) | Cast Shadow |
|---|---|---|---|---|---|---|
| `table` | `assets/items/table.glb` | $0.99 \times 0.94 \times 1.97\text{ m}$ | `0.000` | N/A | N/A | Yes |
| `metal_shelf` | `assets/items/metal_shelf.glb` | $0.41 \times 2.12 \times 1.14\text{ m}$ | `0.000` | N/A | N/A | Yes |
| `first_aid` | `assets/items/first_aid.glb` | $0.41 \times 0.13 \times 0.22\text{ m}$ | `0.000` | `0.940` | `1.230` | Yes |
| `ammo_crate` | `assets/items/ammo_crate.glb` | $0.47 \times 0.36 \times 0.31\text{ m}$ | `0.000` | `0.940` | `1.230` (Tier 1: `0.250`) | Yes |
| `energy_drink` | `assets/items/energy_drink.glb` | $0.06 \times 0.17 \times 0.06\text{ m}$ | `0.085` | `1.025` | `1.315` | Yes |
| `sanity_pill` | `assets/items/sanity_pill_bottle.glb` | $0.08 \times 0.12 \times 0.06\text{ m}$ | `0.000` | `0.940` | `1.230` | Yes |
| `aa_battery` | `assets/items/aa_battery.glb` | $0.08 \times 0.08 \times 0.03\text{ m}$ | `0.000` | `0.940` | `1.230` | Yes |
| `doorKey` | `assets/items/doorKey.glb` | $0.08 \times 0.01 \times 0.03\text{ m}$ | `0.005` | `0.945` | `1.235` | Yes |
