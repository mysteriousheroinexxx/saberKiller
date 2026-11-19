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
