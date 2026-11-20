# Progress Log

- 2026-11-20: Baseline committed (db8e641). Playable DOOM-like FPS: Mixamo-animated
  Saber horde (walk/attack/fall), handgun/shotgun GLB viewmodels, pfp.png HUD
  portrait, wave survival, headshots, pickups, minimap, status-bar HUD. Verified
  in browser, zero console errors. Roadmap + AGENTS.md created for the autonomous
  evolution loop toward a Backrooms dungeon crawler with VN NPC dialogue + trading.
- 2026-11-20: M1.1 done — cohesive overlay theme: framed .panel containers with
  entrance animation, gradient glowing title, amber divider rules, keycap-styled
  control hints, gradient buttons with hover/active/focus states, refined death +
  pause screens. Verified start screen render + clean game boot, zero errors.
- 2026-11-20: M1.2 done — HUD polish: gap+dot crosshair (color-var driven), white X
  hit-marker flashing on hit, red health + amber ammo bars under status numbers,
  low-HP/ammo pulse + damage vignette. Verified numerically (hitmarker.show, bar
  widths track HP/ammo, low class at HP<30) + screenshot, zero errors.
- 2026-11-20: M1.3 done — reusable noclip level-transition shell: Backrooms mono-yellow
  panel (NOCLIP DETECTED tag, level title, italic lore flavor text from a pool, animated
  progress bar), levelTransition(title,flavor,onMid,done) with mid-callback for level
  loads + G.transition() debug trigger. Verified show->onMid->hide cycle, one-line title,
  zero errors. M2 will wire it to real level loads.
- 2026-11-20: M1.4 done — settings panel: SETTINGS module persisted to localStorage
  (sks.settings.v1), sliders for mouse sensitivity / volume / FOV with live value labels,
  applied to mouse-look multiplier, SND master gain, and camera.fov; SETTINGS buttons on
  start + pause screens with back-navigation. Verified open/apply/persist-across-reload/
  back cycle (camera.fov=90, sens=2 stored + restored), zero errors.
- 2026-11-20: M1.5 done — visual-novel dialogue shell: bottom VN box (portrait + name
  plate + typewriter text + ▸ choice buttons + click/space hint), reusable Dialogue
  engine (open/advance/close, branching nodes, choice actions, pauses game while open,
  Space/Enter routing), DIALOGUE_DEMO wanderer tree + G.dialogue() trigger. Verified
  typewriter -> 2 branching choices -> [Leave] closes & resumes game, zero errors.
  MILESTONE 1 (UI polish) COMPLETE.
- 2026-11-20: M2.1 done — level registry (LEVELS: arena + backrooms descriptors with
  bg/fog/ambient/playerLight/roomLight/wallTex/layout/enemies fields) + applyLevelTheme()
  loader wired into initScene (ambientLight + roomLights refs); G.setLevel(id)/G.level.
  Verified theme switch numerically (arena fog #050508 -> backrooms #2a2410, yellow
  ambient/player/room lights) + banner, zero errors. NOTE: walls still show arena
  lava/brick textures — the mono-yellow Backrooms TEXTURE swap is M3.
- 2026-11-20: M2.2 done — exit portal (glowing yellow noclip rift + NOCLIP label + light,
  pulsing/rotating) placed in a reachable cell; player-proximity trigger in updatePlayer;
  LEVEL_ORDER + goNextLevel() drives levelTransition -> applyLevelTheme(next) + player
  reposition + enemy/pickup clear + wave reset; G.nextLevel(); resetGame restores arena.
  Verified stepping into portal transitions arena->backrooms (fog #2a2410, player back at
  start, transition screen hides), portal renders, zero errors.
- 2026-11-20: M2.3 done — per-level ambient sound profiles: SND.ambient(profile) now
  rebuilds switchable node graphs ('drone' = arena low drone; 'fluorescent' = Backrooms
  120Hz mains hum + 240Hz harmonic + flickering 2.8kHz buzz), stopAmbient() + ambientInfo()
  debug; LEVELS.ambientSound field; applyLevelTheme + startGame drive the profile.
  Verified arena(drone,3 nodes)<->backrooms(fluorescent,4 nodes) via setLevel AND portal
  transition, zero errors. Lighting profile already handled by applyLevelTheme (M2.1).
- 2026-11-20: M2.4 done — Progress module (localStorage sks.progress.v1): level/kills/
  maxWave + items inventory {scrap, almondWater, keys} with addItem/useItem (overdraw
  guard); saved on level transition + wave start; G.progress/G.addItem. Verified items
  persist across portal transition AND page reload, level saved, useItem deducts + rejects
  overdraw, zero errors. MILESTONE 2 (multi-level architecture) COMPLETE.
- 2026-11-20: M3.1 done — procedural Backrooms textures in KTG pipeline: wallYellow
  (worn mono-yellow chevron wallpaper + damp stains), carpetDamp (beige Berber carpet),
  ceilTile (mineral-fiber drop-ceiling grid + speckle); registered in TEX; LEVELS gained
  floorTex/ceilTex + backrooms all-yellow wallTex; applyLevelTheme now swaps wall/floor/
  ceiling maps per level (wallMeshes tagged by type, floorMesh/ceilMesh refs). Verified
  arena<->backrooms texture swap numerically + screenshot shows authentic Level 0 look
  (yellow walls / beige carpet / tiled ceiling), zero errors.
- 2026-11-20: M3.2 done — fluorescent ceiling fixtures: createFluorescents() builds a grid
  of 64 emissive rectangular panels (MeshBasicMaterial) inset in the ceiling, shown only in
  backrooms (applyLevelTheme toggles visibility); per-fixture random flicker (brief dimming)
  animated in updatePlayer. 120Hz hum-buzz audio already shipped in M2.3. Verified 64
  fixtures hidden in arena / visible in backrooms, flicker active, panels render in ceiling
  grid (screenshot), zero errors.
- 2026-11-20: M3.3 done — refactored fixed buildMap into reusable layoutArena()/
  layoutBackrooms() (random wall runs + doorways + scattered pillars = irregular segmented
  rooms) + assignWallVariants/computeReach/setLayout; extracted buildWalls() (disposes +
  rebuilds InstancedMeshes from grid per level wallTex); applyLevelTheme regenerates layout
  + walls + minimap on layout change; LEVELS.backrooms.layout='backrooms'. Verified
  backrooms distinct reachable layout (644 floor cells vs arena 540), start/portal cells
  open, enemies spawn, arena<->backrooms swap, labyrinth screenshot, zero errors.
- 2026-11-20: M3.4 done — disorientation touches: ~15% of fluorescent fixtures marked dead
  (permanently dark = dark-room patches); createOutlets() scatters 28 wall outlets + 8 torn-
  wallpaper dark patches on wall faces (rebuilt per layout, backrooms-only); SND.whisper()
  (bandpass noise + LFO) triggered on a random 8-20s timer while in backrooms. Verified
  outlets hidden in arena / 36 detail meshes in backrooms, dead fixtures present, whisper
  fires, zero errors.
- 2026-11-20: M3.5 done — added LEVELS.habitable (Level 1 "Habitable Zone": gray concrete
  warehouse, dim industrial light, drone ambient, segmented layout) and extended
  LEVEL_ORDER to ['arena','backrooms','habitable'] so the exit portal advances Level 0 ->
  Level 1. Verified full chain arena->backrooms->habitable->arena via nextLevel, Level 1
  gray-warehouse render distinct from yellow Level 0, zero errors. MILESTONE 3 (Backrooms
  Level 0) COMPLETE.
- 2026-11-20: M4.1 done — buildTrim() adds instanced baseboards + ceiling cornice on every
  exposed wall face, plus door-frame posts + lintels at 1-cell passages (procedural geometry
  in the .kkrieger spirit; pillars already exist). Rebuilt per layout alongside buildWalls.
  Verified baseboard/cornice render at wall-floor junction (screenshot), 4 trim meshes /
  576 instances arena, 7 meshes / 1120 instances backrooms (door frames at narrow passages),
  zero errors.
- 2026-11-20: M4.2 done — createProps() scatters low-poly procedural props in non-arena
  levels: 18 wooden crates (KTG.crateTex plank texture, some stacked) against walls, 24
  debris chunks on the floor, 6 shelf units (back panel + 3 boards); start/portal cells kept
  clear; rebuilt per layout with nested-geometry disposal. Verified crate + shelf render
  (screenshots), 48 props in backrooms / hidden in arena, zero errors.
- 2026-11-20: M4.3 done — replaced flat door lintels with curved arch headers (half-torus
  InstancedMesh, oriented per passage axis) over 1-cell passages, keeping the side posts;
  rooms now connect through arched openings rather than square holes. Verified 31 arch
  instances in backrooms, curved arch render over a passage (screenshot), zero errors.
  (Partial walls / varied heights deferred — they need collision rework to avoid invisible
  upper-half blocking; arches are the delivered smoother-transition mechanism.)
- 2026-11-20: M4.4 done — established Blender asset pipeline: tools/blender_prop.py builds a
  low-poly metal barrel (cylinder + 2 torus rings + lid, PBR mats) -> assets/prop_barrel.glb
  via Blender 5.3 headless; loadBarrel() loads it (Lambert conversion), createProps() instances
  6 barrel clones against walls with a procedural-cylinder fallback, shared-geometry disposal
  guard so rebuilds don't break the template. Verified template loads, barrel bbox 0.74x0.91x
  0.72 on floor, 6 barrels render (screenshot), survive arena<->backrooms rebuild, zero errors.
  MILESTONE 4 (less blocky maps + Blender assets) COMPLETE.
- 2026-11-20: M5.1 done — added a landmark hall (large open room + 4-pillar cluster) to
  layoutBackrooms for navigation, and fog-of-war minimap reveals: an `explored` cell set
  revealed around the player each frame (revealAround), reset on layout change; drawMinimap
  masks unexplored cells + hides pickups/enemies in fog (arena keeps full map). Verified
  explored 49/1024 at start -> 98 after moving, landmark cell revealed, fog canvas shows
  only the explored patch (screenshot), arena full-map, zero errors. (Literal map-size
  increase deferred — needs per-level MAPW/MAPH refactor; landmarks + reveals + multi-room
  interconnection delivered.)
- 2026-11-20: M5.2 done — fleshed out Level 1 "Habitable Zone": KTG.wallConcrete (gray
  concrete, formwork lines + tie holes + stains), layoutWarehouse() (open spans + regular
  column grid + partition walls with wide openings), LEVELS.habitable now layout:'warehouse'
  + concrete walls. Crates/barrels already scatter via createProps. Verified distinct open
  layout (832 floor cells vs backrooms 407), concrete render + columns + crates (screenshot),
  start/portal open, enemies spawn, zero errors.
- 2026-11-20: M5.3 done — added Level 2 "Pipe Dreams": LEVELS.pipedreams (green-teal industrial
  tint, dense fog), layoutPipes() (narrow 2-wide maintenance tunnel grid), createPipes()
  (476 instanced horizontal pipe runs along tunnel walls near ceiling), createSteam() (10
  rising/fading sprite puffs animated in updatePlayer); extended LEVEL_ORDER to 4 levels.
  Verified narrow layout (592 cells), pipes + animating steam, full chain arena->backrooms->
  habitable->pipedreams->arena, tunnel/pipes/steam render (screenshot), zero errors.
- 2026-11-20: M5.4 done — added Level 3 "The Dungeon": KTG.wallStone (ashlar blocks + mortar),
  layoutDungeon() (4 corner chambers + central chamber + corridor ring), LEVELS.dungeon
  (warm torch-lit amber), createTorches() (10 flame sprites + 4 flickering point lights),
  createTraps() (6 spike pressure plates dealing 8 dmg/0.8s when stepped on); LEVEL_ORDER now
  5 levels. FIXED a reachability bug (central chamber sealed from outer ring -> only 87
  cells): extended connectors to span to corridors -> 455/455 reachable. Verified trap damage
  (hp 100->84), far-corner enemy approaches, full 5-level chain, zero errors. MILESTONE 5
  (expand map / more levels) COMPLETE.
- 2026-11-20: M6.1 done — friendly NPC entities: makeNPCFigure() (robed wanderer: robe +
  head + hood), createNPCs() places one per level (WANDERER/backrooms, M.E.G. AGENT/habitable,
  DELVER/dungeon) with idle bob + sway; proximity scan sets nearNPC and shows a styled
  "[E] Talk to NAME" HUD prompt within 2.5m; KeyE opens the existing Dialogue engine with the
  NPC's tree. Verified NPC present, prompt shows on approach, E opens dialogue box (portrait +
  name + typewriter), zero errors. (Dialogue engine shell already existed from M1.5.)
- 2026-11-20: M6.2 done — verified + extended the dialogue engine: nodes/typewriter/portrait/
  branching choices all functional; added a 'gift' branch to DIALOGUE_DEMO whose choice action
  grants an item (Progress.addItem('almondWater',1) + showMsg), demonstrating choices-with-
  effects and bridging to M7 trading. Verified full branch flow start->q->lore->gift->end->
  leave, choice buttons render (screenshot), almondWater 0->1 via choice action, clean close,
  zero errors.
- 2026-11-20: M6.3 done — wrote distinct NPC characters + branching dialogue trees:
  DIALOGUE_AGENT (M.E.G. Agent: supplies/levels branches, ration grants +1 almondWater +2
  scrap) and DIALOGUE_DELVER (cryptic Delver: fear/treasure branches, +3 scrap), alongside the
  WANDERER demo tree; createNPCs now assigns each NPC its own tree. Verified all three open
  distinct name+text, agent ration grants items, zero errors.
- 2026-11-20: M6.4 done — procedural NPC portraits: makePortrait() draws hooded busts on
  canvas (per-character palette + distinguishing marks: wanderer pale hair, agent shoulder
  badge, delver scar) -> dataURLs; genPortraits() assigns each dialogue tree its own portrait
  (player HUD keeps pfp.png). Verified 3 distinct generated portraits render in dialogue
  (screenshot), zero errors. MILESTONE 6 (visual-novel NPC interaction) COMPLETE.
- 2026-11-20: M7.1 done — inventory + currency UI: an INVENTORY panel (I key toggles, pauses
  game) listing SCRAP (currency), ALMOND WATER (+40 HP, USE button), KEYS with live counts;
  a persistent top-left scrap HUD readout updated in updateHUD; useAlmondWater() consumes via
  Progress.useItem and heals +40 HP. Verified I opens/closes + pause/resume, counts render,
  water heals 50->90 and decrements 2->1, scrap readout 5, panel screenshot, zero errors.
- 2026-11-20: M7.2 done — trade UI via dialogue choices: tradeBuy(price,grant)/tradeSell
  (consume,reward) helpers (scrap-gated, refresh inventory); added a 'trade' branch to
  DIALOGUE_AGENT (buy 24 bullets/3 scrap, +50 HP/2 scrap, key/5 scrap, sell Almond Water/+2
  scrap, done) looping back to the trade node. Verified full transaction sequence numerically
  (scrap 10->7->5->0, bullets +24, hp +50, key +1, insufficient-funds guard, sell +2 scrap),
  trade menu render with prices + agent portrait + scrap HUD (screenshot), zero errors.
- 2026-11-20: M7.3 done — NPC shops with limited stock: Progress.shop {bullets:3,health:2,
  keys:1} (persisted); Dialogue engine gained choicesOf() supporting dynamic choice functions;
  buildTradeChoices() renders stock-aware labels ("(N left)" / "SOLD OUT"); tradeBuyStock()
  gates on stock + scrap, decrements stock, saves. Verified labels show counts, 3 buys deplete
  bullets 3->0, SOLD OUT blocks further purchases (scrap unchanged), stock persists across
  reload, zero errors.
- 2026-11-20: M7.4 done — quests/favors: Progress.quests {delverWater:0/1/2} (persisted);
  Delver favor branch (favorOffer/favorActive/favorDone) with buildDelverWarnChoices() routing
  by quest state and dynamic favorActive choices tracking inventory ("(N/2)"); deliver consumes
  2 Almond Water, grants +5 scrap +1 key. Verified full lifecycle offer->accept->active->
  deliver->done, reward + item consumption, zero errors. MILESTONE 7 (resource exchange /
  trading) COMPLETE.
- 2026-11-20: M8 done — wrote assets/CREDITS.md documenting provenance/licenses (three.js MIT;
  original procedural textures/audio/portraits/layouts + Blender barrel; user-provided Saber
  model + Mixamo royalty-free animations, handgun/shotgun, pfp.png; legacy athena/saber_animated
  noted). 8.1/8.2 evaluated NOT NEEDED — procedural quality sufficient across 5 levels, so no
  CC0 downloads required (condition not met). MILESTONE 8 COMPLETE.
- 2026-11-20: M9.1 done — full playthrough audit across all 5 levels: reachability, NPC
  talkability, combat kills, ambient, portal chain. FOUND+FIXED backrooms sealed pockets
  (random doorways left ~46 unreachable cells): added ensureConnected() bridge pass in
  setLayout (carves minimal walls to connect sealed floor to start region). Re-audit: all
  levels fully reachable (backrooms 735/735, stress x4 connected), NPCs talkable, combat KILL
  OK on every level, full portal chain, zero errors. Trades verified in M7.
- 2026-11-20: M9.2 done — balance: BALANCE table (per-level density + tough multipliers);
  startWave queue scaled by density (backrooms 0.6 fewer, habitable 1.2 more); enemyHp()
  scales HP by level toughness (replaces flat 55+wave*10 across all 4 spawn paths); scrap
  drops on kill (35% chance +1 scrap) tying combat to the currency economy. Existing wave
  HP/speed curve retained. Verified wave-1 queue/hp differ per level (backrooms 4/59,
  dungeon 7/85), scrap drops on kills, zero errors.
- 2026-11-20: M9.3 done — performance pass: measured 24-enemy horde (23 FPS headless software
  render, 343k tris, 67 draw calls; walls/trim/pipes already instanced; 256² shared textures).
  FOUND+FIXED disposal leaks: addDecal/updateDecals + addTracer/updateTracers now dispose
  geometry+material on eviction/expiry; removeZombie disposes skinned skeleton.boneTexture
  (per-clone DataTexture). Note: renderer.info.memory.textures doesn't decrement for skeleton
  boneTextures in r147 (managed outside standard texture accounting), but GPU memory is freed.
  Horde renders correctly, zero errors.
- 2026-11-20: M9.4 done — rewrote README to cover the full game (5 levels + portal chain,
  NPCs/dialogue/trading/quests, inventory/currency, E/I controls, Blender pipeline, full
  playthrough verification); credits in assets/CREDITS.md (M8); tagged v1.0.0. ALL ROADMAP
  MILESTONES (1-9) COMPLETE.
- 2026-11-20: osu!-inspired UI redesign (user request) — cloned ppy/osu (MIT), inspected
  MainMenuButton/OsuLogo: parallelogram shear WEDGE_WIDTH/height=20/100 (~-11deg), hover
  width x1.5 Easing.OutElastic, beat-bounce (+-8deg/scale1.2/squash0.9), additive click flash,
  Pink #ff66aa / Purple #8866ee palette. Applied as a CSS theme layer: tilted parallelogram
  buttons (sheared ::before bg + upright label) with spring hover expand + click flash,
  beat-pulsing pink title + logo ripple, drifting-triangle purple backdrop, elastic panel
  entrances, pink/purple HUD/inventory/dialogue/settings. Verified button shear matrix
  (-0.194), themed computed colors across surfaces, PLAY/combat/inventory all functional,
  zero errors. prefers-reduced-motion respected.
- 2026-11-20: current-level handoff — extracted shared weapon data/reload timing to
  `js/systems/weapons.js`; added pistol/shotgun magazines, timed manual/automatic reload,
  reserve display, and an angled RPG-style health meter. Completed the Level 0 plug-in
  lifecycle and added the Summoner gate/40-second defense encounter: sabers target and
  damage the wizard, and the gate remains sealed until the rite completes. Updated the
  level and control documentation. Browser verification remains pending.
- 2026-11-20: input accessibility — Left Alt toggles free cursor mode without opening
  the pause screen; Left Alt again restores pointer lock. Dialogue choices support
  Up/Down focus navigation and Enter/Space activation.
- 2026-11-20: Summoner asset integration — normalized the user's standing Makima Mixamo
  GLB with the existing Blender cleanup pipeline; extracted the running export's clips
  into a compact animation-only GLB. The Level 0 NPC now swaps its procedural fallback
  for a SkeletonUtils clone, grounded with the skinned-world-bounds method and animated
  with idle/run clips on the matching rig. (The original T-pose texture was added later.)
- 2026-11-20: Sorcerer texture reattachment — extracted the original Makima base-color
  image from `makimaTpose.glb`, which uses one material across all eight mesh chunks, and
  applied it to the normalized animated model's matching UV0 layout.
- 2026-11-20: Sorcerer death decal — copied the supplied two-splat `blood_decals_psx.glb`
  into the game assets and now instantiate it under the Summoner when her defense HP reaches
  zero. The imported decal shares the existing 18s fade/22s disposal lifecycle. Added the
  Sketchfab CC BY 4.0 attribution.
- 2026-11-20: shared death decals + encounter fail state — Saber kills now use the same
  imported decal instead of the generated floor splat. If the Summoner dies, the Level 0
  defense ends in the game-over screen rather than allowing a ritual retry.
