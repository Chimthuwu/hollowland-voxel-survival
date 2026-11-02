import * as THREE from 'three';
import { Block, type Biome, type World } from './world';

type Kind = 'stalker' | 'node' | 'crawler' | 'hallucination';

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
};

const stats: Record<Kind, { hp: number; speed: number; damage: number }> = {
  stalker:       { hp: 30, speed: 3,   damage: 10 },
  node:          { hp: 20, speed: 3,   damage: 15 },
  crawler:       { hp: 25, speed: 5,   damage: 12 },
  hallucination: { hp: 20, speed: 3.8, damage: 8  },
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
    case 'stalker':
    default:              return new THREE.MeshStandardMaterial({ color: 0x151316, roughness: .9,  emissive: 0x080406, emissiveIntensity: .15 });
  }
}

const EYES_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xff3524 });
const CORE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xff5cd9 });

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

function addEyes(parent: THREE.Object3D, x: number, y: number, z: number, size = .06): void {
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(size, size * .85, .02), EYES_MATERIAL);
    eye.position.set(sx * x, y, z);
    parent.add(eye);
  }
}

/** Stalker: gaunt hunched biped — long hanging clawed arms, small head, burning eyes. */
function buildStalker(material: THREE.Material): { root: THREE.Group; parts: MobParts } {
  const root = new THREE.Group();
  const sway = new THREE.Group();
  sway.rotation.x = .16; // permanent hunch
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

function buildMesh(kind: Kind, material: THREE.Material): { root: THREE.Group; parts: MobParts } {
  switch (kind) {
    case 'node':          return buildNode(material);
    case 'crawler':       return buildCrawler(material);
    case 'hallucination': return buildHallucination(material);
    case 'stalker':
    default:              return buildStalker(material);
  }
}

export class Enemies {
  private readonly mobs: Mob[] = [];
  private spawnTimer = 5;
  /** Monotonically increasing clock used for the idle/breathing animation. */
  private simTime = 0;
  /** Cached per-kind materials, built once. Disposed in dispose(). */
  private readonly materials: Record<Kind, THREE.MeshStandardMaterial>;

  constructor(private readonly scene: THREE.Scene, private readonly world: Pick<World, 'get' | 'surface'>) {
    this.materials = {
      stalker:       buildMaterial('stalker'),
      node:          buildMaterial('node'),
      crawler:       buildMaterial('crawler'),
      hallucination: buildMaterial('hallucination'),
    };
  }

  spawn(biome: Biome, position: THREE.Vector3): void {
    const kind = kindFor(biome);
    const data = stats[kind];
    const material = this.materials[kind];
    const { root, parts } = buildMesh(kind, material);
    root.position.copy(position);
    this.scene.add(root);
    this.mobs.push({
      root, kind, ...data,
      cooldown: 0,
      teleport: 2,
      vy: 0,
      fake: kind === 'hallucination' && Math.random() < .45,
      phase: Math.random() * Math.PI * 2,
      parts,
      walkT: Math.random() * 6,
    });
  }
  update(dt: number, player: THREE.Vector3, biome: Biome, onDamage: (amount: number) => void): void {
    dt = Math.min(.05, Math.max(0, dt));
    this.spawnTimer -= dt;
    this.simTime += dt;

    if (this.spawnTimer <= 0) {
      this.spawnTimer = biome === 'overcast' ? 11 : 6;
      if (this.mobs.length < 10) {
        const a = Math.random() * Math.PI * 2;
        const r = 11 + Math.random() * 5;
        const x = player.x + Math.sin(a) * r;
        const z = player.z + Math.cos(a) * r;
        const ground = player.y < 0 ? Math.floor(player.y) : this.world.surface(x, z) + 1;
        if (this.world.get(x, ground, z) === Block.Air && this.world.get(x, ground + 1, z) === Block.Air)
          this.spawn(biome, new THREE.Vector3(x, ground, z));
      }
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];
      const p = mob.root.position;
      mob.cooldown = Math.max(0, mob.cooldown - dt);

      const dx = player.x - p.x;
      const dz = player.z - p.z;
      const dist = Math.hypot(dx, dz);

      // Idle "breathing": subtle per-mob scale oscillation, phased so groups don't sync.
      const breathe = 1 + Math.sin(this.simTime * 1.7 + mob.phase) * .025;
      mob.root.scale.set(breathe, breathe, breathe);

      if (dist > 42) { this.remove(i); continue; }
      const chase = dist < 20 && dist > .9;
      if(chase){
        let step=mob.speed*dt;
        if(mob.kind==='node'){mob.teleport-=dt;if(mob.teleport<=0){step=Math.min(2,dist-1);mob.teleport=2+Math.random();}}
        const nx=p.x+dx/dist*step,nz=p.z+dz/dist*step;
        if(this.world.get(nx,p.y+.3,nz)!==Block.Air){
          if(this.world.get(nx,p.y+1.1,nz)===Block.Air&&this.world.get(nx,p.y+2,nz)===Block.Air&&Math.abs(mob.vy)<.01)mob.vy=6.2;
        } else {p.x=nx;p.z=nz;}
        mob.root.rotation.y=Math.atan2(-dx,-dz);
      }
      mob.vy=Math.max(-20,mob.vy-20*dt);const next=p.y+mob.vy*dt;
      if(mob.vy<=0&&this.world.get(p.x,next-.05,p.z)!==Block.Air){p.y=Math.floor(next-.05)+1;mob.vy=0;}else if(mob.vy>0&&this.world.get(p.x,next+1.7,p.z)!==Block.Air)mob.vy=0;else p.y=next;
      if(dist<1.15&&Math.abs(p.y-player.y)<1.8&&mob.cooldown<=0){if(mob.fake){this.remove(i);continue;}onDamage(mob.damage);mob.cooldown=1;}

      // --- Procedural animation ---
      // Walk cycle swings limbs while chasing; a slow drift keeps them alive when idle.
      mob.walkT += dt * (chase ? mob.speed * 2.5 : 1.3);
      const amp = chase ? .5 : .055;
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
      if (mob.kind === 'hallucination') {
        mob.parts.sway.rotation.z = Math.sin(this.simTime * .8 + mob.phase) * .07;
      } else if (mob.kind === 'node') {
        mob.parts.sway.position.y = (mob.parts.sway.userData.baseY as number) + Math.sin(this.simTime * 1.3 + mob.phase) * .12;
        for (let o = 0; o < mob.parts.orbiters.length; o++)
          mob.parts.orbiters[o].rotation.y += dt * (o % 2 ? -1.7 : 1.3);
        this.materials.node.emissiveIntensity = .9 + Math.sin(this.simTime * 3) * .25;
      }
    }
  }
  attack(origin:THREE.Vector3,direction:THREE.Vector3,range:number,damage:number):boolean {
    const dir=direction.clone().normalize();let best=-1,near=range;
    for(let i=0;i<this.mobs.length;i++){
      const mob=this.mobs[i], center=mob.root.position.clone().add(new THREE.Vector3(0,mob.kind==='crawler'?.5:1,0));
      const delta=center.sub(origin), along=delta.dot(dir);if(along<0||along>near)continue;
      if(delta.addScaledVector(dir,-along).length()>.8)continue;
      best=i;near=along;
    }
    if(best<0)return false;
    const mob=this.mobs[best];mob.hp-=damage;if(mob.hp<=0)this.remove(best);else {mob.root.position.addScaledVector(dir,.18);}
    return true;
  }
  clear(): void {
    for (let i = this.mobs.length - 1; i >= 0; i--) this.remove(i);
    this.spawnTimer = 5;
  }

  dispose(): void {
    this.clear();
    for (const mat of Object.values(this.materials)) mat.dispose();
    EYES_MATERIAL.dispose();
    CORE_MATERIAL.dispose();
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
