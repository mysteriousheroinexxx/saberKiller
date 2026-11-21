// Level 0 story and encounter. Shared movement, weapons, enemies, and dialogue
// remain in the engine; this module owns only the gate and summoning ritual.
import {
  registerLevel, P, WS, mission, cellCenter,
  npcs, zombies, showMsg, $, installSorcererModel, addBloodDecalAsset, gameOver, scene, camera,
  wallMeshes, floorMesh, ceilMesh, fluorescentGroup, outletGroup, propGroup, trimMeshes, WALLH,
  setCustomCollision
} from '../engine.js';
import {
  initLevel0Env, enterLevel0Env, updateLevel0Env, leaveLevel0Env, getCollisionHandler
} from './level0_env.js';

initLevel0Env(scene);

const RITUAL_SECONDS = 40;
const ritual = { started: false, ready: false, elapsed: 0, wizardHp: 100, gateWarned: false, met: false };
let exitPortal = null;
let gateNote = null;

function makeGateNote() {
  if (gateNote) return;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const c = canvas.getContext('2d'); c.fillStyle = '#211c18'; c.fillRect(0, 0, 512, 128);
  c.strokeStyle = '#b79b65'; c.lineWidth = 8; c.strokeRect(5, 5, 502, 118);
  c.fillStyle = '#f3e4c0'; c.font = 'bold 32px monospace'; c.textAlign = 'center';
  c.fillText('THIS DOOR IS', 256, 53); c.fillText('MAGICALLY LOCKED', 256, 96);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
  // Place near the exit portal and ladder
  sp.position.set(79.55, 1.55, 206.8); sp.scale.set(2.5, .65, 1);
  scene.add(sp); gateNote = sp;
}

function nearGateNote() {
  if (!gateNote?.visible) return false;
  return Math.hypot(P.pos.x - gateNote.position.x, P.pos.z - gateNote.position.z) < 2.4;
}
function notePrompt() { return nearGateNote() ? '[E] Read note' : ''; }
function interact() {
  if (!nearGateNote()) return false;
  showMsg('NOTE: THIS DOOR IS MAGICALLY LOCKED'); return true;
}

const WIZARD_DIALOGUE = {
  start: {
    name: 'SUMMONER',
    text: 'That gate will not yield by force. It is keyed to the old rite. Three reagents must be gathered, then I can open a road through the veil. I can begin the portal, but Artoria Lily will hear the spell.',
    choices: [
      { label: 'I will gather the reagents. Open the portal.', action: beginRitual, next: 'ritual' },
      { label: 'Tell me what I am facing.', next: 'warning' }
    ]
  },
  warning: { name: 'SUMMONER', text: 'She comes for the light of the rite. Keep her away from me until the portal stabilizes. If I fall, the spell ends.', next: 'start' },
  ritual: { name: 'SUMMONER', text: 'Then stand with me. Hold Artoria Lily back until the portal is ready!', next: 'end' },
  end: { name: 'SUMMONER', text: 'The rite is underway. Guard me!' }
};

function beginRitual() {
  if (ritual.ready) return;
  ritual.started = true; ritual.elapsed = 0; ritual.wizardHp = 100;
  mission.hitCooldown = 0;
  const wizard = npcs.find(n => n.summoner);
  if (wizard) { wizard.following = false; wizard.followPath = []; wizard.followTimer = 0; }
  mission.active = true;
  mission.target = wizard?.group.position || null;
  mission.onHit = damageWizard;
  showMsg('PROTECT THE SUMMONER — 40 SECONDS');
  updateMissionHud();
}

function damageWizard(amount) {
  const wizard = npcs.find(n => n.summoner);
  if ((!ritual.started && !wizard?.following) || P.dead) return;
  ritual.wizardHp = Math.max(0, ritual.wizardHp - amount);
  if (ritual.wizardHp === 0) {
    ritual.started = false; mission.active = false; mission.target = null; mission.onHit = null;
    if (wizard) addBloodDecalAsset(wizard.group.position);
    gameOver('THE SUMMONER WAS LOST<br>THE PORTAL RITUAL FAILED<br>YOU FAILED TO PROTECT HER');
  }
  updateMissionHud();
}

function updateMissionHud() {
  const el = $('missionHud');
  if (!ritual.met && !ritual.started && !ritual.ready) { el.style.opacity = 0; el.style.display = 'none'; return; }
  const remaining = Math.max(0, RITUAL_SECONDS - ritual.elapsed);
  const hp = Math.max(0, Math.min(100, ritual.wizardHp));
  const status = ritual.ready ? 'PORTAL OPEN — REACH THE GATE'
    : ritual.started ? `PORTAL RITUAL · ${remaining.toFixed(1)}s REMAINING` : 'SUMMONER MET · RITUAL NOT STARTED';
  el.innerHTML = `SUMMONER HEALTH · ${hp}%<div id="summonerBarTrack"><div id="summonerBarFill" style="width:${hp}%"></div></div><span id="summonerStatus">${status}</span>`;
  el.style.display = 'block'; el.style.opacity = 1;
}

function npcInteract(n) {
  if (!n?.summoner) return;
  ritual.met = true; updateMissionHud();
}

function enter(id, portal) {
  if (id !== 'backrooms') return;
  exitPortal = portal;

  const setupEnvironmentAndCollision = () => {
    enterLevel0Env(scene, { wallMeshes, floorMesh, ceilMesh, fluorescentGroup, outletGroup, propGroup, trimMeshes });
    const ch = getCollisionHandler();
    if (ch) setCustomCollision(ch);
    P.pos.set(48.69, 0, -187.65);
    P.yaw = 0; P.pitch = 0;
    if (camera) camera.position.set(48.69, 1.62, -187.65);
  };

  const ch = getCollisionHandler();
  if (ch) {
    setupEnvironmentAndCollision();
  } else {
    initLevel0Env(scene, setupEnvironmentAndCollision);
  }

  // 4. Align exit portal to authentic exit coordinates: [79.55, 0.0, 208.47]
  if (portal) {
    portal.position.set(79.55, 0.0, 208.47);
    if (portal.userData.rift) {
      portal.userData.rift.material.color.setHex(0x554b70);
      portal.userData.rift.material.opacity = .14;
    }
  }

  // 5. Gate note placed next to the exit ladder
  makeGateNote();
  if (gateNote) {
    gateNote.position.set(79.55, 1.55, 206.8);
    gateNote.visible = true;
  }

  // 6. Summoner NPC in starting room
  const returning = npcs.find(n => n.summoner && n.following);
  if (!returning) Object.assign(ritual, { started: false, ready: false, elapsed: 0, wizardHp: 100, gateWarned: false, met: false });
  let wizard = returning || npcs.find(n => n.summoner) || npcs[0];
  if (!wizard && typeof makeNPCFigure === 'function') {
    const g = makeNPCFigure(0x4a6a8a);
    if (scene) scene.add(g);
    wizard = { group: g, name: 'SUMMONER WIZARD', tree: WIZARD_DIALOGUE, summoner: true, phase: 0, _d: 99, placeholder: true, baseYaw: 0 };
    npcs.push(wizard);
  }
  if (wizard) {
    wizard.name = 'SUMMONER WIZARD'; wizard.tree = WIZARD_DIALOGUE; wizard.summoner = true;
    installSorcererModel(wizard);
    if (!wizard.following && wizard.group) {
      wizard.group.position.set(46.5, 0.0, -189.5);
      wizard.group.rotation.y = 0;
    }
    if (wizard.following && wizard.group) { mission.active = true; mission.target = wizard.group.position; mission.onHit = damageWizard; }
    else { mission.active = false; mission.target = null; mission.onHit = null; }
  }

  updateMissionHud();
}

function update(dt) {
  updateLevel0Env(dt, P.pos, zombies, P.yaw);
  if (exitPortal?.userData.rift) {
    const rift = exitPortal.userData.rift;
    rift.material.color.setHex(ritual.ready ? 0xf0e040 : 0x554b70);
    rift.material.opacity = ritual.ready ? .34 : .14;
  }
  if (!ritual.started || !WS.playing || WS.paused) { updateMissionHud(); return; }
  ritual.elapsed = Math.min(RITUAL_SECONDS, ritual.elapsed + dt);
  if (ritual.elapsed >= RITUAL_SECONDS) {
    ritual.started = false; ritual.ready = true;
    const wizard = npcs.find(n => n.summoner);
    if (wizard) { wizard.following = true; wizard.followPath = []; wizard.followTimer = 0; }
    mission.active = true; mission.target = npcs.find(n => n.summoner)?.group.position || null; mission.onHit = damageWizard;
    showMsg('PORTAL OPEN — REACH THE GATE');
  }
  updateMissionHud();
}

function exit(portal) {
  if (ritual.ready) return false;
  if (portal?.userData.rift) { portal.userData.rift.material.color.setHex(0x554b70); portal.userData.rift.material.opacity = .14; }
  if (!ritual.gateWarned) {
    ritual.gateWarned = true;
    showMsg('THE GATE IS SEALED — FIND THE SUMMONER');
  }
  return true;
}

function leave() {
  leaveLevel0Env(scene, { wallMeshes, floorMesh, ceilMesh });
  setCustomCollision(null);
  if (!npcs.find(n => n.summoner && n.following)) { mission.active = false; mission.target = null; mission.onHit = null; }
  if (gateNote) gateNote.visible = false;
  if (!ritual.met) { $('missionHud').style.opacity = 0; $('missionHud').style.display = 'none'; }
}

registerLevel('backrooms', { enter, update, exit, leave, prompt: notePrompt, interact, npcInteract });
