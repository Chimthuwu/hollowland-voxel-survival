import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, World } from '../src/world';
import { Chisel } from '../src/chisel';
import {
  applyShape, createProfile, MICRO_COLUMNS, MICRO_LEVELS, runs,
} from '../src/micro';

/** A hit on the +X face of a block, as the world raycast would produce it. */
const hitOnEastFace = (x: number, y: number, z: number) => ({
  x, y, z,
  previous: { x: x - 1, y, z },
  id: Block.Stone,
  distance: 1,
});

describe('microblock profiles', () => {
  it('starts fully solid and can be emptied', () => {
    const profile = createProfile();
    expect(profile.column(0, 0)).toBe(0xffff);
    profile.setColumn(0, 0, 0);
    expect(profile.column(0, 0)).toBe(0);
    expect(profile.isEmpty()).toBe(false);
    for (let i = 0; i < MICRO_COLUMNS * MICRO_COLUMNS; i++) profile.setColumn(i % MICRO_COLUMNS, Math.floor(i / MICRO_COLUMNS), 0);
    expect(profile.isEmpty()).toBe(true);
  });

  it('splits a mask into vertical runs of solid levels', () => {
    expect(runs(0xffff)).toEqual([[0, MICRO_LEVELS]]);
    expect(runs(0x000f)).toEqual([[0, 4]]);
    expect(runs(0x00ff)).toEqual([[0, 8]]);
    // Two separate bands with a gap between them.
    expect(runs(0x000f | 0xf000)).toEqual([[0, 4], [12, 16]]);
    expect(runs(0)).toEqual([]);
  });

  it('stamps shapes that are readable silhouettes', () => {
    const windowed = createProfile();
    applyShape(windowed, 'window');
    // The middle columns must have a hole through the middle levels.
    expect(windowed.column(3, 3)).not.toBe(0xffff);
    expect(windowed.column(0, 0)).toBe(0xffff);

    const pillar = createProfile();
    applyShape(pillar, 'pillar');
    expect(pillar.column(3, 3)).toBe(0xffff);
    expect(pillar.column(0, 0)).toBe(0);

    const arch = createProfile();
    applyShape(arch, 'arch');
    // The doorway is open at the bottom but solid at the lintel.
    expect(arch.column(3, 3) & 0x0001).toBe(0);
    expect(arch.column(3, 3) & 0x8000).toBe(0x8000);

    const slab = createProfile();
    applyShape(slab, 'slab');
    expect(slab.column(4, 4)).toBe(0x00ff);
  });
});

describe('chisel', () => {
  it('carves a single sub-cell and restores it on a second click', () => {
    const world = new World(new THREE.Scene());
    world.set(4, 40, 4, Block.Stone);
    const chisel = new Chisel(world);
    const hit = hitOnEastFace(4, 40, 4);

    const before = world.microAt(4, 40, 4);
    expect(before).toBeUndefined();

    const carved = chisel.carve(hit);
    expect(carved.action).toBe('carved');
    const profile = world.microAt(4, 40, 4);
    expect(profile).toBeDefined();
    // The point is on the +X face, so the carved column is the east-most one.
    const column = profile!.column(MICRO_COLUMNS - 1, 4);
    expect(column).not.toBe(0xffff);
    // Exactly one 1/16 sliver was removed: the bit count drops by one.
    const solidBits = (m: number) => { let n = 0; for (let i = 0; i < MICRO_LEVELS; i++) if (m & (1 << i)) n++; return n; };
    expect(solidBits(column)).toBe(MICRO_LEVELS - 1);

    const restored = chisel.carve(hit);
    expect(restored.action).toBe('restored');
    expect(world.microAt(4, 40, 4)!.column(MICRO_COLUMNS - 1, 4)).toBe(0xffff);
    world.dispose();
  });

  it('stamps a whole shape onto the block', () => {
    const world = new World(new THREE.Scene());
    world.set(4, 40, 4, Block.Stone);
    const chisel = new Chisel(world);
    chisel.shape = 'pillar';
    const result = chisel.stamp(hitOnEastFace(4, 40, 4));
    expect(result.action).toBe('stamped');
    const profile = world.microAt(4, 40, 4)!;
    expect(profile.column(3, 3)).toBe(0xffff);
    expect(profile.column(0, 0)).toBe(0);
    world.dispose();
  });

  it('cycles through every stamp shape', () => {
    const world = new World(new THREE.Scene());
    const chisel = new Chisel(world);
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) { seen.add(chisel.shapeLabel); chisel.cycleShape(); }
    expect(seen.size).toBe(6);
    world.dispose();
  });

  it('refuses to carve functional blocks and air', () => {
    const world = new World(new THREE.Scene());
    world.set(4, 40, 4, Block.Torch);
    const chisel = new Chisel(world);
    expect(chisel.carve(hitOnEastFace(4, 40, 4)).action).toBe('missed');
    expect(world.microAt(4, 40, 4)).toBeUndefined();
    world.dispose();
  });

  it('previews the exact sub-cell that would be removed', () => {
    const world = new World(new THREE.Scene());
    world.set(4, 40, 4, Block.Stone);
    const chisel = new Chisel(world);
    const preview = chisel.preview(hitOnEastFace(4, 40, 4));
    expect(preview).not.toBeNull();
    // The preview sits inside the block and is a fraction of a block wide.
    expect(preview!.x).toBeGreaterThanOrEqual(4);
    expect(preview!.x).toBeLessThan(5);
    expect(preview!.sx).toBeLessThan(0.2);
    expect(preview!.sy).toBeLessThan(0.1);
    world.dispose();
  });

  it('clears carving when the block is mined away', () => {
    const world = new World(new THREE.Scene());
    world.set(4, 40, 4, Block.Stone);
    const chisel = new Chisel(world);
    chisel.carve(hitOnEastFace(4, 40, 4));
    expect(world.microAt(4, 40, 4)).toBeDefined();
    chisel.clear(4, 40, 4);
    expect(world.microAt(4, 40, 4)).toBeUndefined();
    world.dispose();
  });
});
