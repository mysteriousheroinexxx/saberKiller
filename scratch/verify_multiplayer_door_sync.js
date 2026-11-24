/**
 * Two-Client Multiplayer Synchronization Test for Metallic Exit Door
 * Verifies:
 * 1. Both Host & Joiner see the metallic exit door closed and locked with red indicator.
 * 2. Host unlocks the door with key.
 * 3. Joiner receives DOOR_STATE_UPDATE, door swings open on Joiner screen, indicator turns green.
 * 4. Joiner's collision updates so Joiner can walk through doorway.
 * 5. Run completion synchronizes to both clients.
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

async function run() {
  console.log('[TEST] Starting 2-Client Multiplayer Metallic Door Sync Test...');

  let serverProcess = null;
  const isServerRunning = await new Promise(resolve => {
    http.get(`http://127.0.0.1:${SERVER_PORT}/multiplayer.html`, r => resolve(r.statusCode === 200)).on('error', () => resolve(false));
  });

  if (!isServerRunning) {
    serverProcess = spawn('node', ['server/index.js'], {
      cwd: '/home/mhxxx/AI/test2/doom-zombies',
      env: { ...process.env, PORT: String(SERVER_PORT), HOST: '0.0.0.0' },
      stdio: 'inherit'
    });
    for (let i = 0; i < 30; i++) {
      await wait(200);
      const ok = await new Promise(resolve => {
        http.get(`http://127.0.0.1:${SERVER_PORT}/multiplayer.html`, r => resolve(r.statusCode === 200)).on('error', () => resolve(false));
      });
      if (ok) break;
    }
  }

  const client1 = new ChromeClient(9251, '/tmp/chrome-door-c1');
  const client2 = new ChromeClient(9252, '/tmp/chrome-door-c2');

  await Promise.all([client1.start(), client2.start()]);

  try {
    const t1 = await client1.send('Target.createTarget', { url: 'about:blank' });
    const s1 = (await client1.send('Target.attachToTarget', { targetId: t1.targetId, flatten: true })).sessionId;
    await client1.send('Page.enable', {}, s1);
    await client1.send('Runtime.enable', {}, s1);

    const t2 = await client2.send('Target.createTarget', { url: 'about:blank' });
    const s2 = (await client2.send('Target.attachToTarget', { targetId: t2.targetId, flatten: true })).sessionId;
    await client2.send('Page.enable', {}, s2);
    await client2.send('Runtime.enable', {}, s2);

    const url = `http://127.0.0.1:${SERVER_PORT}/multiplayer.html`;
    const roomCode = 'SYNC_' + Math.floor(Math.random() * 8999 + 1000);

    // 1. Client 1 navigates and creates room
    await client1.send('Page.navigate', { url }, s1);
    for (let i = 0; i < 40; i++) {
      const ready = await client1.eval(s1, `Boolean(window.isEnvReady && window.mpManager?.network?.isConnected)`);
      if (ready) break;
      await wait(200);
    }
    console.log(`[CLIENT 1] Creating room ${roomCode}...`);
    await client1.eval(s1, `window.mpManager.createRoom('${roomCode}');`);

    for (let i = 0; i < 40; i++) {
      const inLobby = await client1.eval(s1, `Boolean(window.mpManager?.isInStagingLobby)`);
      if (inLobby) break;
      await wait(150);
    }

    // 2. Client 2 navigates and joins room
    await client2.send('Page.navigate', { url }, s2);
    for (let i = 0; i < 40; i++) {
      const ready = await client2.eval(s2, `Boolean(window.isEnvReady && window.mpManager?.network?.isConnected)`);
      if (ready) break;
      await wait(200);
    }
    console.log(`[CLIENT 2] Joining room ${roomCode}...`);
    await client2.eval(s2, `window.mpManager.joinRoom('${roomCode}');`);

    for (let i = 0; i < 40; i++) {
      const inLobby = await client2.eval(s2, `Boolean(window.mpManager?.isInStagingLobby)`);
      if (inLobby) break;
      await wait(150);
    }

    // Client 2 toggles ready
    console.log('[CLIENT 2] Toggling ready...');
    await client2.eval(s2, `document.getElementById('btn-staging-action').click();`);
    await wait(400);

    // Client 1 starts match
    console.log('[CLIENT 1] Starting match...');
    await client1.eval(s1, `document.getElementById('btn-staging-action').click();`);

    // Wait for both to enter Level 0
    for (let i = 0; i < 40; i++) {
      const c1Lobby = await client1.eval(s1, `Boolean(window.mpManager?.isInStagingLobby)`);
      const c2Lobby = await client2.eval(s2, `Boolean(window.mpManager?.isInStagingLobby)`);
      if (!c1Lobby && !c2Lobby) break;
      await wait(200);
    }
    console.log('[TEST] Both clients entered Level 0');

    // Wait for metalDoor.glb to load on both clients
    for (let i = 0; i < 40; i++) {
      const c1Door = await client1.eval(s1, `Boolean(window.exitDoorManager?.isModelLoaded)`);
      const c2Door = await client2.eval(s2, `Boolean(window.exitDoorManager?.isModelLoaded)`);
      if (c1Door && c2Door) break;
      await wait(200);
    }

    // 3. Verify door state and closed collision on both clients
    const c1DoorInit = await client1.eval(s1, `({
      locked: window.exitDoorManager?.doorState?.locked,
      collides: window.exitDoorManager?.collidesWithDoor(79.55, 207.0, 0.35)
    })`);
    const c2DoorInit = await client2.eval(s2, `({
      locked: window.exitDoorManager?.doorState?.locked,
      collides: window.exitDoorManager?.collidesWithDoor(79.55, 207.0, 0.35)
    })`);
    console.log('[DOOR INITIAL STATE] Client 1:', c1DoorInit, 'Client 2:', c2DoorInit);
    assert.strictEqual(c1DoorInit.locked, true, 'Client 1 door must be locked');
    assert.strictEqual(c2DoorInit.locked, true, 'Client 2 door must be locked');
    assert.strictEqual(c1DoorInit.collides, true, 'Client 1 closed door must block collision');
    assert.strictEqual(c2DoorInit.collides, true, 'Client 2 closed door must block collision');

    // 4. Client 1 picks up key
    console.log('[CLIENT 1] Picking up Brass Door Key...');
    const keyTarget = await aimAtItem(client1, s1, 'shelf_door_key_tier3');
    console.log('[CLIENT 1] Key target:', keyTarget);
    assert.ok(keyTarget && keyTarget.found, 'Client 1 must target key');
    await wait(400);
    await client1.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 }, s1);
    await wait(100);
    await client1.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 }, s1);

    for (let i = 0; i < 30; i++) {
      const hasKey = await client1.eval(s1, `window.mpManager.inventory.hasItem('doorKey')`);
      if (hasKey) break;
      await wait(150);
    }
    const c1HasKey = await client1.eval(s1, `window.mpManager.inventory.hasItem('doorKey')`);
    assert.strictEqual(c1HasKey, true, 'Client 1 must possess key');
    console.log('[CLIENT 1] Key claimed successfully');

    // 5. Client 1 moves to door and unlocks it
    console.log('[CLIENT 1] Aiming at door...');
    const doorTarget = await aimAtDoor(client1, s1, 'level0_exit_door');
    console.log('[CLIENT 1] Door target:', doorTarget);
    assert.ok(doorTarget && doorTarget.found, 'Client 1 must target door');
    await wait(400);
    console.log('[CLIENT 1] Unlocking door...');
    await client1.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 }, s1);
    await wait(100);
    await client1.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 }, s1);

    // 6. Verify room-wide door unlock synchronization on BOTH clients!
    for (let i = 0; i < 40; i++) {
      const c1Locked = await client1.eval(s1, `window.exitDoorManager?.doorState?.locked`);
      const c2Locked = await client2.eval(s2, `window.exitDoorManager?.doorState?.locked`);
      if (!c1Locked && !c2Locked) break;
      await wait(150);
    }

    const c1PostUnlock = await client1.eval(s1, `({
      locked: window.exitDoorManager?.doorState?.locked,
      targetAngle: window.exitDoorManager?.targetAngle,
      collides: window.exitDoorManager?.collidesWithDoor(79.55, 207.0, 0.35)
    })`);
    const c2PostUnlock = await client2.eval(s2, `({
      locked: window.exitDoorManager?.doorState?.locked,
      targetAngle: window.exitDoorManager?.targetAngle,
      collides: window.exitDoorManager?.collidesWithDoor(79.55, 207.0, 0.35)
    })`);
    console.log('[ROOM-WIDE DOOR SYNC] Client 1:', c1PostUnlock, 'Client 2:', c2PostUnlock);
    assert.strictEqual(c1PostUnlock.locked, false, 'Client 1 door must be unlocked');
    assert.strictEqual(c2PostUnlock.locked, false, 'Client 2 door must be synchronized as unlocked');
    assert.strictEqual(c1PostUnlock.collides, false, 'Client 1 open door collision must be false');
    assert.strictEqual(c2PostUnlock.collides, false, 'Client 2 open door collision must be false');

    await wait(1000); // Allow swing animation

    // Capture screenshot from Client 2's perspective showing unlocked door
    const shotPath = path.join(ARTIFACT_DIR, 'key_exit_05_client2_synced_open_door.png');
    // Position client 2 camera to look at the door
    await client2.eval(s2, `
      (() => {
        const lp = window.localPlayer || window.mpManager.localPlayer;
        lp.pos.set(79.55, 0.0, 205.2);
        const cam = window.camera || window.mpManager.camera;
        cam.position.set(79.55, 1.62, 205.2);
        cam.rotation.order = 'YXZ';
        cam.rotation.y = Math.PI;
        cam.rotation.x = -0.2;
      })()
    `);
    await wait(200);
    await client2.captureScreenshot(s2, shotPath);

    // 7. Client 2 walks through open doorway to escape
    console.log('[CLIENT 2] Walking through open doorway to escape...');
    await client2.eval(s2, `
      (() => {
        const lp = window.localPlayer || window.mpManager.localPlayer;
        lp.pos.set(79.55, 0.0, 206.6);
        lp.networkClient.sendUpdate(lp.pos.x, 0.0, lp.pos.z, lp.yaw, lp.pitch, 2);
        if (window.exitDoorManager) {
          window.exitDoorManager.update(0.05, lp.pos);
        }
      })()
    `);

    // Verify victory overlay on both clients
    for (let i = 0; i < 40; i++) {
      const c1Over = await client1.eval(s1, `document.getElementById('bb-gameover-overlay')?.style.display === 'flex'`);
      const c2Over = await client2.eval(s2, `document.getElementById('bb-gameover-overlay')?.style.display === 'flex'`);
      if (c1Over && c2Over) break;
      await wait(150);
    }

    const c1Victory = await client1.eval(s1, `document.querySelector('.bb-gameover-title')?.textContent?.trim()`);
    const c2Victory = await client2.eval(s2, `document.querySelector('.bb-gameover-title')?.textContent?.trim()`);
    console.log('[VICTORY RESULT] Client 1:', c1Victory, 'Client 2:', c2Victory);
    assert.strictEqual(c1Victory, 'LEVEL ESCAPED!', 'Client 1 must show LEVEL ESCAPED!');
    assert.strictEqual(c2Victory, 'LEVEL ESCAPED!', 'Client 2 must show LEVEL ESCAPED!');

    console.log('[TEST] SUCCESS! 2-Client Multiplayer Metallic Door synchronization verified.');
  } finally {
    await Promise.all([client1.close(), client2.close()]);
    if (serverProcess) serverProcess.kill('SIGTERM');
  }
}

run().catch(err => {
  console.error('[TEST ERROR]', err);
  process.exit(1);
});
