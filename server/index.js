// Standalone HTTP & WebSocket Game Server for Saber Killer Multiplayer
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { MSG_TYPES, MAX_PAYLOAD_SIZE, validatePlayerUpdate } from './protocol.js';
import { RoomManager } from './room_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root path for static game assets (doom-zombies)
const CLIENT_DIR = fs.existsSync(path.resolve(__dirname, '../multiplayer.html'))
  ? path.resolve(__dirname, '..')
  : path.resolve(__dirname, '../doom-zombies');

const PORT = parseInt(process.env.PORT, 10) || 8749;
const HOST = '0.0.0.0';

// Parse optional startup flag for developer rendering comparison panel
const DEV_RENDERING = process.argv.includes('--dev-rendering');
if (DEV_RENDERING) {
  console.log('[SERVER CONFIG] Developer rendering tools enabled (--dev-rendering)');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.mjs': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm'
};

// 1. Static HTTP File Server
const server = http.createServer((req, res) => {
  // CORS & WebSocket upgrade headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Server-controlled developer configuration endpoint
  if (req.url === '/__config' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(JSON.stringify({ renderingDevTools: DEV_RENDERING }));
    return;
  }

  // API endpoints for automated verification and screenshots
  if (req.url === '/api/log' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log('[BROWSER LOG]', body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    return;
  }

  if (req.url === '/api/screenshot' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const data = payload.shot.replace(/^data:image\/png;base64,/, '');
        const label = payload.label || 'screenshot';
        const outPath = `/home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/${label}.png`;
        fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
        console.log(`[TEST ARTIFACT] Saved screenshot [${label}] to: ${outPath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500); res.end();
      }
    });
    return;
  }

  if (req.url === '/api/telemetry' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const outPath = `/home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899/scratch/mp_telemetry_${payload.client || 'client'}.json`;
        fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
        console.log(`[TEST TELEMETRY] Received for ${payload.client}:`, JSON.stringify(payload));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500); res.end();
      }
    });
    return;
  }

  // Sanitize and resolve URL
  let parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = parsedUrl.pathname;
  if (pathname === '/' || pathname === '') {
    pathname = '/multiplayer.html';
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(CLIENT_DIR, safePath);

  // Security: Prevent directory traversal outside CLIENT_DIR
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// 2. WebSocket Server attached to same HTTP server
const wss = new WebSocketServer({ server });
const roomManager = new RoomManager();

function send(ws, type, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

wss.on('connection', (ws, req) => {
  // Ping/Pong keep-alive
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    // 1. Payload size protection
    if (data.length > MAX_PAYLOAD_SIZE) {
      send(ws, MSG_TYPES.SERVER_ERROR, { message: 'Payload exceeded maximum allowed size.' });
      return;
    }

    // 2. Parse JSON
    let message = null;
    try {
      message = JSON.parse(data);
    } catch (e) {
      send(ws, MSG_TYPES.SERVER_ERROR, { message: 'Malformed JSON payload.' });
      return;
    }

    const { type, payload } = message;

    switch (type) {
      case MSG_TYPES.CREATE_ROOM: {
        const res = roomManager.createRoom(ws, payload?.roomCode);
        if (res.error) {
          send(ws, MSG_TYPES.SERVER_ERROR, { message: res.error });
        } else {
          send(ws, MSG_TYPES.ROOM_JOINED, {
            roomCode: res.roomCode,
            playerId: res.player.id,
            slot: res.player.slot,
            spawn: res.spawn,
            totalPlayers: res.totalPlayers
          });
        }
        break;
      }

      case MSG_TYPES.JOIN_ROOM: {
        const res = roomManager.joinRoom(ws, payload?.roomCode);
        if (res.error) {
          send(ws, MSG_TYPES.SERVER_ERROR, { message: res.error });
        } else {
          // Tell joining client about the room and any existing players
          send(ws, MSG_TYPES.ROOM_JOINED, {
            roomCode: res.roomCode,
            playerId: res.player.id,
            slot: res.player.slot,
            spawn: res.spawn,
            existingPlayers: res.existingPlayers,
            totalPlayers: res.totalPlayers
          });

          // Notify existing players in room about new arrival
          const room = roomManager.getRoom(res.roomCode);
          if (room) {
            for (const [otherId, otherPlayer] of room.players) {
              if (otherId !== res.player.id) {
                send(otherPlayer.ws, MSG_TYPES.PLAYER_JOINED, {
                  playerId: res.player.id,
                  slot: res.player.slot,
                  spawn: res.spawn
                });
              }
            }
          }
        }
        break;
      }

      case MSG_TYPES.PLAYER_UPDATE: {
        const session = roomManager.getPlayer(ws);
        if (!session) return; // ignore update from unassociated socket
        const { room, player } = session;

        // Rate limit: maximum 30Hz (~33ms min interval)
        const now = Date.now();
        if (now - player.lastUpdate < 30) {
          return; // drop excessive update
        }
        player.lastUpdate = now;

        // Validate numbers
        if (!validatePlayerUpdate(payload)) {
          return; // reject malformed update
        }

        player.seq++;
        const updatePayload = {
          playerId: player.id,
          x: payload.x,
          y: payload.y,
          z: payload.z,
          yaw: payload.yaw,
          pitch: payload.pitch,
          weapon: payload.weapon ?? 0,
          seq: player.seq,
          timestamp: now
        };

        // Broadcast to other players in the room
        for (const [otherId, otherPlayer] of room.players) {
          if (otherId !== player.id) {
            send(otherPlayer.ws, MSG_TYPES.PLAYER_UPDATE, updatePayload);
          }
        }
        break;
      }

      case MSG_TYPES.HEARTBEAT: {
        send(ws, MSG_TYPES.HEARTBEAT, { serverTime: Date.now() });
        break;
      }

      default:
        // Ignore unhandled message
        break;
    }
  });

  ws.on('close', () => {
    const res = roomManager.handleDisconnect(ws);
    if (res && !res.roomDeleted && res.room) {
      for (const [otherId, otherPlayer] of res.room.players) {
        send(otherPlayer.ws, MSG_TYPES.PLAYER_LEFT, {
          playerId: res.playerId,
          remainingPlayers: res.remainingPlayers
        });
      }
    }
  });

  ws.on('error', (err) => {
    console.warn(`[WS Error] ${err.message}`);
  });
});

// 3. Heartbeat sweep every 25 seconds (Render Cloud & proxy keep-alive)
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// 4. Start Server
server.listen(PORT, HOST, () => {
  console.log(`[SABER KILLER SERVER] Listening on http://${HOST}:${PORT}`);
  console.log(`[SABER KILLER SERVER] Serving client files from: ${CLIENT_DIR}`);
});
