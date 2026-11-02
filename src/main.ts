import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Block, biomeAt, type Biome, World } from './world';
import { Enemies } from './entities';
import { AudioEngine } from './audio';
import { Inventory, UI } from './ui';
import { Player } from './player';
import { Avatar } from './avatar';
import { nearbyLight } from './lighting';
import { DebugOverlay, type DamageSource } from './debugOverlay';
import { BeamWeapon } from './beam';
import { PowerUps, REDUCED_GRAVITY, trySpawnPlatform } from './powerups';
import { Critters } from './critters';
import { BiomeHooks, HOOKS } from './biomeHooks';
import { loadSettings, saveReduceIntensity, saveVolume } from './settings';
import { clearSave, deserializeInventory, readSave, serializeInventory, writeSave } from './save';
import './style.css';

const clamp = THREE.MathUtils.clamp;
const colors: Record<Biome, number> = {overcast:0x343e3b, storm:0x11151b, glitch:0x34203f, psychosis:0x332b38, maw:0x401014, catacombs:0x0b0b10, veins:0x29090f, sky:0x31333d};
const scene = new THREE.Scene();
scene.background = new THREE.Color(colors.overcast);
scene.fog = new THREE.FogExp2(colors.overcast, 0.027);
const renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.querySelector('#app')!.appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); const el=document.createElement('div'); el.style.cssText='position:fixed;inset:0;z-index:10000;background:#111;color:white;padding:3rem;font:18px sans-serif'; el.textContent='The graphics context was lost. Close other graphics-heavy tabs and reload the game.'; document.body.appendChild(el); });
const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.07, 180);
const ambient = new THREE.HemisphereLight(0xb8c4be, 0x20201e, 1.15); scene.add(ambient);
const sun = new THREE.DirectionalLight(0xc2c5bd, 1.3); sun.position.set(15,35,10); scene.add(sun);
const flash = new THREE.PointLight(0xdcecff,0,45); scene.add(flash);
const lantern = new THREE.PointLight(0xffb86b,0,12); scene.add(lantern);
const world = new World(scene);
const enemies = new Enemies(scene,world);
const critters = new Critters(scene,world);
const audio = new AudioEngine();
const beam = new BeamWeapon(scene, world, camera);
const powerups = new PowerUps();
PowerUps.placeAll(world);
const hooks = new BiomeHooks(world);
const inventory = new Inventory();
let menuOpen = false, started = false, dead = false, deathTimer = 0;
const settings = loadSettings();
const ui = new UI(inventory, open => { menuOpen = open; if (open && document.pointerLockElement) document.exitPointerLock(); }, {
  volume: settings.volume,
  reduceIntensity: settings.reduceIntensity,
  onVolume: value => { const v = saveVolume(value); settings.volume = v; audio.setVolume(v); return v; },
  onReduceIntensity: value => { settings.reduceIntensity = saveReduceIntensity(value); },
});
const player = new Player(0.5,world.surface(0,0)+1.01,0.5);
const avatar = new Avatar(scene);
const spawn = player.position.clone();
let health=100, sanity=100, stamina=100, yaw=0, pitch=0, gravity=1, thirdPerson=false, activeBiome:Biome='overcast';
let time=0, gravityTimer=0, lightningTimer=6, flashTimer=0, effectTimer=0, invertTimer=0, footsteps=0, lastImpact=0, hookMessage='';
const overlay = new DebugOverlay();
const keys = new Set<string>(); let jumpQueued=false;
const fog = scene.fog as THREE.FogExp2;
const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene,camera));
const post = new ShaderPass({uniforms:{tDiffuse:{value:null}, uTime:{value:0}, uGlitch:{value:0}, uPsy:{value:0}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:`uniform sampler2D tDiffuse;uniform float uTime,uGlitch,uPsy;varying vec2 vUv;
void main(){vec2 p=vUv; float band=step(.985,fract(sin(floor(p.y*80.)+floor(uTime*8.))*43758.5453)); p.x+=uGlitch*band*.012*sin(uTime*37.); float d=uGlitch*.003; vec3 col=vec3(texture2D(tDiffuse,p+vec2(d,0.)).r,texture2D(tDiffuse,p).g,texture2D(tDiffuse,p-vec2(d,0.)).b); col*=1.-uGlitch*.13*(.5+.5*sin(p.y*900.)); float vignette=smoothstep(.83,.2,length(vUv-.5)); col*=mix(1.,.48+.52*vignette,uPsy);gl_FragColor=vec4(col,1.);\n#include <colorspace_fragment>\n}`}); composer.addPass(post);
// Rain is visual only; lightning and wind have their own gameplay timers.
const rainPositions=new Float32Array(600*3); for(let i=0;i<600;i++){rainPositions[i*3]=(Math.random()-.5)*36;rainPositions[i*3+1]=Math.random()*20;rainPositions[i*3+2]=(Math.random()-.5)*36;}
const rainGeo=new THREE.BufferGeometry(); rainGeo.setAttribute('position',new THREE.BufferAttribute(rainPositions,3));
const rain=new THREE.Points(rainGeo,new THREE.PointsMaterial({color:0x9bb7c8,size:.065,transparent:true,opacity:.75,depthWrite:false})); scene.add(rain);
let aimDirection = new THREE.Vector3();
function lock(){ if(started && !dead && !menuOpen) renderer.domElement.requestPointerLock(); }
ui.startButton.addEventListener('click',()=>{started=true;ui.setStarted(true);audio.start();lock();});
renderer.domElement.addEventListener('click',()=>{if(started && !menuOpen && !dead && !document.pointerLockElement)lock();});
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement)keys.clear();});
document.addEventListener('mousemove',e=>{if(document.pointerLockElement!==renderer.domElement || menuOpen || dead)return;const invert=invertTimer>0?-1:1;yaw-=e.movementX*.0022*invert;pitch=clamp(pitch-e.movementY*.0022*invert,-1.52,1.52);});
document.addEventListener('keydown',e=>{
  if(!started)return;
  if(e.code==='KeyE'){ui.toggleInventory();return;} if(e.code==='KeyC'){ui.toggleCrafting();return;} if(e.code==='KeyP'){ui.toggleSettings();return;} if(e.code==='Escape'){ui.close();return;}
  if(menuOpen || dead)return;
  if(e.code==='KeyV' && !e.repeat)thirdPerson=!thirdPerson;
  if(e.code==='Space'){e.preventDefault();if(!e.repeat)jumpQueued=true;}
  if(/^Digit[1-9]$/.test(e.code))inventory.selected=Number(e.code.slice(5))-1;
  keys.add(e.code);
});
document.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>keys.clear());
window.addEventListener('wheel',e=>{if(started&&!menuOpen){inventory.selected=(inventory.selected+(e.deltaY>0?1:8))%9;}},{passive:true});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
function overlapsPlayer(x:number,y:number,z:number){return player.position.x+player.radius>x && player.position.x-player.radius<x+1 && player.position.z+player.radius>z && player.position.z-player.radius<z+1 && player.position.y+player.height>y && player.position.y<y+1;}
renderer.domElement.addEventListener('mousedown',e=>{
  if(document.pointerLockElement!==renderer.domElement || menuOpen || dead) return;
  const origin=player.position.clone().add(new THREE.Vector3(0,1.57,0));
  camera.getWorldDirection(aimDirection); const hit=world.raycast(origin,aimDirection,6);
  if(e.button===0){
    if(inventory.beam){
      beam.setMouse(true);
      return;
    }
    if(enemies.attack(origin,aimDirection,hit ? Math.min(4.5,hit.distance) : 4.5,inventory.weapon?24:12)){audio.event('hit');return;}
    if(hit){ if(inventory.add(hit.id)){world.set(hit.x,hit.y,hit.z,Block.Air);audio.event('break');} }
  } else if(e.button===2){
    // Platform-seed power-up: right-click drops a scaffold underfoot if the cell is air.
    if(powerups.hasPlatform && trySpawnPlatform(world,player.position.x,player.position.y,player.position.z)){
      audio.event('break');
      return;
    }
    if(hit){const item=inventory.selectedItem();const p=hit.previous;
      if(item && item.count>0 && !overlapsPlayer(p.x,p.y,p.z) && world.get(p.x,p.y,p.z)===Block.Air){world.set(p.x,p.y,p.z,item.id);inventory.remove(item.id,1);}}
  }
});
renderer.domElement.addEventListener('mouseup',e=>{if(e.button===0)beam.setMouse(false);});
function damage(n:number, source:DamageSource='unknown'){if(dead||!started)return;health=clamp(health-n,0,100);audio.event('hurt');overlay.recordDamage({t:time,source,amount:n,y:player.position.y,biome:activeBiome});if(health<=0){dead=true;deathTimer=3;ui.setDeath(true);keys.clear();}}
function respawn(){dead=false;health=sanity=stamina=100;gravity=1;player.position.copy(spawn);player.verticalVelocity=0;enemies.clear();critters.clear();ui.setDeath(false);}
let restoration=false, lit=false,restoreTimer=0;
function strike(){const angle=Math.random()*Math.PI*2,r=Math.random()*30,x=Math.floor(player.position.x+Math.cos(angle)*r),z=Math.floor(player.position.z+Math.sin(angle)*r),y=world.surface(x,z)+1;flash.position.set(x,y+5,z);flash.intensity=100;flashTimer=.18;audio.event('thunder');if(Math.hypot(player.position.x-x,player.position.y-y,player.position.z-z)<3)damage(20,'lightning');for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++)for(let dz=-2;dz<=2;dz++)if(dx*dx+dy*dy+dz*dz<=4 && world.get(x+dx,y+dy,z+dz)===Block.Wood)world.set(x+dx,y+dy,z+dz,Block.Scorched);}
function animate(){requestAnimationFrame(animate);const now=performance.now()/1000,dt=Math.min(.05,now-(time||now));time=now;
  if(started){
    if(dead){deathTimer-=dt;if(deathTimer<=0)respawn();}
    const p=player.position;
    activeBiome=biomeAt(p.x,p.y,p.z);audio.biome(activeBiome);audio.update(dt);
    const targetColor=new THREE.Color(colors[activeBiome]);(scene.background as THREE.Color).lerp(targetColor,Math.min(1,dt*1.5));fog.color.lerp(targetColor,Math.min(1,dt*1.5));fog.density=THREE.MathUtils.lerp(fog.density,activeBiome==='catacombs'?.08:activeBiome==='storm'?.048:.027,Math.min(1,dt));
    ambient.intensity=activeBiome==='catacombs'?.20:activeBiome==='veins'?.30:.98;sun.intensity=activeBiome==='catacombs'?.08:activeBiome==='storm'?.25:1.0;
    if(activeBiome==='glitch'){gravityTimer-=dt;if(gravityTimer<=0){gravityTimer=3;gravity=[.5,1,1.5][Math.floor(Math.random()*3)];audio.event('shift');}}else{gravity=1;gravityTimer=0;}
    const exposed=p.y>world.surface(Math.floor(p.x),Math.floor(p.z));
    if(activeBiome==='storm'&&exposed){lightningTimer-=dt;if(lightningTimer<=0){strike();lightningTimer=5+Math.random()*5;}} else lightningTimer=6;
    flashTimer-=dt;if(flashTimer<=0)flash.intensity=0;
    if(!dead && !menuOpen && document.pointerLockElement===renderer.domElement){
      const forward=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),strafe=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
      const sprint=keys.has('ShiftLeft')&&stamina>0&&(forward!==0||strafe!==0);stamina=clamp(stamina+(sprint?-18:12)*dt,0,100);
      if(invertTimer>0)invertTimer-=dt;else if(activeBiome==='psychosis'&&sanity<35&&Math.random()<dt*.08)invertTimer=2;
      const sign=invertTimer>0?-1:1,under=world.get(Math.floor(p.x),Math.floor(p.y-.08),Math.floor(p.z));
      const hook=hooks.tick(activeBiome,{world,player:p,lit,sanity,health,dt,time,intense:!settings.reduceIntensity});
      if(hook.damage>0)damage(hook.damage,'hazard');
      if(hook.sound)audio.event(hook.sound);
      if(hook.message)hookMessage=hook.message;
      const stepGravity = (powerups.hasGravity ? gravity * REDUCED_GRAVITY : gravity) * hook.gravityScale;
      const impact=player.step(dt,{forward:forward*sign,strafe:strafe*sign,jump:jumpQueued,yaw},(x,y,z)=>world.get(x,y,z)!==Block.Air,stepGravity,activeBiome==='storm'&&exposed?2:0,(sprint?1.45:1)*(under===Block.Mud?.6:1)*hook.speedScale);jumpQueued=false;lastImpact=impact;
      if(impact>11)damage((impact-11)*3,'fall');
      if(under===Block.Flesh && (forward||strafe)){footsteps-=dt;if(footsteps<=0){audio.event('squelch');footsteps=.55;}}
      enemies.update(dt,p,activeBiome,(n)=>damage(n,'enemy'));
      critters.update(dt,p,activeBiome);
      const pickups=powerups.update(world,p.x,p.y,p.z);for(const k of pickups)audio.event(k==='gravity'?'shift':'break');
      restoreTimer-=dt;if(restoreTimer<=0){restoreTimer=1;const proximity=nearbyLight(world,p,activeBiome);restoration=proximity.restore;lit=proximity.lit;}
      if(restoration)sanity=clamp(sanity+7*dt,0,100);else if(activeBiome==='psychosis')sanity=clamp(sanity-3*dt,0,100);else if(activeBiome==='maw'||activeBiome==='glitch'||activeBiome==='veins')sanity=clamp(sanity-.8*dt,0,100);
      if(hook.sanityDrain>0)sanity=clamp(sanity-hook.sanityDrain*dt,0,100);
    }
    world.update(p,time);rain.visible=activeBiome==='storm' && exposed;rain.position.set(p.x,p.y,p.z);if(rain.visible){for(let i=0;i<600;i++){rainPositions[i*3+1]-=dt*12;if(rainPositions[i*3+1]<0)rainPositions[i*3+1]=20;}rainGeo.attributes.position.needsUpdate=true;}
    camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);const eye=p.clone().add(new THREE.Vector3(0,1.57,0));camera.position.copy(eye);if(thirdPerson){const back=new THREE.Vector3(0,.7,3.5).applyEuler(new THREE.Euler(0,yaw,0));camera.position.add(back);camera.lookAt(eye.clone().add(new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(pitch,yaw,0))));}
    if(beam.isActive()){camera.getWorldDirection(aimDirection);beam.update(dt,eye,aimDirection,6,(id)=>{inventory.add(id);audio.event('break');});}
    avatar.update(p,yaw,thirdPerson);
    lantern.position.copy(eye);lantern.intensity=lit?4:0;
    post.uniforms.uTime.value=time;post.uniforms.uGlitch.value=activeBiome==='glitch'&&!settings.reduceIntensity?1:0;post.uniforms.uPsy.value=activeBiome==='psychosis'&&!settings.reduceIntensity?1:0;
    effectTimer-=dt;const powerStr=powerups.hasGravity?'GRAVITY ✦ ':''+(powerups.hasPlatform?'PLATFORM ✦ ':'');const hookLabel=HOOKS[activeBiome].label;const info=powerStr+(hookMessage||hookLabel);
    ui.update(health,sanity,stamina,activeBiome,info);
    overlay.recordFrame(dt);
    overlay.render(time,{x:p.x,y:p.y,z:p.z,vy:player.verticalVelocity,biome:activeBiome,health,sanity,stamina,gravity,impact:lastImpact});
  }
  composer.render();
}
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);});
world.update(player.position,0);ui.update(health,sanity,stamina,activeBiome,'');animate();

// --- Save / load -----------------------------------------------------------
// Terrain edits are intentionally NOT persisted: the world regenerates from
// noise on every load. Player state, inventory and progression flags are.
function captureSave() {
  return {
    player: { x: player.position.x, y: player.position.y, z: player.position.z, health, sanity, stamina },
    inventory: serializeInventory(inventory.slots),
    progression: { weapon: inventory.weapon, beam: inventory.beam, hasGravity: powerups.hasGravity, hasPlatform: powerups.hasPlatform },
  };
}
function applySave(data: ReturnType<typeof captureSave>): void {
  player.position.set(data.player.x, data.player.y, data.player.z);
  player.verticalVelocity = 0;
  health = clamp(data.player.health, 0, 100);
  sanity = clamp(data.player.sanity, 0, 100);
  stamina = clamp(data.player.stamina, 0, 100);
  inventory.slots = deserializeInventory(data.inventory);
  inventory.weapon = data.progression.weapon;
  inventory.beam = data.progression.beam;
  powerups.hasGravity = data.progression.hasGravity;
  powerups.hasPlatform = data.progression.hasPlatform;
}
function doSave(): void {
  const outcome = writeSave(captureSave());
  console.log('[HL save]', outcome.status);
}
function doLoad(): void {
  const outcome = readSave();
  if (outcome.status === 'loaded') { applySave(outcome.data); console.log('[HL load] ok'); }
  else console.log('[HL load]', outcome.status);
}
window.addEventListener('keydown', e => {
  if (!e.ctrlKey || e.altKey) return;
  if (e.code === 'KeyS') { e.preventDefault(); doSave(); }
  else if (e.code === 'KeyL') { e.preventDefault(); doLoad(); }
});
// Load on boot so a returning player resumes where they left off.
{
  const outcome = readSave();
  if (outcome.status === 'loaded') applySave(outcome.data);
  else if (outcome.status === 'unsupported') {
    console.warn('[HL load] ignoring save from a newer version:', outcome.version);
    clearSave();
  }
}
// Development-only inspection hooks for repeatable browser acceptance tests.
if(import.meta.env.DEV) (window as unknown as {__hollowland:unknown}).__hollowland={player,world,inventory,enemies,damage,scene,ui,overlay,beam,powerups,hooks,get state(){return {health,sanity,stamina,activeBiome,gravity,dead,started,menuOpen,lastImpact,hookMessage};},save:doSave,load:doLoad};
