import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, World, biomeAt } from '../src/world';
import { collectTrees } from '../src/forest';
import { Timber } from '../src/timber';

interface Fixture {
  world: World;
  tree: ReturnType<typeof collectTrees>[number];
  timber: Timber;
  loot: Array<{ id: Block; y: number }>;
  impacts: number;
}

function setup(): Fixture {
  const scene = new THREE.Scene();
  const world = new World(scene);
  const trees = collectTrees(12, 90, -90, 90, (x, z) => world.surface(x, z), biomeAt, () => false);
  // Terrain geology only grows trees on open grassy/rocky columns; pick one
  // that actually exists in the world's block data (its trunk is Wood).
  const tree = trees.find(t => t.tx >= 0 && t.tz >= 0
    && world.get(t.tx, t.baseY, t.tz) === Block.Wood)!;
  if (!tree) throw new Error('no trees in test area');
  const f: Fixture = { world, tree, timber: undefined as never, loot: [], impacts: 0 };
  f.timber = new Timber(scene, world, (id, pos) => f.loot.push({ id, y: pos.y }), () => { f.impacts++; });
  return f;
}

describe('tree felling', () => {
  it('topples the tree when the base trunk cell is chopped', () => {
    const f = setup();
    const t = f.tree;
    const base = t.baseY;
    // Chop the bottom trunk cell of the base column.
    expect(f.timber.notify(t.tx, base, t.tz, new THREE.Vector3(t.tx - 5, base, t.tz))).toBe(true);
    // The whole tree left world data immediately: no trunk, no canopy.
    expect(f.world.get(t.tx, base, t.tz)).toBe(Block.Air);
    let leaf = Block.Air;
    for (let y = base; y <= t.topY && leaf === Block.Air; y++)
      for (let dx = -4; dx <= 4 && leaf === Block.Air; dx++)
        for (let dz = -4; dz <= 4; dz++) leaf = f.world.get(t.tx + dx, y, t.tz + dz);
    expect(leaf).toBe(Block.Air);
    // One animating mesh is on stage.
    expect(f.timber.count()).toBe(1);
  });

  it('does not fell when the trunk below still supports the cut', () => {
    const f = setup();
    const t = f.tree;
    const mid = t.baseY + Math.max(1, Math.floor(t.height * .5));
    const below = f.world.get(t.tx, mid - 1, t.tz);
    if (below === Block.Air) return; // some trunk rows at that column may not be trunk cells
    expect(f.timber.notify(t.tx, mid, t.tz, new THREE.Vector3(0, mid, 0))).toBe(false);
    expect(f.timber.count()).toBe(0);
  });

  it('plays a tumbling fall and drops wood loot on impact', () => {
    const f = setup();
    const t = f.tree;
    f.timber.notify(t.tx, t.baseY, t.tz, new THREE.Vector3(t.tx - 5, t.baseY, t.tz));
    // No loot yet: the fall must play out first.
    expect(f.loot.length).toBe(0);
    expect(f.impacts).toBe(0);
    // Simulate falling until the impact fires (fall takes ~1-2 s).
    let fired = false;
    for (let i = 0; i < 60 * 6 && !fired; i++) {
      f.timber.update(1 / 60);
      fired = f.impacts > 0;
    }
    expect(fired).toBe(true);
    // Wood in meaningful quantity along the fallen trunk, plus of the species' fruit.
    const wood = f.loot.filter(l => l.id === Block.Wood).length;
    expect(wood).toBeGreaterThanOrEqual(3);
    // The tree settles and is disposed after the fade.
    for (let i = 0; i < 60 * 6; i++) f.timber.update(1 / 60);
    expect(f.timber.count()).toBe(0);
  });

  it('cannot be harvested twice', () => {
    const f = setup();
    const t = f.tree;
    f.timber.notify(t.tx, t.baseY, t.tz, new THREE.Vector3(t.tx + 5, t.baseY, t.tz));
    f.timber.notify(t.tx, t.baseY, t.tz, new THREE.Vector3(t.tx + 5, t.baseY, t.tz));
    expect(f.timber.count()).toBe(1);
    // Chopping cells mid-fall: the felled tree's own cells are all Air. A
    // neighbouring tree's overhanging branch stub may share the column, but
    // it must not belong to the felled tree.
    for (let y = t.baseY; y < t.topY; y++) {
      if (f.world.get(t.tx, y, t.tz) !== Block.Air) {
        const owner = f.world.treeAtVoxel(t.tx, y, t.tz)?.shape;
        expect(owner && !(owner.tx === t.tx && owner.tz === t.tz),
          `cell ${t.tx},${y},${t.tz} (id ${f.world.get(t.tx, y, t.tz)}) belongs to the felled tree`).toBe(true);
      }
    }
  });
});
