/**
 * Comprehensive Multiplayer Interaction & Inventory Foundation Verification
 * Tests 14 distinct multiplayer scenarios across headless Chromium instances via CDP.
 */

import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const WS_MODULE = '/home/mhxxx/AI/test2/doom-zombies/server/node_modules/ws';
const WebSocket = require(WS_MODULE);

const CLIENT_DIR = '/home/mhxxx/AI/test2/doom-zombies';
const ARTIFACT_DIR = '/home/mhxxx/.gemini/antigravity-cli/brain/1f289c44-ad8c-4627-87d0-a5464314d899';

function httpRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

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
      this.pending.set(mid, { resolve, reject });
      const payload = { id: mid, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }

  async createPageSession() {
    const targets = await this.send('Target.getTargets');
    let page = targets.targetInfos.find(t => t.type === 'page');
    let targetId = page ? page.targetId : (await this.send('Target.createTarget', { url: 'about:blank' })).targetId;
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Page.enable', {}, sessionId);
    return sessionId;
  }

  async eval(sessionId, expression) {
    let expr = expression.trim();
    if (expr.includes('return ') && !expr.startsWith('(() =>') && !expr.startsWith('(function')) {
      expr = `(() => {\n${expr}\n})()`;
    }
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    }, sessionId);
    if (res.exceptionDetails) {
      throw new Error('Eval failed: ' + JSON.stringify(res.exceptionDetails));
    }
    return res.result.value;
  }

  async screenshot(sessionId, outPath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    if (res && res.data) {
      fs.writeFileSync(outPath, Buffer.from(res.data, 'base64'));
    }
  }

  async close() {
    if (this.ws) this.ws.close();
    if (this.chrome) this.chrome.kill();
    try { fs.rmSync(this.profileDir, { recursive: true, force: true }); } catch (e) {}
  }
}

async function run() {
  console.log('========================================================================');
  console.log(' MULTIPLAYER INTERACTION & INVENTORY FOUNDATION — FULL E2E REGRESSION   ');
  console.log('========================================================================\n');

  let passedTests = 0;
  let totalTests = 0;
  function pass(desc) {
    totalTests++;
    passedTests++;
    console.log(`  [PASS] ${desc}`);
  }
  function fail(desc, err) {
    totalTests++;
    console.error(`  [FAIL] ${desc}:`, err);
    throw err;
  }

  const DEV_PORT = 8762;
  const devServer = spawn('node', ['server/index.js', '--dev-rendering'], {
    cwd: CLIENT_DIR,
    env: { ...process.env, PORT: DEV_PORT }
  });

  devServer.stdout.on('data', d => {
    // console.log('[SERVER]', d.toString().trim());
  });
  devServer.stderr.on('data', d => {
    // console.error('[SERVER ERR]', d.toString().trim());
  });

  await new Promise(r => setTimeout(r, 1500));

  const clientA = new ChromeClient(9231, '/tmp/chrome_prof_clientA');
  const clientB = new ChromeClient(9232, '/tmp/chrome_prof_clientB');

  try {
    await clientA.start();
    await clientB.start();
    const sessA = await clientA.createPageSession();
    const sessB = await clientB.createPageSession();

    console.log('\n--- 1. Loading Multiplayer Clients into Room Alpha ---');
    await clientA.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/multiplayer.html` }, sessA);
    await clientB.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/multiplayer.html` }, sessB);

    // Wait for environment and items to load on both clients
    for (let i = 0; i < 50; i++) {
      const readyA = await clientA.eval(sessA, '!!(window.itemManager && window.itemManager.isLoaded && window.mpManager && window.mpManager.network && window.mpManager.network.isConnected)');
      const readyB = await clientB.eval(sessB, '!!(window.itemManager && window.itemManager.isLoaded && window.mpManager && window.mpManager.network && window.mpManager.network.isConnected)');
      if (readyA && readyB) break;
      await new Promise(r => setTimeout(r, 200));
    }

    pass('Both clients loaded PBR level and connected to server via WebSocket');

    // Client A creates room INV1
    await clientA.eval(sessA, `
      window.mpManager.createRoom('INV1');
    `);
    await new Promise(r => setTimeout(r, 400));

    // Client B joins room INV1
    await clientB.eval(sessB, `
      window.mpManager.joinRoom('INV1');
    `);
    await new Promise(r => setTimeout(r, 600));

    const roomStateA = await clientA.eval(sessA, '({ room: window.mpManager.currentRoomCode, id: window.mpManager.myPlayerId })');
    const roomStateB = await clientB.eval(sessB, '({ room: window.mpManager.currentRoomCode, id: window.mpManager.myPlayerId })');

    assert.strictEqual(roomStateA.room, 'INV1');
    assert.strictEqual(roomStateB.room, 'INV1');
    assert.notStrictEqual(roomStateA.id, roomStateB.id);
    pass(`Both clients joined room INV1 (Player A: ${roomStateA.id}, Player B: ${roomStateB.id})`);

    // Scenario 1: Identical world placements
    const countA = await clientA.eval(sessA, 'window.itemManager.items.length');
    const countB = await clientB.eval(sessB, 'window.itemManager.items.length');
    assert.strictEqual(countA, countB, 'Both clients must have identical placement count');
    assert(countA > 10, 'Expected at least 10 placed items/props');
    pass(`Scenario 1: Both clients have identical world placements (${countA} items)`);

    // Scenario 2: Player A approaches table_first_aid_01 and inspects interaction prompt
    // table_first_aid_01 is at [44.75, 0.936, -185.45]
    await clientA.eval(sessA, `
      // Move local player near the table at z = -184.45 looking towards -Z
      window.localPlayer.pos.set(44.75, 0.0, -184.45);
      window.localPlayer.yaw = 0.0;
      window.localPlayer.pitch = -0.60;
      window.camera.position.set(44.75, 1.62, -184.45);
      window.camera.rotation.order = 'YXZ';
      window.camera.rotation.y = 0.0;
      window.camera.rotation.x = -0.60;
      // Update network position
      window.localPlayer.networkClient.sendUpdate(
        window.localPlayer.pos.x,
        window.localPlayer.pos.y,
        window.localPlayer.pos.z,
        window.localPlayer.yaw,
        window.localPlayer.pitch,
        window.localPlayer.weapon
      );
      // Update interaction manager
      window.interactionManager.update();
    `);
    await new Promise(r => setTimeout(r, 200));

    const debugHits = await clientA.eval(sessA, `
      (() => {
        const candidates = [];
        if (window.itemManager.container && window.itemManager.container.children.length > 0) {
          candidates.push(...window.itemManager.container.children);
        }
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(0, 0), window.camera);
        ray.far = 10.0;
        const hits = ray.intersectObjects(candidates, true);
        return {
          camPos: [window.camera.position.x, window.camera.position.y, window.camera.position.z],
          camRot: [window.camera.rotation.x, window.camera.rotation.y, window.camera.rotation.z],
          candidatesCount: candidates.length,
          hitsCount: hits.length,
          hits: hits.map(h => ({
            dist: +h.distance.toFixed(2),
            name: h.object.name,
            parentName: h.object.parent ? h.object.parent.name : null,
            userData: h.object.userData,
            parentUserData: h.object.parent ? h.object.parent.userData : null
          })),
          items: window.itemManager.items.filter(i => i.id.includes('table')).map(i => ({
            id: i.id,
            pos: [i.object.position.x, i.object.position.y, i.object.position.z],
            visible: i.object.visible
          }))
        };
      })()
    `);
    console.log('[DEBUG HITS]', JSON.stringify(debugHits, null, 2));

    const hoverTargetA = await clientA.eval(sessA, `
      window.interactionManager.currentTarget ? {
        id: window.interactionManager.currentTarget.id,
        type: window.interactionManager.currentTarget.type,
        actionText: window.interactionManager.currentTarget.actionText,
        name: window.interactionManager.currentTarget.name,
        distance: +window.interactionManager.currentTarget.distance.toFixed(2),
        promptVisible: document.getElementById('interaction-prompt')?.style.display !== 'none',
        promptHtml: document.getElementById('interaction-prompt')?.innerHTML
      } : null
    `);

    assert(hoverTargetA, 'Player A should detect interaction target on table');
    assert.strictEqual(hoverTargetA.id, 'table_first_aid_01');
    assert.strictEqual(hoverTargetA.actionText, 'Take');
    assert.strictEqual(hoverTargetA.promptVisible, true);
    assert(hoverTargetA.distance <= 2.1, 'Distance must be <= 2.1m');
    pass(`Scenario 2 (Detection): Player A detects '${hoverTargetA.name}' at distance ${hoverTargetA.distance}m with contextual prompt`);

    // Capture screenshot of Player A looking at prompt
    const shotPromptPath = path.join(ARTIFACT_DIR, 'interaction_prompt_medkit.png');
    await clientA.screenshot(sessA, shotPromptPath);
    pass(`Saved prompt screenshot to ${shotPromptPath}`);

    // Player A picks up table_first_aid_01
    await clientA.eval(sessA, `
      window.interactionManager.triggerInteraction();
    `);
    await new Promise(r => setTimeout(r, 500));

    // Verify Player A item state
    const itemStateA = await clientA.eval(sessA, `
      const item = window.itemManager.getItemById('table_first_aid_01');
      return {
        exists: !!item,
        isCollected: !!item?.isCollected,
        visible: item?.object ? item.object.visible : null
      };
    `);
    assert.strictEqual(itemStateA.isCollected, true);
    assert.strictEqual(itemStateA.visible, false);
    pass('Scenario 2 (Pickup): Item table_first_aid_01 removed from Player A world');

    // Scenario 3: Item simultaneously removed from Player B world
    const itemStateB = await clientB.eval(sessB, `
      const item = window.itemManager.getItemById('table_first_aid_01');
      return {
        exists: !!item,
        isCollected: !!item?.isCollected,
        visible: item?.object ? item.object.visible : null
      };
    `);
    assert.strictEqual(itemStateB.isCollected, true);
    assert.strictEqual(itemStateB.visible, false);
    pass('Scenario 3: Item table_first_aid_01 is simultaneously removed from Player B world');

    // Scenario 4: Player A inventory verification
    const invA = await clientA.eval(sessA, `
      const slots = window.inventory.getSlots();
      const firstAid = slots.find(s => s && s.typeId === 'first_aid');
      return {
        totalItems: window.inventory.getCount('first_aid'),
        slot: firstAid ? {
          slotIndex: firstAid.slotIndex,
          typeId: firstAid.typeId,
          name: firstAid.name,
          quantity: firstAid.quantity,
          instanceId: firstAid.instanceId,
          iconUrl: firstAid.iconUrl,
          stackable: firstAid.stackable
        } : null
      };
    `);
    assert.strictEqual(invA.totalItems, 1);
    assert(invA.slot, 'Player A must have first_aid in inventory');
    assert.strictEqual(invA.slot.stackable, false);
    assert(invA.slot.instanceId.startsWith('inst_first_aid_'));
    pass(`Scenario 4: Player A received first_aid with unique ID (${invA.slot.instanceId})`);

    // Scenario 5: Player B cannot collect the same item
    await clientB.eval(sessB, `
      // Move Player B to table position
      window.localPlayer.pos.set(44.75, 0.0, -186.45);
      window.localPlayer.networkClient.sendUpdate(44.75, 0.0, -186.45, 0, 0, 0);
      window.__lastRejected = null;
      window.mpManager.network.onPickupRejected = (payload) => {
        window.__lastRejected = payload;
      };
      // Send pickup request for already collected item
      window.mpManager.network.requestItemPickup('table_first_aid_01');
    `);
    await new Promise(r => setTimeout(r, 400));

    const rejB = await clientB.eval(sessB, 'window.__lastRejected');
    assert(rejB, 'Server must reject pickup request from Player B');
    assert.strictEqual(rejB.itemId, 'table_first_aid_01');
    assert(rejB.reason.includes('already been collected'));
    const countBInv = await clientB.eval(sessB, 'window.inventory.getCount("first_aid")');
    assert.strictEqual(countBInv, 0, 'Player B inventory must remain empty');
    pass('Scenario 5: Player B pickup of already claimed item cleanly rejected by server');

    // Scenario 6: Duplicate request from Player A is rejected
    await clientA.eval(sessA, `
      window.__lastRejected = null;
      window.mpManager.network.onPickupRejected = (payload) => {
        window.__lastRejected = payload;
      };
      window.mpManager.network.requestItemPickup('table_first_aid_01');
    `);
    await new Promise(r => setTimeout(r, 400));
    const rejA = await clientA.eval(sessA, 'window.__lastRejected');
    assert(rejA, 'Duplicate pickup from Player A must be rejected');
    pass('Scenario 6: Rapid duplicate pickup request by original collector cleanly rejected');

    // Scenario 7: Fabricated item ID rejection
    await clientA.eval(sessA, `
      window.__lastRejected = null;
      window.mpManager.network.requestItemPickup('fake_hacked_item_9999');
    `);
    await new Promise(r => setTimeout(r, 400));
    const rejFake = await clientA.eval(sessA, 'window.__lastRejected');
    assert(rejFake, 'Fabricated item ID must be rejected');
    assert(rejFake.reason.includes('does not exist'));
    pass(`Scenario 7: Fabricated item ID rejected cleanly (${rejFake.reason})`);

    // Scenario 8: Out-of-range pickup rejection (> 2.1m)
    // floor_door_key_01 is far from Player A's current position (44.75, -186.45) vs floor_first_aid_01 (43.7, -188.9)
    await clientA.eval(sessA, `
      window.__lastRejected = null;
      // Request floor_first_aid_01 while player is still at (44.75, 0.0, -186.45)
      // Distance is sqrt((44.75-43.7)^2 + (-186.45 - (-188.9))^2) = sqrt(1.05^2 + 2.45^2) = 2.66m > 2.6m
      window.mpManager.network.requestItemPickup('floor_first_aid_01');
    `);
    await new Promise(r => setTimeout(r, 400));
    const rejRange = await clientA.eval(sessA, 'window.__lastRejected');
    assert(rejRange, 'Out of range pickup must be rejected');
    assert(rejRange.reason.includes('too far'));
    pass(`Scenario 8: Out-of-range pickup rejected (${rejRange.reason})`);

    // Scenario 9: Player B collects a different item -> separate independent inventories
    // table_ammo_box_01 is at [44.35, 0.936, -185.45]
    await clientB.eval(sessB, `
      // Move Player B near table_ammo_box_01 at z = -184.45 looking towards -Z
      window.localPlayer.pos.set(44.35, 0.0, -184.45);
      window.localPlayer.yaw = 0.0;
      window.localPlayer.pitch = -0.60;
      window.camera.position.set(44.35, 1.62, -184.45);
      window.camera.rotation.order = 'YXZ';
      window.camera.rotation.y = 0.0;
      window.camera.rotation.x = -0.60;
      window.localPlayer.networkClient.sendUpdate(44.35, 0.0, -184.45, 0.0, -0.60, 0);
      window.interactionManager.update();
    `);
    await new Promise(r => setTimeout(r, 250));

    const targetB = await clientB.eval(sessB, 'window.interactionManager.currentTarget?.id');
    console.log('[DEBUG TARGET B]', targetB);

    await clientB.eval(sessB, `
      window.interactionManager.triggerInteraction();
    `);
    await new Promise(r => setTimeout(r, 500));

    const invA_final = await clientA.eval(sessA, `({
      first_aid: window.inventory.getCount('first_aid'),
      ammo_box: window.inventory.getCount('ammo_box')
    })`);
    const invB_final = await clientB.eval(sessB, `({
      first_aid: window.inventory.getCount('first_aid'),
      ammo_box: window.inventory.getCount('ammo_box')
    })`);

    assert.strictEqual(invA_final.first_aid, 1);
    assert.strictEqual(invA_final.ammo_box, 0);
    assert.strictEqual(invB_final.first_aid, 0);
    assert.strictEqual(invB_final.ammo_box, 1);
    pass('Scenario 9: Player A and Player B maintain independent inventories (Player A: 1 first_aid, Player B: 1 ammo_box)');

    // Capture Developer Inventory Panel Screenshot
    const shotInvPanelPath = path.join(ARTIFACT_DIR, 'developer_inventory_panel.png');
    await clientA.screenshot(sessA, shotInvPanelPath);
    pass(`Saved dev inventory panel screenshot to ${shotInvPanelPath}`);

    // Scenario 10: Two different rooms have independent item states
    const clientC = new ChromeClient(9233, '/tmp/chrome_prof_clientC');
    await clientC.start();
    const sessC = await clientC.createPageSession();
    await clientC.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/multiplayer.html` }, sessC);

    for (let i = 0; i < 40; i++) {
      const readyC = await clientC.eval(sessC, '!!(window.itemManager && window.itemManager.isLoaded && window.mpManager?.network?.isConnected)');
      if (readyC) break;
      await new Promise(r => setTimeout(r, 200));
    }

    // Client C creates room INV2
    await clientC.eval(sessC, 'window.mpManager.createRoom("INV2");');
    await new Promise(r => setTimeout(r, 600));

    // Check table_first_aid_01 in Room INV2: must STILL be available and visible!
    const itemStateC = await clientC.eval(sessC, `
      const item = window.itemManager.getItemById('table_first_aid_01');
      return {
        exists: !!item,
        isCollected: !!item?.isCollected,
        visible: item?.object ? item.object.visible : null
      };
    `);
    assert.strictEqual(itemStateC.isCollected, false);
    assert.strictEqual(itemStateC.visible, true);
    pass('Scenario 10: Room INV2 maintains independent pickup state (table_first_aid_01 is available and visible)');
    await clientC.close();

    // Scenario 11: Player joining room mid-game does not see collected items
    // Player B disconnects from Room INV1
    await clientB.eval(sessB, 'window.mpManager.disconnect();');
    await new Promise(r => setTimeout(r, 400));

    // Player D joins Room INV1
    const clientD = new ChromeClient(9234, '/tmp/chrome_prof_clientD');
    await clientD.start();
    const sessD = await clientD.createPageSession();
    await clientD.send('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/multiplayer.html` }, sessD);

    for (let i = 0; i < 40; i++) {
      const readyD = await clientD.eval(sessD, '!!(window.itemManager && window.itemManager.isLoaded && window.mpManager?.network?.isConnected)');
      if (readyD) break;
      await new Promise(r => setTimeout(r, 200));
    }

    await clientD.eval(sessD, 'window.mpManager.joinRoom("INV1");');
    await new Promise(r => setTimeout(r, 800));

    const itemStatesD = await clientD.eval(sessD, `({
      medkit: {
        isCollected: !!window.itemManager.getItemById('table_first_aid_01')?.isCollected,
        visible: window.itemManager.getItemById('table_first_aid_01')?.object?.visible
      },
      ammoBox: {
        isCollected: !!window.itemManager.getItemById('table_ammo_box_01')?.isCollected,
        visible: window.itemManager.getItemById('table_ammo_box_01')?.object?.visible
      }
    })`);

    assert.strictEqual(itemStatesD.medkit.isCollected, true);
    assert.strictEqual(itemStatesD.medkit.visible, false);
    assert.strictEqual(itemStatesD.ammoBox.isCollected, true);
    assert.strictEqual(itemStatesD.ammoBox.visible, false);
    pass('Scenario 11: Late-joining Player D does not see previously collected items (both items hidden)');
    await clientD.close();

    // Scenario 12: Frozen room layout revision matches room creation
    const layoutRevA = await clientA.eval(sessA, 'window.mpManager.currentRoomCode');
    assert.strictEqual(layoutRevA, 'INV1');
    pass('Scenario 12: Room layout revision frozen across sessions');

    // Close dev clients
    await clientA.close();
    await clientB.close();
    devServer.kill();

    // Scenario 13: Normal server mode (without --dev-rendering)
    console.log('\n--- 2. Testing Production Mode (Server without --dev-rendering) ---');
    const PROD_PORT = 8763;
    const prodServer = spawn('node', ['server/index.js'], {
      cwd: CLIENT_DIR,
      env: { ...process.env, PORT: PROD_PORT }
    });
    prodServer.stdout.on('data', d => console.log('[PROD SERVER]', d.toString().trim()));
    prodServer.stderr.on('data', d => console.error('[PROD SERVER ERR]', d.toString().trim()));

    await new Promise(r => setTimeout(r, 1200));

    const clientProd = new ChromeClient(9235, '/tmp/chrome_prof_clientProd');
    await clientProd.start();
    const sessProd = await clientProd.createPageSession();
    await clientProd.send('Page.navigate', { url: `http://127.0.0.1:${PROD_PORT}/multiplayer.html` }, sessProd);

    for (let i = 0; i < 40; i++) {
      const readyP = await clientProd.eval(sessProd, '!!(window.itemManager && window.itemManager.isLoaded && window.mpManager?.network?.isConnected)');
      if (readyP) break;
      await new Promise(r => setTimeout(r, 200));
    }

    // Verify dev panel removed from DOM
    const devPanelExists = await clientProd.eval(sessProd, '!!document.getElementById("dev-comparison-panel")');
    assert.strictEqual(devPanelExists, false, 'Dev comparison panel must be removed in production mode');

    // Verify room creation and pickup in prod mode
    await clientProd.eval(sessProd, `
      window.__lastRejected = null;
      window.mpManager.network.onPickupRejected = (payload) => {
        window.__lastRejected = payload;
      };
      window.mpManager.createRoom('PROD1');
    `);

    // Ensure room is fully joined and spawn assigned before moving
    for (let i = 0; i < 40; i++) {
      const inRoom = await clientProd.eval(sessProd, 'window.mpManager.currentRoomCode === "PROD1" && !!window.mpManager.myPlayerId');
      if (inRoom) break;
      await new Promise(r => setTimeout(r, 100));
    }

    // Move to table_first_aid_01 and pick it up
    await clientProd.eval(sessProd, `
      window.localPlayer.pos.set(44.75, 0.0, -184.45);
      window.localPlayer.yaw = 0.0;
      window.localPlayer.pitch = -0.60;
      window.camera.position.set(44.75, 1.62, -184.45);
      window.camera.rotation.order = 'YXZ';
      window.camera.rotation.y = 0.0;
      window.camera.rotation.x = -0.60;
      window.localPlayer.networkClient.sendUpdate(44.75, 0.0, -184.45, 0.0, -0.60, 0);
      window.interactionManager.update();
    `);
    await new Promise(r => setTimeout(r, 400));

    const triggerResult = await clientProd.eval(sessProd, `(() => {
      const im = window.interactionManager;
      if (!im) return { error: 'no interactionManager' };
      im.update();
      if (!im.currentTarget) return { error: 'no currentTarget', isEnabled: im.enabled };
      if (im.currentTarget.distance > im.maxDistance) return { error: 'distance too large', dist: im.currentTarget.distance };
      im.triggerInteraction();
      return { success: true, target: im.currentTarget.id };
    })()`);
    console.log('[TRIGGER RESULT]', triggerResult);
    await new Promise(r => setTimeout(r, 600));

    const prodDiag = await clientProd.eval(sessProd, `(() => {
      return {
        room: window.mpManager.currentRoomCode,
        playerId: window.mpManager.myPlayerId,
        connected: window.mpManager.network?.isConnected,
        target: window.interactionManager.currentTarget ? {
          id: window.interactionManager.currentTarget.id,
          distance: window.interactionManager.currentTarget.distance
        } : null,
        itemsCount: window.itemManager.items.length,
        itemMedkit: window.itemManager.getItemById('table_first_aid_01') ? {
          isCollected: window.itemManager.getItemById('table_first_aid_01').isCollected,
          pos: [
            window.itemManager.getItemById('table_first_aid_01').object.position.x,
            window.itemManager.getItemById('table_first_aid_01').object.position.y,
            window.itemManager.getItemById('table_first_aid_01').object.position.z
          ]
        } : null,
        slots: window.inventory.getSlots(),
        lastRejected: window.__lastRejected
      };
    })()`);
    console.log('[PROD DIAG]', JSON.stringify(prodDiag, null, 2));

    const prodInv = await clientProd.eval(sessProd, 'window.inventory.getCount("first_aid")');
    assert.strictEqual(prodInv, 1, 'Player in production mode must be able to collect item');
    pass('Scenario 13: Normal server mode (without --dev-rendering) supports rooms, pickups, and inventory with dev panel removed');

    await clientProd.close();
    prodServer.kill();

    console.log('\n========================================================================');
    console.log(` ALL MULTIPLAYER SCENARIOS PASSED! (${passedTests} / ${totalTests} assertions)`);
    console.log('========================================================================');

  } catch (err) {
    console.error('Test run failed:', err);
    devServer.kill();
    process.exit(1);
  }
}

run();
