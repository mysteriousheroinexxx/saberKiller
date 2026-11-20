// Level 0 story and encounter. Shared movement, weapons, enemies, and dialogue
// remain in the engine; this module owns only the gate and summoning ritual.
import {
  registerLevel, P, WS, mission, spawnZombie, floorCells, cellCenter,
  npcs, showMsg, $
} from '../engine.js';

const RITUAL_SECONDS = 40;
const RUSH_INTERVAL = 2.8;
const ritual = { started:false, ready:false, elapsed:0, nextRush:0, wizardHp:100, gateWarned:false };
let exitPortal=null;

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
  ritual.started=true;ritual.elapsed=0;ritual.nextRush=1.2;ritual.wizardHp=100;
  mission.active=true;
  const wizard=npcs[0];
  mission.target=wizard?.group.position||null;
  mission.onHit=damageWizard;
  showMsg('PROTECT THE SUMMONER — 40 SECONDS');
  updateMissionHud();
}

function damageWizard(amount){
  if(!ritual.started||ritual.ready)return;
  ritual.wizardHp=Math.max(0,ritual.wizardHp-amount);
  if(ritual.wizardHp===0){
    ritual.started=false;mission.active=false;mission.target=null;mission.onHit=null;
    showMsg('THE SUMMONER FELL — SPEAK TO HIM TO RETRY');
  }
  updateMissionHud();
}

function spawnRush(){
  const wizard=mission.target;
  if(!wizard||!floorCells.length)return;
  let cell=null,best=0;
  for(let i=0;i<40;i++){
    const c=floorCells[(Math.random()*floorCells.length)|0];
    const [x,z]=cellCenter(c[0],c[1]);
    const d=Math.hypot(x-wizard.x,z-wizard.z);
    if(d>best){best=d;cell=c;}
    if(d>12)break;
  }
  if(cell)spawnZombie(cell[0],cell[1]);
}

function updateMissionHud(){
  const el=$('missionHud');
  if(!ritual.started&&!ritual.ready){el.style.opacity=0;return;}
  const remaining=Math.max(0,RITUAL_SECONDS-ritual.elapsed);
  el.textContent=ritual.ready
    ? 'PORTAL OPEN — RETURN TO THE GATE'
    : `SUMMONER ${ritual.wizardHp}%   ·   PORTAL ${remaining.toFixed(1)}s`;
  el.style.opacity=1;
}

function enter(id,portal){
  if(id!=='backrooms')return;
  exitPortal=portal;
  Object.assign(ritual,{started:false,ready:false,elapsed:0,nextRush:0,wizardHp:100,gateWarned:false});
  mission.active=false;mission.target=null;mission.onHit=null;
  const wizard=npcs[0];
  if(wizard){
    wizard.name='SUMMONER WIZARD';wizard.tree=WIZARD_DIALOGUE;
    wizard.group.traverse(o=>{if(o.isMesh&&o.material?.color)o.material.color.setHex(0x66519a);});
  }
  if(portal?.userData.rift){portal.userData.rift.material.color.setHex(0x554b70);portal.userData.rift.material.opacity=.14;}
  $('missionHud').style.opacity=0;
}

function update(dt){
  if(exitPortal?.userData.rift){
    const rift=exitPortal.userData.rift;
    rift.material.color.setHex(ritual.ready?0xf0e040:0x554b70);
    rift.material.opacity=ritual.ready ? .34 : .14;
  }
  if(!ritual.started||!WS.playing||WS.paused){updateMissionHud();return;}
  ritual.elapsed=Math.min(RITUAL_SECONDS,ritual.elapsed+dt);
  ritual.nextRush-=dt;
  if(ritual.nextRush<=0&&ritual.elapsed<RITUAL_SECONDS){
    spawnRush();ritual.nextRush=RUSH_INTERVAL;
  }
  if(ritual.elapsed>=RITUAL_SECONDS){
    ritual.started=false;ritual.ready=true;
    mission.active=false;mission.target=null;mission.onHit=null;
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
  mission.active=false;mission.target=null;mission.onHit=null;
  $('missionHud').style.opacity=0;
}

registerLevel('backrooms',{enter,update,exit,leave});
