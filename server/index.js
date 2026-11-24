// Standalone HTTP & WebSocket Game Server for Saber Killer Multiplayer
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { MSG_TYPES, MAX_PAYLOAD_SIZE, validatePlayerUpdate } from './protocol.js';
import { RoomManager, VENDING_CONFIG, configureVendingMachine } from './room_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Root path for static game assets (doom-zombies)
const CLIENT_DIR = fs.existsSync(path.resolve(__dirname, '../multiplayer.html'))
  ? path.resolve(__dirname, '..')
  : path.resolve(__dirname, '../doom-zombies');

const PORT = parseInt(process.env.PORT, 10) || 8749;
const HOST = process.env.HOST || '::';

// Parse optional startup flag for developer rendering comparison panel
const DEV_RENDERING = process.argv.includes('--dev-rendering');
if (DEV_RENDERING) {
  console.log('[SERVER CONFIG] Developer rendering tools enabled (--dev-rendering)');
}

// Configurable vending machine maximum dispense count
const stockArg = process.argv.find(a => a.startsWith('--vending-stock='));
if (stockArg) {
  const stockVal = parseInt(stockArg.split('=')[1], 10);
  if (!isNaN(stockVal)) {
    configureVendingMachine({ defaultMaxStock: stockVal });
    console.log(`[SERVER CONFIG] Vending machine max stock set to: ${stockVal} (--vending-stock)`);
  }
} else if (process.env.VENDING_MAX_STOCK) {
  const stockVal = parseInt(process.env.VENDING_MAX_STOCK, 10);
  if (!isNaN(stockVal)) {
    configureVendingMachine({ defaultMaxStock: stockVal });
    console.log(`[SERVER CONFIG] Vending machine max stock set to: ${stockVal} (VENDING_MAX_STOCK)`);
  }
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

// Server-side active layout revision lifecycle
let activeDevLayout = {
  iteration: 0,
  filename: 'default',
  data: null
};

function loadStartupLayout() {
  const layoutDir = path.join(CLIENT_DIR, 'world-layouts/level0');
  const latestPath = path.join(layoutDir, 'latest.json');
  const defaultPath = path.join(CLIENT_DIR, 'assets/data/world_items.json');

  let defaultData = null;
  try {
    if (fs.existsSync(defaultPath)) {
      defaultData = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
    }
  } catch (err) {
    console.error('[WORLD LAYOUT] Error reading default assets/data/world_items.json:', err.message);
  }

  if (!DEV_RENDERING) {
    activeDevLayout = {
      iteration: 0,
      filename: 'default',
      data: defaultData
    };
    console.log('[WORLD LAYOUT] Production mode active: using approved layout assets/data/world_items.json');
    return;
  }

  // Developer mode: try to load and validate latest.json from disk
  fs.mkdirSync(layoutDir, { recursive: true });

  if (fs.existsSync(latestPath)) {
    try {
      const raw = fs.readFileSync(latestPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || parsed.level !== 'level0' || !Array.isArray(parsed.placements)) {
        throw new Error('Schema validation failed: missing level0 or placements array.');
      }
      const iterNum = parseInt(parsed.iteration, 10) || 1;
      const expectedFilename = `iteration_${String(iterNum).padStart(4, '0')}.json`;
      activeDevLayout = {
        iteration: iterNum,
        filename: expectedFilename,
        data: parsed
      };
      console.log(`[WORLD LAYOUT] Loaded development layout revision: ${expectedFilename} (${parsed.placements.length} items)`);
      return;
    } catch (err) {
      console.warn(`[WORLD LAYOUT] Warning: latest.json missing or invalid (${err.message}), falling back to default assets/data/world_items.json`);
    }
  } else {
    console.warn('[WORLD LAYOUT] Warning: latest.json not found on disk, falling back to default assets/data/world_items.json');
  }

  activeDevLayout = {
    iteration: 0,
    filename: 'default',
    data: defaultData
  };
}

// Initial layout load on server startup
loadStartupLayout();

function getLayoutDataForRevision(requestedRev) {
  const layoutDir = path.join(CLIENT_DIR, 'world-layouts/level0');
  const defaultPath = path.join(CLIENT_DIR, 'assets/data/world_items.json');

  if (requestedRev && requestedRev !== 'default') {
    if (activeDevLayout && activeDevLayout.filename === requestedRev && activeDevLayout.data) {
      return activeDevLayout.data;
    }
    const targetPath = path.join(layoutDir, path.basename(requestedRev));
    if (fs.existsSync(targetPath)) {
      try {
        return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      } catch (err) {
        console.warn(`[WORLD LAYOUT] Error reading requested revision ${requestedRev}:`, err.message);
      }
    }
  }

  if (activeDevLayout && activeDevLayout.data) {
    return activeDevLayout.data;
  }
  if (fs.existsSync(defaultPath)) {
    try {
      return JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
    } catch (err) {
      console.warn(`[WORLD LAYOUT] Error reading default layout:`, err.message);
    }
  }
  return null;
}

// 1. Static HTTP File Server
const server = http.createServer((req, res) => {
  // CORS & WebSocket upgrade headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Normalize URL: strip optional /doom-zombies prefix
  const rawUrl = req.url || '/';
  const normUrl = rawUrl.replace(/^\/doom-zombies(?=\/|$)/, '') || '/';

  // Server-controlled developer configuration endpoint
  if ((normUrl === '/__config' || req.url === '/__config') && req.method === 'GET') {
    const configPayload = JSON.stringify({
      renderingDevTools: DEV_RENDERING,
      latestLayout: (DEV_RENDERING && activeDevLayout && activeDevLayout.filename !== 'default') ? {
        iteration: activeDevLayout.iteration,
        file: activeDevLayout.filename
      } : null
    });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(configPayload),
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(configPayload);
    return;
  }

  // Developer World Placement Layout Endpoints (Only enabled when --dev-rendering is active)
  if (normUrl.startsWith('/api/developer/world-layout/')) {
    const layoutUrl = new URL(normUrl, `http://${req.headers.host || 'localhost'}`);
    const subpath = layoutUrl.pathname.replace('/api/developer/world-layout/', '').replace(/\/+$/, '');

    if (!DEV_RENDERING) {
      const errBody = JSON.stringify({ error: 'Developer tools are disabled on this server.' });
      res.writeHead(403, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(errBody)
      });
      res.end(errBody);
      return;
    }

    const layoutDir = path.join(CLIENT_DIR, 'world-layouts/level0');
    fs.mkdirSync(layoutDir, { recursive: true });

    if (subpath === 'list' && req.method === 'GET') {
      const files = fs.readdirSync(layoutDir);
      const iterations = [];
      let latestFile = null;

      for (const f of files) {
        const match = f.match(/^iteration_(\d+)\.json$/);
        if (match) {
          const num = parseInt(match[1], 10);
          const stats = fs.statSync(path.join(layoutDir, f));
          iterations.push({
            iteration: num,
            filename: f,
            size: stats.size,
            mtime: stats.mtime.toISOString()
          });
        }
      }
      iterations.sort((a, b) => a.iteration - b.iteration);
      if (activeDevLayout && activeDevLayout.filename !== 'default') {
        latestFile = activeDevLayout.filename;
      } else if (iterations.length > 0) {
        latestFile = iterations[iterations.length - 1].filename;
      }

      const listBody = JSON.stringify({ iterations, latest: latestFile, count: iterations.length });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(listBody),
        'Cache-Control': 'no-cache'
      });
      res.end(listBody);
      return;
    }

    if (subpath === 'load' && req.method === 'GET') {
      const iterParam = layoutUrl.searchParams.get('iteration');
      const fileParam = layoutUrl.searchParams.get('file');

      let targetFile = null;
      if (fileParam) {
        targetFile = path.basename(fileParam);
      } else if (iterParam) {
        const num = parseInt(iterParam, 10);
        targetFile = `iteration_${String(num).padStart(4, '0')}.json`;
      }

      // If no target file is requested, return current activeDevLayout data if in memory
      if (!targetFile) {
        if (activeDevLayout && activeDevLayout.data) {
          const content = JSON.stringify(activeDevLayout.data, null, 2);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(content),
            'Cache-Control': 'no-cache'
          });
          res.end(content);
          return;
        }
        targetFile = 'latest.json';
      }

      const filePath = path.join(layoutDir, targetFile);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          // Validate valid JSON before serving
          JSON.parse(content);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(content),
            'Cache-Control': 'no-cache'
          });
          res.end(content);
          return;
        } catch (err) {
          console.warn(`[WORLD LAYOUT] Corrupt layout file ${targetFile}:`, err.message);
        }
      }

      // Fallback: Default layout
      const defaultPath = path.join(CLIENT_DIR, 'assets/data/world_items.json');
      if (fs.existsSync(defaultPath)) {
        const content = fs.readFileSync(defaultPath, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(content),
          'Cache-Control': 'no-cache'
        });
        res.end(content);
        return;
      }

      const errBody = JSON.stringify({ error: `Layout ${targetFile || 'default'} not found.` });
      res.writeHead(404, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(errBody)
      });
      res.end(errBody);
      return;
    }

    if (subpath === 'export' && req.method === 'POST') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          if (!rawBody || !rawBody.trim()) {
            throw new Error('Export payload is empty.');
          }

          let payload;
          try {
            payload = JSON.parse(rawBody);
          } catch (jsonErr) {
            throw new Error(`Invalid JSON syntax in export body: ${jsonErr.message}`);
          }

          // 1. Strict Schema Validation before touching filesystem
          if (!payload || typeof payload !== 'object') {
            throw new Error('Payload must be a JSON object.');
          }
          if (payload.level !== 'level0') {
            throw new Error('Invalid or missing level identifier (expected "level0").');
          }
          if (!Array.isArray(payload.placements)) {
            throw new Error('Placements must be an array.');
          }
          const invalidPlacements = [];
          for (let i = 0; i < payload.placements.length; i++) {
            const p = payload.placements[i];
            if (!p || typeof p !== 'object') {
              throw new Error(`Placement item at index ${i} is not an object.`);
            }
            if (!p.id || typeof p.id !== 'string') {
              throw new Error(`Placement item at index ${i} missing valid string id.`);
            }
            if (!p.type || typeof p.type !== 'string') {
              throw new Error(`Placement '${p.id}' missing item type.`);
            }
            if (!Array.isArray(p.position) || p.position.length !== 3 || p.position.some(n => typeof n !== 'number' || !isFinite(n))) {
              throw new Error(`Placement '${p.id}' has invalid numeric position [x, y, z].`);
            }

            // Developer-authoritative validation check:
            // Warnings and developer-approved/overridden items are accepted.
            // Items with status === 'invalid' without developer approval are flagged.
            const v = p.validation;
            const isApproved = v && (v.status === 'overridden' || v.developerApproved === true);
            if (v && v.status === 'invalid' && !isApproved) {
              invalidPlacements.push({
                id: p.id,
                type: p.type,
                reason: v.failureReason || v.wallReason || 'Collision or boundary violation detected'
              });
            }
          }

          // If un-overridden invalid placements exist and developer did not specify forceExport, reject with HTTP 400 JSON
          if (invalidPlacements.length > 0 && !payload.forceExport) {
            console.warn(`[WORLD EDITOR] Export rejected: ${invalidPlacements.length} un-overridden invalid placements exist.`);
            const errRes = JSON.stringify({
              error: `Validation failed: layout contains ${invalidPlacements.length} un-overridden invalid placement(s).`,
              invalidCount: invalidPlacements.length,
              invalidPlacements
            });
            res.writeHead(400, {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(errRes)
            });
            res.end(errRes);
            return;
          }

          if (invalidPlacements.length > 0 && payload.forceExport) {
            console.log(`[WORLD EDITOR] Force-export accepted by developer override (${invalidPlacements.length} un-overridden invalid items).`);
          }

          // 2. Scan world-layouts/level0/ for next iteration number
          const existing = fs.readdirSync(layoutDir);
          let maxIter = 0;
          for (const f of existing) {
            const match = f.match(/^iteration_(\d+)\.json$/);
            if (match) {
              const num = parseInt(match[1], 10);
              if (num > maxIter) maxIter = num;
            }
          }
          const nextIter = maxIter + 1;
          const filename = `iteration_${String(nextIter).padStart(4, '0')}.json`;
          const filePath = path.join(layoutDir, filename);
          const latestPath = path.join(layoutDir, 'latest.json');
          const latestTmpPath = path.join(layoutDir, 'latest.json.tmp');

          // 3. Construct Complete Normalized Layout Document
          const layoutDoc = {
            schemaVersion: '1.0.0',
            level: 'level0',
            iteration: nextIter,
            createdAt: new Date().toISOString(),
            author: payload.author || 'developer',
            description: payload.description || `Level 0 World Layout Iteration ${nextIter}`,
            catalog: (payload.catalog && Object.keys(payload.catalog).length > 0) ? payload.catalog : (activeDevLayout?.data?.catalog || {}),
            placements: payload.placements.map(p => ({
              id: p.id,
              type: p.type,
              category: p.category || (payload.catalog?.[p.type]?.category) || 'prop',
              placementMode: p.placementMode || 'fixed',
              position: [
                +p.position[0].toFixed(4),
                +p.position[1].toFixed(4),
                +p.position[2].toFixed(4)
              ],
              rotation: [
                +(p.rotation?.[0] || 0).toFixed(4),
                +(p.rotation?.[1] || 0).toFixed(4),
                +(p.rotation?.[2] || 0).toFixed(4)
              ],
              scale: [
                +(p.scale?.[0] || 1).toFixed(4),
                +(p.scale?.[1] || 1).toFixed(4),
                +(p.scale?.[2] || 1).toFixed(4)
              ],
              anchor: p.anchor || { surface: p.surfaceType || 'floor' },
              tags: Array.isArray(p.tags) ? p.tags : ['collidable'],
              validation: p.validation ? {
                status: p.validation.status || 'valid',
                developerApproved: !!p.validation.developerApproved,
                originalStatus: p.validation.originalStatus || null,
                reason: p.validation.reason || p.validation.failureReason || null
              } : { status: 'valid', developerApproved: false }
            })),
            spawnGroups: Array.isArray(payload.spawnGroups) ? payload.spawnGroups : [
              {
                id: 'sg_hallway_consumables_01',
                name: 'Hallway Floor Consumables Pool',
                eligibleTypes: ['almond_can', 'energy_drink', 'sanity_pill', 'aa_battery'],
                candidatePoints: [
                  [41.8, 0.0, -186.2],
                  [42.2, 0.0, -186.1],
                  [42.6, 0.0, -186.0],
                  [43.1, 0.0, -186.0],
                  [43.3, 0.0, -188.7]
                ],
                minCount: 2,
                maxCount: 4,
                surface: 'floor',
                probability: 0.85,
                tags: ['consumable', 'random_loot']
              },
              {
                id: 'sg_tabletop_supplies_01',
                name: 'Office Tabletop Medical & Ammo Pool',
                eligibleTypes: ['first_aid', 'ammo_box', 'sanity_pill', 'doorKey'],
                candidatePoints: [
                  [44.75, 0.936, -185.45],
                  [44.35, 0.936, -185.45],
                  [44.00, 0.936, -185.45],
                  [44.55, 0.936, -185.20],
                  [44.15, 0.936, -185.20]
                ],
                minCount: 2,
                maxCount: 3,
                surface: 'table',
                supportProp: 'prop_table_01',
                probability: 1.0,
                tags: ['high_tier_loot', 'loot_surface']
              }
            ]
          };

          const jsonStr = JSON.stringify(layoutDoc, null, 2);
          // 4. Save immutable numbered iteration file
          fs.writeFileSync(filePath, jsonStr, 'utf8');

          // 5. Atomically update latest.json via temp file rename
          fs.writeFileSync(latestTmpPath, jsonStr, 'utf8');
          fs.renameSync(latestTmpPath, latestPath);

          // 6. Update in-memory activeDevLayout so subsequent room creations use it
          activeDevLayout = {
            iteration: nextIter,
            filename,
            data: layoutDoc
          };

          console.log(`[WORLD EDITOR] Exported iteration ${nextIter} (${layoutDoc.placements.length} items) -> ${filePath}`);

          const resPayload = JSON.stringify({
            success: true,
            iteration: nextIter,
            filename,
            itemCount: layoutDoc.placements.length,
            spawnGroupCount: layoutDoc.spawnGroups.length,
            path: `world-layouts/level0/${filename}`,
            forced: invalidPlacements.length > 0 && !!payload.forceExport
          });

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(resPayload)
          });
          res.end(resPayload);
        } catch (err) {
          console.error('[WORLD EDITOR] Export failed:', err.message);
          const errRes = JSON.stringify({ error: err.message });
          res.writeHead(400, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(errRes)
          });
          res.end(errRes);
        }
      });
      return;
    }

    const notFoundBody = JSON.stringify({ error: 'Endpoint not found.' });
    res.writeHead(404, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(notFoundBody)
    });
    res.end(notFoundBody);
    return;
  }

  // API endpoints for automated verification and screenshots
  if (normUrl === '/api/log' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log('[BROWSER LOG]', body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    return;
  }

  if (normUrl === '/api/screenshot' && req.method === 'POST') {
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

  if (normUrl === '/api/telemetry' && req.method === 'POST') {
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

  // Intercept any unmatched /api/* route before falling through to static files
  if (normUrl.startsWith('/api/')) {
    const apiNotFound = JSON.stringify({ error: `API route not found: ${normUrl}` });
    res.writeHead(404, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(apiNotFound)
    });
    res.end(apiNotFound);
    return;
  }

  // Sanitize and resolve URL
  let parsedUrl = new URL(normUrl, `http://${req.headers.host || 'localhost'}`);
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

// 2. WebSocket Server attached to the same HTTP server and port
server.on('upgrade', (req) => {
  console.log(`[WS UPGRADE] ${req.method} ${req.url} origin=${req.headers.origin || '(none)'} host=${req.headers.host || '(none)'}`);
});

const wss = new WebSocketServer({ server });
const roomManager = new RoomManager();

wss.on('error', (err) => {
  console.error(`[WS SERVER ERROR] code=${err.code || 'UNKNOWN'} message=${err.message}`);
});

function send(ws, type, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

wss.on('connection', (ws, req) => {
  console.log(`[WS CONNECTED] remote=${req.socket.remoteAddress || '(unknown)'} url=${req.url || '/'} origin=${req.headers.origin || '(none)'}`);
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
        const defaultRev = (DEV_RENDERING && activeDevLayout && activeDevLayout.filename) ? activeDevLayout.filename : 'default';
        const requestedRev = (typeof payload?.layoutRevision === 'string' && payload.layoutRevision.trim())
          ? payload.layoutRevision.trim()
          : defaultRev;
        const layoutData = getLayoutDataForRevision(requestedRev);
        const res = roomManager.createRoom(ws, payload?.roomCode, requestedRev, layoutData, { startingPlayers: payload?.startingPlayers });
        if (res.error) {
          send(ws, MSG_TYPES.SERVER_ERROR, { message: res.error });
        } else {
          send(ws, MSG_TYPES.ROOM_JOINED, {
            roomCode: res.roomCode,
            playerId: res.player.id,
            slot: res.player.slot,
            spawn: res.spawn,
            leaderId: res.leaderId,
            runState: res.runState,
            totalPlayers: res.totalPlayers,
            layoutRevision: res.layoutRevision,
            collectedItems: res.collectedItems || [],
            spawnedItems: res.spawnedItems || [],
            inventory: res.inventory
          });
          const lobbyState = roomManager.getLobbyState(res.roomCode);
          if (lobbyState) {
            send(ws, MSG_TYPES.LOBBY_STATE_UPDATE, lobbyState);
          }
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
            leaderId: res.leaderId,
            runState: res.runState,
            existingPlayers: res.existingPlayers,
            totalPlayers: res.totalPlayers,
            layoutRevision: res.layoutRevision,
            collectedItems: res.collectedItems || [],
            spawnedItems: res.spawnedItems || [],
            inventory: res.inventory
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
            // Broadcast synchronized lobby state to all players in room
            const lobbyState = roomManager.getLobbyState(res.roomCode);
            if (lobbyState) {
              for (const [_, p] of room.players) {
                send(p.ws, MSG_TYPES.LOBBY_STATE_UPDATE, lobbyState);
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

        // Cache authoritative player coordinates for proximity validation
        player.position = { x: payload.x, y: payload.y, z: payload.z };
        // console.log(`[SERVER PLAYER_UPDATE] Cached pos:`, player.position);

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

      case MSG_TYPES.ITEM_PICKUP_REQUEST: {
        const requestId = payload?.requestId || `req_${Date.now()}`;
        const itemId = payload?.itemId;
        const clientPos = payload?.clientPosition;

        const session = roomManager.getPlayer(ws);
        const playerId = session ? session.player.id : 'unknown';
        const roomCode = session ? session.room.code : 'unknown';

        console.log(`[PICKUP ${requestId}] Message received: player=${playerId}, room=${roomCode}, item=${itemId}`);
        console.log(`[STAGE 6/19] [SERVER] Pickup request received: reqId=${requestId}, player=${playerId}, room=${roomCode}, item=${itemId}`);
        console.log(`[STAGE 7/19] [SERVER] Request ID parsed: ${requestId}`);
        console.log(`[STAGE 8/19] [SERVER] Player and room resolved: player=${playerId}, room=${roomCode}`);
        console.log(`[STAGE 9/19] [SERVER] Item ID resolved: ${itemId}`);

        console.log(`[STAGE 10/19] [SERVER] Validation executing for item '${itemId}' by player '${playerId}'...`);
        const requestKey = `${playerId}:${requestId}`;
        const activeRoom = session?.room;
        const cached = activeRoom?.pickupRequests?.get(requestKey);
        if (cached) {
          console.log(`[PICKUP ${requestId}] Duplicate request; replaying prior acknowledgement`);
          send(ws, MSG_TYPES.ITEM_PICKUP_RESPONSE, cached);
          if (cached.success && activeRoom) {
            const player = activeRoom.players.get(playerId);
            send(ws, MSG_TYPES.INVENTORY_UPDATE, {
              requestId,
              inventory: player?.inventory.serialize(),
              addedItem: { id: cached.itemId, type: cached.itemType }
            });
          }
          break;
        }

        let res;
        try {
          res = roomManager.handlePickupRequest(ws, itemId, clientPos);
        } catch (err) {
          console.error(`[PICKUP ${requestId}] Pickup processing exception:`, err);
          res = { error: `Pickup processing failed: ${err.message}`, room: session?.room, player: session?.player };
        }

        if (res.error) {
          console.log(`[STAGE 12/19] [SERVER] Pickup REJECTED: reqId=${requestId}, item='${itemId}', reason='${res.error}'`);
          const rejectPayload = {
            requestId,
            success: false,
            itemId,
            playerId: res.player ? res.player.id : playerId,
            roomCode: res.room ? res.room.code : roomCode,
            reason: res.error
          };
          if (activeRoom?.pickupRequests) activeRoom.pickupRequests.set(requestKey, rejectPayload);
          console.log(`[PICKUP ${requestId}] Acknowledgement sent: rejected (${rejectPayload.reason})`);
          console.log(`[STAGE 13/19] [SERVER] Transmitting rejection response to client:`, rejectPayload);
          send(ws, MSG_TYPES.ITEM_PICKUP_RESPONSE, rejectPayload);
          send(ws, MSG_TYPES.PICKUP_REJECTED, {
            requestId,
            itemId,
            reason: res.error
          });
        } else if (res.dispensedItem) {
          console.log(`[VENDING DISPENSE VIA PICKUP ${requestId}] Dispensed item ${res.dispensedItem.id} from ${res.machineId}`);
          const acceptPayload = {
            requestId,
            success: true,
            itemId: res.machineId,
            itemType: 'vending_almond',
            playerId: res.player.id,
            roomCode: res.room.code,
            dispensedItem: res.dispensedItem
          };
          send(ws, MSG_TYPES.ITEM_PICKUP_RESPONSE, acceptPayload);
          send(ws, MSG_TYPES.VENDING_DISPENSE_RESPONSE, acceptPayload);

          for (const [_, p] of res.room.players) {
            send(p.ws, MSG_TYPES.ITEM_SPAWNED, {
              item: res.dispensedItem,
              dispensedFrom: res.machineId
            });
          }
        } else {
          console.log(`[STAGE 11/19] [SERVER] Inventory update executed for player '${res.player.id}', added '${res.item.type}'`);
          console.log(`[STAGE 12/19] [SERVER] Pickup ACCEPTED: reqId=${requestId}, item='${res.item.id}', player='${res.player.id}'`);

          const acceptPayload = {
            requestId,
            success: true,
            itemId: res.item.id,
            itemType: res.item.type,
            playerId: res.player.id,
            roomCode: res.room.code,
            ammoUpdate: res.ammoUpdate
          };
          if (res.room.pickupRequests) {
            res.room.pickupRequests.set(requestKey, acceptPayload);
            if (res.room.pickupRequests.size > 500) res.room.pickupRequests.delete(res.room.pickupRequests.keys().next().value);
          }
          console.log(`[PICKUP ${requestId}] Acknowledgement sent: accepted item=${res.item.id}, player=${res.player.id}`);
          console.log(`[STAGE 13/19] [SERVER] Transmitting success response to client:`, acceptPayload);
          send(ws, MSG_TYPES.ITEM_PICKUP_RESPONSE, acceptPayload);

          console.log(`[STAGE 14/19] [SERVER] Broadcasting world-item removal to room ${res.room.code} for item ${res.item.id}`);
          for (const [_, p] of res.room.players) {
            send(p.ws, MSG_TYPES.ITEM_COLLECTED, {
              requestId,
              itemId: res.item.id,
              itemType: res.item.type,
              collectedBy: res.player.id
            });
          }

          send(ws, MSG_TYPES.INVENTORY_UPDATE, {
            requestId,
            inventory: res.inventory,
            addedItem: {
              id: res.item.id,
              type: res.item.type
            },
            ammoUpdate: res.ammoUpdate
          });
        }
        break;
      }

      case MSG_TYPES.VENDING_DISPENSE_REQUEST: {
        const requestId = payload?.requestId || `disp_${Date.now()}`;
        const machineId = payload?.machineId;
        const clientPos = payload?.clientPosition;

        const session = roomManager.getPlayer(ws);
        const playerId = session ? session.player.id : 'unknown';
        const roomCode = session ? session.room.code : 'unknown';

        console.log(`[VENDING ${requestId}] Dispense requested: player=${playerId}, room=${roomCode}, machine=${machineId}`);
        const res = roomManager.handleVendingDispense(ws, machineId, clientPos);
        if (res.error) {
          console.log(`[VENDING ${requestId}] Rejected: ${res.error} (remainingStock=${res.remainingStock !== undefined ? res.remainingStock : 'n/a'})`);
          const rejectPayload = {
            requestId,
            success: false,
            machineId,
            reason: res.error,
            remainingStock: res.remainingStock !== undefined ? res.remainingStock : undefined
          };
          send(ws, MSG_TYPES.VENDING_DISPENSE_RESPONSE, rejectPayload);
          send(ws, MSG_TYPES.ITEM_PICKUP_RESPONSE, {
            requestId,
            success: false,
            itemId: machineId,
            reason: res.error,
            remainingStock: res.remainingStock !== undefined ? res.remainingStock : undefined
          });
        } else {
          console.log(`[VENDING ${requestId}] Accepted: spawned ${res.dispensedItem.id} at [${res.dispensedItem.position.join(', ')}] (remainingStock=${res.remainingStock})`);
          const acceptPayload = {
            requestId,
            success: true,
            machineId: res.machineId,
            dispensedItem: res.dispensedItem,
            remainingStock: res.remainingStock,
            maxStock: res.maxStock
          };
          send(ws, MSG_TYPES.VENDING_DISPENSE_RESPONSE, acceptPayload);
          send(ws, MSG_TYPES.ITEM_PICKUP_RESPONSE, {
            requestId,
            success: true,
            itemId: res.machineId,
            dispensedItem: res.dispensedItem,
            remainingStock: res.remainingStock
          });

          // Broadcast newly spawned world item and updated machine stock to all players in the room
          for (const [_, p] of res.room.players) {
            send(p.ws, MSG_TYPES.ITEM_SPAWNED, {
              item: res.dispensedItem,
              dispensedFrom: res.machineId,
              remainingStock: res.remainingStock
            });
          }
        }
        break;
      }

      case MSG_TYPES.ITEM_USE_REQUEST: {
        const requestId = payload?.requestId || `use_${Date.now()}`;
        const slotIndex = payload?.slotIndex;
        const instanceId = payload?.instanceId;

        const session = roomManager.getPlayer(ws);
        const playerId = session ? session.player.id : 'unknown';
        const roomCode = session ? session.room.code : 'unknown';

        console.log(`[ITEM USE ${requestId}] Received from player=${playerId}, room=${roomCode}, slot=${slotIndex}`);

        const requestKey = `${playerId}:${requestId}`;
        const activeRoom = session?.room;
        const cached = activeRoom?.useRequests?.get(requestKey);
        if (cached) {
          console.log(`[ITEM USE ${requestId}] Duplicate request; replaying prior acknowledgement`);
          send(ws, MSG_TYPES.ITEM_USE_RESPONSE, cached);
          break;
        }

        const res = roomManager.handleUseItem(ws, slotIndex, instanceId);
        if (res.error) {
          console.log(`[ITEM USE ${requestId}] Rejected: ${res.error}`);
          const rejectPayload = {
            requestId,
            success: false,
            slotIndex,
            reason: res.error
          };
          if (activeRoom?.useRequests) activeRoom.useRequests.set(requestKey, rejectPayload);
          send(ws, MSG_TYPES.ITEM_USE_RESPONSE, rejectPayload);
        } else {
          console.log(`[ITEM USE ${requestId}] Accepted for player=${res.player.id}, item=${res.itemType}`);
          const acceptPayload = {
            requestId,
            success: true,
            slotIndex: res.slotIndex,
            itemType: res.itemType,
            itemName: res.itemName,
            effect: res.effect,
            ammoUpdate: res.ammoUpdate,
            remainingQuantity: res.remainingQuantity
          };
          if (res.room?.useRequests) {
            res.room.useRequests.set(requestKey, acceptPayload);
            if (res.room.useRequests.size > 500) res.room.useRequests.delete(res.room.useRequests.keys().next().value);
          }
          send(ws, MSG_TYPES.ITEM_USE_RESPONSE, acceptPayload);

          send(ws, MSG_TYPES.INVENTORY_UPDATE, {
            requestId,
            inventory: res.inventory,
            usedItem: { type: res.itemType },
            ammoUpdate: res.ammoUpdate
          });
        }
        break;
      }

      case MSG_TYPES.ITEM_DROP_REQUEST: {
        const requestId = payload?.requestId || `drop_${Date.now()}`;
        const slotIndex = payload?.slotIndex;
        const instanceId = payload?.instanceId;
        const quantity = payload?.quantity || 1;
        const clientPos = payload?.playerPosition;
        const clientYaw = payload?.playerYaw;

        const session = roomManager.getPlayer(ws);
        const playerId = session ? session.player.id : 'unknown';
        const roomCode = session ? session.room.code : 'unknown';

        console.log(`[ITEM DROP ${requestId}] Received from player=${playerId}, room=${roomCode}, slot=${slotIndex}, qty=${quantity}`);

        const res = roomManager.handleDropItem(ws, slotIndex, instanceId, quantity, clientPos, clientYaw);
        if (res.error) {
          console.log(`[ITEM DROP ${requestId}] Rejected: ${res.error}`);
          send(ws, MSG_TYPES.ITEM_DROP_RESPONSE, {
            requestId,
            success: false,
            slotIndex,
            reason: res.error
          });
        } else {
          console.log(`[ITEM DROP ${requestId}] Accepted: spawned ${res.droppedItem.id} (${res.droppedItem.type}) at [${res.droppedItem.position.join(', ')}]`);
          send(ws, MSG_TYPES.ITEM_DROP_RESPONSE, {
            requestId,
            success: true,
            dropId: res.droppedItem.id,
            slotIndex: res.slotIndex,
            quantity: res.droppedQuantity
          });

          // Broadcast spawned world item to ALL players in room
          for (const [_, p] of res.room.players) {
            send(p.ws, MSG_TYPES.ITEM_SPAWNED, {
              item: res.droppedItem,
              droppedBy: res.player.id
            });
          }

          send(ws, MSG_TYPES.INVENTORY_UPDATE, {
            requestId,
            inventory: res.inventory,
            droppedItem: { id: res.droppedItem.id, type: res.droppedItem.type, quantity: res.droppedQuantity }
          });
        }
        break;
      }

      case MSG_TYPES.INVENTORY_SWAP_REQUEST: {
        const fromSlot = payload?.fromSlot;
        const toSlot = payload?.toSlot;
        const res = roomManager.handleSwapSlots(ws, fromSlot, toSlot);
        if (!res.error && res.success) {
          send(ws, MSG_TYPES.INVENTORY_UPDATE, {
            inventory: res.inventory
          });
        }
        break;
      }

      case MSG_TYPES.PLAYER_DAMAGE_REQUEST: {
        const amount = payload?.amount;
        const reason = payload?.reason || 'DEFAULT';
        const targetPlayerId = payload?.targetPlayerId;
        const res = roomManager.applyDamage(targetPlayerId ? targetPlayerId : ws, amount, reason);
        if (res.error) {
          send(ws, MSG_TYPES.SERVER_ERROR, { message: res.error });
        } else if (res.events && res.room) {
          for (const evt of res.events) {
            for (const [_, p] of res.room.players) {
              send(p.ws, evt.type, evt.payload);
            }
          }
        }
        break;
      }

      case MSG_TYPES.PLAYER_REVIVE_REQUEST: {
        const requestId = payload?.requestId || `rev_${Date.now()}`;
        const targetPlayerId = payload?.targetPlayerId;
        const clientPos = payload?.clientPosition;
        console.log(`[REVIVE ${requestId}] Request received: target=${targetPlayerId}`);
        const res = roomManager.handleReviveRequest(ws, targetPlayerId, clientPos);
        if (res.error) {
          console.warn(`[REVIVE ${requestId}] Rejected: ${res.error}`);
          send(ws, MSG_TYPES.PLAYER_REVIVE_RESPONSE, {
            requestId,
            success: false,
            targetPlayerId,
            reason: res.error
          });
        } else {
          console.log(`[REVIVE ${requestId}] Accepted: revived ${targetPlayerId}`);
          send(ws, MSG_TYPES.PLAYER_REVIVE_RESPONSE, {
            requestId,
            success: true,
            targetPlayerId
          });
          send(ws, MSG_TYPES.INVENTORY_UPDATE, {
            requestId,
            inventory: res.reviverInventory,
            usedItem: { type: 'first_aid', quantity: 1 }
          });
          if (res.events && res.room) {
            for (const evt of res.events) {
              for (const [_, p] of res.room.players) {
                send(p.ws, evt.type, evt.payload);
              }
            }
          }
        }
        break;
      }

      case MSG_TYPES.ROOM_ITEMS_STATE: {
        const session = roomManager.getPlayer(ws);
        if (!session) return;
        const { room } = session;
        const items = [];
        for (const [id, item] of room.worldItems) {
          items.push({
            id: item.id,
            type: item.type,
            isPickup: item.isPickup,
            available: item.available,
            collectedBy: item.collectedBy
          });
        }
        send(ws, MSG_TYPES.ROOM_ITEMS_STATE, {
          roomCode: room.code,
          layoutRevision: room.layoutRevision,
          items
        });
        break;
      }

      case MSG_TYPES.HEARTBEAT: {
        send(ws, MSG_TYPES.HEARTBEAT, { serverTime: Date.now() });
        break;
      }

      case MSG_TYPES.LOBBY_READY_TOGGLE: {
        const res = roomManager.setPlayerReady(ws, payload?.isReady);
        if (res.error) {
          send(ws, MSG_TYPES.SERVER_ERROR, { message: res.error });
        } else if (res.success && res.room) {
          const lobbyState = roomManager.getLobbyState(res.room.code);
          for (const [_, p] of res.room.players) {
            send(p.ws, MSG_TYPES.LOBBY_STATE_UPDATE, lobbyState);
          }
        }
        break;
      }

      case MSG_TYPES.MATCH_START_REQUEST: {
        const res = roomManager.startMatch(ws);
        if (res.error) {
          console.warn(`[MATCH START] Rejected for player in room ${res.room?.code}: ${res.error}`);
          send(ws, MSG_TYPES.MATCH_START_REJECTED, {
            reason: res.error,
            unreadyCount: res.unreadyCount
          });
        } else if (res.success && res.room) {
          console.log(`[MATCH START] Match started for room ${res.room.code} with ${res.startingPlayers} players!`);
          for (const [_, p] of res.room.players) {
            send(p.ws, MSG_TYPES.MATCH_STARTED, {
              roomCode: res.room.code,
              startingPlayers: res.startingPlayers,
              layoutRevision: res.room.layoutRevision,
              collectedItems: res.collectedItems || [],
              players: res.players || []
            });
          }
        }
        break;
      }

      default:
        // Ignore unhandled message
        break;
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS CLOSED] remote=${req.socket.remoteAddress || '(unknown)'} code=${code} reason=${reason.toString() || '(none)'}`);
    const res = roomManager.handleDisconnect(ws);
    if (res && !res.roomDeleted && res.room) {
      for (const [otherId, otherPlayer] of res.room.players) {
        send(otherPlayer.ws, MSG_TYPES.PLAYER_LEFT, {
          playerId: res.playerId,
          remainingPlayers: res.remainingPlayers
        });
      }
      if (res.room.runState === 'LOBBY') {
        const lobbyState = roomManager.getLobbyState(res.room.code);
        if (lobbyState) {
          for (const [_, p] of res.room.players) {
            send(p.ws, MSG_TYPES.LOBBY_STATE_UPDATE, lobbyState);
          }
        }
      }
    }
  });

  ws.on('error', (err) => {
    console.warn(`[WS ERROR] remote=${req.socket.remoteAddress || '(unknown)'} code=${err.code || 'UNKNOWN'} message=${err.message}`);
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

server.on('error', (err) => {
  if (err.code === 'EADDRNOTAVAIL' && HOST === '::') {
    console.warn(`[SABER KILLER SERVER] IPv6 '::' not available, falling back to '0.0.0.0'`);
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[SABER KILLER SERVER] Listening on http://0.0.0.0:${PORT}`);
      console.log(`[SABER KILLER SERVER] Serving client files from: ${CLIENT_DIR}`);
    });
    return;
  }
  console.error(`[HTTP/WS LISTENER ERROR] ${HOST}:${PORT} code=${err.code || 'UNKNOWN'} message=${err.message}`);
  if (err.code === 'EADDRINUSE' || err.code === 'EACCES' || err.code === 'EPERM') {
    clearInterval(heartbeatInterval);
    process.exitCode = 1;
  }
});

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// 4. Start Server
server.listen(PORT, HOST, () => {
  const displayHost = HOST === '::' ? 'localhost' : HOST;
  console.log(`[SABER KILLER SERVER] Listening on http://${displayHost}:${PORT} (bound to ${HOST})`);
  console.log(`[SABER KILLER SERVER] Serving client files from: ${CLIENT_DIR}`);
});
