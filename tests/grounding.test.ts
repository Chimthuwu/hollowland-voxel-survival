import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, World, biomeAt } from '../src/world';
import { Critters } from '../src/critters';
import { collectTrees } from '../src/forest';

const world: Pick<World, 'get' | 'surface'> = {
  get: (_x: number, y: number, _z: number) => (y < 0 ? Block.Stone : Block.Air),
  surface: () => -1,
};

describe('critters stay near the ground', () => {
  // surface() returns the topmost SOLID block, so the walkable ground face is
  // surface + 1. A critter group sitting well above that face means its body
  // is hanging in the air, which reads as debris floating in mid air.
  const groundFace = world.surface(0, 0) + 1;

  it('flies insects just above the ground, not two blocks up', () => {
    const critters = new Critters(new THREE.Scene(), world);
    critters.spawn('overcast', new THREE.Vector3(0, 0, 0.5)); // moth
    critters.spawn('storm', new THREE.Vector3(4, 0, 0.5));    // dragonfly
    // Park the player close enough that nothing despawns (despawn radius 42)
    // but far enough that the skittish flee behaviour is not triggered (< 3).
    // 150 frames stays under the 3s auto-spawn timer so the count stays predictable.
    for (let i = 0; i < 150; i++) critters.update(1 / 60, new THREE.Vector3(20, 0, 20), 'overcast');
    const positions = critters.positions();
    expect(positions.length).toBe(2);
    for (const p of positions) {
      expect(p.y).toBeLessThanOrEqual(groundFace + 0.2);
      expect(p.y).toBeGreaterThanOrEqual(groundFace - 1.4);
    }
  });

  it('keeps the beetle on the ground', () => {
    const critters = new Critters(new THREE.Scene(), world);
    critters.spawn('glitch', new THREE.Vector3(0, 0, 0.5)); // beetle
    for (let i = 0; i < 200; i++) critters.update(1 / 60, new THREE.Vector3(20, 0, 20), 'glitch');
    const p = critters.positions()[0];
    expect(Math.abs(p.y - groundFace)).toBeLessThan(0.2);
  });
});

describe('critters roam without spinning in place', () => {
  // Regression: the movement probe used a fixed +.2 above the origin, which
  // dipped into the ground cell for moths/dragonflies (their origins ease
  // down to the surface line). Every frame then read "blocked" and the
  // collision turn spun them 90°/frame — the entity flickered like two.
  it('a moth on flat ground actually moves and does not flip every frame', () => {
    const scene = new THREE.Scene();
    const real = new World(scene);
    const flat: Pick<World, 'get' | 'surface'> = {
      get: (x, y, z) => real.get(x, y, z),
      surface: () => real.surface(0, 0), // flat spawn plateau, no steps
    };
    const critters = new Critters(scene, flat);
    const origin = new THREE.Vector3(0.5, flat.surface(0, 0) + 1, 0.5);
    critters.spawn('overcast', origin); // moth
    const player = new THREE.Vector3(20, 0, 20); // far: wander, no flee
    for (let i = 0; i < 90; i++) critters.update(1 / 60, player, 'overcast');
    const p = critters.positions()[0];
    // The bug signature was zero translation plus a 90°/frame collision turn;
    // a healthy wanderer covers ground.
    const travelled = Math.hypot(p.x - origin.x, p.z - origin.z);
    expect(travelled, 'a free moth must actually travel, not pin in place').toBeGreaterThan(0.4);
    real.dispose();
  });
});

describe('trees are rooted, collidable voxel woodland', () => {
  it('gives every tree a trunk on the ground and a solid canopy above it', () => {
    // Use the REAL surface noise so base heights agree with world.get().
    const world = new World(new THREE.Scene());
    const trees = collectTrees(12, 90, -90, 90,
      (x, z) => world.surface(x, z),
      (x, y) => (y > 64 ? 'sky' : y < 0 ? 'catacombs' : x < 96 ? 'overcast' : 'storm'),
      () => false);
    expect(trees.length).toBeGreaterThan(0);
    // The raw collector has no terrain policy; the world only renders trees
    // on open ground (not water/desert), so pick one that actually exists.
    const TRUNKS = [Block.Wood, Block.Glitch, Block.Bone, Block.Flesh];
    const t = trees.find(tr => TRUNKS.includes(world.get(tr.tx, tr.baseY, tr.tz)))!;
    expect(t, 'no tree in range renders as a real trunk').toBeDefined();
    const trunk = world.get(t.tx, t.baseY, t.tz);
    expect(TRUNKS).toContain(trunk);
    // Canopy leaves exist somewhere in the tree's bounding volume — and as
    // solid blocks they are collidable by construction (world.get != Air).
    let leafY: number | null = null, topY: number | null = null;
    for (let y = t.baseY; y <= t.topY; y++) {
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
        const id = world.get(t.tx + dx, y, t.tz + dz);
        if (id === Block.Leaf) { if (leafY === null) leafY = y; topY = y; }
      }
    }
    expect(leafY).not.toBeNull();
    // Lower canopy hangs near the trunk (no floating slab over a stick)...
    expect(leafY! - t.baseY).toBeLessThan(t.height * .6 + 2);
    // ...but the canopy is tall enough to climb, not a stump.
    expect(topY! - leafY!).toBeGreaterThanOrEqual(2);
    // The tree is substantially taller than the old 6-row trunks.
    expect(t.height).toBeGreaterThanOrEqual(5);
    world.dispose();
  });
});
