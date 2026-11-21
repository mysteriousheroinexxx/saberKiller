# Project: Saber Kill Simulator (DOOM-like -> Backrooms dungeon crawler)

Self-contained browser FPS in `index.html` (Three.js r147, vendored in `vendor/`).
Read `ROADMAP.md` for the ordered build plan and `PROGRESS.md` for what's done.

## Run / verify
- Serve: `python3 -m http.server 8734` from this dir (GLB XHR needs HTTP).
- Verify in a REAL browser via the browser tool: boot `index.html`, check
  `window.__errors` is empty, drive gameplay through the `window.G` debug API
  (`G.start()`, `G.tick(sec)` with `G.setAuto(false)` for deterministic tests,
  `G.spawnAt`, `G.aimAtNearest`, `G.shoot`, `G.state`). Numeric assertions +
  screenshots. For real-time rAF, `Page.bringToFront` + focus emulation first
  (hidden tabs throttle rAF and read as fake bugs).
- Load the `browser-game-dev` skill before game work; `hermes-agent` for cron.

## Loop discipline (cron runs are ~3-min capped)
1. Read ROADMAP.md, pick the FIRST unchecked `[ ]` sub-task.
2. Do ONE small bounded increment. If too big, split into smaller sub-tasks.
3. Verify (browser, zero console errors, game still bootable).
4. `git add -A && git commit` the increment with a clear message.
5. Tick the sub-task `[x]` in ROADMAP.md, append a dated line to PROGRESS.md.
6. Stop. Never leave the game broken or half-migrated between commits.

## Key technical facts
- Technical Documentation: Detailed reverse-engineering, coordinate conversions, PBR reconstruction, dynamic lighting allocation, post-processing, and blood VFX architecture are documented in `docs/LEVEL0_RENDERING_PIPELINE.md`.
- Engine r147 (upgraded from r128 so cloned SkinnedMesh deform while moving).
- Enemies: Mixamo Saber GLBs normalized via Blender (`*_clean.glb`). Raw Mixamo
  exports have a mesh-meters-vs-bone-cm mismatch under a 0.01 Armature — fix
  with `tools/blender_clean.py` (set Armature scale 1, delete strays, re-export).
  Ground/scale from a TRUE skinned bbox (`skinnedWorldBox`), not Box3.setFromObject.
  Re-attach skin from `assets/saber.glb` by mesh-name leading digit. See skill
  reference `mixamo-glb-normalization.md`.
- Summoner Sorcerer: normalize the user's `makimaSorcererIdleStanding.glb` with
  `tools/blender_clean.py`; use `tools/blender_animation.py` on the running export to
  keep only its Mixamo rig/actions. The idle GLB is the mesh source; action clips bind
  by matching `mixamorig:*` bone names. Ground/scale via `skinnedWorldBox`, clone with
  `THREE.SkeletonUtils.clone`. Both Mixamo exports strip materials; reattach the user's
  base-color image extracted from `makimaTpose.glb` (`assets/makimaSorcerer_baseColor.png`)
  to the animated mesh chunks, which share the original UV layout.
- Blender 5.3 headless: `~/bin/blender-5.3.0-linux-x64/blender --background
  --python <script> -- <args>` (use `env -i HOME=$HOME PATH=/usr/bin:/bin` to
  avoid Python-env poisoning). Design low-poly props/NPCs here -> assets/*.glb.
- HUD portrait uses `assets/pfp.png`. World/textures/sound are procedural (KTG
  pipeline in index.html) in the .kkrieger spirit; keep new levels procedural
  first, add CC0 assets only where needed (record in assets/CREDITS.md).
- Backrooms Level 0 look: mono-yellow chevron wallpaper, damp beige carpet,
  mineral-fiber ceiling tiles, buzzing flickering fluorescents, randomly
  segmented non-Euclidean rooms, wall outlets, occasional dark/red rooms.

## Git
- Repo initialized; commit every verified increment. Identity already set.
- Keep large binary assets tracked (they're part of the game).
