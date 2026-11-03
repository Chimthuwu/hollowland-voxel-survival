import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Block, biomeAt, type Biome, World, worldSeed } from './world';
import { GENERATION_VERSION } from './landmarks';
import { Enemies, type Kind } from './entities';
import { AudioEngine } from './audio';
import { Inventory, UI, headBlockFor, itemLabel } from './ui';
import { Player } from './player';
import { Avatar } from './avatar';
import { dayPhase, daylightLevel, nearbyLight, shadeAt, timeOfDayLabel } from './lighting';
import { DebugOverlay, type DamageSource } from './debugOverlay';
import { beamDps, canBreak, effectiveTier, meleeDamage, miningSpec, toolDps } from './tools';
import { Pickups } from './pickups';
import { Timber } from './timber';
import { BeamWeapon } from './beam';
import { BlockDamage } from './blockDamage';
import { PewPew } from './pewpew';
import { PowerUps, REDUCED_GRAVITY, trySpawnPlatform } from './powerups';
import { placeSky } from './sky';
import { Critters } from './critters';
import { Chisel } from './chisel';
import { KnappingMinigame } from './knapping';
import type { KnapTool } from './knappingCore';
import { BiomeHooks, HOOKS } from './biomeHooks';
import { loadSettings, saveReduceIntensity, saveVolume } from './settings';
import { clearSave, deserializeInventory, readSave, serializeInventory, writeSave, type SaveData } from './save';
import './style.css';

const clamp = THREE.MathUtils.clamp;
// Biome scene palettes, recolored in the art pivot so every hostile region
// reads at a glance: storm is cold electric teal, glitch is hot orchid
// magenta, psychosis is a pale sick mauve, and the maw is a deep gore red.
const colors: Record<Biome, number> = {overcast:0x474058, storm:0x16222e, glitch:0x40144c, psychosis:0x3b2e40, maw:0x4a0d13, catacombs:0x0b0b10, veins:0x29090f, sky:0x31333d};
const scene = new THREE.Scene();
scene.background = new THREE.Color(colors.overcast);
scene.fog = new THREE.FogExp2(colors.overcast, 0.019);
const renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.querySelector('#app')!.appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); const el=document.createElement('div'); el.style.cssText='position:fixed;inset:0;z-index:10000;background:#111;color:white;padding:3rem;font:18px sans-serif'; el.textContent='The graphics context was lost. Close other graphics-heavy tabs and reload the game.'; document.body.appendChild(el); });
const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.07, 220); // far plane lifted so the cloud deck stays visible
const ambient = new THREE.HemisphereLight(0xc3bde8, 0x2a2430, 1.15); scene.add(ambient);
const sun = new THREE.DirectionalLight(0xd9cdbd, 1.3); sun.position.set(15,35,10); scene.add(sun);
const flash = new THREE.PointLight(0xdcecff,0,45); scene.add(flash);
const lantern = new THREE.PointLight(0xffb86b,0,12); scene.add(lantern);
// Psychosis hallucination: a plain dark silhouette the fog can half-hide.
// Invisible until the psychosis hook fires an apparition, then fades in,
// stands there, and is gone at the end of the pulse.
const phantom = new THREE.Mesh(new THREE.BoxGeometry(.85, 3.1, .45), new THREE.MeshBasicMaterial({ color: 0x07030c, transparent: true, opacity: 0 }));
phantom.visible = false; scene.add(phantom);
let phantomTimer = 0;
function startPhantom(): void {
  camera.getWorldDirection(aimDirection);
  const flat = Math.hypot(aimDirection.x, aimDirection.z);
  if (flat < 1e-4) return;
  const x = player.position.x + aimDirection.x / flat * 9;
  const z = player.position.z + aimDirection.z / flat * 9;
  const y = world.surface(Math.floor(x), Math.floor(z)) + 2.55;
  phantom.position.set(x, y, z);
  phantom.rotation.y = Math.atan2(player.position.x - x, player.position.z - z);
  phantomTimer = 2;
  phantom.visible = true;
}
const world = new World(scene);
const enemies = new Enemies(scene,world);
const critters = new Critters(scene,world);
const chisel = new Chisel(world);
const audio = new AudioEngine();
// Shared staged block-damage registry: created before the beam so both the
// crystal beam and the PEW PEW melt blocks through the same state.
const blockDamage = new BlockDamage(scene);
const beam = new BeamWeapon(scene, world, camera, blockDamage);
const powerups = new PowerUps();
PowerUps.placeAll(world);
// Sky traversal: the scaffold chain up to the crystal beacon above the clouds.
placeSky(world);
const hooks = new BiomeHooks(world);
const loot = new Pickups(scene, (x, y, z) => world.get(x, y, z) !== Block.Air);
// Tree felling: a removed base trunk cell topples the whole tree and spills wood.
const timber = new Timber(scene, world, (id, pos) => loot.spawn(id, pos, 1), () => {
  // The ground punch: a low boom plus camera shake scaled to the fall.
  audio.event('thud');
  shakeTimer = .5;
});
const inventory = new Inventory();
// The player spawns with the beam laser gun so they can mine, place and
// fight right away instead of gating it behind deep crystal ore.
inventory.beam = true;
// The PEW PEW blaster: shared staged block damage with hand tools and the
// beam. It resolves creatures, forage and mining along one central aim ray.
const pewpew = new PewPew(blockDamage, {
  raycast: (o, d, r) => world.raycast(o, d, r),
  attackEnemy: (o, d, r, dmg, onKill) => enemies.attack(o, d, r, dmg, (pos, kind) => {
    const list = CREATURE_DROPS[kind] ?? [[Block.Morsel, 1] as [Block, number]];
    for (const [id, n] of list) for (let i = 0; i < n; i++) loot.spawn(id, pos.clone().setY(pos.y + .4), 1);
    onKill(pos, kind);
  }),
  forage: hit => world.forageFlora(hit.x, hit.z),
  onBlockBreak: (id, x, y, z) => {
    if (inventory.add(id)) {
      world.set(x, y, z, Block.Air);
      chisel.clear(x, y, z);
      audio.event('break');
      timber.notify(x, y, z, player.position);
      const tier = effectiveTier(inventory.toolTier, false);
      if (tier > 0 && inventory.wearTool() === 'broken') ui.toast('YOUR TOOL BROKE');
    }
  },
  onImpact: (_family, broken) => audio.event(broken ? 'break' : 'hit'),
}, camera);
pewpew.attachScene(scene);
// The player toggles between the blaster (hold to fire shots) and the crystal
// beam (hold to melt) with Q; the beam only exists once it is unlocked.
let activeWeapon: 'pewpew' | 'beam' = 'pewpew';
let menuOpen = false, started = false, dead = false, deathTimer = 0;
const settings = loadSettings();
// The knapping minigame lives in its own overlay host so it can sit above the
// HUD without fighting the inventory panels for space.
const knappingHost = document.createElement('div');
knappingHost.id = 'knapping-host';
document.body.appendChild(knappingHost);
const knapping = new KnappingMinigame(knappingHost, {
  onComplete: result => {
    const head = headBlockFor(result.tool);
    const added = inventory.add(head, 1);
    inventory.recordToolTier(result.quality);
    ui.toast(added
      ? `${result.headName.toUpperCase()} · ${result.quality.toUpperCase()}`
      : `YOUR PACK IS FULL — THE ${result.quality.toUpperCase()} ${result.tool.toUpperCase()} HEAD IS LOST`);
    audio.event('break');
  },
  onCancel: () => { ui.toast('The stone is left rough.'); },
});
const ui = new UI(inventory, open => { menuOpen = open; if (open && document.pointerLockElement) document.exitPointerLock(); }, {
  volume: settings.volume,
  reduceIntensity: settings.reduceIntensity,
  onVolume: value => { const v = saveVolume(value); settings.volume = v; audio.setVolume(v); return v; },
  onReduceIntensity: value => { settings.reduceIntensity = saveReduceIntensity(value); },
}, (tool: KnapTool) => { knapping.open(tool); });
const player = new Player(0.5,world.surface(0,0)+1.01,0.5);
const avatar = new Avatar(scene);
const spawn = player.position.clone();
let health=100, sanity=100, stamina=100, yaw=0, pitch=0, gravity=1, thirdPerson=false, activeBiome:Biome='overcast';
let time=0, gravityTimer=0, lightningTimer=6, flashTimer=0, effectTimer=0, invertTimer=0, footsteps=0, lastImpact=0, hookMessage='';
// Screen shake from felled trees hitting the ground: decays over half a second.
let shakeTimer = 0;
// Hold-to-mine state: left click damages a block over time instead of
// removing it instantly. Soft blocks (dirt, wood, leaves…) still break at once.
let leftMouseDown = false;
let pewpewFiring = false;
let mineTarget: { x: number; y: number; z: number; id: Block; health: number } | null = null;
let mineDamage = 0;
// Canopy-gloom level: smoothed 0..~.55 darkness applied while the player
// stands in genuine shade (under a canopy or any cover outdoors).
let gloomLevel = 0;

/** Anatomy-keyed loot: shells shear into chitin, drakes leave hide and claws;
 * light creatures leave fibres; everything yields at least a raw morsel. */
const CREATURE_DROPS: Partial<Record<Kind, Array<[Block, number]>>> = {
  skitter: [[Block.Silk, 1], [Block.Morsel, 1]],
  hopper: [[Block.Silk, 1], [Block.Morsel, 1]],
  stalker: [[Block.Claw, 1], [Block.Morsel, 2]],
  thrasher: [[Block.Chitin, 2], [Block.Morsel, 2]],
  saurolisk: [[Block.Hide, 2], [Block.Claw, 2], [Block.Morsel, 3]],
  cresthorn: [[Block.Hide, 2], [Block.Claw, 1], [Block.Morsel, 4]],
  crawler: [[Block.Morsel, 1]],
  node: [[Block.Morsel, 1]],
  hallucination: [[Block.Morsel, 1]],
};
const overlay = new DebugOverlay();
const keys = new Set<string>(); let jumpQueued=false;
const fog = scene.fog as THREE.FogExp2;
const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene,camera));
const post = new ShaderPass({uniforms:{tDiffuse:{value:null}, uTime:{value:0}, uGlitch:{value:0}, uPsy:{value:0}, uGloom:{value:0}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:`uniform sampler2D tDiffuse;uniform float uTime,uGlitch,uPsy,uGloom;varying vec2 vUv;
void main(){vec2 p=vUv; float band=step(.985,fract(sin(floor(p.y*80.)+floor(uTime*8.))*43758.5453)); p.x+=uGlitch*band*.012*sin(uTime*37.); float d=uGlitch*.003; vec3 col=vec3(texture2D(tDiffuse,p+vec2(d,0.)).r,texture2D(tDiffuse,p).g,texture2D(tDiffuse,p-vec2(d,0.)).b); col*=1.-uGlitch*.13*(.5+.5*sin(p.y*900.)); float vignette=smoothstep(.83,.2,length(vUv-.5)); col*=mix(1.,.48+.52*vignette,uPsy); col*=1.-uGloom*.3;gl_FragColor=vec4(col,1.);\n#include <colorspace_fragment>\n}`}); composer.addPass(post);
// Rain is visual only; lightning and wind have their own gameplay timers.
const rainPositions=new Float32Array(600*3); for(let i=0;i<600;i++){rainPositions[i*3]=(Math.random()-.5)*36;rainPositions[i*3+1]=Math.random()*20;rainPositions[i*3+2]=(Math.random()-.5)*36;}
const rainGeo=new THREE.BufferGeometry(); rainGeo.setAttribute('position',new THREE.BufferAttribute(rainPositions,3));
const rain=new THREE.Points(rainGeo,new THREE.PointsMaterial({color:0x9bb7c8,size:.065,transparent:true,opacity:.75,depthWrite:false})); scene.add(rain);
let aimDirection = new THREE.Vector3();
// Outline of the block the player is pointing at, so the target is always obvious.
const highlightGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
const highlight = new THREE.LineSegments(highlightGeo, new THREE.LineBasicMaterial({ color: 0xf2e2c0, transparent: true, opacity: .85, depthTest: true }));
highlight.visible = false; scene.add(highlight);
// Faint outline of the exact sub-cell the chisel would remove.
const cellGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const cellOutline = new THREE.LineSegments(cellGeo, new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: .95 }));
cellOutline.visible = false; scene.add(cellOutline);
// Crack overlay on the block currently being mined: brightens as damage mounts.
const crackGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.003, 1.003, 1.003));
const crack = new THREE.LineSegments(crackGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: true }));
crack.visible = false; scene.add(crack);
function lock(){ if(started && !dead && !menuOpen) renderer.domElement.requestPointerLock(); }
ui.startButton.addEventListener('click',()=>{
  // A custom seed typed into the start menu takes over the rolled one.
  const custom=ui.seedInput?.value.trim();
  if(custom){
    // Stable string->seed hash so 'HOLLOW' always means the same world.
    let h=2166136261;
    for(let i=0;i<custom.length;i++){h^=custom.charCodeAt(i);h=Math.imul(h,16777619);}
    world.reseed(h>>>0||1);
    ui.toast('WORLD SEEDED · '+custom.toUpperCase());
  }
  started=true;ui.setStarted(true);audio.start();lock();
});
renderer.domElement.addEventListener('click',()=>{if(started && !menuOpen && !dead && !document.pointerLockElement)lock();});
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement)keys.clear();});
document.addEventListener('mousemove',e=>{if(document.pointerLockElement!==renderer.domElement || menuOpen || dead)return;const invert=invertTimer>0?-1:1;yaw-=e.movementX*.0022*invert;pitch=clamp(pitch-e.movementY*.0022*invert,-1.52,1.52);});
document.addEventListener('keydown',e=>{
  if(!started)return;
  if(e.code==='KeyE'){ui.toggleInventory();return;} if(e.code==='KeyC'){ui.toggleCrafting();return;} if(e.code==='KeyP'){ui.toggleSettings();return;} if(e.code==='Escape'){ui.close();return;}
  if(menuOpen || dead)return;
  if(e.code==='KeyV' && !e.repeat)thirdPerson=!thirdPerson;
  if(e.code==='KeyQ' && !e.repeat){
    // Weapon swap: pewpew blaster <-> crystal beam (only when unlocked).
    const next = activeWeapon === 'pewpew' ? 'beam' : 'pewpew';
    if(next === 'beam' && !inventory.beam){ ui.toast('THE CRYSTAL BEAM IS NOT YOURS YET'); audio.event('break'); }
    else {
      activeWeapon = next;
      pewpewFiring = false;
      beam.setMouse(false);
      ui.toast(activeWeapon === 'beam' ? 'CRYSTAL BEAM · SUSTAINED MELT' : 'PEW PEW · RAPID BLASTER');
      audio.event('shift');
    }
  }
  if(e.code==='KeyG' && !e.repeat){const label=chisel.cycleShape();ui.toast(`CHISEL · ${label.toUpperCase()} · LEFT CARVE · RIGHT STAMP`);}
  if(e.code==='KeyF' && !e.repeat){
    // Consumables live in the hotbar: bandages patch you up, raw morsels are
    // meager nosh. Selecting the item and pressing F is the whole system.
    const held=inventory.selectedItem();
    if(held?.id===Block.Bandage){health=clamp(health+25,0,100);inventory.remove(Block.Bandage,1);ui.toast('THE BANDAGE PULLS THE HURT TIGHT');audio.event('break');}
    else if(held?.id===Block.Morsel){health=clamp(health+7,0,100);inventory.remove(Block.Morsel,1);ui.toast('Raw and chewy. It helps. A little.');audio.event('break');}
  }
  if(e.code==='Space'){e.preventDefault();if(!e.repeat)jumpQueued=true;}
  if(/^Digit[1-9]$/.test(e.code))inventory.selected=Number(e.code.slice(5))-1;
  keys.add(e.code);
});
document.addEventListener('keyup',e=>keys.delete(e.code));
// The browser context menu never belongs in HOLLOWLAND: right-click is the
// place/step button, and losing it to the OS menu at a bad moment is a death.
document.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('blur',()=>keys.clear());
window.addEventListener('wheel',e=>{if(started&&!menuOpen){inventory.selected=(inventory.selected+(e.deltaY>0?1:8))%9;}},{passive:true});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
function overlapsPlayer(x:number,y:number,z:number){return player.position.x+player.radius>x && player.position.x-player.radius<x+1 && player.position.z+player.radius>z && player.position.z-player.radius<z+1 && player.position.y+player.height>y && player.position.y<y+1;}
renderer.domElement.addEventListener('mousedown',e=>{
  if(document.pointerLockElement!==renderer.domElement || menuOpen || dead) return;
  const origin=player.position.clone().add(new THREE.Vector3(0,1.57,0));
  camera.getWorldDirection(aimDirection); const hit=world.raycast(origin,aimDirection,6);
  const holdingChisel=inventory.selectedItem()?.id===Block.Chisel;
  if(e.button===0){
    leftMouseDown = true;
    if(holdingChisel){
      // Left click with the chisel shaves the exact sub-cell under the crosshair.
      if(hit){
        const result=chisel.carve(hit);
        ui.toast(result.action==='missed'?result.label:`CHISEL · ${result.label}`);
        if(result.action!=='missed')audio.event('hit');
      }
      return;
    }
    if(activeWeapon==='pewpew'){
      pewpewFiring = true;
      return;
    }
    if(inventory.beam){
      beam.setMouse(true);
      return;
    }
    if(enemies.attack(origin,aimDirection,hit ? Math.min(4.5,hit.distance) : 4.5,meleeDamage(effectiveTier(inventory.toolTier,inventory.beam),inventory.weapon?24:12,inventory.edgeBonus),(pos,kind)=>{
      // Creature loot is keyed by anatomy (see CREATURE_DROPS).
      const list=CREATURE_DROPS[kind]??[[Block.Morsel,1] as [Block,number]];
      for(const [id,n] of list)for(let i=0;i<n;i++)loot.spawn(id,pos.clone().setY(pos.y+.4),1);
    })){audio.event('hit');return;}
    if(hit){
      // Forage first: clicking the ground a plant grows from gathers the
      // plant (one drop per column, no double-harvest), taking priority over
      // mining that block entirely.
      const flora=world.forageFlora(hit.x,hit.z);
      if(flora){
        const DROP: Record<string,[Block,number]> = { shroom:[Block.Morsel,1], grass:[Block.Grass,1], flower:[Block.Grass,1], fern:[Block.Grass,1], branch:[Block.Wood,1], log:[Block.Wood,3] };
        const LABEL: Record<string,string> = { shroom:'MUSHROOM', grass:'GRASS TUFT', flower:'WILDFLOWER', fern:'FERN', branch:'FALLEN BRANCH', log:'FALLEN LOG' };
        const [id,count]=DROP[flora.kind];
        for(let i=0;i<count;i++) loot.spawn(id,new THREE.Vector3(hit.x+.5,flora.y+1.2,hit.z+.5),1);
        ui.toast(`GATHERED · ${LABEL[flora.kind]}`);
        audio.event('break');
        return;
      }
      // Tier gate: a block that needs a better tool than the player owns is
      // simply refused, with a reason on the HUD.
      const tier=effectiveTier(inventory.toolTier,inventory.beam);
      const gate=canBreak(hit.id,tier);
      if(!gate.ok){ui.toast(gate.reason);return;}
      const spec = miningSpec(hit.id);
      // Tree trunks take sustained chopping to fell — a tree only topples when
      // its base trunk cell is actually broken. Placed soft blocks (dirt,
      // grass, wood planks, leaves…) still break at once.
      const isTrunk = world.isTreeTrunk(hit.x, hit.y, hit.z);
      const soft = spec.soft && !isTrunk;
      if(soft){
        if(inventory.add(hit.id)){
          world.set(hit.x,hit.y,hit.z,Block.Air);chisel.clear(hit.x,hit.y,hit.z);audio.event('break');
          timber.notify(hit.x,hit.y,hit.z,player.position);
          if(tier>0&&!inventory.beam){if(inventory.wearTool()==='broken')ui.toast('YOUR TOOL BROKE');}
        }
      } else {
        mineTarget = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, health: spec.hardness };
        mineDamage = 0;
        // Punching a trunk shakes skyfruit loose from the canopy — fruit falls
        // the very first hit, before the tree is felled.
        if(isTrunk){
          const tree = world.treeAtVoxel(hit.x, hit.y, hit.z);
          if(tree){
            const base = new THREE.Vector3(tree.shape.tx + .5, tree.shape.baseY, tree.shape.tz + .5);
            const drops = 3 + Math.floor(Math.random() * 3);
            for(let i = 0; i < drops; i++){
              const a = Math.random() * Math.PI * 2;
              const r = 1 + Math.random() * 3;
              loot.spawn(Block.Skyfruit, new THREE.Vector3(
                base.x + Math.cos(a) * r,
                base.y + 2 + Math.random() * 3,
                base.z + Math.sin(a) * r
              ), 1);
            }
            audio.event('break');
          }
        }
      }
    }
  } else if(e.button===2){
    // Right-click is the "use" button: consumables restore you, the platform
    // seed drops a scaffold underfoot, anything else is placed as a block.
    const held=inventory.selectedItem();
    if(held?.id===Block.Bandage){health=clamp(health+25,0,100);inventory.remove(Block.Bandage,1);ui.toast('THE BANDAGE PULLS THE HURT TIGHT');audio.event('break');return;}
    if(held?.id===Block.Morsel){health=clamp(health+7,0,100);inventory.remove(Block.Morsel,1);ui.toast('Raw and chewy. It helps. A little.');audio.event('break');return;}
    if(powerups.hasPlatform && trySpawnPlatform(world,player.position.x,player.position.y,player.position.z)){
      audio.event('break');
      return;
    }
    if(holdingChisel){
      // Right click with the chisel stamps a whole decorative shape.
      if(hit){
        const result=chisel.stamp(hit);
        ui.toast(result.action==='missed'?result.label:`CHISEL · ${result.label}`);
        if(result.action!=='missed')audio.event('break');
      }
      return;
    }
    if(hit){const item=inventory.selectedItem();const p=hit.previous;
      if(item && item.count>0 && item.id!==Block.Chisel && !overlapsPlayer(p.x,p.y,p.z) && world.get(p.x,p.y,p.z)===Block.Air){world.set(p.x,p.y,p.z,item.id);inventory.remove(item.id,1);}}
  }
});
renderer.domElement.addEventListener('mouseup',e=>{
  if(e.button===0){
    beam.setMouse(false);
    pewpewFiring = false;
    leftMouseDown = false;
    if(mineTarget){ mineTarget = null; mineDamage = 0; crack.visible = false; }
  }
});
// Every lethal hit names itself on the death screen, so a player who dies
// underground immediately knows what did it (fall, enemy, storm or hazard).
const DEATH_CAUSES: Record<DamageSource, string> = {
  fall: 'A SHEER DROP BROKE YOU AGAINST THE DARK.',
  enemy: 'SOMETHING FOUND YOU IN THE TUNNELS.',
  lightning: 'THE STORM STRUCK YOU DOWN.',
  hazard: 'THE LAND ITSELF DRANK YOUR LIFE.',
  unknown: 'IT WAS SOMETHING ELSE.',
};
function damage(n:number, source:DamageSource='unknown'){
  if(dead||!started)return;
  // Creature gear blunts specific incoming sources: the chitin cuirass covers
  // enemy strikes; the hide guard covers land hazards and lightning.
  if(source==='enemy'&&inventory.armored)n*=.65;
  else if((source==='hazard'||source==='lightning')&&inventory.hideGuarded)n*=.5;
  health=clamp(health-n,0,100);audio.event('hurt');overlay.recordDamage({t:time,source,amount:n,y:player.position.y,biome:activeBiome});if(health<=0){dead=true;deathTimer=3;ui.setDeath(true,DEATH_CAUSES[source]);keys.clear();}}
function respawn(){dead=false;health=sanity=stamina=100;gravity=1;player.position.copy(spawn);player.verticalVelocity=0;enemies.clear();critters.clear();loot.clear();ui.setDeath(false);}
let restoration=false, lit=false,restoreTimer=0;
function strike(){const angle=Math.random()*Math.PI*2,r=Math.random()*30,x=Math.floor(player.position.x+Math.cos(angle)*r),z=Math.floor(player.position.z+Math.sin(angle)*r),y=world.surface(x,z)+1;flash.position.set(x,y+5,z);flash.intensity=100;flashTimer=.18;audio.event('thunder');if(Math.hypot(player.position.x-x,player.position.y-y,player.position.z-z)<3)damage(20,'lightning');for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++)for(let dz=-2;dz<=2;dz++)if(dx*dx+dy*dy+dz*dz<=4 && world.get(x+dx,y+dy,z+dz)===Block.Wood)world.set(x+dx,y+dy,z+dz,Block.Scorched);}
function animate(){requestAnimationFrame(animate);const now=performance.now()/1000,dt=Math.min(.05,now-(time||now));time=now;
  if(started){
    if(dead){deathTimer-=dt;if(deathTimer<=0)respawn();}
    const p=player.position;
    activeBiome=biomeAt(p.x,p.y,p.z);audio.biome(activeBiome);audio.update(dt);
    // --- Day-night cycle ---
    // One world-clock phase drives sky/fog colour, ambient light and the sun's
    // arc. Underground biomes keep their own permanent darkness, and the night
    // floor keeps the surface readable instead of pitch black.
    const dayPhase_ = dayPhase(time), dayLevel = daylightLevel(dayPhase_);
    const underground = activeBiome==='catacombs'||activeBiome==='veins';
    const targetColor=new THREE.Color(colors[activeBiome]).multiplyScalar(underground?1:.4+.6*dayLevel);(scene.background as THREE.Color).lerp(targetColor,Math.min(1,dt*1.5));fog.color.lerp(targetColor,Math.min(1,dt*1.5));    // Fog pulled way in: the world reads further now the chunk radius is 3.
    fog.density=THREE.MathUtils.lerp(fog.density,activeBiome==='catacombs'?.058:activeBiome==='storm'?.034:.019,Math.min(1,dt));
    ambient.intensity=(activeBiome==='catacombs'?.20:activeBiome==='veins'?.30:.98)*(underground?1:.55+.45*dayLevel);sun.intensity=(activeBiome==='catacombs'?.08:activeBiome==='storm'?.25:1.0)*(underground?1:.45+.55*dayLevel);
    const sunAngle=(dayPhase_-.25)*Math.PI*2;sun.position.set(Math.cos(sunAngle)*28,Math.max(9,Math.sin(sunAngle)*30+12),16);
    // --- Canopy gloom ---
    // When the player stands under cover (canopy, roof, overhang) the world
    // visibly closes in: lights dim, the shader adds a cool patina of gloom.
    // Underground biomes handle their own darkness and skip this layer.
    const shaded=!underground&&shadeAt(world,p.x,p.y,p.z);
    gloomLevel=THREE.MathUtils.lerp(gloomLevel,shaded?.55:0,Math.min(1,dt*2.5));
    ambient.intensity*=1-gloomLevel*.5;
    sun.intensity*=1-gloomLevel*.35;
    post.uniforms.uGloom.value=gloomLevel;
    if(activeBiome==='glitch'){gravityTimer-=dt;if(gravityTimer<=0){gravityTimer=3;gravity=[.5,1,1.5][Math.floor(Math.random()*3)];audio.event('shift');}}else{gravity=1;gravityTimer=0;}
    const exposed=p.y>world.surface(Math.floor(p.x),Math.floor(p.z));
    if(activeBiome==='storm'&&exposed){lightningTimer-=dt;if(lightningTimer<=0){strike();lightningTimer=5+Math.random()*5;}} else lightningTimer=6;
    flashTimer-=dt;if(flashTimer<=0)flash.intensity=0;
    if(!dead && !menuOpen && document.pointerLockElement===renderer.domElement){
      const forward=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),strafe=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
      const sprint=keys.has('ShiftLeft')&&stamina>0&&(forward!==0||strafe!==0);stamina=clamp(stamina+(sprint?-18:12)*dt,0,100);
      if(invertTimer>0)invertTimer-=dt;else if(activeBiome==='psychosis'&&sanity<35&&Math.random()<dt*.08)invertTimer=2;
      const sign=invertTimer>0?-1:1,under=world.get(Math.floor(p.x),Math.floor(p.y-.08),Math.floor(p.z));
      // Swimming: waist- or feet-deep in Water counts as immersed. Water is
      // not solid — you sink slowly, hold Space to paddle up, move sluggish
      // and a splash-landing never counts as a fall.
      const torso=world.get(Math.floor(p.x),Math.floor(p.y+.6),Math.floor(p.z));
      const inWater=under===Block.Water||torso===Block.Water;
      const hook=hooks.tick(activeBiome,{world,player:p,lit,sanity,health,dt,time,intense:!settings.reduceIntensity});
      if(hook.damage>0)damage(hook.damage,'hazard');
      if(hook.sound)audio.event(hook.sound);
      if(hook.message)hookMessage=hook.message;
      if(hook.hallucination>0)startPhantom();
      const stepGravity = (powerups.hasGravity ? gravity * REDUCED_GRAVITY : gravity) * hook.gravityScale;
      const impact=player.step(dt,{forward:forward*sign,strafe:strafe*sign,jump:jumpQueued,yaw},(x,y,z)=>{const b=world.get(x,y,z);return b!==Block.Air&&b!==Block.Water;},stepGravity,activeBiome==='storm'&&exposed?2:0,(sprint?1.45:1)*(under===Block.Mud?.6:1)*(inWater?.55:1)*hook.speedScale);jumpQueued=false;lastImpact=impact;
      if(inWater){
        if(keys.has('Space'))player.verticalVelocity=Math.min(3.2,player.verticalVelocity+16*dt);
        // Buoyancy: cap the sink speed so water always slows you gently — and
        // the capped impact can never reach the 11 m/s fall-damage threshold.
        player.verticalVelocity=Math.max(player.verticalVelocity,-2.6);
      }
      if(impact>11)damage((impact-11)*3,'fall');
      if(under===Block.Flesh && (forward||strafe)){footsteps-=dt;if(footsteps<=0){audio.event('squelch');footsteps=.55;}}
      enemies.update(dt,p,activeBiome,(n)=>damage(n,'enemy'),dayPhase_,lit);
      critters.update(dt,p,activeBiome);
      const pickups=powerups.update(world,p.x,p.y,p.z);for(const k of pickups)audio.event(k==='gravity'?'shift':'break');
      for(const id of loot.update(dt,p)){ if(inventory.add(id))audio.event('break'); }
      timber.update(dt);
      restoreTimer-=dt;if(restoreTimer<=0){restoreTimer=1;const proximity=nearbyLight(world,p,activeBiome);restoration=proximity.restore;lit=proximity.lit;}
      if(restoration)sanity=clamp(sanity+7*dt,0,100);else if(activeBiome==='psychosis')sanity=clamp(sanity-3*dt,0,100);else if(activeBiome==='maw'||activeBiome==='glitch'||activeBiome==='veins')sanity=clamp(sanity-.8*dt,0,100);
      if(hook.sanityDrain>0)sanity=clamp(sanity-hook.sanityDrain*dt,0,100);
    }
    world.update(p,time);rain.visible=activeBiome==='storm' && exposed;rain.position.set(p.x,p.y,p.z);if(rain.visible){for(let i=0;i<600;i++){rainPositions[i*3+1]-=dt*12;if(rainPositions[i*3+1]<0)rainPositions[i*3+1]=20;}rainGeo.attributes.position.needsUpdate=true;}
    // Target highlight: outline the block under the crosshair and, when the
    // chisel is held, the exact sub-cell that would be shaved.
    camera.getWorldDirection(aimDirection);
    const eyeNow=p.clone().add(new THREE.Vector3(0,1.57,0));
    const look=world.raycast(eyeNow,aimDirection,6);
    if(look){
      highlight.visible=true;
      highlight.position.set(look.x+.5,look.y+.5,look.z+.5);
      if(inventory.selectedItem()?.id===Block.Chisel){
        const res=chisel.preview(look);
        if(res){cellOutline.visible=true;cellOutline.position.set(res.x,res.y,res.z);cellOutline.scale.set(res.sx,res.sy,res.sz);}
        else cellOutline.visible=false;
      } else cellOutline.visible=false;
      // Interaction prompt: name the action the crosshair offers right now.
      if(inventory.selectedItem()?.id===Block.Chisel){
        ui.setPrompt('LEFT — CARVE · RIGHT — STAMP');
      } else {
        const gate=canBreak(look.id,effectiveTier(inventory.toolTier,activeWeapon==='beam'));
        if(!gate.ok)ui.setPrompt(gate.reason);
        else ui.setPrompt(miningSpec(look.id).soft?'CLICK — BREAK':'HOLD — MINE');
      }
    } else {
      highlight.visible=false;cellOutline.visible=false;
      ui.setPrompt('');
    }

    // Hold-to-mine: sustained left-click damages a block over time; the time
    // to break depends on the block hardness and the tool tier, so stone and
    // ore take longer with weaker tools. Soft blocks break instantly on click.
    if(leftMouseDown && !inventory.beam){
      const tier = effectiveTier(inventory.toolTier, false);
      const t = mineTarget;
      if(t && look && look.x===t.x && look.y===t.y && look.z===t.z){
        mineDamage += toolDps(tier) * dt;
        const ratio = Math.min(1, mineDamage / t.health);
        crack.visible = true;
        crack.position.set(t.x+.5, t.y+.5, t.z+.5);
        (crack.material as THREE.LineBasicMaterial).opacity = ratio;
        if(mineDamage >= t.health){
          if(inventory.add(t.id)){
            world.set(t.x,t.y,t.z,Block.Air);
            chisel.clear(t.x,t.y,t.z);
            audio.event('break');
            timber.notify(t.x,t.y,t.z,player.position);
            if(tier>0){if(inventory.wearTool()==='broken')ui.toast('YOUR TOOL BROKE');}
          }
          mineTarget = null; mineDamage = 0; crack.visible = false;
        }
      } else {
        mineTarget = null; mineDamage = 0; crack.visible = false;
        if(look){
          const gate = canBreak(look.id, tier);
          if(gate.ok && !miningSpec(look.id).soft){
            mineTarget = { x: look.x, y: look.y, z: look.z, id: look.id, health: miningSpec(look.id).hardness };
            mineDamage = 0;
          }
        }
      }
    } else if(!inventory.beam){
      crack.visible = false;
    }

    // Beam target damage visualization: cracks brighten as the beam melts a block.
    if(inventory.beam && beam.isActive()){
      const b = beam.targeted();
      if(b){
        const spec = miningSpec(b.id);
        const ratio = Math.min(1, Math.max(0, (spec.hardness - b.health) / spec.hardness));
        crack.visible = true;
        crack.position.set(b.x+.5, b.y+.5, b.z+.5);
        (crack.material as THREE.LineBasicMaterial).opacity = ratio;
      } else {
        crack.visible = false;
      }
    }
    ui.tick(dt);
    camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);const eye=p.clone().add(new THREE.Vector3(0,1.57,0));camera.position.copy(eye);if(thirdPerson){const back=new THREE.Vector3(0,.7,3.5).applyEuler(new THREE.Euler(0,yaw,0));camera.position.add(back);camera.lookAt(eye.clone().add(new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(pitch,yaw,0))));}
    // Felled-tree impact: position jitter plus a slight roll kick, decaying fast
    // so it reads as a ground punch rather than a wobble.
    if(shakeTimer>0){
      shakeTimer-=dt;
      const s=shakeTimer*shakeTimer*4*.5;
      camera.position.x+=(Math.random()-.5)*s;
      camera.position.y+=(Math.random()-.5)*s*.5;
      camera.position.z+=(Math.random()-.5)*s;
      camera.rotation.z+=(Math.random()-.5)*s*.18;
    }
    if(beam.isActive()){camera.getWorldDirection(aimDirection);
      // The beam is flesh-hungry too: cut the nearest creature along the aim
      // line at beam DPS. Its body then blocks the frame — reach is clamped to
      // the impact distance so the visual trace ends at the body and the stone
      // behind it only starts melting once the blood is done.
      const cut=enemies.beamCut(eye,aimDirection,6,beamDps(3,inventory.level),dt,(pos,kind)=>{
        const list=CREATURE_DROPS[kind]??[[Block.Morsel,1] as [Block,number]];
        for(const [id,n] of list)for(let i=0;i<n;i++)loot.spawn(id,pos.clone().setY(pos.y+.4),1);
      });
      if(cut>0&&Math.random()<dt*9)audio.event('hit');
      beam.update(dt,eye,aimDirection,6,(id,x,y,z)=>{inventory.add(id);audio.event('break');timber.notify(x,y,z,player.position);if(inventory.toolTier>0&&inventory.wearTool()==='broken')ui.toast('YOUR TOOL BROKE');},inventory.toolTier,inventory.level,cut>0?cut:Infinity);}
    // PEW PEW: held fire resolves one shot per cooldown window through the
    // shared block-damage path; the gun handles heat, recoil and feedback.
    if(pewpewFiring && !dead && document.pointerLockElement===renderer.domElement){
      pewpew.tier = effectiveTier(inventory.toolTier, false);
      pewpew.fire(eye, aimDirection);
    }
    pewpew.update(dt);
    blockDamage.update(time);
    avatar.update(p,yaw,thirdPerson);
    lantern.position.copy(eye);lantern.intensity=lit?4:0;
    post.uniforms.uTime.value=time;post.uniforms.uGlitch.value=activeBiome==='glitch'&&!settings.reduceIntensity?1:0;post.uniforms.uPsy.value=Math.min(1.5,(activeBiome==='psychosis'&&!settings.reduceIntensity?1:0)+(phantomTimer>0?.45:0));
    if(phantomTimer>0){
      phantomTimer-=dt;
      // Fade in over the first third, hold, and dissolve at the end.
      const t=Math.max(0,phantomTimer/2);const rise=t<.7?(.7-t)/.7:1;
      const mat=phantom.material as THREE.MeshBasicMaterial;mat.opacity=Math.min(.55,.62*rise*Math.min(1,t*2.5+ .35));
      if(phantomTimer<=0)phantom.visible=false;
    }
    effectTimer-=dt;const powerStr=powerups.hasGravity?'GRAVITY ✦ ':''+(powerups.hasPlatform?'PLATFORM ✦ ':'');const toolStr=inventory.toolTier>0?`TOOL T${inventory.toolTier}${inventory.toolDurability>0?' ('+inventory.toolDurability+')':''} · `:'';const lvlStr=`LVL ${inventory.level} · `;const sel=inventory.selectedItem();const selStr=sel?` · ${itemLabel(sel.id)}`:'';const hookLabel=HOOKS[activeBiome].label;const info=powerStr+lvlStr+toolStr+timeOfDayLabel(dayPhase_)+' · '+(hookMessage||hookLabel)+selStr;
    // Weapon HUD: the blaster reports live heat/overheat state; the crystal
    // beam is sustained, so it shows only its label.
    const weaponHud = activeWeapon==='pewpew'
      ? pewpew.hudState()
      : (inventory.beam ? { label: 'CRYSTAL BEAM', heat: 0, overheated: false, recoil: 0 } : undefined);
    ui.update(health,sanity,stamina,activeBiome,info,weaponHud);
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
    seed: worldSeed(),
    generationVersion: GENERATION_VERSION,
    player: { x: player.position.x, y: player.position.y, z: player.position.z, health, sanity, stamina },
    inventory: serializeInventory(inventory.slots),
    progression: { weapon: inventory.weapon, beam: inventory.beam, hasGravity: powerups.hasGravity, hasPlatform: powerups.hasPlatform, toolTier: inventory.toolTier, toolDurability: inventory.toolDurability, armored: inventory.armored, hideGuarded: inventory.hideGuarded, edgeBonus: inventory.edgeBonus },
  };
}
function applySave(data: SaveData): void {
  // A seeded save regenerates its own world before the player lands in it.
  // Saves without a seed (pre-M2) keep the default generation.
  if (typeof data.seed === 'number') world.reseed(data.seed);
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
  inventory.toolTier = data.progression.toolTier ?? 0;
  inventory.toolDurability = data.progression.toolDurability ?? 0;
  inventory.armored = data.progression.armored ?? false;
  inventory.hideGuarded = data.progression.hideGuarded ?? false;
  inventory.edgeBonus = data.progression.edgeBonus ?? 0;
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
// Load on boot so a returning player resumes where they left off. A fresh
// world rolls a random seed (bump-able via the start-menu seed field).
{
  const outcome = readSave();
  if (outcome.status === 'loaded') applySave(outcome.data);
  else {
    // No usable save: roll a fresh deterministic seed for a brand-new world.
    world.reseed((Date.now() % 2147483647) || 1);
    if (outcome.status === 'unsupported') {
      console.warn('[HL load] ignoring save from a newer version:', outcome.version);
      clearSave();
    }
  }
}
// Development-only inspection hooks for repeatable browser acceptance tests.
if(import.meta.env.DEV) (window as unknown as {__hollowland:unknown}).__hollowland={player,world,inventory,enemies,critters,chisel,damage,scene,ui,overlay,beam,pewpew,blockDamage,powerups,hooks,get state(){return {health,sanity,stamina,activeBiome,gravity,dead,started,menuOpen,lastImpact,hookMessage,activeWeapon,pewpewFiring,pewpewHeat:pewpew.heat,pewpewOverheated:pewpew.overheated};},save:doSave,load:doLoad};
