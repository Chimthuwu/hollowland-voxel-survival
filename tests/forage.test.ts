import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, biomeAt, World } from '../src/world';
import { floraPickAt } from '../src/foliage';

describe('forageable ground flora', () => {
  it('finds a pickable flora column near the spawn region', () => {
    let found: [number, number] | null = null;
    for (let x = -40; x < 40 && !found; x++)
      for (let z = -40; z < 40; z++) {
        const biome = biomeAt(x, 8, z);
        if (biome === 'overcast' && floraPickAt(x, z, biome) === 'shroom') { found = [x, z]; break; }
      }
    expect(found).not.toBeNull();
  });

  it('topGround anchors to actual blocks, skipping trees and placed utilities', () => {
    const world = new World(new THREE.Scene());
    const s = world.surface(3, 3);
    // Clear terrain: plain noise ground.
    expect(world.topGround(3, 3)).toBe(s);
    // A dug-out pit drops the anchor instead of leaving it floating.
    for (let y = s; y >= s - 2; y--) world.set(3, y, 3, Block.Air);
    expect(world.topGround(3, 3)).toBeLessThan(s);
    // A player-built floor raises the anchor...
    world.set(3, s + 2, 3, Block.Stone);
    expect(world.topGround(3, 3)).toBe(s + 2);
    // ...but tree canopy and placed utilities never carry ground flora.
    world.set(3, s + 6, 3, Block.Leaf);
    world.set(4, s + 1, 4, Block.Scaffold);
    expect(world.topGround(3, 3)).toBe(s + 2);
    expect(world.topGround(4, 4)).toBe(s);
    world.dispose();
  });

  it('forages a plant once and refuses a second harvest', () => {
    const world = new World(new THREE.Scene());
    let spot: [number, number] | null = null;
    for (let x = -40; x < 40 && !spot; x++)
      for (let z = -40; z < 40; z++) {
        const g = world.topGround(x, z);
        if (g < 2 || g > 13) continue;
        if (biomeAt(x, g, z) !== 'overcast') continue;
        if (floraPickAt(x, z, 'overcast') === 'shroom') { spot = [x, z]; break; }
      }
    // Bring the chunk up so the forage rebuild path has geometry to refresh.
    for (let i = 0; i < 20; i++) world.update(new THREE.Vector3(spot![0] + .5, 8, spot![1] + .5), 0);
    const first = world.forageFlora(spot![0], spot![1]);
    expect(first).toEqual({ kind: 'shroom', y: world.topGround(spot![0], spot![1]) + 1 });
    // Second click on the same column must not double-drop.
    expect(world.forageFlora(spot![0], spot![1])).toBeNull();
    // Columns without flora cannot be harvested at all.
    let empty: [number, number] | null = null;
    for (let x = 30; x < 60 && !empty; x++)
      for (let z = -40; z < 40; z++) {
        const g = world.topGround(x, z);
        if (g < 2 || g > 13) continue;
        if (biomeAt(x, g, z) === 'overcast' && floraPickAt(x, z, 'overcast') === null) { empty = [x, z]; break; }
      }
    expect(empty).not.toBeNull();
    expect(world.forageFlora(empty![0], empty![1])).toBeNull();
    world.dispose();
  });
});
