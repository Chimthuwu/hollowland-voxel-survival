import * as THREE from 'three';
import { Block, type Biome, type World } from './world';
import { daylightLevel, exposureAt, lightSourceNear, MOB_LIGHT } from './lighting';

type Kind = 'stalker' | 'node' | 'crawler' | 'hallucination' | 'skitter' | 'thrasher' | 'cresthorn' | 'hopper' | 'saurolisk';
export type { Kind };

/** Seconds a dying mob spends shrinking and sinking before it is removed. */
const DEATH_TIME = 0.38;
/** Seconds the white-hot hit flash lasts. */
const HIT_FLASH_TIME = 0.14;

/** Animated sub-rigs per mob. `userData.base` holds the rest pose each channel animates around. */
interface MobParts {
  /** Swingable limbs (arms/legs) driven by the walk cycle. */
  limbs: THREE.Object3D[];
  /** Chittering mandibles (crawler). */
  jaws: THREE.Object3D[];
  /** Inner group animated per kind (node bob, hallucination sway). */
  sway: THREE.Object3D;
  /** Orbiting satellite pivots (node). */
  orbiters: THREE.Object3D[];
}

/** A tumbling chunk of a destroyed creature — the kill's gore footprint. */
interface Gib {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  spinX: number; spinZ: number;
  life: number;
}

type Mob = {
  root: THREE.Group;
  kind: Kind;
  hp: number;
  speed: number;
  damage: number;
  cooldown: number;
  teleport: number;
  vy: number;
  fake: boolean;
  /** Random per-spawn phase so a pack of mobs doesn't breathe in unison. */
  phase: number;
  parts: MobParts;
  /** Accumulated walk-cycle phase. */
  walkT: number;
  /** Seconds of hit flash remaining. */
  hitFlash: number;
  /** Seconds of death animation remaining; 0 means alive. */
  dying: number;
  /** The meshes that get swapped to the flash material. */
  meshes: THREE.Mesh[];
  /** Body scale: big creatures read as big. */
  size: number;
  /** Telegraphed charge state machine (thrasher / cresthorn). */
  charge: { state: 'roam' | 'wary' | 'lunge' | 'recover'; timer: number; dirX: number; dirZ: number };
  /** Stalker head twitch: abrupt, out-of-sync, wrong. */
  twitchT: number;
  tiltZ: number;
  /** Light attraction: seconds until the next scan for a placed light. */
  lightT: number;
  /** Cached nearest torch/totem cell centre, or null. */
  lightPt: THREE.Vector3 | null;
};

/** Species-level light response (Milestone 3): what light DOES to a kind.
 *  fear    — bright light blinds/burns it; placed light denies spawn & harms
 *  attract — drawn toward placed lights like a moth (a camp lures them)
 *  neutral — light means nothing to it
 *  'burn' marks fear kinds that take steady damage in bright light. */
type LightResponse = 'burn' | 'attract' | 'neutral';
const stats: Record<Kind, { hp: number; speed: number; damage: number; size: number; light: LightResponse }> = {
  stalker:       { hp: 30,  speed: 3,   damage: 10, size: 1,    light: 'burn' },
  node:          { hp: 20,  speed: 3,   damage: 15, size: 1,    light: 'neutral' },
  crawler:       { hp: 25,  speed: 5,   damage: 12, size: 1,    light: 'neutral' },
  hallucination: { hp: 20,  speed: 3.8, damage: 8,  size: 1,    light: 'neutral' },
  // Giant burrow bug: towers over the player, still fast and cheap in a
  // pack — a swarm of them reads as a stampede, not a nuisance.
  skitter:       { hp: 18,  speed: 4.4, damage: 7,  size: 1.8,  light: 'attract' },
  // Armoured beetle: slow, tanky, lunges from a readable telegraphed wind-up.
  thrasher:      { hp: 66,  speed: 2.1, damage: 18, size: 1.15, light: 'neutral' },
  // Territorial dinosaur: rare, huge, gives a warning display before charging.
  cresthorn:     { hp: 150, speed: 1.7, damage: 24, size: 2.6,  light: 'neutral' },
  // Spring-mad grazer insect: mid-small, closes ground in anxious bounds.
  hopper:        { hp: 14,  speed: 2.2, damage: 8,  size: .8,   light: 'attract' },
  // Pack raptor: the second dinosaur. Fast telegraphed charger, short wind-up.
  saurolisk:     { hp: 95,  speed: 4.4, damage: 16, size: 1.55, light: 'neutral' },
};

function kindFor(b: Biome): Kind {
  return b === 'glitch' ? 'node'
       : b === 'maw' || b === 'veins' ? 'crawler'
       : b === 'psychosis' ? 'hallucination'
       : 'stalker';
}

/** One shared material per kind, built once and reused for every mob of that kind. */
function buildMaterial(kind: Kind): THREE.MeshStandardMaterial {
  switch (kind) {
    case 'crawler':       return new THREE.MeshStandardMaterial({ color: 0x6a1c25, roughness: .92, emissive: 0x180404, emissiveIntensity: .35 });
    case 'node':          return new THREE.MeshStandardMaterial({ color: 0xe62db5, roughness: .8,  emissive: 0x6c0d52, emissiveIntensity: .9,  wireframe: true });
    case 'hallucination': return new THREE.MeshStandardMaterial({ color: 0x252028, roughness: .85, emissive: 0x150d20, emissiveIntensity: .25, transparent: true, opacity: .78 });
    // Skitter: dark chitin with a faint sickly sheen.
    case 'skitter':       return new THREE.MeshStandardMaterial({ color: 0x3a4740, roughness: .55, metalness: .25, emissive: 0x0c1812, emissiveIntensity: .4 });
    // Thrasher: plum-plated shell, like polished armour.
    case 'thrasher':      return new THREE.MeshStandardMaterial({ color: 0x5c2330, roughness: .6,  emissive: 0x1c060a, emissiveIntensity: .35 });
    // Cresthorn: dusty sage hide — a territorial grazer, not a shadow creature.
    case 'cresthorn':     return new THREE.MeshStandardMaterial({ color: 0x6d7258, roughness: .95 });
    // Hopper: meadow-green chitin, a nervous jumper.
    case 'hopper':        return new THREE.MeshStandardMaterial({ color: 0x55683f, roughness: .7, emissive: 0x14260c, emissiveIntensity: .3 });
    // Saurolisk: dark teal raptor hide, lean and quick.
    case 'saurolisk':     return new THREE.MeshStandardMaterial({ color: 0x37524a, roughness: .85, emissive: 0x0a1512, emissiveIntensity: .25 });
    case 'stalker':
    default:              return new THREE.MeshStandardMaterial({ color: 0x151316, roughness: .9,  emissive: 0x080406, emissiveIntensity: .15 });
  }
}

const EYES_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xff3524 });
const CORE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xff5cd9 });
const AMBER_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffb44a });
const CREST_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xb44a3a, roughness: .8, emissive: 0x3a0c08, emissiveIntensity: .5 });

function boxAt(parent: THREE.Object3D, material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** A limb pivot at (x, y) whose segment hangs downward; rotation swings around the pivot. */
function limbAt(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, len: number, w: number, base = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  g.rotation.x = base;
  g.userData.base = base;
  const seg = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), material);
  seg.position.y = -len / 2;
  g.add(seg);
  parent.add(g);
  return g;
}

function addEyes(parent: THREE.Object3D, x: number, y: number, z: number, size = .06, material: THREE.MeshBasicMaterial = EYES_MATERIAL): void {
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(size, size * .85, .02), material);
    eye.position.set(sx * x, y, z);
    parent.add(eye);
  }
}

/** Stalker: gaunt hunched biped — long hanging clawed arms, small head, burning eyes. */
function buildStalker(material: THREE.Material): { root: THREE.Group; parts: MobParts } {
  const root = new THREE.Group();
  const sway = new THREE.Group();
  sway.rotation.x = .16; // permanent hunch
  sway.userData.baseZ = 0;
  root.add(sway);
  // Torso, shoulders and pelvis.
  boxAt(sway, material, .48, .8, .26, 0, 1.35, 0);
  boxAt(sway, material, .58, .14, .26, 0, 1.72, 0);
  boxAt(root, material, .4, .18, .24, 0, .92, 0);
  // Small head on a short neck.
  boxAt(sway, material, .12, .2, .12, 0, 1.83, 0);
  boxAt(sway, material, .3, .34, .3, 0, 1.95, -.02);
  addEyes(sway, .07, 1.97, -.17);

  const limbs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    // Upper arm pivots at the shoulder; forearm + claws hang off the elbow.
    const arm = limbAt(sway, material, sx * .33, 1.66, .62, .12, sx * .08);
    const elbow = new THREE.Group();
    elbow.position.y = -.62;
    arm.add(elbow);
    boxAt(elbow, material, .1, .55, .1, 0, -.27, 0);
    for (const cx of [-.05, 0, .05]) {
      const claw = boxAt(elbow, material, .035, .22, .035, cx * 1.2, -.66, cx * 2);
      claw.rotation.x = cx * 2.2;
    }
    limbs.push(arm);
  }
  for (const sx of [-1, 1]) {
    const thigh = limbAt(root, material, sx * .14, .9, .48, .15, sx * .04);
    const knee = new THREE.Group();
    knee.position.y = -.48;
    thigh.add(knee);
    boxAt(knee, material, .13, .44, .13, 0, -.22, 0);
    boxAt(knee, material, .16, .07, .3, 0, -.44, -.06);
    limbs.push(thigh);
  }
  return { root, parts: { limbs, jaws: [], sway, orbiters: [] } };
}

/** Crawler: low insectoid predator — six angled legs, dorsal ridge, chittering mandibles. */
function buildCrawler(material: THREE.Material): { root: THREE.Group; parts: MobParts } {
  const root = new THREE.Group();
  boxAt(root, material, .95, .34, 1.15, 0, .42, .05);   // carapace
  boxAt(root, material, .42, .12, .8, 0, .62, .05);      // dorsal ridge
  boxAt(root, material, .5, .28, .38, 0, .46, -.72);    // head
  addEyes(root, .09, .5, -.9, .05);
  const jaws: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const jaw = new THREE.Group();
    jaw.position.set(sx * .1, .44, -.88);
    jaw.rotation.y = -sx * .4;
    jaw.userData.base = -sx * .4;
    boxAt(jaw, material, .05, .05, .26, 0, 0, -.13);
    root.add(jaw);
    jaws.push(jaw);
  }
  const limbs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const hip = new THREE.Group();
    hip.position.set(sx * .45, .38, -.3 + i * .3);
    hip.userData.base = 0;
    const femur = boxAt(hip, material, .3, .06, .06, sx * .14, -.06, 0);
    femur.rotation.z = sx * -1.0;
    const tibia = boxAt(hip, material, .05, .24, .05, sx * .27, -.2, 0);
    tibia.rotation.z = sx * .35;
    root.add(hip);
    limbs.push(hip);
  }
  return { root, parts: { limbs, jaws, sway: root, orbiters: [] } };
}

/** Hallucination: tall wrong silhouette — asymmetric arms, oversized tilted head, swaying. */
function buildHallucination(material: THREE.Material): { root: THREE.Group; parts: MobParts } {
  const root = new THREE.Group();
  const sway = new THREE.Group();
  root.add(sway);
  boxAt(sway, material, .4, .95, .24, 0, 1.3, 0);
  boxAt(sway, material, .14, .28, .14, 0, 1.72, 0);
  const head = boxAt(sway, material, .5, .48, .4, 0, 1.98, 0);
  head.rotation.z = .12;
  addEyes(sway, .1, 1.98, -.21, .07);
  const limbs: THREE.Object3D[] = [];
  limbs.push(limbAt(sway, material, -.42, 1.72, 1.05, .11)); // left arm unnaturally long
  limbs.push(limbAt(sway, material, .42, 1.72, .7, .11));   // right arm too short
  limbs.push(limbAt(root, material, -.15, .85, .85, .12));
  limbs.push(limbAt(root, material, .15, .85, .85, .12));
  return { root, parts: { limbs, jaws: [], sway, orbiters: [] } };
}

/** Node: floating corrupted geometry — glowing core, wireframe shell, orbiting spiky satellites. */
function buildNode(material: THREE.Material): { root: THREE.Group; parts: MobParts } {
  const root = new THREE.Group();
  const sway = new THREE.Group();
  sway.position.y = 1.05;
  sway.userData.baseY = 1.05;
  root.add(sway);
  sway.add(new THREE.Mesh(new THREE.IcosahedronGeometry(.4, 0), CORE_MATERIAL));
  sway.add(new THREE.Mesh(new THREE.IcosahedronGeometry(.72, 1), material));
  const orbiters: THREE.Object3D[] = [];
  for (let i = 0; i < 2; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.x = i === 0 ? .5 : -.35;
    pivot.rotation.z = i === 0 ? 0 : .9;
    const sat = new THREE.Mesh(new THREE.IcosahedronGeometry(i === 0 ? .22 : .17, 0), material);
    sat.position.x = .95;
    pivot.add(sat);
    sway.add(pivot);
    orbiters.push(pivot);
  }
  return { root, parts: { limbs: [], jaws: [], sway, orbiters } };
}

/** Skitter: knee-high swarm bug — dome body, whipping antennae, six flicking legs. */
function buildSkitter(material: THREE.Material): { root: THREE.Group; parts: MobParts } {
  const root = new THREE.Group();
  const body = boxAt(root, material, .42, .26, .5, 0, .22, .02);
  body.rotation.x = -.06;
  boxAt(root, material, .24, .16, .22, 0, .3, -.3);       // head capsule
  addEyes(root, .06, .34, -.38, .05, AMBER_MATERIAL);     // two amber pinheads
  for (const sx of [-1, 1]) {
    const antenna = boxAt(root, material, .02, .02, .3, sx * .08, .4, -.44);
    antenna.userData.base = 0;
    antenna.rotation.x = -.9;
  }
  const limbs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const hip = new THREE.Group();
    hip.position.set(sx * .2, .26, -.16 + i * .17);
    hip.userData.base = 0;
    const leg = boxAt(hip, material, .04, .06, .04, sx * .16, -.03, 0);
    leg.rotation.z = sx * -.9;
    boxAt(hip, material, .03, .16, .03, sx * .26, -.1, 0).rotation.z = sx * .4;
    root.add(hip);
    limbs.push(hip);
  }
  return { root, parts: { limbs, jaws: [], sway: root, orbiters: [] } };
}

/** Thrasher: plated beetle tank — domed shell, pale seam, two front scythe arms. */
function buildThrasher(material: THREE.Material): { root: THREE.Group; parts: MobParts } {
  const root = new THREE.Group();
  const shell = boxAt(root, material, 1.05, .5, 1.3, 0, .5, .05);
  shell.rotation.x = -.08;
  boxAt(root, material, .86, .3, 1.0, 0, .78, .05);       // raised dome
  const seam = boxAt(root, material, .06, .1, 1.24, 0, .72, .05);
  void seam;
  boxAt(root, material, .5, .3, .36, 0, .42, -.78);       // armoured brow/head
  addEyes(root, .13, .52, -.9, .06, AMBER_MATERIAL);
  const limbs: THREE.Object3D[] = [];
  // Two front scythe pivots (the telegraph raises them before the lunge).
  for (const sx of [-1, 1]) {
    const arm = limbAt(root, material, sx * .28, .55, .55, .14, -1.1);
    const blade = boxAt(arm, material, .05, .45, .16, 0, -.6, .04);
    blade.rotation.x = .35;
    limbs.push(arm);
  }
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const hip = new THREE.Group();
    hip.position.set(sx * .55, .45, -.35 + i * .38);
    hip.userData.base = 0;
    const femur = boxAt(hip, material, .34, .07, .07, sx * .16, -.07, 0);
    femur.rotation.z = sx * -.95;
    const tibia = boxAt(hip, material, .06, .28, .06, sx * .3, -.24, 0);
    tibia.rotation.z = sx * .38;
    root.add(hip);
    limbs.push(hip);
  }
  return { root, parts: { limbs, jaws: [], sway: root, orbiters: [] } };
}

/** Cresthorn: big territorial dinosaur — columnar legs, long neck, coral crest fin. */
function buildCresthorn(material: THREE.Material): { root: THREE.Group; parts: MobParts } {
  const root = new THREE.Group();
  const sway = new THREE.Group();
  sway.position.y = 1.35;
  root.add(sway);
  // Barrel torso with a slight forward slope.
  boxAt(sway, material, 1.25, .85, 2.35, 0, .35, .1);
  boxAt(sway, material, 1.05, .5, .9, 0, .55, -1.0);      // shoulder mass
  // Tapering tail, two segments.
  boxAt(sway, material, .8, .5, 1.1, 0, .28, 1.55);
  boxAt(sway, material, .5, .28, 1.0, 0, .2, 2.4);
  // Long neck on a pivot: the warning display rears it back.
  const neck = new THREE.Group();
  neck.position.set(0, .6, -1.15);
  neck.rotation.x = -.5;
  neck.userData.baseX = -.5;
  sway.add(neck);
  boxAt(neck, material, .38, 1.15, .38, 0, .55, 0);
  const head = boxAt(neck, material, .4, .34, .55, 0, 1.2, -.12);
  void head;
  // The crest: a coral fin ridge across the skull.
  const crest = boxAt(neck, CREST_MATERIAL, .08, .5, .62, 0, 1.5, -.1);
  crest.rotation.x = .25;
  addEyes(neck, .11, 1.22, -.3, .06, AMBER_MATERIAL);
  // Four columnar legs.
  const limbs: THREE.Object3D[] = [];
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const leg = limbAt(sway, material, sx * .62, .1, 1.35, .26, sz * .12);
    leg.position.z = sz * .85;
    const foot = boxAt(leg, material, .36, .12, .5, 0, -1.32, -.04);
    void foot;
    limbs.push(leg);
  }
  return { root, parts: { limbs, jaws: [], sway, orbiters: [] } };
}

function buildMesh(kind: Kind, material: THREE.Material): { root: THREE.Group; parts: MobParts } {
  switch (kind) {
    case 'node':          return buildNode(material);
    case 'crawler':       return buildCrawler(material);
    case 'hallucination': return buildHallucination(material);
    case 'skitter':       return buildSkitter(material);
    case 'thrasher':      return buildThrasher(material);
    case 'cresthorn':     return buildCresthorn(material);
    case 'hopper':        return buildHopper(material);
    case 'saurolisk':     return buildSaurolisk(material);
    case 'stalker':
    default:              return buildStalker(material);
  }
}

/** Hopper: nervous spring-legged grazer insect — tilted body, coiled hind legs. */
function buildHopper(material: THREE.Material): { root: THREE.Group; parts: MobParts } {
  const root = new THREE.Group();
  const body = boxAt(root, material, .5, .32, .8, 0, .4, -.05);
  body.rotation.x = .3;
  boxAt(root, material, .3, .22, .26, 0, .52, -.48);      // raised head capsule
  addEyes(root, .08, .58, -.6, .05, AMBER_MATERIAL);
  for (const sx of [-1, 1]) {
    const antenna = boxAt(root, material, .02, .02, .32, sx * .09, .62, -.66);
    antenna.rotation.x = -.8;
    antenna.userData.base = 0;
  }
  const limbs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    // Sprung hind leg: coxa kicked back, shin folded under.
    const hip = new THREE.Group();
    hip.position.set(sx * .27, .44, .24);
    hip.userData.base = 0;
    const femur = boxAt(hip, material, .08, .34, .09, sx * .1, -.08, .08);
    femur.rotation.x = -.85;
    boxAt(hip, material, .05, .3, .05, sx * .16, -.3, .18).rotation.x = .55;
    root.add(hip);
    limbs.push(hip);
    // Small front leg pairs.
    for (let i = 0; i < 2; i++) {
      const front = new THREE.Group();
      front.position.set(sx * .22, .3, -.28 + i * .2);
      front.userData.base = 0;
      boxAt(front, material, .04, .05, .05, sx * .12, -.02, 0).rotation.z = sx * -.8;
      boxAt(front, material, .03, .18, .03, sx * .2, -.12, 0).rotation.z = sx * .35;
      root.add(front);
      limbs.push(front);
    }
  }
  return { root, parts: { limbs, jaws: [], sway: root, orbiters: [] } };
}

/** Saurolisk: lean second dinosaur — raptor hide, whip tail, sickle-claw legs. */
function buildSaurolisk(material: THREE.Material): { root: THREE.Group; parts: MobParts } {
  const root = new THREE.Group();
  const sway = new THREE.Group();
  sway.position.y = 1;
  root.add(sway);
  boxAt(sway, material, .55, .55, 1.5, 0, .3, .1);        // lean torso
  boxAt(sway, material, .42, .42, .8, 0, .55, -.75);      // raised chest
  boxAt(sway, material, .3, .3, 1.1, 0, .3, 1.15);        // tail base
  boxAt(sway, material, .2, .2, .6, 0, .24, 1.95);        // tail whip
  // Neck and snapping head.
  const neck = new THREE.Group();
  neck.position.set(0, .78, -.72);
  neck.rotation.x = -.15;
  neck.userData.baseX = -.15;
  sway.add(neck);
  boxAt(neck, material, .22, .5, .24, 0, .2, 0);
  boxAt(neck, material, .2, .2, .5, 0, .42, -.3);         // skull
  boxAt(neck, material, .18, .07, .44, 0, .31, -.44);     // jawline
  addEyes(neck, .06, .5, -.5, .05, AMBER_MATERIAL);
  // Two bounding sickle-claw legs plus quick little arms.
  const limbs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const leg = limbAt(root, material, sx * .3, .9, .9, .16, sx * .1);
    boxAt(leg, material, .12, .55, .12, 0, -.84, 0);       // shin
    const foot = boxAt(leg, material, .16, .06, .36, 0, -1.32, -.06);
    void foot;
    limbs.push(leg);
  }
  for (const sx of [-1, 1]) limbs.push(limbAt(sway, material, sx * .3, 1.2, .4, .08, sx * .55));
  return { root, parts: { limbs, jaws: [], sway, orbiters: [] } };
}

export class Enemies {
  private readonly mobs: Mob[] = [];
  private readonly gibs: Gib[] = [];
  /** One shared gib cube and one cached tinted material per kind. */
  private readonly gibGeometry = new THREE.BoxGeometry(.14, .14, .14);
  private readonly gibMaterials = new Map<Kind, THREE.MeshBasicMaterial>();
  private spawnTimer = 5;
  /** Monotonically increasing clock used for the idle/breathing animation. */
  private simTime = 0;
  /** Cached per-kind materials, built once. Disposed in dispose(). */
  private readonly materials: Record<Kind, THREE.MeshStandardMaterial>;
  /** White-hot material swapped in briefly when a mob is hit. Shared per kind. */
  private readonly flashMaterials: Record<Kind, THREE.MeshStandardMaterial>;

  constructor(private readonly scene: THREE.Scene, private readonly world: Pick<World, 'get' | 'surface'>) {
    this.materials = {
      stalker:       buildMaterial('stalker'),
      node:          buildMaterial('node'),
      crawler:       buildMaterial('crawler'),
      hallucination: buildMaterial('hallucination'),
      skitter:       buildMaterial('skitter'),
      thrasher:      buildMaterial('thrasher'),
      cresthorn:     buildMaterial('cresthorn'),
      hopper:        buildMaterial('hopper'),
      saurolisk:     buildMaterial('saurolisk'),
    };
    // One white-hot material per kind. Mobs swap to it on a hit and back after,
    // so there is no per-spawn material allocation.
    const flash = (wireframe: boolean) => new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffd9d0, emissiveIntensity: 1.6, roughness: .5, wireframe,
    });
    this.flashMaterials = {
      stalker: flash(false),
      node: flash(true),
      crawler: flash(false),
      hallucination: flash(false),
      skitter: flash(false),
      thrasher: flash(false),
      cresthorn: flash(false),
      hopper: flash(false),
      saurolisk: flash(false),
    };
  }

  /** Spawns by biome: the shapeshift path used by tests and dev hooks. */
  spawn(biome: Biome, position: THREE.Vector3): void {
    this.spawnKind(kindFor(biome), position);
  }

  /** Spawns a specific kind at a position. */
  spawnKind(kind: Kind, position: THREE.Vector3): void {
    const data = stats[kind];
    const material = this.materials[kind];
    const { root, parts } = buildMesh(kind, material);
    root.scale.setScalar(data.size);
    root.position.copy(position);
    this.scene.add(root);
    const meshes: THREE.Mesh[] = [];
    root.traverse(obj => { if (obj instanceof THREE.Mesh) meshes.push(obj); });
    this.mobs.push({
      root, kind, ...data,
      cooldown: 0,
      teleport: 2,
      vy: 0,
      fake: kind === 'hallucination' && Math.random() < .45,
      phase: Math.random() * Math.PI * 2,
      parts,
      walkT: Math.random() * 6,
      hitFlash: 0,
      dying: 0,
      meshes,
      size: data.size,
      charge: { state: 'roam', timer: 0, dirX: 0, dirZ: 1 },
      twitchT: Math.random() * 2,
      tiltZ: 0,
      lightT: Math.random() * .6,
      lightPt: null,
    });
  }

  /**
   * The Overcast roster: light decides who lives here. Warm, open ground
   * belongs to oversized wildlife (skitter swarms, thrashers, the rare
   * cresthorn); deep shade and night belong to the stalkers.
   */
  private spawnOvercast(x: number, groundY: number, z: number, phase: number): void {
    const exposure = exposureAt(this.world, x, groundY, z, phase);
    const count = (k: Kind) => this.mobs.reduce((n, m) => n + (m.kind === k ? 1 : 0), 0);
    const at = new THREE.Vector3(x, groundY, z);
    // Light-gated stalker spawning (Milestone 3): deep shade is their niche,
    // but a placed light (torch/totem) within 8 blocks denies the spawn
    // outright in daylight — a campfire circle is stalker-proof ground, so
    // camping torches is a real strategy instead of a decoration. At night
    // the light radius reads as only a small halo and stalkers may approach.
    const daylight = daylightLevel(phase);
    if (exposure < MOB_LIGHT.stalkerHide) {
      const denied = lightSourceNear(this.world, at, 8) !== null && daylight > .25;
      if (!denied && Math.random() < .6) this.spawnKind('stalker', at);
      else if (denied && Math.random() < .3 && count('skitter') < 9) {
        // Light-attracted wildlife fills the camp's ring instead.
        this.spawnKind('skitter', new THREE.Vector3(x + (Math.random() - .5) * 3, groundY, z + (Math.random() - .5) * 3));
      }
      return;
    }
    const roll = Math.random();
    if (roll < .3 && count('skitter') < 9) {
      const pack = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < pack; i++)
        this.spawnKind('skitter', new THREE.Vector3(x + (Math.random() - .5) * 3, groundY, z + (Math.random() - .5) * 3));
    } else if (roll < .48 && count('hopper') < 5) {
      this.spawnKind('hopper', at);
    } else if (roll < .62 && count('thrasher') < 2) {
      this.spawnKind('thrasher', at);
    } else if (roll < .7 && count('saurolisk') < 2) {
      this.spawnKind('saurolisk', at);
    } else if (roll < .76 && count('cresthorn') < 1) {
      this.spawnKind('cresthorn', at);
    }
  }

  update(dt: number, player: THREE.Vector3, biome: Biome, onDamage: (amount: number) => void, phase = .3, playerLit = false): void {
    dt = Math.min(.05, Math.max(0, dt));
    this.spawnTimer -= dt;
    this.simTime += dt;
    this.updateGibs(dt);

    if (this.spawnTimer <= 0) {
      this.spawnTimer = biome === 'overcast' ? 10 : 6;
      if (this.mobs.length < 12) {
        const a = Math.random() * Math.PI * 2;
        const r = 12 + Math.random() * 5; // never pops in right beside the player
        const x = player.x + Math.sin(a) * r;
        const z = player.z + Math.cos(a) * r;
        const ground = player.y < 0 ? Math.floor(player.y) : this.world.surface(x, z) + 1;
        if (this.world.get(x, ground, z) === Block.Air && this.world.get(x, ground + 1, z) === Block.Air) {
          if (biome === 'overcast') this.spawnOvercast(x, ground, z, phase);
          else this.spawn(biome, new THREE.Vector3(x, ground, z));
        }
      }
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      const p = mob.root.position;
      mob.cooldown = Math.max(0, mob.cooldown - dt);

      // Hit flash: swap to the white-hot material, then swap back.
      if (mob.hitFlash > 0) {
        mob.hitFlash -= dt;
        if (mob.hitFlash <= 0) {
          const normal = this.materials[mob.kind];
          for (const mesh of mob.meshes) mesh.material = normal;
        }
      }

      // Death animation: shrink and sink, then the mob is removed.
      if (mob.dying > 0) {
        mob.dying -= dt;
        const t = Math.max(0, mob.dying / DEATH_TIME);
        mob.root.scale.setScalar(t * t * mob.size);
        mob.root.rotation.y += dt * 7;
        p.y -= dt * 1.6;
        if (mob.dying <= 0) { this.remove(i); continue; }
        continue;
      }

      const dx = player.x - p.x;
      const dz = player.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 42) { this.remove(i); continue; }

      // Idle "breathing": subtle per-mob scale oscillation, phased so groups
      // don't sync. Wary chargers add a rapid visible pulse — the telegraph.
      const breathe = 1 + Math.sin(this.simTime * 1.7 + mob.phase) * .025
        + (mob.charge.state === 'wary' ? Math.sin(this.simTime * 17) * .07 : 0);
      mob.root.scale.set(breathe * mob.size, breathe * mob.size, breathe * mob.size);

      // --- Behaviour selection -------------------------------------------------
      let chase = dist < 20 && dist > .9;
      let moveX = chase ? dx / dist : 0, moveZ = chase ? dz / dist : 0;
      let step = chase ? mob.speed * dt : 0;
      let faceAway = false; // true when moving outward (flee/retreat), to face travel direction

      if (mob.kind === 'stalker') {
        // Bright open ground dulls their senses; shade and night sharpen them.
        const exposure = exposureAt(this.world, p.x, p.y, p.z, phase);
        const detect = exposure < MOB_LIGHT.stalkerHide ? 20 : exposure < MOB_LIGHT.stalkerHunt ? 12 : 7;
        chase = dist < detect && dist > .9;
        moveX = chase ? dx / dist : 0; moveZ = chase ? dz / dist : 0;
        step = chase ? mob.speed * dt : 0;
        // Species light response — 'burn': a placed light close by recoils
        // them AND sears them. The burn is why lanterns/weapon-light matter:
        // hold the light on a stalker and it dies without a blow. Light
        // deaths drop no loot (the corpse burns away).
        if (playerLit && dist < 6.5) {
          chase = false;
          moveX = -dx / dist; moveZ = -dz / dist;
          step = mob.speed * .75 * dt;
          faceAway = true;
          const litExposure = Math.max(exposure, .92); // placed light dominates
          if (litExposure > MOB_LIGHT.stalkerHunt) {
            mob.hp -= 25 * dt;
            mob.hitFlash = Math.max(mob.hitFlash, .1);
            for (const mesh of mob.meshes) mesh.material = this.flashMaterials[mob.kind];
            if (mob.hp <= 0 && mob.dying <= 0) {
              mob.dying = DEATH_TIME;
              this.spawnGibs(mob);
            }
          }
        }
      } else if (mob.kind === 'skitter') {
        // Swarms chase; a lone skitter loses its nerve and bolts.
        let allies = 0;
        for (const other of this.mobs) {
          if (other !== mob && other.kind === 'skitter' && other.root.position.distanceToSquared(p) < 49) allies++;
        }
        if (allies === 0 && dist < 15) {
          chase = false;
          moveX = -dx / (dist + 1e-4); moveZ = -dz / (dist + 1e-4);
          step = mob.speed * 1.2 * dt;
          faceAway = true;
        }
      } else if (mob.kind === 'thrasher' || mob.kind === 'cresthorn' || mob.kind === 'saurolisk') {
        // Telegraphed charger: stalk → wind-up pause → lunge → recover.
        // The saurolisk is the fast pack-hunter variant: shorter wind-up, a
        // brisker lunge and less time standing still after committing.
        const cfg = mob.kind === 'cresthorn' ? { wary: 1.15, lunge: .55, speed: 8, recover: 1.7 }
          : mob.kind === 'saurolisk' ? { wary: .5, lunge: .5, speed: 11, recover: 1.1 }
          : { wary: .7, lunge: .42, speed: 9.5, recover: 1.7 };
        const c = mob.charge;
        chase = false;
        if (c.state === 'roam') {
          if (dist < 10) { c.state = 'wary'; c.timer = cfg.wary; }
        } else if (c.state === 'wary') {
          c.timer -= dt;
          if (c.timer <= 0) {
            if (dist < 12) {
              c.state = 'lunge';
              c.timer = cfg.lunge;
              c.dirX = dx / (dist + 1e-4); c.dirZ = dz / (dist + 1e-4);
            } else c.state = 'roam';
          }
        } else if (c.state === 'lunge') {
          moveX = c.dirX; moveZ = c.dirZ;
          step = cfg.speed * dt;
          c.timer -= dt;
          if (c.timer <= 0) { c.state = 'recover'; c.timer = cfg.recover; }
        } else {
          // Backing off after a committed lunge — the window to retaliate.
          c.timer -= dt;
          moveX = -dx / (dist + 1e-4); moveZ = -dz / (dist + 1e-4);
          step = mob.speed * .5 * dt;
          faceAway = true;
          if (c.timer <= 0) c.state = 'roam';
        }
      } else if (mob.kind === 'hopper') {
        // Spring-mad grazer: whenever it is grounded it bounds to close ground.
        if (mob.vy === 0 && dist > 2.2) mob.vy = 5.6;
      }

      // --- Light attraction --------------------------------------------------
      // Drawn kinds (skitter, hopper) drift toward a placed light when it is
      // the nearer magnet than the player — a lure to bait swarms away from
      // a camp, with the bug pile to fight around it as the price.
      let faceMove = false; // face the travel direction (attraction drift)
      if (stats[mob.kind].light === 'attract') {
        mob.lightT -= dt;
        if (mob.lightT <= 0) {
          mob.lightT = .5;
          const src = lightSourceNear(this.world, p, 9);
          mob.lightPt = src ? new THREE.Vector3(src.x, src.y, src.z) : null;
        }
        const lt = mob.lightPt;
        if (lt) {
          const lx = lt.x - p.x, lz = lt.z - p.z;
          const ld = Math.hypot(lx, lz);
          if (ld < dist + 2 && ld > 1.6) {
            chase = false;
            moveX = lx / (ld + 1e-4); moveZ = lz / (ld + 1e-4);
            step = mob.speed * dt;
            faceMove = true;
          }
        }
      } else if (mob.lightPt) mob.lightPt = null;

      // --- Movement over terrain ------------------------------------------------
      if (step > 0) {
        if (mob.kind === 'node' && chase) {
          mob.teleport -= dt;
          if (mob.teleport <= 0) { step = Math.min(2, dist - 1); mob.teleport = 2 + Math.random(); }
        }
        const nx = p.x + moveX * step, nz = p.z + moveZ * step;
        if (this.world.get(nx, p.y + .3, nz) !== Block.Air) {
          if (this.world.get(nx, p.y + 1.1, nz) === Block.Air && this.world.get(nx, p.y + 2 * mob.size, nz) === Block.Air && Math.abs(mob.vy) < .01) mob.vy = 6.2;
        } else { p.x = nx; p.z = nz; }
      }
      // Face travel; wary chargers and lurkers face the player.
      if (step > 0) {
        const fx = faceAway || faceMove ? moveX : chase || mob.charge.state !== 'lunge' ? dx / (dist + 1e-4) : moveX;
        const fz = faceAway || faceMove ? moveZ : chase || mob.charge.state !== 'lunge' ? dz / (dist + 1e-4) : moveZ;
        mob.root.rotation.y = Math.atan2(-fx, -fz);
      }

      mob.vy = Math.max(-20, mob.vy - 20 * dt);
      const next = p.y + mob.vy * dt;
      if (mob.vy <= 0 && this.world.get(p.x, next - .05, p.z) !== Block.Air) { p.y = Math.floor(next - .05) + 1; mob.vy = 0; }
      else if (mob.vy > 0 && this.world.get(p.x, next + 1.7 * mob.size, p.z) !== Block.Air) mob.vy = 0;
      else p.y = next;
      if (dist < 1.15 * Math.max(1, mob.size) && Math.abs(p.y - player.y) < 1.8 && mob.cooldown <= 0) {
        if (mob.fake) { this.remove(i); continue; }
        onDamage(mob.damage);
        mob.cooldown = 1;
      }

      // --- Procedural animation ---
      // Walk cycle swings limbs while moving; a slow drift keeps them alive when idle.
      const moving = step > 0;
      mob.walkT += dt * (moving ? mob.speed * 2.5 : 1.3);
      const amp = moving ? .5 : .055;
      for (let li = 0; li < mob.parts.limbs.length; li++) {
        const limb = mob.parts.limbs[li];
        limb.rotation.x = (limb.userData.base as number ?? 0)
          + Math.sin(mob.walkT + (li % 2) * Math.PI + Math.floor(li / 2) * .7) * amp;
      }
      if (mob.parts.jaws.length && dist < 4) {
        const chit = Math.sin(this.simTime * 16 + mob.phase) * .22;
        for (let j = 0; j < mob.parts.jaws.length; j++)
          mob.parts.jaws[j].rotation.y = (mob.parts.jaws[j].userData.base as number) + (j === 0 ? chit : -chit);
      }
      if (mob.kind === 'stalker') {
        // The head-tilt twitch: abrupt, unsynced pauses that read as "wrong".
        mob.twitchT -= dt;
        if (mob.twitchT <= 0) {
          mob.twitchT = 1.1 + Math.random() * 2.6;
          mob.tiltZ = (Math.random() - .5) * (chase ? .3 : .55);
        }
        (mob.parts.sway.rotation as THREE.Euler).z = ((mob.parts.sway.userData.baseZ as number) ?? 0) + mob.tiltZ;
      } else if (mob.kind === 'hallucination') {
        mob.parts.sway.rotation.z = Math.sin(this.simTime * .8 + mob.phase) * .07;
      } else if (mob.kind === 'node') {
        mob.parts.sway.position.y = (mob.parts.sway.userData.baseY as number) + Math.sin(this.simTime * 1.3 + mob.phase) * .12;
        for (let o = 0; o < mob.parts.orbiters.length; o++)
          mob.parts.orbiters[o].rotation.y += dt * (o % 2 ? -1.7 : 1.3);
        this.materials.node.emissiveIntensity = .9 + Math.sin(this.simTime * 3) * .25;
      }
    }
  }

  attack(origin: THREE.Vector3, direction: THREE.Vector3, range: number, damage: number, onKill?: (position: THREE.Vector3, kind: Kind) => void): boolean {
    const dir = direction.clone().normalize();
    let best = -1, near = range;
    for (let i = 0; i < this.mobs.length; i++) {
      const mob = this.mobs[i], center = mob.root.position.clone().add(new THREE.Vector3(0, mob.kind === 'crawler' ? .5 : mob.kind === 'cresthorn' ? 2.1 : mob.kind === 'saurolisk' ? 1.2 : 1, 0));
      const delta = center.sub(origin), along = delta.dot(dir);
      if (along < 0 || along > near) continue;
      if (delta.addScaledVector(dir, -along).length() > .8) continue;
      best = i; near = along;
    }
    if (best < 0) return false;
    const mob = this.mobs[best];
    mob.hp -= damage;
    // Flash the mob white for a beat so the hit reads.
    mob.hitFlash = HIT_FLASH_TIME;
    for (const mesh of mob.meshes) mesh.material = this.flashMaterials[mob.kind];
    if (mob.hp <= 0) {
      // Start the death animation instead of vanishing: a burst of the
      // creature's own shell/ hide chunks sprays out as it goes.
      mob.dying = DEATH_TIME;
      this.spawnGibs(mob);
      const flash = this.flashMaterials[mob.kind];
      for (const mesh of mob.meshes) mesh.material = flash;
      onKill?.(mob.root.position.clone(), mob.kind);
    } else {
      mob.root.position.addScaledVector(dir, .18);
    }
    return true;
  }

  /**
   * The beam weapon carving creatures: continuous DPS along the aimed ray,
   * stopping at the first body it meets. Returns the distance to the struck
   * creature this frame, or -1 when the ray meets only terrain — the caller
   * clamps the beam's reach to that distance, so a body blocks whatever was
   * mined behind it and the visual trace ends at the impact point.
   */
  beamCut(origin: THREE.Vector3, direction: THREE.Vector3, range: number, dps: number, dt: number, onKill?: (position: THREE.Vector3, kind: Kind) => void): number {
    const dir = direction.clone().normalize();
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < this.mobs.length; i++) {
      const mob = this.mobs[i];
      if (mob.dying > 0) continue;
      const center = mob.root.position.clone().add(new THREE.Vector3(0, mob.kind === 'crawler' ? .5 : mob.kind === 'cresthorn' ? 2.1 : mob.kind === 'saurolisk' ? 1.2 : 1, 0));
      const delta = center.sub(origin), along = delta.dot(dir);
      if (along < 0 || along > range || along >= bestDist) continue;
      if (delta.addScaledVector(dir, -along).length() > .8) continue;
      best = i; bestDist = along;
    }
    if (best < 0) return -1;
    const mob = this.mobs[best];
    mob.hp -= dps * dt;
    mob.hitFlash = HIT_FLASH_TIME;
    for (const mesh of mob.meshes) mesh.material = this.flashMaterials[mob.kind];
    if (mob.hp <= 0) {
      // Same death as any killing blow: shrink-sink animation plus the gore burst.
      mob.dying = DEATH_TIME;
      this.spawnGibs(mob);
      const flash = this.flashMaterials[mob.kind];
      for (const mesh of mob.meshes) mesh.material = flash;
      onKill?.(mob.root.position.clone(), mob.kind);
    }
    return bestDist;
  }

  /** Anatomy-tinted gore burst at the point of death. */
  private spawnGibs(mob: Mob): void {
    const material = this.gibMaterial(mob.kind);
    for (let i = 0; i < 7; i++) {
      const mesh = new THREE.Mesh(this.gibGeometry, material);
      mesh.position.copy(mob.root.position)
        .add(new THREE.Vector3((Math.random() - .5) * .6, .5 + Math.random() * .9, (Math.random() - .5) * .6));
      this.scene.add(mesh);
      this.gibs.push({
        mesh,
        vx: (Math.random() - .5) * 4, vy: 2.5 + Math.random() * 3, vz: (Math.random() - .5) * 4,
        spinX: (Math.random() - .5) * 12, spinZ: (Math.random() - .5) * 12,
        life: .6 + Math.random() * .3,
      });
    }
  }

  /** One darkened chunk material per kind, built lazily and shared. */
  private gibMaterial(kind: Kind): THREE.MeshBasicMaterial {
    let material = this.gibMaterials.get(kind);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color: this.materials[kind].color.clone().multiplyScalar(.8) });
      this.gibMaterials.set(kind, material);
    }
    return material;
  }

  /** Steps the gib physics: fall, tumble, bounce off terrain, fade small. */
  private updateGibs(dt: number): void {
    for (let i = this.gibs.length - 1; i >= 0; i--) {
      const gib = this.gibs[i];
      gib.life -= dt;
      if (gib.life <= 0) { this.scene.remove(gib.mesh); this.gibs.splice(i, 1); continue; }
      gib.vy -= 16 * dt;
      const p = gib.mesh.position;
      p.x += gib.vx * dt; p.y += gib.vy * dt; p.z += gib.vz * dt;
      if (gib.vy < 0 && this.world.get(p.x, p.y - .05, p.z) !== Block.Air) {
        p.y = Math.floor(p.y) + .07;
        gib.vy *= -.35; gib.vx *= .6; gib.vz *= .6;
        gib.spinX *= .6; gib.spinZ *= .6;
      }
      gib.mesh.rotation.x += gib.spinX * dt;
      gib.mesh.rotation.z += gib.spinZ * dt;
      gib.mesh.scale.setScalar(Math.min(1, gib.life * 3.5));
    }
  }

  count(): number { return this.mobs.length; }

  clear(): void {
    for (let i = this.mobs.length - 1; i >= 0; i--) this.remove(i);
    for (const gib of this.gibs) this.scene.remove(gib.mesh);
    this.gibs.length = 0;
    this.spawnTimer = 5;
  }

  dispose(): void {
    this.clear();
    for (const mat of Object.values(this.materials)) mat.dispose();
    for (const mat of Object.values(this.flashMaterials)) mat.dispose();
    this.gibGeometry.dispose();
    for (const mat of this.gibMaterials.values()) mat.dispose();
    this.gibMaterials.clear();
    EYES_MATERIAL.dispose();
    CORE_MATERIAL.dispose();
    AMBER_MATERIAL.dispose();
    CREST_MATERIAL.dispose();
  }

  private remove(index: number): void {
    const mob = this.mobs[index];
    this.scene.remove(mob.root);
    // Geometries are unique per spawn and must be disposed; materials are shared and disposed in dispose().
    mob.root.traverse(obj => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
    this.mobs.splice(index, 1);
  }
}
