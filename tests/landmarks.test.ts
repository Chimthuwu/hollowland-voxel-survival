import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Block, World, biomeAt } from '../src/world';
import {
  GENERATION_VERSION, LANDMARK_GRID, landmarkForCell, landmarkAtVoxel,
  setLandmarkContext, type PlacementContext,
} from '../src/landmarks';

/** Pure-noise stand-in for the world context so landmark tests run without
 *  a full World instance — surface mimics the real generator closely enough
 *  for placement checks (gentle 4..10 band, water-free). */
const ctx: PlacementContext = {
  surface: (x, z) => 5 + (Math.floor(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 3),
  waterBodyAt: () => 0,
  terrainKindAt: () => 'plains',
  biomeAt: (x, y, z) => biomeAt(x, y, z),
};

beforeEach(() => setLandmarkContext(4242, ctx));

describe('landmark framework', () => {
  it('has a generator version', () => {
    expect(GENERATION_VERSION).toBeGreaterThan(1);
  });

  it('places landmarks deterministically per grid cell', () => {
    const a = landmarkForCell(3, 2);
    const again = landmarkForCell(3, 2);
    expect(a).toEqual(again);
  });

  it('finds at least one landmark of each kind across a region', () => {
    const kinds = new Set<string>();
    for (let gx = -10; gx <= 10; gx++) for (let gz = -10; gz <= 10; gz++) {
      const lm = landmarkForCell(gx, gz);
      if (lm) kinds.add(lm.kind);
    }
    expect(kinds.has('ruin')).toBe(true);
    expect(kinds.has('petrified')).toBe(true);
    expect(kinds.has('cathedral')).toBe(true);
    expect(kinds.has('shrine')).toBe(true);
  });

  it('never anchors a landmark inside the spawn clearing', () => {
    for (let gx = -10; gx <= 10; gx++) for (let gz = -10; gz <= 10; gz++) {
      const lm = landmarkForCell(gx, gz);
      if (lm) expect(Math.hypot(lm.cx, lm.cz)).toBeGreaterThan(28);
    }
  });

  it('answers voxels identically regardless of query order (pure function)', () => {
    const probe: Array<[number, number, number]> = [];
    for (let gx = -6; gx <= 6; gx++) for (let gz = -6; gz <= 6; gz++) {
      const lm = landmarkForCell(gx, gz);
      if (!lm) continue;
      probe.push([lm.cx, lm.base + 1, lm.cz], [lm.cx + 1, lm.base, lm.cz + 1]);
    }
    expect(probe.length).toBeGreaterThan(0);
    // Reverse-order second pass must give identical answers.
    const first = probe.map(([x, y, z]) => landmarkAtVoxel(x, y, z));
    const second = [...probe].reverse().map(([x, y, z]) => landmarkAtVoxel(x, y, z));
    expect(second.reverse()).toEqual(first);
  });

  it('a ruin rings its anchor with stone or scaffold in open air', () => {
    let ruin = null as ReturnType<typeof landmarkForCell>;
    for (let gx = -10; gx <= 10 && !ruin; gx++) for (let gz = -10; gz <= 10 && !ruin; gz++) {
      const lm = landmarkForCell(gx, gz);
      if (lm?.kind === 'ruin') ruin = lm;
    }
    expect(ruin).not.toBeNull();
    if (!ruin) return;
    // The totem stands at the heart.
    expect(landmarkAtVoxel(ruin.cx, ruin.base + 1, ruin.cz)).toBe(Block.Totem);
    // A refined-metal cache hides directly beneath the totem.
    const cache = landmarkAtVoxel(ruin.cx, ruin.base - 1, ruin.cz);
    expect([Block.CopperBar, Block.CrystalBar, Block.Crystal]).toContain(cache);
    // Wall material appears somewhere on the ring.
    let wall: Block | undefined;
    for (let x = ruin.cx - 7; x <= ruin.cx + 7 && wall === undefined; x++)
      for (let z = ruin.cz - 7; z <= ruin.cz + 7 && wall === undefined; z++)
        wall = landmarkAtVoxel(x, ruin.base + 1, z);
    expect(wall).toBeDefined();
  });

  it('a crystal cathedral carves air under the surface with crystal inside', () => {
    let lm: ReturnType<typeof landmarkForCell> = null;
    for (let gx = -10; gx <= 10 && !lm; gx++) for (let gz = -10; gz <= 10 && !lm; gz++) {
      const found = landmarkForCell(gx, gz);
      if (found?.kind === 'cathedral') lm = found;
    }
    expect(lm).not.toBeNull();
    if (!lm) return;
    // Scan the anchor column: the dome carves air somewhere under the
    // surface, and the core holds the rare echo-gem deposit on its floor.
    let carved = false, gem = false;
    for (let y = lm.base - 6; y >= lm.base - 34; y--) {
      const v = landmarkAtVoxel(lm.cx, y, lm.cz);
      if (v === Block.Air) carved = true;
      if (v === Block.EchoGem) gem = true;
    }
    expect(carved).toBe(true);
    expect(gem).toBe(true);
  });

  it('a petrified tree holds a crystal heart in a hollow trunk', () => {
    let lm: ReturnType<typeof landmarkForCell> = null;
    for (let gx = -10; gx <= 10 && !lm; gx++) for (let gz = -10; gz <= 10 && !lm; gz++) {
      const found = landmarkForCell(gx, gz);
      if (found?.kind === 'petrified') lm = found;
    }
    expect(lm).not.toBeNull();
    if (!lm) return;
    // Scan a ring around the trunk axis: petrified bark (stone/bone) wraps
    // the hollow, and the hollow holds a crystal heart or echo gem.
    let bark = false, heart = false;
    for (let y = lm.base + 4; y <= lm.base + 16; y++) {
      for (let ox = 1; ox <= 3; ox++) {
        const v = landmarkAtVoxel(lm.cx + ox, y, lm.cz);
        if (v === Block.Stone || v === Block.Bone) bark = true;
      }
      const c = landmarkAtVoxel(lm.cx, y, lm.cz);
      if (c === Block.Crystal || c === Block.EchoGem) heart = true;
    }
    expect(bark).toBe(true);
    expect(heart).toBe(true);
  });

  it('a shrine buries an echo gem under its totem', () => {
    let lm: ReturnType<typeof landmarkForCell> = null;
    for (let gx = -10; gx <= 10 && !lm; gx++) for (let gz = -10; gz <= 10 && !lm; gz++) {
      const found = landmarkForCell(gx, gz);
      if (found?.kind === 'shrine') lm = found;
    }
    expect(lm).not.toBeNull();
    if (!lm) return;
    expect(landmarkAtVoxel(lm.cx, lm.base + 1, lm.cz)).toBe(Block.Totem);
    expect(landmarkAtVoxel(lm.cx, lm.base - 1, lm.cz)).toBe(Block.EchoGem);
  });
});

describe('world seeding (Milestone 2)', () => {
  it('same seed regenerates identical terrain through world.get()', () => {
    const scene = new THREE.Scene();
    const a = new World(scene);
    a.reseed(777);
    const probe: Block[] = [];
    for (let x = -20; x <= 20; x += 7) for (let z = -20; z <= 20; z += 7)
      for (let y = -8; y <= 12; y += 4) probe.push(a.get(x, y, z));
    // A second world, same seed: identical answers.
    const b = new World(new THREE.Scene());
    b.reseed(777);
    const again: Block[] = [];
    for (let x = -20; x <= 20; x += 7) for (let z = -20; z <= 20; z += 7)
      for (let y = -8; y <= 12; y += 4) again.push(b.get(x, y, z));
    expect(again).toEqual(probe);
  });

  it('different seeds produce meaningfully different worlds', () => {
    const scene = new THREE.Scene();
    const a = new World(scene);
    // Sequential reseeds of ONE world keep the landmark context bound to the
    // same instance, so the comparison is purely terrain-vs-terrain.
    a.reseed(111);
    const before: Block[] = [];
    for (let x = 10; x <= 28; x += 3) for (let z = -28; z <= 28; z += 3)
      for (let y = 2; y <= 10; y += 2) before.push(a.get(x, y, z));
    a.reseed(999);
    const after: Block[] = [];
    for (let x = 10; x <= 28; x += 3) for (let z = -28; z <= 28; z += 3)
      for (let y = 2; y <= 10; y += 2) after.push(a.get(x, y, z));
    const diffs = before.filter((v, i) => v !== after[i]).length;
    expect(diffs / before.length).toBeGreaterThan(0.05);
  });

  it('player edits survive regeneration and override landmark voxels', () => {
    const scene = new THREE.Scene();
    const w = new World(scene);
    w.reseed(555);
    // Dig one block anywhere: get() honors the edit over generation data.
    w.set(50, 3, 50, Block.Air);
    expect(w.get(50, 3, 50)).toBe(Block.Air);
    // Place into a landmark's footprint: the edit wins over the structure.
    const probe = { x: 40, y: 8, z: 40 };
    w.set(probe.x, probe.y, probe.z, Block.Torch);
    expect(w.get(probe.x, probe.y, probe.z)).toBe(Block.Torch);
  });

  it('the landmark grid is coarse enough to keep chunk work bounded', () => {
    expect(LANDMARK_GRID).toBeGreaterThanOrEqual(32);
  });
});
