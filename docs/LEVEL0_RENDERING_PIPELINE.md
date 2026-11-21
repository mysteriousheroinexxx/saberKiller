# Level 0 Rendering Pipeline & VFX Architecture Guide

This document records the reverse-engineering discoveries, technical specifications, asset conversion workflows, and rendering pipelines implemented for **Level 0 (The Backrooms)** in *Saber Kill Simulator*.

---

## 1. Level 0 Asset Pipeline

### 1.1 Source Project & Asset Extraction
- **Source**: Open-source *Budget-Backrooms* project built in Unreal Engine 4.27.
- **Map File**: `Content/Maps/M_LV0.umap` (Level 0 interior layout: 260m $\times$ 630m).
- **Static Meshes & Blueprints**:
  - `Wall`: `SM_Modular_Wall` (standard 3.0m wide $\times$ 4.0m high structural wall unit).
  - `Pillar`: `SM_Modular_Pillar` (1.0m $\times$ 1.0m $\times$ 4.0m architectural columns).
  - `Ceiling/Floor`: Instanced planar grid patches ($4.0\text{m} \times 4.0\text{m}$).
  - `Lights`: Blueprint `Lights.uasset` consisting of ceiling housing `SM_Fluorescent_Light` with child `PointLightComponent` at `RelativeLocation = (0, 0, -180cm)`.
  - `Props`: Cardboard boxes (`SM_Cardboard_Box_*`), wall electrical outlets (`SM_Outlet`), Megascans directional decal arrows.

### 1.2 Coordinate System Transformations & Scale Normalization
Unreal Engine uses a **left-handed, Z-up coordinate system in centimeters**, whereas Three.js uses a **right-handed, Y-up coordinate system in meters**.

The coordinate transformation applied during asset parsing is:
$$\begin{aligned}
X_{\text{Three}} &= -\frac{Y_{\text{UE4}}}{100} \\
Y_{\text{Three}} &= \frac{Z_{\text{UE4}}}{100} \\
Z_{\text{Three}} &= -\frac{X_{\text{UE4}}}{100}
\end{aligned}$$

Rotation matrices and Euler angles were converted accordingly to preserve exact wall and doorway alignments without gaps.

### 1.3 Asset Manifests & Generation
The extracted scene data is stored in `assets/level0/level0_map.json`:
- **826 Floors**: Merged into single instanced/buffered geometry.
- **762 Walls & 46 Pillars**: Instanced with authentic double-sided box geometry (`side: THREE.DoubleSide`) to eliminate backface culling issues.
- **344 Lights**: 3D world positions of fluorescent fixtures.
- **17 Decals & 15 Props**: Cardboard boxes and wall outlets.
- **1-Meter Collision Sub-Grid**: Exact Boolean occupation grid matching UE4 level collision boundaries.

---

## 2. Rendering Pipeline & PBR Reconstruction

### 2.1 PBR Material Reconstruction
All extracted PBR texture channels are loaded and applied using `THREE.MeshStandardMaterial`:
1. **Damp Backrooms Carpet** (`Carpet_INST_*`):
   - `BaseColor` (`Carpet_INST_basecolor.png`): sRGB color encoding.
   - `Normal` (`Carpet_INST_normal.png`): Tangent space normal map.
   - `Roughness` (`Carpet_INST_roughness.png`): High roughness ($0.85$) with specular response at grazing angles.
   - `Ambient Occlusion` (`Carpet_INST_ambientOcclusion.png`): Bound to geometry UV2 set (`floorGeo.setAttribute('uv2', ...)`) for corner and contact shadowing.
2. **Monoyellow Chevron Wallpaper**:
   - `BaseColor` (`test3_basecolor.png`): Authentic mono-yellow wallpaper tone.
   - `Normal` (`norm_1k_paperwalls.png`): Crisp 1K surface embossing.
   - `Roughness` (`test3_roughness.png`): Matte paper texture response.
3. **Acoustic Grid Ceiling Tiles**:
   - `BaseColor`, `NormalGL`, `Roughness`, and `AO` from `OfficeCeiling001_4K_*`.
4. **Color Space Configuration**:
   - Color textures (`map`): `encoding = THREE.sRGBEncoding`.
   - Data textures (`normalMap`, `roughnessMap`, `aoMap`): `encoding = THREE.LinearEncoding`.

### 2.2 Physical Dynamic Lighting & Shadow Budget
In UE4, the level contains 344 static point lights baked via Lightmass into static lightmaps. In real-time WebGL, rendering 344 simultaneous dynamic shadow-casting lights is impossible without severe performance degradation.

**The Solution — Dynamic Priority Allocation**:
- **Total Budget**: 8 active `THREE.PointLight`s.
  - **4 Shadow-Casting Lights**: $512 \times 512$ PCF soft shadows (`type: THREE.PCFSoftShadowMap`, `bias: -0.0015`, `normalBias: 0.04`).
  - **4 Ambient Fill Lights**: Soft quadratic falloff for ambient hallway bounce.
- **Physical Suspension**: Lights are placed at $Y = 2.2\text{m}$ (suspended 1.8m below the 4.0m ceiling, matching UE4 `Lights.uasset` `RelativeLocation`).
- **Physical Decay**: Quadratic decay ($2.0$), intensity $32.0$, distance $24.0\text{m}$.
- **Directional Forward Weighting**: Light sorting calculates Euclidean distance weighted by the player's view vector:
  $$\text{EffectiveDistance} = d \times (\text{dot}(\vec{dir}_{\text{light}}, \vec{fwd}_{\text{player}}) > 0.2 \,?\, 0.65 : 1.4)$$
  Fixtures down the corridor in front of the player are prioritized over lights behind solid walls.
- **Enemy Dynamic Slot**: When Artoria Lily is nearby, light slot 1 is dedicated to the fixture closest to her, ensuring she casts crisp silhouettes down hallways.

### 2.3 Post-Processing & Color Grading Pipeline
Implemented in `js/engine.js` via a fullscreen shader pass (`renderScene()`):
1. **15,000K White Balance Cool Shift**: Compensates for warm point lights, reproducing the clinical fluorescent ambiance.
2. **SceneColorTint**: Multiplied by $(1.0, 0.99, 0.87)$ to yield the sickly green-yellow Backrooms cast.
3. **Chroma Saturation (200%)**: Boosts the wallpaper color vibrancy without blowing out highlights (`uSaturation: 1.85`).
4. **ACES Filmic Tone Mapping**: Provides realistic shoulder roll-off and dark toe contrast (`THREE.ACESFilmicToneMapping`, exposure $1.05$).
5. **Analog Film Grain & Vignette**: Subtle film grain (`uGrain: 0.085`), edge vignette (`uVignette: 0.95`), and chromatic aberration fringe (`uFringe: 0.0035`).

---

## 3. Environment Integration & Collision

### 3.1 Collision vs. Raycasting Synchronization
- **Player Movement**: Uses the authentic 1m sub-cell grid (`circleHitsWall`). Solid walls block movement; open corridors and doorways allow smooth traversal.
- **Weapon Raycasting**: When firing, raycasts query `customCollision.getRaycastTargets()` (the instanced wall and pillar bounding geometry) plus active enemy `hitMeshes`.
- **Consistency Guarantee**: Solid walls block both player movement and bullet trajectories; open doorways permit both.

### 3.2 Obsolete Procedural Geometry Purge
When entering `backrooms` mode (`enterLevel0Env`), legacy procedural assets from Milestones 1–4 are explicitly hidden and removed:
- Procedural `wallMeshes`, `trimMeshes` (wooden baseboards, door posts, curved torus arches) are removed from the scene and disposed.
- Procedural `floorMesh` and `ceilMesh` are hidden, completely eliminating Z-fighting.

---

## 4. Visual Effects — Blood Impact Animation (`bulletHit`)

### 4.1 Asset Inspection & Browser Compatibility Analysis
- **Source File**: `assets/bulletHit.mov`
- **Format**: Apple ProRes 4444 (`ap4h`), pixel format `yuva444p12le` (contains 16/12-bit alpha channel).
- **Resolution**: $1920 \times 1920$, 60 fps, 70 frames, duration 1.167s.
- **File Size**: **139 MB**.
- **Browser Playback Limitation**: Browsers cannot natively decode ProRes 4444. Furthermore, 139 MB is unacceptable for a web game.

### 4.2 Conversion Workflow
Two optimized formats were generated using `ffmpeg`:
1. **WebM with VP9 Alpha** (`assets/vfx/bulletHit.webm`):
   - Command: `ffmpeg -i bulletHit.mov -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 2M -auto-alt-ref 0 bulletHit.webm`
   - File size: **321 KB** (99.8% size reduction).
   - Preserves complete alpha channel transparency.
2. **8x8 Sprite Sheet Atlas** (`assets/vfx/bulletHit_sheet.png` & `assets/vfx/bulletHit_sheet.webp`):
   - Command: `ffmpeg -i bulletHit.mov -vf "select=between(n\,2\,65),scale=256:256,tile=8x8" -frames:v 1 bulletHit_sheet.png`
   - 64 sampled frames in an $8 \times 8$ grid, total resolution $2048 \times 2048$.
   - WebP size: **623 KB**; PNG fallback: **1.85 MB**.

### 4.3 Why Sprite Sheet is the Default for Weapon Impacts
While WebM video texture is supported via `videoPool`, the **Sprite Sheet Flipbook** is the preferred engine default for weapon impacts:
1. **Zero Playback Latency**: Texture is preloaded into VRAM; playback begins on the exact frame of impact without asynchronous buffering delay.
2. **Concurrent Overlapping Hits**: Shotgun blasts (7 pellets hitting simultaneously) and automatic weapon bursts spawn independent impact planes sharing one GPU texture with zero video decoder exhaustion.
3. **Zero GPU Upload Stalls**: Static texture in GPU memory; each instance simply updates UV offsets (`u, v`) per frame.
4. **Universal Compatibility**: Works across all desktop and mobile browsers without video autoplay policy restrictions.

### 4.4 In-Engine Implementation (`js/systems/blood_vfx.js`) & Surface Attachment
- **Surface Normal Offset**: Hits calculate the true 3D surface normal from the hit geometry or raycast normal transformed by `matrixWorld`. An outward offset of $0.002\text{m}$ ($2\text{mm}$) is applied along the surface normal (`hitPoint + norm * 0.002`), ensuring the blood splash appears directly on the visual mesh surface without clipping or embedding inside Artoria Lily's body.
- **Hierarchical Dynamic Attachment**:
  - Rather than being placed in static world space (where an advancing enemy walking at $2.0\text{m/s}$ would immediately swallow the stationary billboard within 100ms), the impact quad is parented directly to the character entity's group (`zb.group`).
  - World coordinates are transformed into local parent coordinates via `targetParent.worldToLocal(surfacePos)`.
  - **Parent Scale Compensation**: The Mixamo skeleton root is scaled down by $s = 0.0105$ to convert centimeters to meters. To prevent the blood quad from being crushed into a $9.9\text{mm}$ speck, the local quad scale is dynamically adjusted:
    $$s_{\text{local}} = \frac{s_{\text{base}}}{\text{parentScale}}$$
- **Dynamic Camera Billboarding with Roll Retention**:
  - As the character rotates or runs, the quad continuously faces the active player camera.
  - In character local space, the billboard orientation is calculated each frame as:
    $$Q_{\text{local}} = Q_{\text{parent}}^{-1} \times Q_{\text{camera}}$$
  - The randomized roll angle ($Z$-rotation) is multiplied into the local quaternion, maintaining random blood orientation while tracking the camera angle.
- **Bone-Aligned Precision Hitboxes**:
  - Replaced the coarse monolithic bounding box with individual hitboxes aligned to Artoria Lily's animated Mixamo bones (`mixamorigHead`, `mixamorigSpine2`, `mixamorigHips`, `mixamorigLeftUpLeg`, `mixamorigRightUpLeg`, `mixamorigLeftLeg`, `mixamorigRightLeg`, `mixamorigLeftArm`, `mixamorigRightArm`).
  - Provides pinpoint headshot detection and surface normal accuracy across walking, running, and attacking animation frames.
- **Authoritative Hook & Lifecycle**:
  - Triggered inside `damageZombie(zb, dmg, point, headshot, hitNormal)` on successful hits on Saber. Wall impacts trigger `sparkBurst()`.
  - When an enemy is defeated or removed, `BloodVFX.detachFrom(zb.group)` safely reparents any active impacts back to the global VFX scene to finish playback without orphaned nodes.

### 4.5 Deprecation & Complete Removal of Legacy Procedural Blood Particles
- The legacy particle-burst generator (`bloodBurst(point, n)` and `bloodMat`) previously spawned procedural red sprite squares into the scene on hit.
- This legacy generator has been completely removed from `js/engine.js`. The `bulletHit_sheet.webp` flipbook implementation now operates as the sole, authoritative blood impact effect on Saber hits.
- Environmental sparks on bullet wall impacts (`sparkBurst` and `sparkMat`) and floor splat decals upon death (`addBloodDecalAsset`) remain fully active and preserved.

---

