import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, type World } from '../src/world';
import { Critters } from '../src/critters';
import { appendFoliage, type FoliageBuffers } from '../src/foliage';

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

describe('tree canopy is rooted to its trunk', () => {
  it('starts the canopy at the trunk base so no slab hovers over a stick', () => {
    // Find a real tree spot: world.ts only grows trees where hash(x,z) > .985.
    let spot: [number, number] | null = null;
    for (let x = 12; x < 60 && !spot; x++) {
      for (let z = -60; z < 60; z++) {
        const n = Math.sin(x * 127.1 + z * 311.7 + 19.19) * 43758.5453123;
        if (n - Math.floor(n) > .985) { spot = [x, z]; break; }
      }
    }
    expect(spot).not.toBeNull();
    const [x, z] = spot!;
    const surface = () => 8;
    const out: FoliageBuffers = { positions: [], normals: [], tint: [], effects: [], foliage: [], indices: [] };
    appendFoliage(out, Math.floor(x / 16), 0, Math.floor(z / 16), surface, () => 'overcast');

    const ys: number[] = [];
    for (let i = 1; i < out.positions.length; i += 3) ys.push(out.positions[i]);
    expect(ys.length).toBeGreaterThan(0);

    const baseY = surface() + 1;          // trunk base
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // The tree reaches the ground (the trunk base is the lowest point) ...
    expect(minY).toBeLessThanOrEqual(baseY + 0.6);
    // ... and the widest canopy layer sits within two blocks of the base,
    // otherwise it reads as a slab floating above a thin stick.
    const nearBase = ys.filter(y => y <= baseY + 2.6);
    expect(nearBase.length).toBeGreaterThan(0);
    // The canopy must still reach upward, so it is not a stump.
    expect(maxY).toBeGreaterThan(baseY + 3);
  });
});
