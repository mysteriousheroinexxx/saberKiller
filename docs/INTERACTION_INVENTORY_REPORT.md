# Saber Killer — Full Player Inventory & Hotbar Implementation Report

## 1. Executive Summary

This milestone completes the full player-facing inventory and quick-access hotbar experience for multiplayer Survival Mode on Level 0 in Saber Killer. Building upon the interaction and networking foundation, players now have seamless access to a 10-slot persistent gameplay hotbar, an expandable 30-slot backpack inventory modal (`Tab` / `Escape`), contextual item inspection, physical world dropping with real-time multi-client synchronization, and authoritative server-validated item consumption.

Key Accomplishments:
- **10-Slot Quick-Access Hotbar**: Permanently displayed at the bottom of the HUD with guaranteed vertical stacking clearance above the stamina gauge. Keys `1`–`9` select slots 1–9, and Key `0` selects slot 10.
- **Integrated Starting Loadout**: Starting equipment is automatically populated into hotbar slots 1–3 on spawn:
  - Slot 1 (Index 0): Beretta Px4 Storm Pistol
  - Slot 2 (Index 1): Stagecoach Double-Barrel Shotgun
  - Slot 3 (Index 2): Tactical Flashlight
  - Slots 4–10 (Indices 3–9): Reserved for collected supplies and consumables.
- **30-Slot Full Inventory Modal (`Tab` / `Escape`)**: Organized into 10 hotbar slots and 20 configurable backpack storage slots ($5\times4$ grid). Toggling the modal frees the mouse cursor, suspends movement and weapon discharge, keeps the room simulation active without pausing, and allows seamless slot swapping and stack management.
- **Item Inspection Details**: Selecting any filled inventory or hotbar slot renders high-fidelity metadata (display name, item category, descriptive narrative, and resource effect statistics).
- **Physical World Dropping & Stacking**: Dropping an item safely calculates a forward drop position on the floor in front of the player, spawns an interactive physical 3D world item via `ITEM_SPAWNED` across all connected peers, and supports both single-item immediate drops and multi-item stack quantity selection.
- **Server-Authoritative Item Consumption**: Medical kits (+50 HP), Almond Water (+35 Sanity), Sanity Pills (+60 Sanity), Energy Drinks (+100 Stamina, +25% Sprint Speed for 15s), Batteries (+50 Flashlight charge), and Ammunition Boxes (+12 Pistol rounds) are validated and deducted on the server before client-side effect dispatch.
- **Multiplayer State Isolation & Circular Lifecycle**: Two concurrent Chromium clients verified the full circular lifecycle: Player A collects item -> stacks items -> drops partial stack into world -> Player B approaches dropped item -> Player B collects item -> Player A's inventory remains unaffected.
- **Zero Story Mode Regression**: Single-player Story Mode files (`index.html`, `js/engine.js`, `js/levels/level0.js`, `js/levels/level0_env.js`) maintain a strict 0-line diff against `master`.

---

## 2. Architecture & Data Flow

```
                      +-----------------------------+
                      |     Client A (LocalPlayer)  |
                      | - Hotbar (10 Slots)         |
                      | - Backpack (20 Slots)       |
                      | - Active Held Item / Weapon |
                      +--------------+--------------+
                                     |
               +---------------------+---------------------+
               | (Left-Click / Use)                        | (Right-Click / Drop)
               v                                           v
     ITEM_USE_REQUEST                            ITEM_DROP_REQUEST
   (slotIndex, instanceId)                     (slotIndex, qty, dropPos)
               |                                           |
               +---------------------+---------------------+
                                     |
                                     v
                        ===========================
                           WebSocket Connection
                        ===========================
                                     |
                                     v
                      +-----------------------------+
                      |     Saber Killer Server     |
                      | - Validate Player & Room    |
                      | - Verify Item Existence     |
                      | - Authoritative Inventory   |
                      | - Decrement / Split Slot    |
                      +--------------+--------------+
                                     |
         +---------------------------+---------------------------+
         | (If Use Request)                                      | (If Drop Request)
         v                                                       v
  ITEM_USE_RESPONSE                                       ITEM_DROP_RESPONSE
  INVENTORY_UPDATE                                        INVENTORY_UPDATE
         |                                                       |
         |                                           +-----------+-----------+
         |                                           |                       |
         | Broadcast (only for drop)                 v                       v
         +---------------------------------> ITEM_SPAWNED              ITEM_SPAWNED
                                              (Client A)                (Client B)
                                                   |                         |
                                                   v                         v
                                          +-----------------+       +-----------------+
                                          | WorldItemManager|       | WorldItemManager|
                                          | Spawn 3D Object |       | Spawn 3D Object |
                                          +-----------------+       +-----------------+
                                                                             |
                                                                             | (Approach & E)
                                                                             v
                                                                    ITEM_PICKUP_REQUEST
```

---

## 3. UI Component System & Control Bindings

### 3.1 Hotbar Layout & Visual Hierarchy
- **Positioning**: Bottom center fixed container (`#bb-hotbar-container`).
  - Hotbar bounds: `top: calc(100vh - 87px)`, `height: 56px`.
  - Stamina bar bounds: `top: calc(100vh - 19px)`, `height: 12px`.
  - Margin: 12px vertical buffer ensuring zero visual overlap or occlusion.
- **Styling**: Monochromatic Budget-Backrooms palette:
  - Slots: $48\times48\text{px}$, background `rgba(18, 18, 16, 0.85)`, border $1\text{px}$ solid `#3a3832`.
  - Active Selection: Border `#ffcc00`, box-shadow `0 0 10px rgba(255, 204, 0, 0.45)`, gold keycap badge.
  - Keycap Number: Upper-left corner, font-size $10\text{px}$, color `#8a887d` (or `#ffcc00` when selected).
  - Quantity Badge: Lower-right corner, font-size $11\text{px}$ bold, `#edece6`.

### 3.2 Full Inventory Modal (`Tab` / `Escape`)
- **Container**: Translucent fullscreen overlay (`rgba(10, 10, 8, 0.78)`) hosting a centered modal (`rgba(18, 18, 16, 0.96)`, border $2\text{px}$ solid `#3a3832`, box-shadow `0 8px 32px rgba(0,0,0,0.85)`).
- **Structure**:
  - **Header**: Title `"SURVIVAL INVENTORY"` with slot occupancy indicator (`"X / 30 SLOTS"`) and Close button (`[ESC]`).
  - **Upper Section**: 10 Hotbar Quick-Access Slots ($1\times10$ grid).
  - **Lower Section**: 20 Backpack Storage Slots ($5\times4$ grid).
  - **Side Panel**: Contextual Item Inspection Inspector rendering:
    - High-contrast $48\times48\text{px}$ vector SVG icon.
    - Title, category badge (`WEAPON`, `MEDICAL`, `CONSUMABLE`, `EQUIPMENT`).
    - Flavour description text.
    - Dynamic effect statistics breakdown.
    - Direct action buttons (`[USE / CONSUME]`, `[DROP]`).

### 3.3 Context Menu & Drop Quantity Selector Modal
- **Context Menu**: Triggered via right-clicking any occupied slot.
  - Actions: `Use / Consume`, `Drop`, `Assign to Hotbar`, `Inspect`.
  - Click-outside detection auto-dismisses menu.
- **Drop Quantity Selector**:
  - Automatically bypassed for single-item slots (`qty === 1`), immediately dropping the unit.
  - Displayed for multi-item stacks: slider and numeric stepper defaulting to `1`, clamped between `1` and `maxStack`, with `"CONFIRM DROP"` and `"CANCEL"` buttons.

### 3.4 Key & Mouse Input Scheme

| Input | Navigate Mode / Gameplay | Full Inventory Open (`Tab`) |
| :--- | :--- | :--- |
| `Keys 1`–`9` | Select Hotbar Slots 1–9 | Assign selected item to Hotbar Slot 1–9 |
| `Key 0` | Select Hotbar Slot 10 | Assign selected item to Hotbar Slot 10 |
| `Tab` | Open Full Inventory Modal | Close Full Inventory Modal |
| `Escape` | Pause / Game Menu | Close Full Inventory Modal |
| `Left Click` | Fire equipped weapon / Consume held item | Select slot / Click UI buttons |
| `Right Click` | Drop 1 unit of held item into world | Open contextual item menu |
| `WASD` | Normal FPS Player Movement | Suppressed (modal open) |
| `Mouse Look` | First-Person Camera Control | Pointer freed for UI interaction |

---

## 4. Item Definitions & Consumable Effects

| Item ID | Display Name | Category | Stack | Effect / Resource Restored |
| :--- | :--- | :--- | :---: | :--- |
| `weapon_pistol` | Beretta Px4 Storm | `weapon` | 1 | 9mm Semi-Automatic Pistol (12-round mag). |
| `weapon_shotgun` | Stagecoach Shotgun | `weapon` | 1 | Double-barrel break-action shotgun (2 shells). |
| `equipment_torch`| Tactical Flashlight | `equipment`| 1 | High-intensity spotlight; consumes battery over time. |
| `first_aid` | First Aid Kit | `medical` | 1 | Restores $+50\text{ HP}$ (up to $100\text{ HP}$ maximum). |
| `almond_can` | Almond Water | `consumable`| 4 | Restores $+35\text{ Sanity}$ and $+50\text{ Hydration}$. |
| `sanity_pill` | Sanity Pills | `medical` | 4 | Restores $+60\text{ Sanity}$. |
| `energy_drink` | Energy Drink | `consumable`| 4 | $+100\text{ Stamina}$ and $+25\%\text{ Sprint Speed}$ for $15\text{s}$. |
| `aa_battery` | Battery Pack | `equipment`| 8 | Restores $+50\%\text{ Flashlight Battery Charge}$. |
| `ammo_box` | Ammunition Box | `consumable`| 4 | Restores $+12\text{ Pistol Rounds}$. |
| `doorKey` | Level 0 Keycard | `key` | 1 | Authoritative Level 0 security clearance. |

---

## 5. Verification Matrix — All 21 Scenarios Passed

All 21 end-to-end scenarios were executed and verified against a live multiplayer server using headless Chromium instances via Chrome DevTools Protocol (`scratch/verify_inventory_hotbar.js`):

| # | Scenario Objective | Verification Criteria | Observed Result | Status |
| :-: | :--- | :--- | :--- | :-: |
| **1** | Default Starting Loadout | Slots 0, 1, 2 populated with Pistol, Shotgun, Flashlight. | Slots 0–2 initialized; slot 3 empty; 30 slots total. | **PASS** |
| **2** | Hotbar HUD Layout & Clearance | 10 slots rendered; vertical buffer above stamina bar. | Hotbar `top: 457, bottom: 513`; Stamina `top: 525`; 12px margin. | **PASS** |
| **3** | Two-Client Room Join | Client A creates room; Client B joins; isolated state. | Client A (`p_1`) & Client B (`p_2`) connected to `TESTROOM`. | **PASS** |
| **4** | World Item Collection into Slot 4 | Target item picked up into first free hotbar slot. | Player A collected `table_first_aid_01` into slot 3 (`inst_first_aid_*`). | **PASS** |
| **5** | Peer World Despawn Sync | Collected item instantly despawns on remote clients. | `table_first_aid_01` became invisible and marked collected on Player B. | **PASS** |
| **6** | Hotbar Selection (Keys 1–3) | Slot 1 activates Pistol; Slot 2 Shotgun; Slot 3 Torch. | Viewmodels and spotlight toggled correctly according to selection. | **PASS** |
| **7** | Consumable Selection (Key 4) | Slot 4 activates held 3D consumable container. | Weapon viewmodel lowered; held item container active. | **PASS** |
| **8** | Unarmed Selection (Key 0) | Slot 10 selects empty slot; viewmodels hidden. | Weapon set to `-1`; hands empty. | **PASS** |
| **9** | Full Inventory Modal (`Tab`) | Opens 30-slot grid; frees mouse; maintains room tick. | Modal displayed (`flex`); movement suppressed; simulation active. | **PASS** |
| **10** | Modal Dismissal (`Escape`) | Modal cleanly closes; input returned to gameplay. | Modal display set to `none`; player control restored. | **PASS** |
| **11** | Authoritative Item Consumption | First Aid Kit heals 50 HP; item decremented from slot. | Player A HP restored from 60 to 100; slot 3 cleared to null. | **PASS** |
| **12** | Item Stacking in Inventory | Collecting same type merges into existing stack. | Player A picked up two Almond Cans; merged to quantity 2 in slot 3. | **PASS** |
| **13** | Partial Stack World Drop | Dropping 1 from stack of 2 leaves 1 in inventory. | Player A dropped 1 can; remaining quantity in slot 3 became 1. | **PASS** |
| **14** | Dropped Item World Spawning | Server spawns dynamic 3D item safely in front of player. | `drop_almond_can_*` spawned at `[42, 0.02, -186.9]`. | **PASS** |
| **15** | Peer 3D Scene Synchronization | Dropped item immediately visible and interactive for peer. | Player B received `ITEM_SPAWNED` and rendered visible object. | **PASS** |
| **16** | Peer Pickup of Dropped Item | Remote player approaches and collects dropped item. | Player B approached drop; picked up into slot 3; item despawned. | **PASS** |
| **17** | Single-Item Full Stack Drop | Dropping final remaining item clears slot to null. | Player A dropped last can; slot 3 transitioned to null. | **PASS** |
| **18** | Malicious / Invalid Drop Rejection | Dropping from empty slot or invalid quantity rejected. | Server rejected drop attempt with `"Item not found in inventory"`. | **PASS** |
| **19** | Inventory Isolation | Actions of Player A do not leak into Player B inventory. | Player A slot 3 empty; Player B inventory contains 1 Almond Can. | **PASS** |
| **20** | Weapon & Equipment Integrity | Firing pistol consumes ammo; torch consumes battery. | Pistol fired, bullets $12 \to 11$; battery drained $100 \to 99.5\%$. | **PASS** |
| **21** | Visual Artifacts & UI Proof | Clean screenshots captured and archived. | All 5 inspection and gameplay PNG screenshots captured. | **PASS** |

---

## 6. Generated Visual Artifacts

The following visual artifacts were generated and saved in the artifact directory:

1. [inventory_01_gameplay_hotbar.png](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/inventory_01_gameplay_hotbar.png):
   10-slot gameplay hotbar during active navigation, displaying pistol (1), shotgun (2), flashlight (3), collected energy drinks (4, stack of 3), empty slots (5–10), and clear vertical spacing above the stamina meter.
2. [inventory_02_full_inventory_modal.png](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/inventory_02_full_inventory_modal.png):
   Full 30-slot modal opened via `Tab`, showing 10 hotbar slots, 20 storage slots, slot occupancy count, and translucent backdrop.
3. [inventory_03_item_inspection_details.png](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/inventory_03_item_inspection_details.png):
   Selected item inspection details panel showing Energy Drink metadata, narrative lore, stamina boost stat, speed multiplier stat, and direct action triggers.
4. [inventory_04_context_menu_and_drop_modal.png](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/inventory_04_context_menu_and_drop_modal.png):
   Drop Quantity Selector modal displaying stack split slider, clamped numeric input, and confirmation controls.
5. [inventory_05_dropped_world_item_sync.png](file:///home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/inventory_05_dropped_world_item_sync.png):
   In-game 3D rendering of dropped Almond Water item resting on the carpeted floor, synchronized across clients.

---

## 7. Scope Isolation & Git Verification

- **Story Mode Files**:
  - `index.html`: **0 diff lines**
  - `js/engine.js`: **0 diff lines**
  - `js/levels/level0.js`: **0 diff lines**
  - `js/levels/level0_env.js`: **0 diff lines**
- **Preserved Untracked Research**:
  - `docs/SABER_AI_IMPLEMENTATION_BRIEF.md`
  - `docs/SABER_AI_VALIDATION_REPORT.md`
  - `saber_eval.html`
  - `saber_prototype/`
  - `yuka/`
- **Branch**: `feature/interaction-inventory-foundation`
- **No Master Merging**: Changes remain strictly on `feature/interaction-inventory-foundation`.
