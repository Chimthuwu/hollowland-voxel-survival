import * as THREE from 'three';
import type { Biome, World } from './world';

type Kind = 'beetle' | 'moth';
type Critter = {
  root: THREE.Group; kind: Kind; heading: number; retarget: number;
  flap: number; speed: number; vy: number; wings?: THREE.Object3D[];
};

/** Non-hostile giant insects that wander the surface and shy away from the player. */
export class Critters {
  private readonly mobs: Critter[] = [];
  private spawnTimer = 3;
  constructor(private readonly scene: THREE.Scene, private readonly world: Pick<World, 'get' | 'surface'>) {}

  spawn(biome: Biome, position: THREE.Vector3): void {
    const kind: Kind = biome === 'overcast' || biome === 'psychosis' ? 'moth' : 'beetle';
    const root = new THREE.Group();
    if (kind === 'beetle') {
      const shell = new THREE.MeshStandardMaterial({ color: 0x1d1a20, roughness: .55, metalness: .35 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(.34, 10, 8), shell);
      body.scale.set(1, .62, 1.35); body.position.y = .3; root.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(.16, 8, 6), shell);
      head.position.set(0, .26, -.48); root.add(head);
      const legMat = new THREE.MeshStandardMaterial({ color: 0x121014, roughness: .9 });
      for (const sx of [-1, 1]) for (const sz of [-.28, 0, .28]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(.3, .05, .05), legMat);
        leg.position.set(sx * .34, .16, sz); leg.rotation.z = sx * -.5; root.add(leg);
      }
      const gleam = new THREE.MeshBasicMaterial({ color: 0x7fd0a8 });
      for (const sx of [-.05, .05]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(.04, .03, .02), gleam);
        eye.position.set(sx, .3, -.6); root.add(eye);
      }
    } else {
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a3f4d, roughness: .9 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(.09, .5, 4, 8), bodyMat);
      body.rotation.x = Math.PI / 2; body.position.y = 1.4; root.add(body);
      const wingMat = new THREE.MeshStandardMaterial({ color: 0x6f6472, roughness: .8, transparent: true, opacity: .82, side: THREE.DoubleSide });
      const wings: THREE.Object3D[] = [];
      for (const sx of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.PlaneGeometry(.7, .42), wingMat);
        wing.position.set(sx * .38, 1.46, .04); wing.rotation.y = sx * .25; root.add(wing); wings.push(wing);
      }
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xd8c36a });
      for (const sx of [-.04, .04]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(.035, .035, .02), eyeMat);
        eye.position.set(sx, 1.46, -.32); root.add(eye);
      }
      this.mobs.push({ root, kind, heading: Math.random() * Math.PI * 2, retarget: 2, flap: Math.random() * 6, speed: 1.2, vy: 0, wings });
      root.position.copy(position); this.scene.add(root);
      return;
    }
    this.mobs.push({ root, kind, heading: Math.random() * Math.PI * 2, retarget: 2, flap: Math.random() * 6, speed: .8, vy: 0 });
    root.position.copy(position); this.scene.add(root);
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
      } else {
        // Moths bob and flutter at head height; wings beat visibly.
        const base = this.world.surface(p.x, p.z) + 1.6;
        p.y += (base + Math.sin(m.flap * 2.1) * .35 - p.y) * Math.min(1, dt * 3);
        if (m.wings) for (let w = 0; w < m.wings.length; w++)
          m.wings[w].rotation.z = (w === 0 ? 1 : -1) * (.35 + Math.sin(m.flap * 14) * .6);
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
