import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, biomeAt, World } from '../src/world';
import { collectTrees, cellInTree } from '../src/forest';
import { Timber } from '../src/timber';

describe('tree look', () => {
  it('hangs skyfruit under the canopy of overcast trees', () => {
    const world = new World(new THREE.Scene());
    const trees = collectTrees(12, 90, -90, 90, (x, z) => world.surface(x, z), biomeAt, () => false);
    // Geology-gated: only pick a tree whose trunk actually rendered as Wood.
    const t = trees.find(tree => tree.tx >= 0 && tree.tz >= 0 && biomeAt(tree.tx, tree.baseY, tree.tz) === 'overcast'
      && world.get(tree.tx, tree.baseY, tree.tz) === Block.Wood);
    expect(t).toBeDefined();
    let fruit = 0;
    for (let y = t!.baseY; y <= t!.topY; y++)
      for (let dx = -4; dx <= 4; dx++)
        for (let dz = -4; dz <= 4; dz++)
          if (world.get(t!.tx + dx, y, t!.tz + dz) === Block.Skyfruit) fruit++;
    // The fruit must be plainly visible on arrival, not speckle.
    expect(fruit).toBeGreaterThanOrEqual(4);
    world.dispose();
  });

  it('trunks carry branch stubs; chipping a stub yields wood WITHOUT felling', () => {
    const world = new World(new THREE.Scene());
    const trees = collectTrees(12, 90, -90, 90, (x, z) => world.surface(x, z), biomeAt, () => false);
    // Geology-gated: only pick a tree whose trunk actually rendered as Wood.
    const t = trees.find(tree => tree.tx >= 0 && tree.tz >= 0 && biomeAt(tree.tx, tree.baseY, tree.tz) === 'overcast'
      && world.get(tree.tx, tree.baseY, tree.tz) === Block.Wood);
    expect(t).toBeDefined();
    let stub: [number, number, number] | null = null;
    for (let y = t!.baseY; y <= t!.topY && !stub; y++)
      for (let dx = -4; dx <= 4 && !stub; dx++)
        for (let dz = -4; dz <= 4; dz++) {
          const x = t!.tx + dx, z = t!.tz + dz;
          const cell = cellInTree(t!, x, y, z);
          if (cell?.kind === 'branch') { stub = [x, y, z]; break; }
        }
    expect(stub).not.toBeNull();
    const [bx, by, bz] = stub!;
    expect(world.get(bx, by, bz)).toBe(Block.Wood);
    // A stub is a harvestable chip, not the support column: no felling.
    const loot: Block[] = [];
    const timber = new Timber(new THREE.Scene(), world, id => loot.push(id), () => undefined);
    expect(timber.notify(bx, by, bz, new THREE.Vector3(bx - 3, by, bz))).toBe(false);
    expect(timber.count()).toBe(0);
    world.dispose();
    timber.dispose();
  });
});
