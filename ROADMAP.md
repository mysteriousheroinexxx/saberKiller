# SABER KILL SIMULATOR — Evolution Roadmap

Goal: evolve the playable DOOM-like FPS into a multi-level, Backrooms-inspired
dungeon crawler with visual-novel NPC dialogue and resource trading. Maps
should feel less blocky; use Blender-designed assets and (CC0) online
resources where helpful.

## How the autonomous loop works
Each loop run: read this file top-to-bottom, find the FIRST unchecked `[ ]`
sub-task, do ONE bounded increment of it (a cron run is hard-capped at ~3
minutes — do not try to finish a whole milestone in one run). Verify in a
real browser (numeric + screenshot), `git commit` the increment, then tick
the sub-task `[x]` and append a line to PROGRESS.md. ALWAYS leave the game
bootable with zero console errors. If a sub-task is too big, split it into
smaller `[ ]` sub-tasks inline rather than half-finishing it.

## Milestone 1 — UI polish
- [x] 1.1 Cohesive theme: title/start/pause/death screens, fonts, color palette, spacing
- [x] 1.2 HUD polish: crosshair, hit-marker, damage vignette, low-HP pulse, ammo/health bars
- [x] 1.3 Level-transition / "noclip" screen between levels (Backrooms flavor text)
- [x] 1.4 Settings panel (mouse sensitivity, volume, FOV) persisted to localStorage
- [x] 1.5 Dialogue UI shell (portrait + typewriter text box + choice buttons) — reused by M6

## Milestone 2 — Multi-level architecture
- [ ] 2.1 Level registry + loader (each level = layout + textures + entities + ambient)
- [ ] 2.2 Level transition trigger (exit door / noclip zone) + fade + load next
- [ ] 2.3 Per-level ambient sound + lighting profile
- [ ] 2.4 Progression state (which level, inventory) persisted across transitions

## Milestone 3 — Backrooms Level 0 "The Lobby" (research-grounded)
Reference: mono-yellow worn chevron wallpaper, damp stained beige carpet,
1.27x1.14m mineral-fiber false ceiling tiles, harsh buzzing 120Hz fluorescent
fixtures, randomly segmented empty rooms/hallways, non-Euclidean disorientation,
scattered wall outlets, occasional pitch-black rooms / blood-red rooms.
- [ ] 3.1 Procedural yellow-wallpaper + damp-carpet + ceiling-tile textures (KTG pipeline)
- [ ] 3.2 Fluorescent light fixtures (emissive panels) + flicker + 120Hz hum-buzz audio
- [ ] 3.3 Randomly segmented room layout generator (non-grid, varied room shapes)
- [ ] 3.4 Disorientation touches: occasional dark rooms, outlets, torn wallpaper, whispers
- [ ] 3.5 Wire Level 0 as a playable level with an exit to Level 1

## Milestone 4 — Less blocky maps + Blender assets
- [ ] 4.1 Wall/geometry variety: beveled trim, baseboards, door frames, pillars (Blender)
- [ ] 4.2 Props: furniture, crates, shelves, debris (Blender low-poly, CC0 textures)
- [ ] 4.3 Smoother transitions between rooms (arches, partial walls, varied heights)
- [ ] 4.4 Asset pipeline: tools/blender_*.py -> assets/*.glb, loaded + instanced in-game

## Milestone 5 — Expand the map / more levels
- [ ] 5.1 Larger interconnected Level 0 (multi-room, landmarks, minimap reveals)
- [ ] 5.2 Level 1 "Habitable Zone" (warehouse/concrete, crates, dim industrial light)
- [ ] 5.3 Level 2 "Pipe Dreams" (pipes, steam, narrow maintenance tunnels)
- [ ] 5.4 A dungeon level (stone, torches, traps) tying the crawler theme together

## Milestone 6 — Visual-novel NPC interaction
- [ ] 6.1 NPC entities (idle animation, approach prompt "E to talk")
- [ ] 6.2 Dialogue engine: nodes, typewriter text, portrait, branching choices
- [ ] 6.3 Write NPC characters + dialogue trees (Backrooms wanderers / M.E.G. agents)
- [ ] 6.4 NPC portraits (reuse pfp.png style / generate / CC0)

## Milestone 7 — Resource exchange / trading
- [ ] 7.1 Inventory + currency (e.g. "almond water" / scrap as Backrooms currency)
- [ ] 7.2 Trade UI: buy/sell ammo, health, keys, items via dialogue choices
- [ ] 7.3 NPC shops with stock + prices; transactions update inventory/HUD
- [ ] 7.4 Quests/favors: NPC asks for an item -> reward (ties dialogue to gameplay)

## Milestone 8 — Online resources (only if needed, CC0/permissive)
- [ ] 8.1 Source CC0 textures (ambientCG/PolyHaven) for carpet/concrete/metal if procedural falls short
- [ ] 8.2 Source CC0 low-poly props/NPC base meshes (Kenney/Quaternius/PolyHaven) if Blender-from-scratch is slow
- [ ] 8.3 License/attribution recorded in assets/CREDITS.md

## Milestone 9 — Integration, balance, final polish
- [ ] 9.1 Full playthrough verification: all levels reachable, NPCs talkable, trades work
- [ ] 9.2 Balance: enemy density per level, resource economy, difficulty curve
- [ ] 9.3 Performance pass (instancing, disposal, texture budgets) for a full horde
- [ ] 9.4 Final README + credits + git tag
