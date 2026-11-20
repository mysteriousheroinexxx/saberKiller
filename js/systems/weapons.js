// Shared weapon definitions and magazine/reload timing.
// Hit detection, effects, and player-owned ammo remain in the engine.
export const WEAPONS = [
  {name:'PISTOL',dmg:26,rate:.21,spread:.012,pellets:1,ammo:'bullets',capacity:12,reload:1.15,kick:.05},
  {name:'SHOTGUN',dmg:13,rate:.95,spread:.055,pellets:7,ammo:'shells',capacity:6,reload:1.6,kick:.16}
];

export function startReload(player, weaponIndex, onStart){
  const weapon=WEAPONS[weaponIndex];
  if(player.reloadT>0||player.mag[weapon.ammo]>=weapon.capacity||player[weapon.ammo]<=0)return false;
  player.reloadT=weapon.reload;
  player.reloadWeapon=weaponIndex;
  if(onStart)onStart();
  return true;
}

export function updateReload(player,dt){
  if(player.reloadT<=0)return;
  player.reloadT=Math.max(0,player.reloadT-dt);
  if(player.reloadT!==0||player.reloadWeapon<0)return;
  const weapon=WEAPONS[player.reloadWeapon],key=weapon.ammo;
  const needed=Math.max(0,weapon.capacity-player.mag[key]);
  const loaded=Math.min(needed,player[key]);
  player[key]-=loaded;
  player.mag[key]+=loaded;
  player.reloadWeapon=-1;
}
