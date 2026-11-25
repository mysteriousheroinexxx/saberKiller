import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RoomManager,
  SANITY_CONFIG,
  configureSanityRules,
  resetSanityConfig,
  ENERGY_DRINK_CONFIG,
  configureEnergyDrinkRules,
  resetEnergyDrinkConfig
} from './room_manager.js';
import {
  SanityController,
  SANITY_STATE,
  DEFAULT_SANITY_CONFIG
} from '../js/multiplayer/sanity_controller.js';
import {
  ITEM_DEFINITIONS,
  ITEM_EFFECTS_CONFIG,
  getItemDefinition
} from '../js/multiplayer/item_catalog.js';
import { LocalPlayerController } from '../js/multiplayer/player_controller.js';
import { SABER_STATES } from './ai/saber_agent.js';

function makeMockSocket() {
  return { readyState: 1, send: () => {} };
}

function makeMockLayout() {
  return {
    layoutRevision: 'test_sanity_drink',
    placements: [
      { id: 'energy_world_1', type: 'energy_drink', position: [48.69, 0, -187.0] },
      { id: 'almond_world_1', type: 'almond_can', position: [49.0, 0, -187.0] },
      { id: 'doorKey_1', type: 'doorKey', position: [78.5, 0, 206.0] }
    ]
  };
}

function makeMinimalPlayerController() {
  // Minimal THREE-like stubs for LocalPlayerController in Node
  globalThis.window = globalThis.window || {
    addEventListener: () => {},
    removeEventListener: () => {},
    sanityController: null
  };
  globalThis.document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    pointerLockElement: null,
    createElement: () => ({
      width: 64,
      height: 64,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop: () => {} }),
        fillStyle: '',
        fillRect: () => {}
      })
    })
  };
  globalThis.THREE = globalThis.THREE || class {};
  THREE.Vector3 = THREE.Vector3 || class {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    clone() { return new THREE.Vector3(this.x, this.y, this.z); }
  };
  THREE.Group = THREE.Group || class {
    constructor() { this.position = new THREE.Vector3(); this.rotation = { x: 0, y: 0, z: 0 }; this.visible = true; this.children = []; }
    add(c) { this.children.push(c); }
    remove(c) {}
    clear() { this.children = []; }
  };
  THREE.SpotLight = THREE.SpotLight || class {
    constructor() { this.position = new THREE.Vector3(); this.target = { position: new THREE.Vector3() }; this.visible = false; }
  };
  THREE.PointLight = THREE.PointLight || class {
    constructor() { this.position = new THREE.Vector3(); }
  };
  THREE.CanvasTexture = THREE.CanvasTexture || class {};
  THREE.SpriteMaterial = THREE.SpriteMaterial || class {};
  THREE.AdditiveBlending = 2;
  THREE.Sprite = THREE.Sprite || class {
    constructor() { this.position = new THREE.Vector3(); this.scale = new THREE.Vector3(); this.visible = false; }
  };
  THREE.Mesh = THREE.Mesh || class {
    constructor() { this.position = new THREE.Vector3(); this.rotation = { x: 0, y: 0, z: 0 }; this.visible = true; this.castShadow = false; }
  };
  THREE.BoxGeometry = THREE.BoxGeometry || class {};
  THREE.CylinderGeometry = THREE.CylinderGeometry || class {};
  THREE.MeshStandardMaterial = THREE.MeshStandardMaterial || class {};
  THREE.MeshBasicMaterial = THREE.MeshBasicMaterial || class {};
  THREE.AmbientLight = THREE.AmbientLight || class {};
  THREE.GLTFLoader = THREE.GLTFLoader || class {
    load() {}
  };
  THREE.Box3 = THREE.Box3 || class {
    setFromObject() { return this; }
    getCenter(v) { return v; }
    getSize(v) { return v; }
  };
  THREE.Color = THREE.Color || class { constructor() {} };

  const camera = {
    position: new THREE.Vector3(),
    rotation: { order: 'YXZ', x: 0, y: 0 },
    add: () => {}
  };
  const scene = new THREE.Group();
  const controller = new LocalPlayerController(camera, scene, null, null);
  return controller;
}

test('1. Budget Backrooms sanity drain: normal exploration decays at baseline 0.035/s, NOT chase rate', () => {
  resetSanityConfig();
  const rm = new RoomManager();
  const ws = makeMockSocket();
  const created = rm.createRoom(ws, 'SAN_BASE', 'default', makeMockLayout(), { directStart: true });
  const room = rm.getRoom(created.roomCode);
  const player = created.player;

  // Pause simulation timer so we can step deterministically
  room.simulation.stop();

  // Force Sabers far away in PATROL state (NOT CHASE)
  const { saberAlpha, saberBeta } = room.simulation.sim;
  saberAlpha.stateMachine.changeTo(SABER_STATES.PATROL);
  saberBeta.stateMachine.changeTo(SABER_STATES.PATROL);
  saberAlpha.canSeeTarget = false;
  saberBeta.canSeeTarget = false;

  assert.equal(player.sanity, 100);
  // Step 10 seconds of normal exploration via RoomSimulation.tick()
  const emptyChase = new Map();
  for (let i = 0; i < 200; i++) {
    rm.stepRoomSurvivalState(room, 0.05, emptyChase);
  }

  const expected = 100 - DEFAULT_SANITY_CONFIG.passiveDrainPerSecond * 10; // 99.65
  assert.ok(Math.abs(player.sanity - expected) < 1e-6, `Expected ~${expected}, got ${player.sanity}`);
  assert.equal(player.isChasedBySaber, false);
  assert.equal(player.sanityDrainRate, SANITY_CONFIG.passiveDrainPerSecond);

  room.simulation.destroy();
});

test('2. Saber CHASE drain: actively chasing Saber increases drain per targeted player, and stops when chase ends', () => {
  resetSanityConfig();
  const rm = new RoomManager();
  const ws1 = makeMockSocket();
  const ws2 = makeMockSocket();

  const created = rm.createRoom(ws1, 'SAN_CHASE', 'default', makeMockLayout());
  rm.joinRoom(ws2, 'SAN_CHASE');
  rm.setPlayerReady(ws2, true);
  rm.startMatch(ws1);

  const room = rm.getRoom('SAN_CHASE');
  room.simulation.stop();

  const players = [...room.players.values()];
  const p1 = players[0];
  const p2 = players[1];
  const sim = room.simulation.sim;

  // Put Alpha into active CHASE targeting ONLY Player 1; Beta remains in PATROL (even in same map!)
  const p1Entity = room.simulation.playerEntities.get(p1.id);
  const p2Entity = room.simulation.playerEntities.get(p2.id);
  sim.saberAlpha.targetEntity = p1Entity;
  sim.saberAlpha.canSeeTarget = true;
  sim.saberAlpha.stateMachine.changeTo(SABER_STATES.CHASE);
  sim.saberBeta.targetEntity = p2Entity;
  sim.saberBeta.canSeeTarget = false;
  sim.saberBeta.stateMachine.changeTo(SABER_STATES.PATROL);

  const collectedEvents = [];
  rm.onRoomEvents = (r, evts) => collectedEvents.push(...evts);

  // Verify RoomSimulation.getChasedPlayersMap() reflects actual Saber AI state + target player
  const chasedMap = room.simulation.getChasedPlayersMap();
  assert.equal(chasedMap.get(p1.id), 1, 'Player 1 must be marked actively chased by Saber Alpha');
  assert.equal(chasedMap.has(p2.id), false, 'Player 2 must NOT get chase drain just because a Saber exists in PATROL');

  // Step 20 seconds while Saber Alpha actively chases Player 1
  for (let i = 0; i < 400; i++) {
    const evts = rm.stepRoomSurvivalState(room, 0.05, chasedMap);
    collectedEvents.push(...evts);
  }

  // Player 1 drained at chaseDrainPerSecond (0.25/s -> -5.0), Player 2 at passive (0.035/s -> -0.7)
  const expectedP1 = 100 - SANITY_CONFIG.chaseDrainPerSecond * 20;
  const expectedP2 = 100 - SANITY_CONFIG.passiveDrainPerSecond * 20;
  assert.ok(Math.abs(p1.sanity - expectedP1) < 1e-5, `Expected P1 sanity ~${expectedP1}, got ${p1.sanity}`);
  assert.ok(Math.abs(p2.sanity - expectedP2) < 1e-5, `Expected P2 sanity ~${expectedP2}, got ${p2.sanity}`);
  assert.equal(p1.isChasedBySaber, true);
  assert.equal(p2.isChasedBySaber, false);
  assert.ok(p1.sanity < p2.sanity - 4.0, 'Chased player sanity dropped noticeably faster than unchased teammate');

  // STALK state (not CHASE) must NOT apply chase drain
  sim.saberAlpha.stateMachine.changeTo(SABER_STATES.STALK);
  const stalkMap = room.simulation.getChasedPlayersMap();
  assert.equal(stalkMap.size, 0, 'STALK state must not trigger chase sanity drain');

  // Search/Patrol after chase ends -> returns Player 1 immediately to baseline normal drain
  sim.saberAlpha.stateMachine.changeTo(SABER_STATES.SEARCH);
  const afterChaseMap = room.simulation.getChasedPlayersMap();
  const p1Before = p1.sanity;
  for (let i = 0; i < 200; i++) {
    rm.stepRoomSurvivalState(room, 0.05, afterChaseMap);
  }
  const p1After = p1.sanity;
  assert.equal(p1.isChasedBySaber, false);
  assert.ok(Math.abs((p1Before - p1After) - SANITY_CONFIG.passiveDrainPerSecond * 10) < 1e-5);

  // Also verify emitted PLAYER_SANITY_UPDATE packets identify the right playerId
  const p1Updates = collectedEvents.filter(e => e.type === 'PLAYER_SANITY_UPDATE' && e.payload.playerId === p1.id);
  const p2Updates = collectedEvents.filter(e => e.type === 'PLAYER_SANITY_UPDATE' && e.payload.playerId === p2.id);
  assert.ok(p1Updates.some(u => u.payload.isChased === true));
  assert.ok(p2Updates.every(u => u.payload.isChased === false));

  room.simulation.destroy();
});

test('3. Zero sanity preserves black-screen collapse without death/damage and allows continued gameplay actions', () => {
  resetSanityConfig();
  const rm = new RoomManager();
  const ws = makeMockSocket();
  const created = rm.createRoom(ws, 'SAN_ZERO', 'default', makeMockLayout(), { directStart: true });
  const room = rm.getRoom('SAN_ZERO');
  room.simulation.stop();
  const player = created.player;

  // Drain player sanity all the way to 0 via active chase ticks
  player.sanity = 1.0;
  const chaseMap = new Map([[player.id, 1]]);
  for (let i = 0; i < 200; i++) {
    rm.stepRoomSurvivalState(room, 0.05, chaseMap);
  }

  assert.equal(player.sanity, 0);
  assert.equal(player.hp, 100, 'Zero sanity must NEVER damage player HP');
  assert.equal(player.state, 'ACTIVE', 'Zero sanity must keep player ACTIVE');
  assert.equal(player.isDead, false);
  assert.equal(player.isDowned, false);

  // Client SanityController enters DEPLETED state (drives black screen) without lethality
  const sc = new SanityController();
  sc.applyServerState({ sanity: player.sanity, maxSanity: 100, isPaused: false, isChased: true });
  assert.equal(sc.currentSanity, 0);
  assert.equal(sc.state, SANITY_STATE.DEPLETED);
  assert.equal(sc.isDepleted, true);

  // Player at 0 sanity can still pick up items, use items, and unlock exit door
  const availKey = [...room.worldItems.values()].find(it => it.type === 'doorKey' && it.available);
  assert.ok(availKey, 'Room has an available key');
  player.position = { x: availKey.position[0], y: 0, z: availKey.position[2] };
  const keyPick = rm.handlePickupRequest(ws, availKey.id);
  assert.equal(keyPick.success, true, `Player at 0 sanity can still pick up items (${keyPick.error || 'ok'})`);
  const unlock = rm.handleDoorUnlock(ws, 'level0_exit_door', { x: 79.0, y: 0, z: 206.5 });
  assert.equal(unlock.success, true, `Player at 0 sanity can still unlock exit door (${unlock.error || 'ok'})`);

  // Almond Water can restore sanity & trigger Budget-Backrooms 4.0s pause from 0%
  player.inventory.addItem('almond_can', 1);
  const almondSlot = player.inventory.getSlots().findIndex(s => s && s.typeId === 'almond_can');
  const useAlmond = rm.handleUseItem(ws, almondSlot);
  assert.equal(useAlmond.success, true);
  assert.equal(player.sanity, ITEM_EFFECTS_CONFIG.almond_can.sanityRestore);
  assert.equal(player.isSanityPaused, true);
  assert.equal(player.sanityPauseRemaining, SANITY_CONFIG.almondPauseDurationSeconds);

  // During Almond Water 4s pause, sanity does not decay
  const sanityRightAfterAlmond = player.sanity;
  for (let i = 0; i < 40; i++) {
    rm.stepRoomSurvivalState(room, 0.05, chaseMap);
  }
  assert.equal(player.sanity, sanityRightAfterAlmond);

  room.simulation.destroy();
});

test('4. Energy Drink: restores stamina to max, applies 1.27x walking speed, removes sanity restoration, never affects Sabers', () => {
  resetEnergyDrinkConfig();
  resetSanityConfig();

  // Verify catalog + effect definitions strictly omit sanity restore and use 1.27x speed
  const drinkDef = getItemDefinition('energy_drink');
  assert.equal(drinkDef.metadata.speedMultiplier, 1.27);
  assert.equal(drinkDef.metadata.sanityRestore, undefined);
  assert.equal(ITEM_EFFECTS_CONFIG.energy_drink.speedMultiplier, 1.27);
  assert.equal(ITEM_EFFECTS_CONFIG.energy_drink.sanityRestore, undefined);

  const rm = new RoomManager();
  const ws = makeMockSocket();
  const created = rm.createRoom(ws, 'DRINK_1', 'default', makeMockLayout(), { directStart: true });
  const room = rm.getRoom('DRINK_1');
  room.simulation.stop();
  const player = created.player;

  // Lower player's sanity & stamina before drinking
  player.sanity = 42.5;
  player.stamina = 15;
  player.inventory.addItem('energy_drink', 2);
  const slot = player.inventory.getSlots().findIndex(s => s && s.typeId === 'energy_drink');
  assert.ok(slot >= 0);

  const saberAlphaSpeedBefore = room.simulation.sim.saberAlpha.chaseSpeed;
  const saberBetaSpeedBefore = room.simulation.sim.saberBeta.chaseSpeed;

  const useRes = rm.handleUseItem(ws, slot);
  assert.equal(useRes.success, true);
  assert.equal(useRes.remainingQuantity, 1, 'Consumed exactly 1 Energy Drink');
  assert.equal(useRes.sanityUpdate, null, 'Energy Drink must not emit sanityUpdate');
  assert.equal(useRes.effect.sanityRestore, undefined, 'Energy Drink effect must not include sanityRestore');
  assert.equal(player.sanity, 42.5, 'Energy Drink must NOT restore sanity');
  assert.equal(player.stamina, player.maxStamina, 'Energy Drink must restore server stamina to maximum');
  assert.equal(player.speedMultiplier, 1.27, 'Energy Drink must apply 1.27x speed multiplier');

  // Verify Sabers were never touched
  assert.equal(room.simulation.sim.saberAlpha.chaseSpeed, saberAlphaSpeedBefore);
  assert.equal(room.simulation.sim.saberBeta.chaseSpeed, saberBetaSpeedBefore);

  // Client LocalPlayerController integration + SanityController check
  const local = makeMinimalPlayerController();
  const sanityCtrl = new SanityController();
  sanityCtrl.setSanity(42.5);
  globalThis.window.sanityController = sanityCtrl;

  local.stamina = 0;
  local._staminaExhausted = true;
  local.applyItemEffect(useRes.effect);

  assert.equal(sanityCtrl.currentSanity, 42.5, 'Client sanity must stay untouched at 42.5');
  assert.equal(local.stamina, local.maxStamina, 'Existing stamina restored to 100%');
  assert.equal(local._staminaExhausted, false, 'Stamina exhaustion cleared immediately');
  assert.equal(local.speedMultiplier, 1.27);
  local.isSprinting = false;
  assert.ok(Math.abs(local.getEffectiveMoveSpeed() - (local.speed * 1.27)) < 1e-6, 'Walking speed is 1.27x normal walk speed');
  local.isSprinting = true;
  assert.ok(Math.abs(local.getEffectiveMoveSpeed() - (local.sprintSpeed * 1.27)) < 1e-6, 'Sprint scales cleanly with active multiplier');

  room.simulation.destroy();
});

test('5. Energy Drink: configurable duration, non-stacking boost, clean expiration, and match reset', () => {
  resetEnergyDrinkConfig();
  configureEnergyDrinkRules({ durationSeconds: 2.0, speedMultiplier: 1.27 });
  assert.equal(ENERGY_DRINK_CONFIG.durationSeconds, 2.0);
  assert.equal(ITEM_DEFINITIONS.energy_drink.metadata.durationSeconds, 2.0);

  const rm = new RoomManager();
  const ws1 = makeMockSocket();
  const created = rm.createRoom(ws1, 'DRINK_DUR', 'default', makeMockLayout(), { directStart: true });
  const room = rm.getRoom('DRINK_DUR');
  room.simulation.stop();
  const player = created.player;

  player.inventory.addItem('energy_drink', 3);
  const slot = player.inventory.getSlots().findIndex(s => s && s.typeId === 'energy_drink');

  // Drink 1
  const r1 = rm.handleUseItem(ws1, slot);
  assert.equal(r1.success, true);
  assert.equal(player.speedMultiplier, 1.27);
  assert.equal(player.speedBoostRemaining, 2.0);

  // Advance 1.0s
  for (let i = 0; i < 20; i++) rm.stepRoomSurvivalState(room, 0.05, new Map());
  assert.equal(player.speedMultiplier, 1.27);
  assert.ok(Math.abs(player.speedBoostRemaining - 1.0) < 1e-6);

  // Drink 2 while boost active -> MUST NOT stack multiplier above 1.27
  const r2 = rm.handleUseItem(ws1, slot);
  assert.equal(r2.success, true);
  assert.equal(player.speedMultiplier, 1.27, 'Repeated consumption must NOT stack speed multiplier');
  assert.equal(player.speedBoostRemaining, 2.0, 'Repeated consumption refreshes configured duration');

  // Also check LocalPlayerController does not stack
  const local = makeMinimalPlayerController();
  local.applyItemEffect(r1.effect);
  local.applyItemEffect(r2.effect);
  assert.equal(local.speedMultiplier, 1.27);
  assert.equal(local.speedBoostTimer, 2.0);

  // Step 2.1s -> boost expires cleanly on both server & client
  let expireEvents = [];
  for (let i = 0; i < 42; i++) {
    expireEvents.push(...rm.stepRoomSurvivalState(room, 0.05, new Map()));
  }
  assert.equal(player.speedMultiplier, 1.0, 'Server speedMultiplier resets to 1.0 upon expiration');
  assert.equal(player.speedBoostRemaining, 0);
  assert.ok(expireEvents.some(e => e.type === 'PLAYER_SPEED_BOOST_UPDATE' && e.payload.active === false && e.payload.speedMultiplier === 1.0));

  // Simulate client update(2.1) expiring boost timer cleanly
  local.speedBoostTimer = 0.05;
  local.speedMultiplier = 1.27;
  local.update(0.1);
  assert.equal(local.speedBoostTimer, 0);
  assert.equal(local.speedMultiplier, 1.0);

  // Drink 3 then reset match -> everything resets cleanly!
  rm.handleUseItem(ws1, slot);
  assert.equal(player.speedMultiplier, 1.27);
  player.sanity = 12;
  player.stamina = 10;

  room.runState = 'GAME_OVER';
  room.simulation.destroy();
  room.simulation = null;
  const restart = rm.startMatch(ws1);
  assert.equal(restart.success, true);
  assert.equal(player.sanity, 100);
  assert.equal(player.stamina, 100);
  assert.equal(player.speedMultiplier, 1.0);
  assert.equal(player.speedBoostRemaining, 0);

  local.speedMultiplier = 1.27;
  local.speedBoostTimer = 10;
  local.stamina = 5;
  local._staminaExhausted = true;
  local.resetCombatState();
  assert.equal(local.speedMultiplier, 1.0);
  assert.equal(local.speedBoostTimer, 0);
  assert.equal(local.stamina, 100);
  assert.equal(local._staminaExhausted, false);

  room.simulation.destroy();
  resetEnergyDrinkConfig();
});
