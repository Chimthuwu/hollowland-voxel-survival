import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Block, World } from '../src/world';
import { placeSky, skyLayout } from '../src/sky';

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

  it('plants the chain and beacon into the live world with the right blocks', () => {
    const world = new World(new THREE.Scene());
    const { slabs, beacon, start } = placeSky(world);
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
    world.dispose();
  });
});
