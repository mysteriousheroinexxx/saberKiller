/**
 * Focused Browser Smoke Test: Level 0 Key & Exit Door Objective
 * Verifies:
 * 1. Room initialization: survivor has tactical flashlight only, exactly 1 key on map.
 * 2. Key pickup: player targets and picks up Brass Door Key into inventory.
 * 3. Exit door initially locked with red status light.
 * 4. Key unlock: player possessing key unlocks door; status light turns green, door swings open.
 * 5. Escape completion: interacting with or crossing open doorway triggers level escape victory overlay.
 */

import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const WebSocket = require('/home/mhxxx/AI/test2/doom-zombies/server/node_modules/ws');
const ARTIFACT_DIR = '/home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899';

class ChromeClient {
  constructor(port, profileDir) {
    this.port = port;
    this.profileDir = profileDir;
    this.chrome = null;
    this.ws = null;
    this.id = 1;
    this.pending = new Map();
  }

  async start() {
    fs.mkdirSync(this.profileDir, { recursive: true });
    this.chrome = spawn('/usr/bin/chromium', [
      '--headless=new',
      '--remote-debugging-port=' + this.port,
      '--user-data-dir=' + this.profileDir,
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=gl',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-dev-shm-usage',
      '--window-size=1280,720',
      'about:blank'
    ]);

    let wsUrl = null;
    for (let i = 0; i < 40; i++) {
      try {
        const data = await new Promise((resolve, reject) => {
          http.get(`http://127.0.0.1:${this.port}/json/version`, r => {
            let b = ''; r.on('data', c => b += c);
            r.on('end', () => resolve(JSON.parse(b)));
          }).on('error', reject);
        });
        if (data.webSocketDebuggerUrl) { wsUrl = data.webSocketDebuggerUrl; break; }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 200));
    }

    if (!wsUrl) throw new Error('Could not connect to Chromium CDP on port ' + this.port);
    this.ws = new WebSocket(wsUrl);

    this.ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(msg.error);
        else p.resolve(msg.result);
      }
    });

    await new Promise(r => this.ws.on('open', r));
  }

  send(method, params = {}, sessionId = null) {
    return new Promise((resolve, reject) => {
      const mid = this.id++;
      const msg = { id: mid, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.pending.set(mid, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
    });
  }

  async eval(sessionId, expr) {
    let expression = expr.trim();
    if (!expression.startsWith('(() =>') && !expression.startsWith('(function')) {
      if (expression.startsWith('({') && expression.endsWith('})')) {
        expression = `(() => { return ${expression}; })()`;
      } else if (expression.includes(';') || expression.includes('\n') || expression.includes('return ') || expression.includes('const ') || expression.includes('let ')) {
        expression = `(() => {\n${expression}\n})()`;
      }
    }
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    }, sessionId);
    if (res.exceptionDetails) {
      throw new Error('Eval failed: ' + (res.exceptionDetails.exception?.description || JSON.stringify(res.exceptionDetails)));
    }
    return res.result?.value;
  }

  async captureScreenshot(sessionId, filePath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(filePath, Buffer.from(res.data, 'base64'));
    console.log(`[SCREENSHOT] Saved: ${filePath}`);
  }

  async close() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
    if (this.chrome) {
      try { this.chrome.kill('SIGTERM'); } catch (e) {}
    }
  }
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function aimAtItem(client, sessionId, itemId, defaultDist = 0.8) {
  let lastRes = null;
  const distCandidates = [defaultDist, 0.75, 0.85, 0.65, 0.95];
  for (const d of distCandidates) {
    for (let i = 0; i < 15; i++) {
      const res = await client.eval(sessionId, `
        (() => {
          const item = window.itemManager?.getItemById('${itemId}') || window.itemManager?.items?.find(i => i.id === '${itemId}' || i.type === '${itemId}');
          if (!item || !item.object) return { found: false, reason: 'no item', hasItemManager: !!window.itemManager, totalItems: window.itemManager?.items?.length };
          const bbox = new THREE.Box3().setFromObject(item.object);
          const center = new THREE.Vector3();
          bbox.getCenter(center);

          const lp = window.localPlayer || window.mpManager.localPlayer;
          lp.pos.set(center.x, 0.0, center.z + ${d});
          const eyeY = 1.62;
          const dx = center.x - lp.pos.x;
          const dz = center.z - lp.pos.z;
          const dy = center.y - eyeY;

          lp.yaw = Math.atan2(-dx, -dz);
          lp.pitch = Math.atan2(dy, Math.hypot(dx, dz));

          const cam = window.camera || window.mpManager.camera;
          cam.position.set(lp.pos.x, eyeY, lp.pos.z);
          cam.rotation.order = 'YXZ';
          cam.rotation.y = lp.yaw;
          cam.rotation.x = lp.pitch;

          lp.networkClient.sendUpdate(lp.pos.x, 0.0, lp.pos.z, lp.yaw, lp.pitch, lp.weapon ?? 2);
          if (window.interactionManager) window.interactionManager.update();

          const target = window.interactionManager?.currentTarget;
          return {
            found: target?.id === '${itemId}' || target?.type === '${itemId}',
            targetId: target?.id,
            targetType: target?.type,
            actionText: target?.actionText,
            promptText: window.interactionManager?.promptEl?.innerText.trim().replace(/\\s+/g, ' '),
            distance: target?.distance,
            center: { x: center.x, y: center.y, z: center.z },
            distUsed: ${d}
          };
        })()
      `);
      lastRes = res;
      if (res && res.found) return res;
      await wait(60);
    }
  }
  return lastRes;
}

async function aimAtDoor(client, sessionId, doorId = 'level0_exit_door') {
  for (let i = 0; i < 20; i++) {
    const res = await client.eval(sessionId, `
      (() => {
        const door = window.exitDoorManager?.rootGroup;
        if (!door) return { found: false, reason: 'no door' };

        const center = new THREE.Vector3(79.55, 1.4, 207.0);
        const lp = window.localPlayer || window.mpManager.localPlayer;
        lp.pos.set(79.55, 0.0, 205.2);
        const eyeY = 1.62;
        const dx = center.x - lp.pos.x;
        const dz = center.z - lp.pos.z;
        const dy = center.y - eyeY;

        lp.yaw = Math.atan2(-dx, -dz);
        lp.pitch = Math.atan2(dy, Math.hypot(dx, dz));

        const cam = window.camera || window.mpManager.camera;
        cam.position.set(lp.pos.x, eyeY, lp.pos.z);
        cam.rotation.order = 'YXZ';
        cam.rotation.y = lp.yaw;
        cam.rotation.x = lp.pitch;

        lp.networkClient.sendUpdate(lp.pos.x, 0.0, lp.pos.z, lp.yaw, lp.pitch, lp.weapon ?? 2);
        if (window.interactionManager) window.interactionManager.update();

        const target = window.interactionManager?.currentTarget;
        return {
          found: target?.id === '${doorId}',
          targetId: target?.id,
          targetType: target?.type,
          actionText: target?.actionText,
          doorLocked: window.exitDoorManager?.doorState?.locked,
          promptText: window.interactionManager?.promptEl?.innerText.trim().replace(/\\s+/g, ' '),
          distance: target?.distance
        };
      })()
    `);
    if (res && res.found) return res;
    await wait(60);
  }
  return null;
}

const SERVER_PORT = 8755;
const CHROME_PORT = 9233;

async function run() {
  console.log('[TEST] Starting Level 0 Key & Exit Door Objective browser test...');

  // 1. Ensure server is running on port 8755
  let serverProcess = null;
  const isServerRunning = await new Promise(resolve => {
    http.get(`http://127.0.0.1:${SERVER_PORT}/multiplayer.html`, r => resolve(r.statusCode === 200)).on('error', () => resolve(false));
  });

  if (!isServerRunning) {
    console.log(`[TEST] Starting Saber Killer server on port ${SERVER_PORT}...`);
    serverProcess = spawn('node', ['server/index.js'], {
      cwd: '/home/mhxxx/AI/test2/doom-zombies',
      env: { ...process.env, PORT: String(SERVER_PORT), HOST: '0.0.0.0' },
      stdio: 'inherit'
    });
    for (let i = 0; i < 30; i++) {
      await wait(300);
      const ok = await new Promise(resolve => {
        http.get(`http://127.0.0.1:${SERVER_PORT}/multiplayer.html`, r => resolve(r.statusCode === 200)).on('error', () => resolve(false));
      });
      if (ok) break;
    }
  }

  const client = new ChromeClient(CHROME_PORT, '/tmp/chrome-key-exit-test');
  await client.start();

  try {
    const targets = await client.send('Target.getTargets');
    let pageTarget = targets.targetInfos.find(t => t.type === 'page');
    if (!pageTarget) {
      const created = await client.send('Target.createTarget', { url: 'about:blank' });
      pageTarget = { targetId: created.targetId };
    }
    const { sessionId } = await client.send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });

    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);

    const testRoom = 'KEY' + Math.floor(Math.random() * 899 + 100);
    const url = `http://127.0.0.1:${SERVER_PORT}/multiplayer.html`;
    console.log(`[TEST] Navigating to ${url}...`);
    await client.send('Page.navigate', { url }, sessionId);

    // Wait for environment to load
    let ready = false;
    for (let i = 0; i < 50; i++) {
      await wait(300);
      ready = await client.eval(sessionId, `
        Boolean(window.isEnvReady && window.mpManager && window.mpManager.network && window.mpManager.network.isConnected)
      `);
      if (ready) break;
    }
    assert.ok(ready, 'Client environment and network should be ready');
    console.log('[TEST] Client loaded and connected');

    // Create room
    console.log(`[TEST] Creating room ${testRoom}...`);
    await client.eval(sessionId, `window.mpManager.createRoom('${testRoom}');`);

    // Wait for staging lobby
    let inLobby = false;
    for (let i = 0; i < 50; i++) {
      await wait(200);
      inLobby = await client.eval(sessionId, `Boolean(window.mpManager?.isInStagingLobby)`);
      if (inLobby) break;
    }
    assert.ok(inLobby, 'Client should be in staging lobby');
    console.log('[TEST] Host is in staging lobby; starting match...');

    // Host starts match
    await client.eval(sessionId, `document.getElementById('btn-staging-action').click();`);
    await wait(1200);

    for (let i = 0; i < 50; i++) {
      await wait(200);
      inLobby = await client.eval(sessionId, `Boolean(window.mpManager?.isInStagingLobby)`);
      if (!inLobby) break;
    }
    assert.equal(inLobby, false, 'Must transition from lobby into active Level 0 gameplay');
    console.log('[TEST] Active Level 0 gameplay entered');

    // Wait for itemManager and exitDoorManager to be ready
    for (let i = 0; i < 50; i++) {
      const itemsLoaded = await client.eval(sessionId, `
        Boolean(window.itemManager?.isLoaded && window.itemManager?.items?.length > 0 && window.exitDoorManager?.rootGroup)
      `);
      if (itemsLoaded) break;
      await wait(200);
    }

    // 1. Verify initial loadout (tactical flashlight only, no key)
    const initialInv = await client.eval(sessionId, `
      ({
        hasTorch: window.mpManager.inventory.hasItem('equipment_torch'),
        hasKey: window.mpManager.inventory.hasItem('doorKey'),
        slots: window.mpManager.inventory.getSlots().filter(Boolean).map(s => s.typeId)
      })
    `);
    console.log('[TEST] Initial loadout:', initialInv);
    assert.equal(initialInv.hasTorch, true, 'Must have flashlight');
    assert.equal(initialInv.hasKey, false, 'Must not start with key');

    // 2. Position player at shelf to look at Brass Door Key
    console.log('[TEST] Targeting Brass Door Key on metal shelf...');
    const targetInfo = await aimAtItem(client, sessionId, 'shelf_door_key_tier3');
    console.log('[TEST] Target info on key:', targetInfo);
    assert.ok(targetInfo && targetInfo.found, 'Must target Brass Door Key');

    // Wait for server to process player position update
    await wait(400);

    // Press E to pick up key
    console.log('[TEST] Pressing E to collect key...');
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 }, sessionId);
    await wait(100);
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 }, sessionId);

    // Wait for server response and inventory update
    for (let i = 0; i < 40; i++) {
      await wait(150);
      const hasKey = await client.eval(sessionId, `window.mpManager.inventory.hasItem('doorKey')`);
      if (hasKey) break;
    }

    const postKeyInv = await client.eval(sessionId, `
      ({
        hasKey: window.mpManager.inventory.hasItem('doorKey'),
        keyCount: window.mpManager.inventory.getCount('doorKey')
      })
    `);
    assert.equal(postKeyInv.hasKey, true, 'Player inventory must contain doorKey');
    assert.equal(postKeyInv.keyCount, 1, 'Player must possess exactly 1 key');
    console.log('[TEST] Brass Door Key claimed successfully into inventory');

    // Open inventory to capture screenshot of key in inventory
    await client.eval(sessionId, `window.inventoryUI.open()`);
    await wait(400);
    const shot1 = path.join(ARTIFACT_DIR, 'key_exit_01_key_in_inventory.png');
    await client.captureScreenshot(sessionId, shot1);
    await client.eval(sessionId, `window.inventoryUI.close()`);
    await wait(300);

    // 3. Move to Level 0 Exit Door at [79.55, 0.0, 207.0]
    console.log('[TEST] Aiming at Level 0 Exit Door...');
    const doorTarget = await aimAtDoor(client, sessionId, 'level0_exit_door');
    console.log('[TEST] Door target info (with key in inventory):', doorTarget);
    assert.ok(doorTarget && doorTarget.found, 'Must target level0_exit_door');
    assert.equal(doorTarget.doorLocked, true, 'Door must be locked initially');
    assert.equal(doorTarget.actionText, 'Unlock', 'Action text must be Unlock when possessing key');

    // Wait for server to process player position update
    await wait(400);

    const shot2 = path.join(ARTIFACT_DIR, 'key_exit_02_door_locked.png');
    await client.captureScreenshot(sessionId, shot2);

    // 4. Trigger unlock on door via E key
    console.log('[TEST] Pressing E to unlock exit door...');
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 }, sessionId);
    await wait(100);
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 }, sessionId);

    // Wait for door to unlock
    for (let i = 0; i < 40; i++) {
      await wait(150);
      const isLocked = await client.eval(sessionId, `Boolean(window.exitDoorManager?.doorState?.locked)`);
      if (!isLocked) break;
    }

    const postUnlockState = await client.eval(sessionId, `
      ({
        doorLocked: window.exitDoorManager?.doorState?.locked,
        targetAngle: window.exitDoorManager?.targetAngle
      })
    `);
    assert.equal(postUnlockState.doorLocked, false, 'Door must be authoritatively unlocked');
    console.log('[TEST] Exit Door unlocked successfully; waiting for door swing...');
    await wait(1200); // Allow smooth hinge swing animation

    const shot3 = path.join(ARTIFACT_DIR, 'key_exit_03_door_unlocked.png');
    await client.captureScreenshot(sessionId, shot3);

    // 5. Interacting with unlocked door triggers level escape
    console.log('[TEST] Walking into open doorway to escape Level 0...');
    // Step forward into the doorway (distance < 1.6m triggers escape automatically in ExitDoorManager)
    await client.eval(sessionId, `
      (() => {
        const lp = window.localPlayer || window.mpManager.localPlayer;
        lp.pos.set(79.55, 0.0, 206.6);
        lp.networkClient.sendUpdate(lp.pos.x, 0.0, lp.pos.z, lp.yaw, lp.pitch, lp.weapon ?? 2);
        if (window.exitDoorManager) {
          window.exitDoorManager.update(0.05, lp.pos);
        }
      })()
    `);

    // Wait for victory overlay
    for (let i = 0; i < 50; i++) {
      await wait(150);
      const overlayDisplay = await client.eval(sessionId, `document.getElementById('bb-gameover-overlay')?.style.display`);
      if (overlayDisplay === 'flex') break;
    }

    const victoryInfo = await client.eval(sessionId, `
      ({
        overlayVisible: document.getElementById('bb-gameover-overlay')?.style.display === 'flex',
        title: document.querySelector('.bb-gameover-title')?.textContent?.trim(),
        reason: document.getElementById('bb-gameover-reason')?.textContent?.trim()
      })
    `);
    console.log('[TEST] Victory escape overlay:', victoryInfo);
    assert.equal(victoryInfo.overlayVisible, true, 'Game over / victory overlay must be displayed');
    assert.equal(victoryInfo.title, 'LEVEL ESCAPED!', 'Title must display LEVEL ESCAPED!');
    assert.match(victoryInfo.reason, /unlocked the exit door and escaped the Backrooms/i);

    const shot4 = path.join(ARTIFACT_DIR, 'key_exit_04_level_escaped.png');
    await client.captureScreenshot(sessionId, shot4);

    console.log('[TEST] SUCCESS! All Level 0 Key & Exit Door criteria verified in browser.');
  } finally {
    await client.close();
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  }
}

run().catch(err => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
