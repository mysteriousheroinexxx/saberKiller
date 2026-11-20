# SABER KILL SIMULATOR — a Backrooms dungeon-crawler FPS

A wave-survival shooter in the spirit of id Software's DOOM that grew into a
multi-level, Backrooms-inspired dungeon crawler: you vs. an endless horde of
Saber (Fate's Artoria) across five procedurally-built levels, with friendly
NPCs to talk to, trade with, and do favors for. The world, textures and sounds
are 100% procedurally generated in the spirit of .kkrieger / werkkzeug3; the
Saber characters and handgun/shotgun are GLB models you supplied, animated with
real Mixamo clips. See `assets/CREDITS.md` for asset provenance and licenses.

## Play

Serve over HTTP (the GLB models need XHR, which file:// blocks):

    cd doom-zombies
    python3 -m http.server 8734
    # visit http://127.0.0.1:8734/

Click CLICK TO PLAY. Mouse is captured via pointer lock; ESC pauses.
(If a GLB can't load, the game falls back to procedural box enemies.)

## Controls

    WASD / arrows   move (arrows also turn)
    Mouse           aim
    Click / hold    shoot
    Left Alt        toggle between free cursor and pointer lock
    R               reload current weapon (also reloads automatically on empty)
    1 / 2           pistol / shotgun
    Shift           sprint
    E               talk to a nearby NPC
    Up / Down       navigate dialogue choices; Enter / Space select
    I               inventory (use Almond Water, see scrap/keys)
    Esc             pause

Headshots deal double damage. Kills drop scrap (currency) and each cleared wave
spawns health/ammo resupply. Waves grow forever — survive as long as you can.

## The five levels

Find the glowing NOCLIP exit rift to descend through the levels (the chain wraps):

    THE ARENA            the starting combat hub (tech/brick/hell walls)
    LEVEL 0 — THE LOBBY  Backrooms: mono-yellow wallpaper, damp carpet, buzzing
                         flickering fluorescents, randomly segmented rooms,
                         wall outlets, torn wallpaper, whispers, dark pockets
    LEVEL 1 — HABITABLE  open concrete warehouse, column grid, crates/barrels
    LEVEL 2 — PIPE DREAMS narrow maintenance tunnels, wall pipes, steam puffs
    LEVEL 3 — THE DUNGEON stone chambers, flickering torches, spike traps

Each level has its own layout generator, textures, lighting, ambient sound, and
enemy balance (density + toughness). A fog-of-war minimap reveals as you explore
(the arena shows the full map). Settings (sensitivity/volume/FOV) and progression
(level, kills, inventory, shop stock, quests) persist in localStorage.

## NPCs, dialogue, trading & quests

Friendly NPCs idle in the levels (the Mixamo sorcerer in the Lobby, M.E.G. Agent in the
warehouse, Delver in the dungeon). Approach and press E for a visual-novel dialogue
(portrait, typewriter text, branching choices):

- The Wanderer shares lore and gifts Almond Water.
- The M.E.G. Agent runs a shop: buy bullets / health / keys with scrap, sell
  Almond Water. Stock is limited and persists ("(N left)" / "SOLD OUT").
- The Delver offers a favor quest: bring 2 Almond Water for +5 scrap and a key.

In Level 0, the exit gate is sealed. Find the Summoner Wizard and agree to help gather
the three reagents. Sabers rush the wizard while his 40-second portal rite is underway;
keep him alive, then reach the gate once the portal opens.

Currency is scrap (dropped by kills, gifted, and traded). Almond Water heals +40 HP
from the inventory (I). Keys are a quest/trade reward.

## How the two reference repos were used

- id-Software/DOOM (GPL source release): spiritual basis. The original is
  1997 C code requiring proprietary DOOM WAD data (not redistributable),
  so this is an original homage: grid level, hitscan weapons, status-bar
  HUD with a pixel marine face, automap minimap, fog-lit corridors, waves.
- jaromil/kkrieger-werkkzeug3: asset philosophy. The Windows-only toolchain
  can't run here, so its ideas are reimplemented in JS:
    * KTG-style texture pipeline: value-noise/fbm/turbulence composed into
      generation histories (tech panels, brick, hell flesh, yellow wallpaper,
      damp carpet, ceiling tiles, concrete, stone, crate, blood, gun metal...).
    * V2-style sound: every effect synthesized live with WebAudio — zero
      audio files (ambient drone / fluorescent hum, whispers, combat SFX).

## The Saber horde (Mixamo-animated GLBs)

Enemies use your Mixamo-rigged Saber GLBs with real animation clips:
  - saberWalking_clean.glb   base mesh + rig + walk cycle
  - saberJumpKickAndPunch_clean.glb / saberPunches_clean.glb  attack combos
  - saberFalling_clean.glb   death fall (she falls backward on her own)

Each enemy is a SkeletonUtils.clone with an AnimationMixer: walk loops while
chasing, a random attack combo plays in melee range, and the fall clip plays
on death (then the corpse lingers, sinks, and is disposed). The original
saber.glb supplies the skin texture (Mixamo strips materials on export), and
a slight emissive lift keeps the dark armor readable in the dim arena.

### The "_clean" GLBs — why they exist (important)

Your raw Mixamo exports have a unit mismatch: the mesh geometry is in
METERS while the skeleton is in CENTIMETERS under an Armature scaled 0.01
(plus a 90° X rotation). three.js then renders the mesh 100x too small and
skinning stretches it apart / floats it through the ceiling. They also
contained a stray "Icosphere" object.

The fix (Blender 5.3, headless): import the GLB, delete stray non-skinned
objects, set the Armature scale to 1.0 (mesh + bones stay consistent, just
large), and re-export. That yields the *_clean.glb files. In-game the model
is scaled to 1.85 m and grounded using a TRUE skinned bounding box
(skinnedWorldBox() deforms every vertex through the skeleton) — not the
bind-pose geometry box, which lies about where the feet/head actually are.

To regenerate a clean GLB from a new Mixamo export:

    ~/bin/blender-5.3.0-linux-x64/blender --background --python tools/blender_clean.py -- assets/yourClip.glb assets/yourClip_clean.glb

## Weapons (handgun.glb / shotgun.glb)

First-person viewmodels loaded from your GLBs, auto-oriented so the barrel
points forward and the grip hangs down (the shotgun's muzzle/grip axes are
solved numerically from the vertices; the pistol uses a fixed flip). They
inherit the existing bob/recoil/switch animation and muzzle flash.

## Blender asset pipeline

Low-poly props are generated headless in Blender 5.3 and loaded/instanced in-game:

    ~/bin/blender-5.3.0-linux-x64/blender --background --python tools/blender_prop.py -- assets/prop_barrel.glb

`tools/blender_prop.py` builds the metal barrel; `tools/blender_clean.py`
normalizes Mixamo character exports; `tools/blender_animation.py` exports compact
animation-only Mixamo rigs; `tools/blender_rig.py` is the legacy procedural rig.
The Lobby sorcerer uses the idle character mesh, with a matching running clip loaded
and available for later movement states. Its base-color texture is extracted from the
original T-pose GLB and reused across the animated mesh's matching UV layout.

## Tech

- Three.js r147 (vendored, MIT) — upgraded from r128 so cloned SkinnedMeshes
  deform correctly while moving.
- `js/engine.js` owns reusable world/combat systems; `js/systems/` holds shared
  gameplay modules such as weapon definitions and reload timing; `js/levels/`
  contains level-specific story and encounter logic. The HUD remains in `index.html`.
- Vendored three.min.js / GLTFLoader / SkeletonUtils.
- InstancedMesh walls/trim/pipes, pooled particles/tracers/decals, per-enemy
  material + mixer + skeleton.boneTexture disposal between waves.
- Per-level layout generators with a connectivity bridge pass (ensureConnected)
  so no floor pocket is ever sealed off; reachability flood-fill filters spawns.

## Verified by automated browser playthrough

Full audit across all five levels: every floor cell reachable, NPCs talkable,
combat kills register, trades/quests work, full portal chain, zero console
errors. Mixamo Saber enemies coherent, correctly sized (head below the 3.4 m
ceiling), facing the player; walk/attack/death clips play; death falls backward
with blood decal + scrap drops; pistol & shotgun viewmodels point forward;
24-enemy horde benchmarked and disposal leaks fixed. See PROGRESS.md for the
increment-by-increment build log and ROADMAP.md for the plan (all milestones done).

## Debug console API

    G.state            live game state
    G.start()          start without pointer lock
    G.restart()        full reset
    G.setAuto(bool)    pause/resume the rAF sim (for deterministic G.tick tests)
    G.tick(sec)        advance the sim by fixed steps
    G.spawn(n) / G.spawnAt(cx,cz)
    G.aimAtNearest()   auto-aim (testing)
    G.setLevel(id) / G.nextLevel() / G.transition()
    G.progress / G.addItem(k,n)
    G.teleport(cx,cz)  G.setHp(v)  G.hurt(v)  G.addAmmo()  G.killAll()
