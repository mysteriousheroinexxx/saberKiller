// Level 0 story and encounter. Shared movement, weapons, enemies, and dialogue
// remain in the engine; this module owns only the gate and summoning ritual.
import {
  registerLevel, P, WS, mission, cellCenter,
  npcs, showMsg, $, installSorcererModel, addBloodDecalAsset, gameOver, scene
} from '../engine.js';

const RITUAL_SECONDS = 40;
const ritual = { started:false, ready:false, elapsed:0, wizardHp:100, gateWarned:false, met:false };
let exitPortal=null;
let gateNote=null;

function makeGateNote(){
  if(gateNote)return;
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
  const c=canvas.getContext('2d');c.fillStyle='#211c18';c.fillRect(0,0,512,128);
  c.strokeStyle='#b79b65';c.lineWidth=8;c.strokeRect(5,5,502,118);
  c.fillStyle='#f3e4c0';c.font='bold 32px monospace';c.textAlign='center';
  c.fillText('THIS DOOR IS',256,53);c.fillText('MAGICALLY LOCKED',256,96);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas)}));
  const [x,z]=cellCenter(5,6);sp.position.set(x,1.55,z);sp.scale.set(2.5,.65,1);
  scene.add(sp);gateNote=sp;
}
function nearGateNote(){
  if(!gateNote?.visible)return false;
  return Math.hypot(P.pos.x-gateNote.position.x,P.pos.z-gateNote.position.z)<2.4;
}
function notePrompt(){return nearGateNote()?'[E] Read note':'';}
function interact(){
  if(!nearGateNote())return false;
  showMsg('NOTE: THIS DOOR IS MAGICALLY LOCKED');return true;
}

const WIZARD_DIALOGUE = {
  start: {
    name:'SUMMONER',
    text:'That gate will not yield by force. It is keyed to the old rite. Three reagents must be gathered, then I can open a road through the veil. I can begin the portal, but the sabers will hear the spell.',
    choices:[
      {label:'I will gather the reagents. Open the portal.',action:beginRitual,next:'ritual'},
      {label:'Tell me what I am facing.',next:'warning'}
    ]
  },
  warning:{name:'SUMMONER',text:'They come for the light of the rite. Keep them away from me until the portal stabilizes. If I fall, the spell ends.',next:'start'},
  ritual:{name:'SUMMONER',text:'Then stand with me. Hold the sabers back until the portal is ready!',next:'end'},
  end:{name:'SUMMONER',text:'The rite is underway. Guard me!'}
};

function beginRitual(){
  if(ritual.ready)return;
  ritual.started=true;ritual.elapsed=0;ritual.wizardHp=100;
  const wizard=npcs.find(n=>n.summoner);
  if(wizard){wizard.following=false;wizard.followPath=[];wizard.followTimer=0;}
  mission.active=true;
  mission.target=wizard?.group.position||null;
  mission.onHit=damageWizard;
  showMsg('PROTECT THE SUMMONER — 40 SECONDS');
  updateMissionHud();
}

function damageWizard(amount){
  const wizard=npcs.find(n=>n.summoner);
  if((!ritual.started&&!wizard?.following)||P.dead)return;
  ritual.wizardHp=Math.max(0,ritual.wizardHp-amount);
  if(ritual.wizardHp===0){
    ritual.started=false;mission.active=false;mission.target=null;mission.onHit=null;
    if(wizard)addBloodDecalAsset(wizard.group.position);
    gameOver('THE SUMMONER WAS LOST<br>THE PORTAL RITUAL FAILED<br>YOU FAILED TO PROTECT HER');
  }
  updateMissionHud();
}

function updateMissionHud(){
  const el=$('missionHud');
  if(!ritual.met&&!ritual.started&&!ritual.ready){el.style.opacity=0;return;}
  const remaining=Math.max(0,RITUAL_SECONDS-ritual.elapsed);
  const hp=Math.max(0,Math.min(100,ritual.wizardHp));
  const status=ritual.ready?'PORTAL OPEN — RETURN TO THE GATE'
    :ritual.started?`PORTAL RITUAL · ${remaining.toFixed(1)}s REMAINING`:'SUMMONER MET · RITUAL NOT STARTED';
  el.innerHTML=`SUMMONER HEALTH · ${hp}%<div id="summonerBarTrack"><div id="summonerBarFill" style="width:${hp}%"></div></div><span id="summonerStatus">${status}</span>`;
  el.style.opacity=1;
}

function npcInteract(n){
  if(!n?.summoner)return;
  ritual.met=true;updateMissionHud();
}

function enter(id,portal){
  if(id!=='backrooms')return;
  exitPortal=portal;
  makeGateNote();gateNote.visible=true;
  const returning=npcs.find(n=>n.summoner&&n.following);
  if(!returning)Object.assign(ritual,{started:false,ready:false,elapsed:0,wizardHp:100,gateWarned:false,met:false});
  const wizard=returning||npcs[0];
  if(wizard){
    wizard.name='SUMMONER WIZARD';wizard.tree=WIZARD_DIALOGUE;wizard.summoner=true;
    installSorcererModel(wizard);
    if(wizard.following){mission.active=true;mission.target=wizard.group.position;mission.onHit=damageWizard;}
    else {mission.active=false;mission.target=null;mission.onHit=null;}
  }
  if(portal?.userData.rift){portal.userData.rift.material.color.setHex(0x554b70);portal.userData.rift.material.opacity=.14;}
  updateMissionHud();
}

function update(dt){
  if(exitPortal?.userData.rift){
    const rift=exitPortal.userData.rift;
    rift.material.color.setHex(ritual.ready?0xf0e040:0x554b70);
    rift.material.opacity=ritual.ready ? .34 : .14;
  }
  if(!ritual.started||!WS.playing||WS.paused){updateMissionHud();return;}
  ritual.elapsed=Math.min(RITUAL_SECONDS,ritual.elapsed+dt);
  if(ritual.elapsed>=RITUAL_SECONDS){
    ritual.started=false;ritual.ready=true;
    const wizard=npcs.find(n=>n.summoner);
    if(wizard){wizard.following=true;wizard.followPath=[];wizard.followTimer=0;}
    mission.active=true;mission.target=npcs.find(n=>n.summoner)?.group.position||null;mission.onHit=damageWizard;
    showMsg('PORTAL OPEN — REACH THE GATE');
  }
  // Keep the exit visibly sealed until the ritual completes.
  updateMissionHud();
}

function exit(portal){
  if(ritual.ready)return false;
  if(portal?.userData.rift){portal.userData.rift.material.color.setHex(0x554b70);portal.userData.rift.material.opacity=.14;}
  if(!ritual.gateWarned){
    ritual.gateWarned=true;
    showMsg('THE GATE IS SEALED — FIND THE SUMMONER');
  }
  return true;
}

function leave(){
  if(!npcs.find(n=>n.summoner&&n.following)){mission.active=false;mission.target=null;mission.onHit=null;}
  if(gateNote)gateNote.visible=false;
  if(!ritual.met)$('missionHud').style.opacity=0;
}

registerLevel('backrooms',{enter,update,exit,leave,prompt:notePrompt,interact,npcInteract});
