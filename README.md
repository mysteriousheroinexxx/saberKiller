# Saber Killer

A cooperative multiplayer survival-horror FPS set in **Backrooms Level 0**, built with **Three.js** and **Node.js**.

---

## Development Credits

### AI-Assisted Development
- **Gemini 3.8** — Used for most of the game's development.
- **Qwen 4** — Assisted with the initial prototype.
- **Gemini Hydrogen** — Assisted with sound system integration.

### 3D Assets and Animation
- 3D assets sourced from **Sketchfab**.
- 3D models animated in **Blender** by **@mysteriousheroinexxx**.

See [assets/CREDITS.md](assets/CREDITS.md) for detailed asset provenance and licensing.

---

## Game Overview

**Saber Killer** places up to two players inside a damp, mono-yellow Backrooms Level 0 facility patrolled by two persistent AI-controlled Sabers (**Saber Alpha** and **Saber Beta**). Beginning equipped only with a **Tactical Flashlight**, survivors must explore interconnected rooms, manage physical health, stamina, battery charge, and psychological sanity, scavenge firearms and scarce ammunition, locate brass keys on facility shelves and tables, and unlock the secured exit door to escape together.

The repository also retains the original single-player **Story Mode** prototype at `index.html`, documented in [ROADMAP.md](ROADMAP.md) and [PROGRESS.md](PROGRESS.md), while active development focuses on multiplayer **Survival Mode** (`multiplayer.html`).

---

## Implemented Features

- [x] **Multiplayer Rooms & Staging Lobby** — Create or join two-player rooms (`MAX_PLAYERS_PER_ROOM = 2`) by room code, inspect team readiness in a 3D brushed-steel staging lobby with live T-800 character models and green/white readiness indicators, toggle `READY`, and trigger a server-authoritative leader `START`.
- [x] **Level 0 Environment & Placement Editor** — Multi-room Backrooms Level 0 layout (`assets/level0/level0_map.json`, `lv0_scene.glb`) featuring chevron wallpaper, damp carpet, drop ceilings, PBR lighting, wall bullet decals, facility furniture, vending machines, and a 3D `WorldPlacementEditor` (`F4` in dev mode) for inspecting and saving layout revisions.
- [x] **Inventory, Equipment, Pickups & Dropping** — Server-synced 30-slot inventory (`20` backpack storage slots + `10` quick-access hotbar slots) with `Tab` modal toggle, `1`–`0` and scroll-wheel selection, `E` world interaction/pickup, right-click item dropping, drag-and-drop hotbar assignment, and contextual item actions.
- [x] **Pistol & Shotgun Discovery, Firing & Reloading** — World-discovered **Beretta Px4 Storm Compact** pistol (`12`-round magazine) and **Coach Shotgun** (`6`-shell magazine) with viewmodel animations, `R` manual reloads, wall impact decals, and Story Mode-derived blood hit effects and `blood_decals_psx.glb` pools when Sabers are staggered.
- [x] **Fixed Room-Wide Ammunition Economy** — Server-enforced Level 0 room budget capped at `60` total rounds (`48` pistol rounds: `12` loaded + `18` pickups of `2`; `12` shotgun shells: `6` loaded + `3` pickups of `2`) with duplicate pickup prevention.
- [x] **Health, Damage, Downed State & Teammate Revival** — `100` HP vitality pool transitioning to a recoverable `DOWNED` state when a teammate remains alive (`1` revival per run within `2.8m` using a **First Aid Kit**, restoring `50` HP), escalating to `ELIMINATED` and room `GAME_OVER` if no revivable survivors remain.
- [x] **Sanity & Psychological Effects** — Server-authoritative per-player sanity (`0–100%`) featuring passive decay (`0.035/s`), accelerated chase drain (`0.25/s`) driven by active Saber chase state, progressive vignette/desaturation distortion below `80%`, panic FX below `10%`, visual blackout at `0%`, temporary drain pause and recovery from **Almond Water**, and major restoration from **Sanity Pills**.
- [x] **Keys, Locked Exit & Escape Objective** — Brass door keys spawned on approved furniture surfaces (`metal_shelf`, `table`, and vending zones) used to unlock the Level 0 steel exit door and complete the match escape sequence.
- [x] **Stamina & Flashlight Battery Systems** — Sprint stamina (`100` max, drains while sprinting and regenerates while walking/idle) plus **Energy Drink** full stamina restore and temporary `1.27x` sprint speed boost (`15s`); **Tactical Flashlight** battery drain (`0.25/s` while active) recharged `+50%` by **AA Battery Packs**.
- [x] **Configurable Environmental Loot** — Data-driven loot distribution (`LOOT_CONFIG`) seeding batteries, Almond Water, Energy Drinks, and Sanity Pills across approved world surfaces alongside room-capped **First Aid Kits** and configurable Almond Water vending machines.
- [x] **Two Server-Authoritative Sabers & Encounter Pacing** — Independent Yuka-driven **Saber Alpha** (menace) and **Saber Beta** (stalker) AI running across `PATROL`, `INVESTIGATE_SOUND`, `SEARCH`, `STALK`, `CHASE`, `ATTACK`, `STAGGERED`, and `RECOVER` states, combining wall-occluded vision, footstep/gunfire hearing stimuli, pathfinding, mutual collision separation, and macro `EncounterDirector` pacing (`RELEASE`, `BUILD_UP`, `MENACE`, `CLIMAX`).
- [x] **Developer AI Observation Tools** — Enabled via `--dev-rendering`, providing the Render/Lighting & World Inspector (`F2`), World Placement Editor (`F4`), and **Saber AI Observation Deck** (`F6`) with live AI state cards, vision/LoS diagnostics, 3D vision/path aids, and sound-stimulus logs.
- [x] **Difficulty Settings** — Server-side room and AI simulation presets (`NORMAL`: `15` HP attack damage with `0.3s` windup at contact range; `HARD`: `100` HP instant strike at `1.8m` range) supported in `RoomManager` and `SaberAgent`. *(Exposed in server API/configuration; lobby UI selector is not yet added.)*
- [x] **Multiplayer Audio System & Volume Settings UI** — Shared single-`AudioContext` `MultiplayerAudioManager` with `7` hierarchical buses (`Master`, `Environment`, `Player Movement`, `Weapons`, `Interactions`, `Enemies`, `UI`), 3D HRTF positional `PannerNode` remote playback, persistent `localStorage` Audio Settings panel with collapsible category controls, and implemented WAV assets:
  - Level 0 `60Hz` electrical hum ambience (`background60HzElectricHum.wav`)
  - Dynamic sanity-driven heartbeat loop (`heartbeat.wav`)
  - Walking and running footsteps (`walking.wav`, `running.wav`)
  - Beretta Px4 pistol gunfire (`pistolFire.wav`) and pistol/shotgun reload (`reload.wav`)
  - Item pickup (`pickingUp.wav`), Almond Water / Energy Drink consumption (`drinkingDrink.wav`), and Sanity Pill consumption (`pillBottleEat.wav`)

---

## Technical Architecture

- **Client Rendering (Three.js r147)** — Renders the 3D Level 0 environment, brushed-metal staging lobby, first-person viewmodels, remote player characters, lighting, post-processing shader, and HUD overlays directly in the browser (`multiplayer.html`, `js/multiplayer/`).
- **Multiplayer Server & WebSockets (Node.js + `ws`)** — Standalone HTTP and WebSocket server (`server/index.js`, `server/room_manager.js`, `server/protocol.js`) managing room lifecycles, movement synchronization, and state broadcasts on port `8749`.
- **Server-Authoritative Gameplay State** — Room item spawns, pickups, fixed ammunition budgets, inventory updates, consumable effects, damage/downed/revival checks, sanity decay, and exit door unlocks are validated on the server.
- **Saber AI Simulation (Yuka)** — Server-side AI simulation built on vendored `yuka` (`server/ai/`) computing line-of-sight, sound propagation, path navigation, stagger timers, and encounter pacing while broadcasting snapshots to room clients.
- **Web Audio API Mixer** — Centralized `MultiplayerAudioManager` (`js/multiplayer/audio_manager.js`, `ambient_audio.js`, `audio_settings_ui.js`) routing local and positional remote voices through category and master gain nodes with persistent user preferences.

---

## Current Development Status

Saber Killer is under active development toward an initial **0.1.0** milestone and has not been publicly released yet.

- **Completed in the current codebase**: Core two-player Level 0 survival gameplay, redesigned staging lobby, inventory/weapon/ammo/key/revival loops, Budget-Backrooms-calibrated sanity and heartbeat systems, dual server-authoritative Saber AI with observation tooling, and the shared multiplayer audio architecture with ambience, movement, gunfire, reload, pickup, consumable sounds, and Audio Settings UI.
- **In progress / planned before 0.1.0**: Remaining audio integrations (dedicated enemy attack/vocal cues and UI sounds, plus shotgun-specific firing audio if added), exposing room difficulty selection in the lobby UI, consolidating active feature branches into `master`, and final end-to-end release testing.

---

## Running the Game

### Prerequisites
- **Node.js** (v18+ recommended, with ES module and `node:test` support)

### 1. Install Server Dependencies
From the repository root:

```bash
cd server
npm install
cd ..
```

### 2. Start the Multiplayer Server
Standard mode (default port `8749`, configurable via `PORT`):

```bash
node server/index.js
```

Or enable developer tools (render/lighting comparison `[F2]`, world placement editor `[F4]`, and Saber AI Observation Deck `[F6]`):

```bash
node server/index.js --dev-rendering
```

Optional vending stock override: `--vending-stock=<count>` (defaults to `5`).

### 3. Open the Game
With the server running, open a modern WebGL-capable browser:

- **Multiplayer Survival Mode**: `http://localhost:8749/multiplayer.html`
- **Legacy Story Mode**: `http://localhost:8749/`

### 4. Controls (Multiplayer)
- `W A S D` — Move (`Shift` to sprint)
- `Mouse` — Aim (click viewport for pointer lock; `Esc` unlocks cursor or closes open modals)
- `Left Click` — Fire equipped weapon or use held consumable
- `Right Click` — Drop held item
- `R` — Reload active firearm
- `E` — Interact / Pick up item / Use vending machine / Revive teammate / Unlock exit
- `Tab` — Open or close Inventory & Equipment panel
- `1`–`0` / `Mouse Wheel` — Select hotbar slot

### Automated Tests
Server and audio/UI unit test suites can be run via Node's built-in test runner:

```bash
node --test server/*.test.js
```

---

## Documentation
- [Asset Credits & Licenses](assets/CREDITS.md)
- [Development Roadmap (Legacy Story Mode)](ROADMAP.md)
- [Progress Log (Legacy Story Mode)](PROGRESS.md)
