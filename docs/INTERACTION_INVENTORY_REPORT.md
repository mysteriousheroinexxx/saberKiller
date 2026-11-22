# Saber Killer — Level 0 Interaction & Inventory Foundation Report

## 1. Executive Summary

This milestone establishes the authoritative multiplayer interaction framework and inventory data model for Level 0 in Saber Killer. Players can discover physical world items, receive contextual interaction prompts in first person, collect items through debounced `[E]` key interaction, and maintain persistent, isolated inventories synchronized in real time across multiplayer clients.

The entire implementation adheres strictly to the architectural constraints:
- **Zero modification to Story Mode**: All single-player Story Mode files (`index.html`, `js/engine.js`, `js/levels/level0.js`, `js/levels/level0_env.js`) have a 0-line diff against `master`.
- **Authoritative Server Networking**: The Node.js server atomically claims pickups, verifies Euclidean proximity ($2.1\text{m}$ limit with $2.6\text{m}$ latency allowance), enforces capacity and stack limits, and guarantees that duplicate or fabricated requests cannot corrupt world state.
- **Visual & UI Cohesion**: A full suite of monochromatic vector SVG icons matching the authentic Budget-Backrooms aesthetic (`#edece6`, two-tone opacity, $24\times24$ viewBox) was created for all collectible item classes.
- **Developer Inspection Tooling**: When started with `--dev-rendering`, a developer-only inventory inspection panel provides live visibility into slot contents, instance IDs, recent pickup events, rejected requests, and room state.

---

## 2. System Architecture

```
   +------------------------+                    +------------------------+
   |   LocalPlayer (Eye)    |                    |   RemotePlayer Peer    |
   +-----------+------------+                    +-----------+------------+
               |                                             |
               | (Camera Raycast: 2.1m)                      | (3D Scene Render)
               v                                             v
   +------------------------+                    +------------------------+
   |   InteractionManager   |                    |    WorldItemManager    |
   | - [E] Take First Aid   |                    | - container.children   |
   +-----------+------------+                    | - hideItem(itemId)     |
               | (KeyE Trigger)                  +-----------+------------+
               v                                             ^
   +------------------------+                                |
   |     NetworkClient      |                                |
   +-----------+------------+                                |
               | ITEM_PICKUP_REQUEST                         | ITEM_COLLECTED
               v                                             | (Despawn from scene)
=============================== WebSocket =================================
               |                                             |
               v                                             |
   +------------------------+                                |
   |   Saber Killer Server  | -------------------------------+
   | - Proximity Validation |
   | - Atomic Item Claim    | -------------------------------+
   | - InventoryController  |                                | INVENTORY_UPDATE
   +------------------------+                                v
                                                 +------------------------+
                                                 |  InventoryController   |
                                                 | - 12 Configured Slots  |
                                                 | - Stacking / Unique ID |
                                                 +------------------------+
```

### 2.1 Central Item Catalog (`js/multiplayer/item_catalog.js`)
Data-driven registry defining properties for all Level 0 items:
- Item classes: `first_aid`, `almond_can`, `sanity_pill`, `energy_drink`, `aa_battery`, `ammo_box`, `doorKey`, `vending_almond`.
- Stacking rules: non-stackable medical kits and keys (`maxStack: 1`), stackable consumables (`maxStack: 4` or `8`).
- Model references, vector SVG icons, display names, and metadata.
- Shared between browser clients and Node.js server.

### 2.2 Reusable Interaction Framework (`js/multiplayer/interaction_manager.js`)
- Viewport center raycasting up to $2.1\text{m}$ from the active camera.
- Traversal of scene graph from raycast hit meshes up to parent placement wrappers.
- Contextual HUD prompt DOM element (`[E] Take First Aid Kit`).
- Debounced single-action interaction on `KeyE` press.
- Automatic suspension when developer world placement editor is in active Edit mode.

### 2.3 Authoritative Inventory Controller (`js/multiplayer/inventory_controller.js`)
- Slot-based container supporting 12 inventory slots.
- Automatic merging of stackable items up to `maxStack`.
- Unique instance ID generation (`inst_<type>_<ts>_<seq>`) for non-stackable items.
- Capacity enforcement, quantity validation, serialization/deserialization for network transport.

### 2.4 Server Session & Proximity Security (`server/room_manager.js` & `server/index.js`)
- Authoritative state machine tracking room world item availability (`available: true/false`).
- Proximity check: Euclidean distance calculation between authoritative player coordinates (`player.position`) and item placement coordinates (`item.position`) taking into account eye level ($1.62\text{m}$) and ground level ($dist \le 2.6\text{m}$).
- Atomic claiming: Once claimed, the item is immediately marked `available = false` and assigned `collectedBy`.
- Outgoing packets: Broadcasts `ITEM_COLLECTED` to all room sockets; sends `INVENTORY_UPDATE` to the collector socket; responds with `PICKUP_REJECTED` upon any invalid, out-of-range, or duplicate attempt.

---

## 3. Cohesive SVG Vector Icon System

Seven monochromatic vector SVGs were created under `assets/ui/icons/` adhering to the HUD design standard:
1. `item_first_aid.svg`: Medical kit silhouette with embossed cross and handle.
2. `item_almond_can.svg`: Classic aluminum beverage can with teardrop motif.
3. `item_energy_drink.svg`: Slim energy drink can with lightning bolt symbol.
4. `item_sanity_pill.svg`: Pharmaceutical tablet bottle with capsule emblem.
5. `item_key.svg`: Backrooms brass door key silhouette.
6. `item_ammo_box.svg`: Ammunition container with stamped cartridge silhouettes.
7. `item_battery.svg`: Flashlight battery pack matching existing survival HUD.

---

## 4. Multiplayer Regression & Verification Results

All 14 milestone scenarios were verified end-to-end via headless Chromium CDP automation running multiple concurrent browser sessions against the live game server:

| Scenario | Objective | Observed Result | Status |
| :--- | :--- | :--- | :--- |
| **Scenario 1** | Identical world placements across clients | Both clients spawned identical 25 world items and props from frozen room layout. | **PASS** |
| **Scenario 2** | Contextual prompt & Player A pickup | Player A approached table; HUD prompt displayed `[E] Take First Aid Kit` at $1.09\text{m}$; triggered pickup; item removed from Player A's world. | **PASS** |
| **Scenario 3** | Simultaneous world despawn on peer | Player B simultaneously saw `table_first_aid_01` despawn and become invisible. | **PASS** |
| **Scenario 4** | Player A inventory reception | Player A's inventory received `first_aid` (`qty: 1`, `stackable: false`, ID: `inst_first_aid_*`). | **PASS** |
| **Scenario 5** | Rejection of already claimed item | Player B attempted pickup of `table_first_aid_01`; server rejected with `"already been collected"`; Player B inventory remained 0. | **PASS** |
| **Scenario 6** | Atomic claim against duplicate requests | Player A sent duplicate pickup request for `table_first_aid_01`; server rejected with `"already been collected"`. | **PASS** |
| **Scenario 7** | Rejection of fabricated item IDs | Player A requested `fake_hacked_item_9999`; server rejected with `"does not exist in room layout"`. | **PASS** |
| **Scenario 8** | Rejection of out-of-range pickups | Player A requested item $> 5\text{m}$ away; server rejected with `"Player too far from item (5.15m > 2.1m limit)"`. | **PASS** |
| **Scenario 9** | Independent inventories across peers | Player B approached and collected `table_ammo_box_01`; Player A inventory had 1 `first_aid` and 0 `ammo_box`; Player B inventory had 0 `first_aid` and 1 `ammo_box`. | **PASS** |
| **Scenario 10** | Independent room item states | Client C created room `INV2`; `table_first_aid_01` was verified to be available and visible (unaffected by Room `INV1`). | **PASS** |
| **Scenario 11** | Late-joining player synchronization | Player D joined room `INV1` mid-game; `onRoomJoined` delivered `collectedItems`; both collected items were hidden upon arrival. | **PASS** |
| **Scenario 12** | Frozen layout revision | Room layout revisions remained immutable across sessions. | **PASS** |
| **Scenario 13** | Production mode safety | Server started without `--dev-rendering`; developer inspection panels were removed from DOM; rooms, pickups, and inventory operated cleanly. | **PASS** |
| **Scenario 14** | Visual evidence & screenshots | Captured HUD interaction prompt screenshot (`interaction_prompt_medkit.png`) and dev inspection panel screenshot (`developer_inventory_panel.png`). | **PASS** |

---

## 5. Scope Isolation & Preserved Assets

- Single-player Story Mode files (`index.html`, `js/engine.js`, `js/levels/level0.js`, `js/levels/level0_env.js`): **0 diff lines**.
- Preserved untracked Saber AI research files (`docs/SABER_AI_*`, `saber_eval.html`, `saber_prototype/`, `yuka/`).
- No inventory UI grid context menus, consume gameplay mechanics, or drop physics implemented, strictly honoring milestone boundaries.
