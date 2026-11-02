import * as THREE from 'three';
import { Block, type Biome, type World } from './world';

type Kind = 'stalker' | 'node' | 'crawler' | 'hallucination';
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

const EYES_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xd8453e });

/** Builds the local-space mesh for a kind. The caller positions it and adds it to the scene. */
function buildMesh(kind: Kind, material: THREE.Material): THREE.Group {
  const root = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    root.add(mesh);
  };
  const addEyes = (yOffset: number, zOffset: number) => {
    for (const x of [-.1, .1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(.06, .05, .02), EYES_MATERIAL);
      eye.position.set(x, yOffset, zOffset);
      root.add(eye);
    }
  };

  if (kind === 'node') {
    // Floating corrupted geometry: faceted icosahedron + two spiky satellites.
    add(new THREE.IcosahedronGeometry(.7,  1),  0,    1.05, 0);
    add(new THREE.IcosahedronGeometry(.28, 0),  .35,  1.4,  .15);
    add(new THREE.IcosahedronGeometry(.22, 0), -.35,  .9,  -.2);
  } else if (kind === 'crawler') {
    // Low, hunched crawler: wide torso, head thrust forward, four squat legs.
    add(new THREE.BoxGeometry(1.0,  .42, 1.2),  0,    .42, 0);
    add(new THREE.BoxGeometry(.55, .38, .45),  0,    .55, -.7);
    add(new THREE.BoxGeometry(.38, .32, .32),  0,    .82, -.95);
    for (const x of [-.55, .55]) for (const z of [-.45, .45]) add(new THREE.BoxGeometry(.32, .22, .18), x, .22, z);
    add(new THREE.BoxGeometry(.12, .06, .04),  .12,  .62, -1.18);
    add(new THREE.BoxGeometry(.12, .06, .04), -.12,  .62, -1.18);
  } else if (kind === 'hallucination') {
    // Tall, swaying, semi-transparent silhouette: thin torso, oversized head, long arms.
    add(new THREE.BoxGeometry(.45, .85, .3),  0,  1.2,  0);
    add(new THREE.BoxGeometry(.5,  .55, .45), 0,  1.85, 0);
    add(new THREE.BoxGeometry(.4,  .25, .2),  0,  1.95, -.22);
    for (const x of [-.22, .22]) add(new THREE.BoxGeometry(.18, .85, .18), x, .42,  0);
    for (const x of [-.55, .55]) add(new THREE.BoxGeometry(.14, .8,  .18), x, 1.1,  0);
    addEyes(1.93, -.34);
  } else {
    // Stalker: hulking biped with a smaller head, hanging arms, glowing eyes.
    add(new THREE.BoxGeometry(.62, .85, .38), 0,  1.22, 0);
    add(new THREE.BoxGeometry(.46, .5,  .44), 0,  1.85, 0);
    add(new THREE.BoxGeometry(.42, .22, .22), 0,  1.95, -.22);
    for (const x of [-.24, .24]) add(new THREE.BoxGeometry(.22, .85, .22), x, .42,  0);
    for (const x of [-.48, .48]) add(new THREE.BoxGeometry(.17, .8,  .22), x, 1.18, 0);
    addEyes(1.92, -.23);
  }
  return root;
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
    const root = buildMesh(kind, material);
    root.position.copy(position);
    this.scene.add(root);
    this.mobs.push({
      root, kind, ...data,
      cooldown: 0,
      teleport: 2,
      vy: 0,
      fake: kind === 'hallucination' && Math.random() < .45,
      phase: Math.random() * Math.PI * 2,
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
      if(dist<20&&dist>.9){
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
