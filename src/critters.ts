import * as THREE from 'three';
import type { Biome, World } from './world';

type Kind = 'beetle' | 'moth' | 'dragonfly';

type Critter = {
  root: THREE.Group;
  kind: Kind;
  heading: number;
  retarget: number;
  flap: number;
  speed: number;
  vy: number;
  phase: number;
  wings?: THREE.Object3D[];
  legs?: THREE.Object3D[];
};

interface Built {
  root: THREE.Group;
  wings: THREE.Object3D[];
  legs: THREE.Object3D[];
}

/** Rhinoceros beetle: iridescent split elytra, horn, antennae, six articulated legs. */
function buildBeetle(): Built {
  const root = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0x232028, roughness: .4, metalness: .55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x141117, roughness: .85 });
  // Elytra: two slightly parted halves over the abdomen.
  for (const sx of [-1, 1]) {
    const half = new THREE.Mesh(new THREE.SphereGeometry(.33, 12, 8), shell);
    half.scale.set(.52, .58, 1.38);
    half.position.set(sx * .05, .32, .05);
    half.rotation.y = sx * -.05;
    root.add(half);
  }
  // Dark seam ridge between the halves.
  const seam = new THREE.Mesh(new THREE.BoxGeometry(.03, .06, .85), dark);
  seam.position.set(0, .5, .02);
  root.add(seam);
  const pronotum = new THREE.Mesh(new THREE.SphereGeometry(.2, 10, 6), shell);
  pronotum.scale.set(1.05, .68, 1);
  pronotum.position.set(0, .3, -.36);
  root.add(pronotum);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.14, 8, 6), shell);
  head.position.set(0, .26, -.54);
  root.add(head);
  // Horn curving up from the snout.
  const horn = new THREE.Mesh(new THREE.ConeGeometry(.05, .32, 5), shell);
  horn.rotation.x = -1.15;
  horn.position.set(0, .33, -.62);
  root.add(horn);
  // Antennae.
  const antMat = new THREE.MeshStandardMaterial({ color: 0x1a171c, roughness: .9 });
  for (const sx of [-1, 1]) {
    const ant = new THREE.Mesh(new THREE.BoxGeometry(.02, .02, .28), antMat);
    ant.position.set(sx * .06, .34, -.63);
    ant.rotation.x = -.55;
    ant.rotation.y = sx * .4;
    root.add(ant);
  }
  const gleam = new THREE.MeshBasicMaterial({ color: 0x7fd0a8 });
  for (const sx of [-.05, .05]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(.04, .03, .02), gleam);
    eye.position.set(sx, .3, -.66);
    root.add(eye);
  }
  // Six articulated legs: angled femur + dropping tibia, animated while walking.
  const legMat = new THREE.MeshStandardMaterial({ color: 0x121014, roughness: .9 });
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const hip = new THREE.Group();
    hip.position.set(sx * .26, .26, -.25 + i * .25);
    const femur = new THREE.Mesh(new THREE.BoxGeometry(.28, .045, .045), legMat);
    femur.position.set(sx * .13, -.05, 0);
    femur.rotation.z = sx * -.95;
    hip.add(femur);
    const tibia = new THREE.Mesh(new THREE.BoxGeometry(.05, .22, .04), legMat);
    tibia.position.set(sx * .25, -.18, 0);
    tibia.rotation.z = sx * .4;
    hip.add(tibia);
    root.add(hip);
    legs.push(hip);
  }
  return { root, wings: [], legs };
}

/** Moth: fuzzy segmented body, glowing eyes, two pairs of translucent flapping wings. */
function buildMoth(): Built {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a3f4d, roughness: .95 });
  const fuzzMat = new THREE.MeshStandardMaterial({ color: 0x5c4f60, roughness: 1 });
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(.12, 8, 6), fuzzMat);
  thorax.position.set(0, 1.4, -.12);
  root.add(thorax);
  const abdomen = new THREE.Mesh(new THREE.CapsuleGeometry(.075, .34, 4, 8), bodyMat);
  abdomen.rotation.x = Math.PI / 2;
  abdomen.scale.set(1, 1, .8);
  abdomen.position.set(0, 1.37, .16);
  root.add(abdomen);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.08, 8, 6), fuzzMat);
  head.position.set(0, 1.43, -.26);
  root.add(head);
  // Feathered antennae sweep forward.
  for (const sx of [-1, 1]) {
    const ant = new THREE.Mesh(new THREE.BoxGeometry(.02, .02, .2), bodyMat);
    ant.position.set(sx * .04, 1.5, -.34);
    ant.rotation.x = -.7;
    ant.rotation.z = sx * .3;
    root.add(ant);
  }
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
  for (const sx of [-.045, .045]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(.04, .04, .02), eyeMat);
    eye.position.set(sx, 1.44, -.32);
    root.add(eye);
  }
  // Two wing pairs per side, pivoted at the thorax so flapping reads naturally.
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x8a7f92, roughness: .8, transparent: true, opacity: .78, side: THREE.DoubleSide });
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const fore = new THREE.Group();
    fore.position.set(sx * .08, 1.45, .04);
    fore.userData.side = sx;
    fore.userData.hind = 0;
    const foreMesh = new THREE.Mesh(new THREE.PlaneGeometry(.72, .42), wingMat);
    foreMesh.position.x = sx * .36;
    fore.add(foreMesh);
    root.add(fore);
    wings.push(fore);
    const hind = new THREE.Group();
    hind.position.set(sx * .08, 1.42, .14);
    hind.userData.side = sx;
    hind.userData.hind = 1;
    const hindMesh = new THREE.Mesh(new THREE.PlaneGeometry(.46, .32), wingMat);
    hindMesh.position.x = sx * .23;
    hind.add(hindMesh);
    root.add(hind);
    wings.push(hind);
  }
  return { root, wings, legs: [] };
}

/** Dragonfly: long tapered tail, huge compound eyes, four narrow whirring wings. */
function buildDragonfly(): Built {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x27423c, roughness: .6, metalness: .3 });
  const thorax = new THREE.Mesh(new THREE.CapsuleGeometry(.09, .26, 4, 8), bodyMat);
  thorax.rotation.x = Math.PI / 2;
  thorax.position.set(0, 1.7, -.12);
  root.add(thorax);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.1, 8, 6), bodyMat);
  head.position.set(0, 1.71, -.3);
  root.add(head);
  // Compound eyes.
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x59e0c8, roughness: .3, emissive: 0x1a8f7a, emissiveIntensity: .6 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.085, 8, 6), eyeMat);
    eye.position.set(sx * .08, 1.73, -.34);
    root.add(eye);
  }
  // Long tail with a slight droop.
  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(.04, .78, 4, 8), bodyMat);
  tail.rotation.x = Math.PI / 2 + .07;
  tail.position.set(0, 1.66, .3);
  root.add(tail);
  // Four narrow wings, pivoted at the thorax. They need enough opacity to read
  // as attached to the body instead of leaving it floating in mid air.
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x9fd6c6, roughness: .4, transparent: true, opacity: .62, side: THREE.DoubleSide });
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) for (let pair = 0; pair < 2; pair++) {
    const w = new THREE.Group();
    w.position.set(sx * .09, 1.72, pair === 0 ? -.1 : .08);
    w.rotation.y = sx * -.12;
    w.userData.side = sx;
    w.userData.hind = pair;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pair === 0 ? .82 : .68, pair === 0 ? .15 : .12), wingMat);
    mesh.position.x = sx * (pair === 0 ? .41 : .34);
    w.add(mesh);
    root.add(w);
    wings.push(w);
  }
  return { root, wings, legs: [] };
}

function build(kind: Kind): Built {
  if (kind === 'beetle') return buildBeetle();
  if (kind === 'moth') return buildMoth();
  return buildDragonfly();
}

/** Which giant insect haunts which surface biome. */
function kindFor(biome: Biome): Kind {
  if (biome === 'storm') return 'dragonfly';
  return biome === 'overcast' || biome === 'psychosis' ? 'moth' : 'beetle';
}

/** Non-hostile giant insects that wander the surface and shy away from the player. */
export class Critters {
  private readonly mobs: Critter[] = [];
  private spawnTimer = 3;
  constructor(private readonly scene: THREE.Scene, private readonly world: Pick<World, 'get' | 'surface'>) {}

  spawn(biome: Biome, position: THREE.Vector3): void {
    const kind = kindFor(biome);
    const { root, wings, legs } = build(kind);
    const speed = kind === 'beetle' ? .8 : kind === 'moth' ? 1.2 : 2.3;
    this.mobs.push({
      root, kind,
      heading: Math.random() * Math.PI * 2,
      retarget: 2,
      flap: Math.random() * 6,
      speed,
      vy: 0,
      phase: Math.random() * Math.PI * 2,
      wings: wings.length ? wings : undefined,
      legs: legs.length ? legs : undefined,
    });
    root.position.copy(position);
    this.scene.add(root);
  }

  positions(): THREE.Vector3[] { return this.mobs.map(m => m.root.position); }

  update(dt: number, player: THREE.Vector3, biome: Biome): void {
    dt = Math.min(.05, Math.max(0, dt));
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 7 + Math.random() * 5;
      if (this.mobs.length < 6 && player.y > -2) {
        const a = Math.random() * Math.PI * 2, r = 9 + Math.random() * 6;
        const x = player.x + Math.sin(a) * r, z = player.z + Math.cos(a) * r;
        const ground = this.world.surface(x, z) + 1;
        this.spawn(biome, new THREE.Vector3(x, ground, z));
      }
    }
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i], p = m.root.position;
      const dx = player.x - p.x, dz = player.z - p.z, dist = Math.hypot(dx, dz);
      if (dist > 42) { this.remove(i); continue; }
      m.retarget -= dt; m.flap += dt;
      // Skittish: anything within 3 blocks gets fled from; otherwise wander.
      if (dist < 3) { m.heading = Math.atan2(-dx, -dz); m.retarget = 1.2; }
      else if (m.retarget <= 0) { m.heading += (Math.random() - .5) * 1.8; m.retarget = 1.5 + Math.random() * 2.5; }
      const pace = dist < 3 ? m.speed * 2.2 : m.speed;
      const nx = p.x + Math.sin(m.heading) * pace * dt, nz = p.z + Math.cos(m.heading) * pace * dt;
      if (this.world.get(nx, p.y + .2, nz) === 0) { p.x = nx; p.z = nz; } else m.heading += Math.PI * .5;
      m.root.rotation.y = m.heading;
      if (m.kind === 'beetle') {
        const ground = this.world.surface(p.x, p.z) + 1;
        p.y += (ground - p.y) * Math.min(1, dt * 6);
        // Scuttling legs, faster when fleeing.
        if (m.legs) {
          const scuttle = dist < 3 ? 16 : 7;
          for (let l = 0; l < m.legs.length; l++)
            m.legs[l].rotation.x = Math.sin(m.flap * scuttle + l * 1.9 + m.phase) * .3;
        }
      } else {
        // Aerial insects bob and flutter close to the ground: the moth skims the
        // surface, the dragonfly hovers a little higher. The old offsets left them
        // hanging two blocks up, which read as debris floating in mid air.
        const dragonfly = m.kind === 'dragonfly';
        const base = this.world.surface(p.x, p.z) + (dragonfly ? .9 : .15);
        const bob = dragonfly ? .22 : .35;
        const ease = dragonfly ? 5 : 3;
        p.y += (base + Math.sin(m.flap * 2.1 + m.phase) * bob - p.y) * Math.min(1, dt * ease);
        if (m.wings) {
          const rate = dragonfly ? 24 : 14;
          const amp = dragonfly ? .28 : .55;
          for (let w = 0; w < m.wings.length; w++) {
            const wing = m.wings[w];
            const side = wing.userData.side as number;
            const hind = (wing.userData.hind as number) ? 1 : 0;
            wing.rotation.z = side * (.3 + Math.sin(m.flap * rate - hind * .9) * amp);
          }
        }
      }
    }
  }

  clear(): void { for (let i = this.mobs.length - 1; i >= 0; i--) this.remove(i); this.spawnTimer = 3; }

  private remove(index: number): void {
    const m = this.mobs[index]; this.scene.remove(m.root);
    const materials = new Set<THREE.Material>();
    m.root.traverse(obj => { if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); Array.isArray(obj.material) ? obj.material.forEach(x => materials.add(x)) : materials.add(obj.material); } });
    materials.forEach(x => x.dispose()); this.mobs.splice(index, 1);
  }
}
