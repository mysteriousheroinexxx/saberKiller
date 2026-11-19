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
