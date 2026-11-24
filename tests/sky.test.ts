import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Block, World } from '../src/world';
import { placeSky, skyLayout } from '../src/sky';
import { skyEyeLayout } from '../src/skyEye';

describe('sky traversal layout', () => {
  it('is deterministic for the same surface function', () => {
    const surface = (x: number, z: number) => 5 + Math.abs(x * .1 + z) * .2 % 4;
    expect(JSON.stringify(skyLayout(surface))).toBe(JSON.stringify(skyLayout(surface)));
  });

  it('climbs by exactly one jumpable step per platform and ends above the clouds', () => {
    const surface = () => 6;
    const { slabs, beacon } = skyLayout(surface);
    expect(slabs.length).toBeGreaterThan(40);
    for (let i = 1; i < slabs.length; i++) {
      const prev = slabs[i - 1], slab = slabs[i];
      expect(slab.y).toBe(prev.y + 1); // never a higher leap than one block
      // Each hop moves exactly one slab-gap on a single axis (4 = 3 wide + 1 gap).
      const dx = slab.x - prev.x, dz = slab.z - prev.z;
      expect([dx, dz]).toEqual(expect.arrayContaining([0]));
      expect([Math.abs(dx), Math.abs(dz)]).toEqual(expect.arrayContaining([0, 4]));
    }
    // The guaranteed target: the beacon top sits past the y=64 cloud line.
    expect(beacon.y + 1).toBeGreaterThan(64);
    expect(beacon.w).toBeGreaterThanOrEqual(7);
  });

  it('keeps the beacon reachable from the ground landing by jumpable hops', () => {
    const surface = (x: number, z: number) => 5 + Math.abs(x * .1 + z) * .2 % 4;
    const { slabs, beacon, start } = skyLayout(surface);
    // Start slab meets the ground it rises from; no teleport required.
    expect(start.y).toBe(Math.max(4, surface(10, 5)));
    // Walk the chain as a graph: every consecutive landing is at most one
    // block up and at most one air gap away on a single axis.
    const nodes = [...slabs, { ...beacon, w: beacon.w, d: beacon.d }];
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length) {
      const i = queue.shift()!;
      const a = nodes[i];
      for (let j = 0; j < nodes.length; j++) {
        if (seen.has(j)) continue;
        const b = nodes[j];
        const dx = Math.abs(a.x - b.x), dz = Math.abs(a.z - b.z);
        const gapX = Math.max(0, dx - a.w), gapZ = Math.max(0, dz - a.d);
        const rise = b.y - a.y;
        // Small epsilon: the chain's y accumulates as a float when the
        // surface height is fractional.
        if (rise >= -1e-6 && rise <= 1 + 1e-6 && gapX <= 1 && gapZ <= 1 && (gapX === 0 || gapZ === 0)) {
          seen.add(j); queue.push(j);
        }
      }
    }
    expect(seen.has(nodes.length - 1)).toBe(true);
  });

  it('hangs a deterministic decorative eye above the beacon', () => {
    const beacon = { x: 10, y: 66, z: 12, w: 7, d: 7 };
    const eye = skyEyeLayout(beacon);
    expect(JSON.stringify(eye)).toBe(JSON.stringify(skyEyeLayout(beacon)));
    expect(eye.center.y).toBeGreaterThan(beacon.y);
    expect(eye.sclera).toHaveLength(24); // 7x7 square ring
    expect(eye.iris).toHaveLength(8);    // 3x3 iris minus the pupil
    expect(eye.sclera.every(p => p.y === eye.center.y)).toBe(true);
    expect(eye.pupil).toEqual(eye.center);
  });

  it('plants the chain and beacon into the live world with the right blocks', () => {
    const world = new World(new THREE.Scene());
    const { slabs, beacon, start, eye } = placeSky(world);
    // Every slab cell is scaffold; the first landing replaces the ground top.
    expect(world.get(start.x, start.y, start.z)).toBe(Block.Scaffold);
    for (const slab of slabs) expect(world.get(slab.x + slab.w - 1, slab.y, slab.z + slab.d - 1)).toBe(Block.Scaffold);
    // Hidden content: a crystal cache hangs under every marked slab.
    const cached = slabs.filter(s => s.cache);
    expect(cached.length).toBeGreaterThan(0);
    for (const slab of cached) expect(world.get(slab.x + 1, slab.y - 1, slab.z + 1)).toBe(Block.Crystal);
    // The beacon: totem base, crystal column over it, echo gems in the floor.
    expect(world.get(beacon.totem.x, beacon.totem.y, beacon.totem.z)).toBe(Block.Totem);
    for (const crystal of beacon.crystals) expect(world.get(crystal.x, crystal.y, crystal.z)).toBe(Block.Crystal);
    for (const gem of beacon.gems) expect(world.get(gem.x, gem.y, gem.z)).toBe(Block.EchoGem);
    // fruit, light
    const fruited = slabs.filter(s => s.fruit);
    expect(fruited.length).toBeGreaterThan(0);
    for (const slab of fruited) expect(world.get(slab.x + 1, slab.y + 1, slab.z + 1)).toBe(Block.Skyfruit);
    // The sky eye: crystal ring, echo-gem iris, scorched pupil, all in the air.
    expect(eye).toBeDefined();
    for (const p of eye!.sclera) expect(world.get(p.x, p.y, p.z)).toBe(Block.Crystal);
    for (const p of eye!.iris) expect(world.get(p.x, p.y, p.z)).toBe(Block.EchoGem);
    expect(world.get(eye!.pupil.x, eye!.pupil.y, eye!.pupil.z)).toBe(Block.Scorched);
    world.dispose();
  });
});
