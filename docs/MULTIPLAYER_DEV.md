# Saber Killer — Multiplayer Architecture & Phase 1 Prototype Guide

This document details the architecture, network protocol, asset pipeline, and deployment instructions for the multiplayer module of **Saber Killer** (Three.js r147 browser FPS).

---

## 1. Architectural Principles & Isolation

The multiplayer system is architected as an **independent, isolated module** running alongside the existing single-player game.

### Strict Single-Player Protection
To guarantee that Story Mode remains 100% stable and regression-free:
- **No modifications to core single-player files**: `js/engine.js`, `js/levels/level0.js`, `index.html`, weapon systems, damage systems, Saber AI, blood VFX, and collision routines remain completely untouched.
- **Dedicated Entry Point**: Multiplayer runs from its own entry point: [doom-zombies/multiplayer.html](file:///home/mhxxx/AI/test2/doom-zombies/multiplayer.html).
- **Environment Decoupling**: The Level 0 PBR environment and collision maps are loaded directly from `js/levels/level0_env.js` without initializing single-player story managers, HUDs, or Makima narrative sequences.
- **Zero Shared Runtime State**: Single-player and multiplayer use separate global scopes, controllers, and update loops.

---

## 2. System Overview

```
                      +---------------------------------------+
                      |       Node.js Dedicated Server        |
                      |   (server/index.js + ws library)      |
                      |   Port: process.env.PORT || 8749      |
                      +-------------------+-------------------+
                                          |
                        WebSocket JSON    |   30Hz Rate-Limited
                        Bi-directional    |   State Relaying
                                          |
                +-------------------------+-------------------------+
                |                                                   |
                v                                                   v
+-------------------------------+                   +-------------------------------+
|    Browser Client 1 (Host)    |                   |   Browser Client 2 (Joiner)   |
|   multiplayer.html (Level 0)  |                   |   multiplayer.html (Level 0)  |
| - LocalPlayerController       |                   | - LocalPlayerController       |
| - T-800 RemotePlayer (Peer)   |                   | - T-800 RemotePlayer (Peer)   |
| - TransformInterpolator       |                   | - TransformInterpolator       |
| - Physically Correct Lights   |                   | - Physically Correct Lights   |
| - Backrooms Shader Post-Pass  |                   | - Backrooms Shader Post-Pass  |
+-------------------------------+                   +-------------------------------+
```

---

## 3. Server Architecture (`server/`)

The server is implemented as a lightweight, performant Node.js service using the standard `ws` WebSocket library and Node's built-in `http` module.

### Directory Structure
```
server/
├── index.js          # HTTP static file server & WebSocket router / heartbeat / rate limiter
├── room_manager.js   # Room lifecycle, 2-player capacity, spawn assignment
├── protocol.js       # Packet types, validation schemas, payload limits (4KB)
└── package.json      # Dependencies (ws ^8.18.0)
```

### Key Server Features
1. **Dynamic Port Binding**: Listens on `process.env.PORT || 8749` (fully compatible with local environments and cloud providers like Render).
2. **Room Management**:
   - Rooms can be created with custom or auto-generated 4-character alphanumeric codes (e.g., `ROOM`, `DUAL`).
   - Maximum capacity is strictly capped at **2 players** in Phase 1.
   - Deterministic spawn point assignment:
     - Player 1: `(48.69, 0.0, -187.65)` (Facing peer)
     - Player 2: `(51.50, 0.0, -187.65)` (Facing peer)
3. **Packet Validation & Security**:
   - Message length is capped at 4KB per frame to prevent buffer flooding.
   - All inbound payloads are validated for numeric coordinate sanity (`-10000 < val < 10000`).
4. **Relay Rate Limiting**: Updates are relayed to room peers at a maximum of 30Hz to prevent network congestion.
5. **Heartbeat / Keep-Alive**: Server pings clients every 25 seconds; dead sockets terminate after 35 seconds of silence.

---

## 4. Client Subsystem (`doom-zombies/js/multiplayer/`)

The client multiplayer logic is organized into clean ES modules:

| Module | File Link | Purpose |
| :--- | :--- | :--- |
| **Main Setup** | [main.js](file:///home/mhxxx/AI/test2/doom-zombies/js/multiplayer/main.js) | Three.js r147 initialization, Level 0 PBR environment, physically correct lighting, authentic Backrooms post-processing pass, and autotest runner. |
| **Manager** | [mp_manager.js](file:///home/mhxxx/AI/test2/doom-zombies/js/multiplayer/mp_manager.js) | Orchestrates local player controller, remote player pool, and network packet dispatching. |
| **Network Client** | [network_client.js](file:///home/mhxxx/AI/test2/doom-zombies/js/multiplayer/network_client.js) | Manages WebSocket connection, automatic protocol detection (`ws:` / `wss:`), connection retry, and 20s ping. |
| **Player Controller** | [player_controller.js](file:///home/mhxxx/AI/test2/doom-zombies/js/multiplayer/player_controller.js) | Local 1st-person controller with WASD movement, Pointer Lock look, Beretta Px4 viewmodel, 1m wall collision via Level 0 handler, and 20Hz update broadcaster. |
| **Remote Player** | [remote_player.js](file:///home/mhxxx/AI/test2/doom-zombies/js/multiplayer/remote_player.js) | Full-body T-800 character model, pitch-tilting chest weapon anchor holding the Beretta Px4 pistol, and transform interpolation. |
| **Interpolation** | [interpolation.js](file:///home/mhxxx/AI/test2/doom-zombies/js/multiplayer/interpolation.js) | Snapshot interpolation buffer with an 80ms render delay, position linear interpolation (Lerp), and shortest-arc yaw spherical linear interpolation (Slerp). |

---

## 5. Network Protocol Specification

All WebSocket packets are JSON strings formatted with `type` and `data`.

### Client -> Server Messages
- **`CREATE_ROOM`**:
  ```json
  { "type": "CREATE_ROOM", "data": { "roomCode": "DUAL" } }
  ```
- **`JOIN_ROOM`**:
  ```json
  { "type": "JOIN_ROOM", "data": { "roomCode": "DUAL" } }
  ```
- **`PLAYER_UPDATE`** (Broadcast at 20Hz):
  ```json
  {
    "type": "PLAYER_UPDATE",
    "data": {
      "x": 48.69,
      "y": 0.0,
      "z": -187.65,
      "yaw": -1.5707,
      "pitch": 0.05,
      "weapon": 0,
      "timestamp": 1732203456789
    }
  }
  ```
- **`HEARTBEAT`**:
  ```json
  { "type": "HEARTBEAT", "data": { "timestamp": 1732203456789 } }
  ```

### Server -> Client Messages
- **`ROOM_JOINED`**:
  ```json
  {
    "type": "ROOM_JOINED",
    "data": {
      "playerId": "p_1",
      "roomCode": "DUAL",
      "spawn": { "x": 48.69, "y": 0.0, "z": -187.65, "yaw": -1.5707, "pitch": 0.0 },
      "players": []
    }
  }
  ```
- **`PLAYER_JOINED`**:
  ```json
  {
    "type": "PLAYER_JOINED",
    "data": {
      "playerId": "p_2",
      "spawn": { "x": 51.50, "y": 0.0, "z": -187.65, "yaw": 1.5707, "pitch": 0.0 }
    }
  }
  ```
- **`PLAYER_UPDATE`**: Relayed snapshot from remote peer with server timestamp.
- **`PLAYER_LEFT`**:
  ```json
  { "type": "PLAYER_LEFT", "data": { "playerId": "p_2" } }
  ```
- **`SERVER_ERROR`**:
  ```json
  { "type": "SERVER_ERROR", "data": { "message": "Room is full (max 2 players)." } }
  ```

---

## 6. T-800 Player Model Pipeline

### Source Model Analysis
- **Source**: `assets/t-800_blood_yes_rigged_bone_terminator_2.glb` (Sketchfab glTF 2.0).
- **Issue 1 (Deprecated Extension)**: The model relied on the deprecated `KHR_materials_pbrSpecularGlossiness` extension, which caused shader compilation warnings and black materials in Three.js r147+.
- **Issue 2 (Unit Scale & Armature)**: The source model had an internal node matrix with scale factor `0.0254` (inches to meters) representing an unscaled height of 81.059 inches (2.0589m), and complex skinning node trees that added runtime overhead for a Phase 1 static proxy.

### Normalization Process
1. Removed `KHR_materials_pbrSpecularGlossiness` and mapped textures directly to standard `pbrMetallicRoughness`.
2. Stripped skinning, joints, and inverse bind matrices.
3. Reset all node transform matrices to identity.
4. Calculated uniform scale factor to achieve an authentic human height:
   $$\text{scale} = \frac{1.850\text{ m}}{81.0587284} \approx 0.0228228821$$
5. Baked the scaling directly into vertex positions across all 4 mesh primitives.
6. Aligned the vertical bounding box so the soles of the boots sit exactly at $Y = 0.000\text{m}$.
7. Output asset: [doom-zombies/assets/t-800_player.glb](file:///home/mhxxx/AI/test2/doom-zombies/assets/t-800_player.glb) (3.37 MB).

### Mesh Bounding & Hierarchy Verification
- **Height**: Exact $1.850\text{m}$ ($Y \in [-0.00046, +1.8495]$).
- **Facing Direction & Visual Pivot**: The T-800 visual model is mounted on a dedicated visual pivot group (`visualPivot`) with a 180-degree ($+\pi$ radians) rotation around its local Y-axis (`rotation.y = Math.PI`). This ensures the visual character faces the player's look and aiming direction while preserving the network-synchronized player transform.
- **Weapon Attachment**: The right hand / chest weapon anchor is positioned at `(0.16, 1.22, -0.22)`. The Beretta Px4 model is attached to this anchor, tilting dynamically with the remote player's vertical look pitch.

---

## 7. How to Run and Test

### 1. Start the Server
From the project root:
```bash
node server/index.js
```
The server will start on port `8749` (or `PORT` environment variable) and serve static files from `doom-zombies/`.

### 2. Connect Browser Clients
Open two browser windows or tabs:
- **Client 1**: Navigate to `http://localhost:8749/multiplayer.html`
  - Leave Room Code blank (or enter a custom code like `TEST`) and click **Create Room**.
  - Client 1 spawns in Level 0 at `(48.69, 0, -187.65)`.
- **Client 2**: Navigate to `http://localhost:8749/multiplayer.html`
  - Enter the room code displayed in Client 1's HUD and click **Join Room**.
  - Client 2 spawns at `(51.50, 0, -187.65)`.

Both players immediately see each other's full-body T-800 model holding the Beretta pistol. Moving with WASD or looking around with the mouse updates the peer's position and orientation smoothly.

### 3. Playing over LAN or ZeroTier / VPN
To play across different computers on the same local network or virtual LAN:
1. Determine the host machine's IP address (e.g. `192.168.1.100` or ZeroTier IP `10.147.x.x`).
2. Run `node server/index.js` on the host machine.
3. On both machines, navigate to `http://<HOST_IP>:8749/multiplayer.html`.
4. In the **Server Address** field in the UI, enter `<HOST_IP>:8749` (or leave default if connecting on same host).
5. Create and join the room code as described above.

---

## 8. Verification & Test Outcomes

Automated end-to-end testing was performed with two headless browser instances simultaneously connected to the Node server:

1. **Connection & Handshake**: Both clients successfully negotiated WebSocket connections and entered room `DUAL`.
2. **Spawn Allocation**: Client 1 was allocated slot 1 `(48.69, 0, -187.65)` and Client 2 slot 2 `(51.50, 0, -187.65)`.
3. **Mesh & Weapon Presence**: Both clients confirmed full model loading:
   - `remotePlayerHasMesh: true`
   - `remotePlayerHasWeapon: true`
4. **Transform Interpolation**: Client 2 performed movement along the Z-axis; Client 1 received continuous 20Hz snapshots and smoothly interpolated the peer's position without jitter or warping.
5. **Console Stability**: Zero JavaScript exceptions (`jsErrors: []`).
6. **Visual Proof**: Two screenshots were captured from each client's camera view:
   - Client 1 viewing Peer: `mp_client1_views_peer.png`
   - Client 2 viewing Peer: `mp_client2_views_peer.png`

---

## 9. Current Scope & Future Phases

### Implemented in Phase 1 (Complete)
- Isolated Node.js WebSocket server with room lifecycle and 2-player capacity.
- Separate `multiplayer.html` entry point preserving 100% of single-player Story Mode.
- Normalized 1.85m T-800 player model with PBR metallic/roughness materials.
- Local first-person controller with Pointer Lock, Level 0 wall collision, and viewmodel.
- Remote player representation with chest weapon anchor and snapshot interpolation.
- Level 0 physically correct lighting and Backrooms post-processing pass.

### Deferred to Future Phases
- **Phase 2 (Combat & Synchronization)**: Weapon firing synchronization, projectile raycasting, player health & damage, hitboxes, and wall impact decals across network.
- **Phase 3 (Game Modes & PvE)**: Multiplayer cooperative PvE against Saber with network-synchronized AI behavior, and PvP deathmatch mode.
- **Phase 4 (Cloud Infrastructure)**: Matchmaking, host migration, voice/text chat, and deployment to Render / cloud WebSocket hosting.
