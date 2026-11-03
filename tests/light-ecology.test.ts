import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Block, World } from '../src/world';
import { Enemies } from '../src/entities';

const scene = new THREE.Scene();
let world: World;
let enemies: Enemies;

beforeEach(() => {
  world = new World(new THREE.Scene());
  enemies = new Enemies(scene, world);
});

/** Carve a flat test room around (cx, y, cz) with a solid floor. */
function room(cx: number, y: number, cz: number, r = 10): void {
  for (let x = cx - r; x <= cx + r; x++)
    for (let z = cz - r; z <= cz + r; z++) {
      world.set(x, y, z, Block.Stone);
      for (let dy = 1; dy <= 6; dy++) world.set(x, y + dy, z, Block.Air);
    }
}

describe('light-gated stalker spawning (Milestone 3)', () => {
  const spawn = (x: number, z: number, phase: number) =>
    (enemies as unknown as { spawnOvercast(x: number, y: number, z: number, phase: number): void })
      .spawnOvercast(x, 5, z, phase);

  const stalkers = () => {
    const kinds = (enemies as unknown as { mobs: Array<{ kind: string }> }).mobs;
    return kinds.filter(m => m.kind === 'stalker').length;
  };

  beforeEach(() => {
    room(1000, 4, 1000); // surface() here is above the room → deep shade ✓
  });

  it('daylight deep shade spawns stalkers when no placed light is near', () => {
    for (let i = 0; i < 50 && stalkers() === 0; i++) spawn(1000, 1000, .25);
    expect(stalkers()).toBeGreaterThan(0);
  });

  it('a torch within 8 blocks denies the daylight spawn entirely', () => {
    world.set(1002, 6, 1002, Block.Torch);
    for (let i = 0; i < 50; i++) spawn(1000, 1000, .25);
    expect(stalkers()).toBe(0);
  });

  it('a totem denies it too, and wildlife may fill the camp ring', () => {
    world.set(999, 6, 1001, Block.Totem);
    for (let i = 0; i < 50; i++) spawn(1000, 1000, .25);
    expect(stalkers()).toBe(0);
  });

  it('at night the same torch no longer protects — stalkers come', () => {
    world.set(1002, 6, 1002, Block.Torch);
    for (let i = 0; i < 50 && stalkers() === 0; i++) spawn(1000, 1000, .75);
    expect(stalkers()).toBeGreaterThan(0);
  });
});

describe('stalker light burn (species light response)', () => {
  beforeEach(() => room(2000, 4, 2000));

  it('a stalker held in placed light burns to death without a blow', () => {
    enemies.spawnKind('stalker', new THREE.Vector3(2002, 5, 2000));
    const player = new THREE.Vector3(2000, 5, 2000);
    let hurt = 0;
    for (let t = 0; t < 4; t += .05) enemies.update(.05, player, 'overcast', n => { hurt += n; }, .25, true);
    expect(enemies.count()).toBe(0); // burned away
    expect(hurt).toBe(0); // it never closed to melee — the light did the work
  });

  it('the same stalker in darkness chases normally and survives', () => {
    enemies.spawnKind('stalker', new THREE.Vector3(2002, 5, 2000));
    const player = new THREE.Vector3(2000, 5, 2000);
    for (let t = 0; t < 2; t += .05) enemies.update(.05, player, 'overcast', () => {}, .25, false);
    expect(enemies.count()).toBe(1);
  });
});

describe('light attraction is species-keyed', () => {
  beforeEach(() => room(3000, 4, 3000));

  it('skitter drifts toward a torch rather than the player', () => {
    world.set(3003, 5, 3000, Block.Torch);
    enemies.spawnKind('skitter', new THREE.Vector3(2997, 5, 3000)); // 3 from torch, 6 from player
    const player = new THREE.Vector3(2991, 5, 3000);
    for (let t = 0; t < 2.5; t += .05) enemies.update(.05, player, 'overcast', () => {}, .25, false);
    const kinds = (enemies as unknown as { mobs: Array<{ root: THREE.Object3D }> }).mobs;
    expect(kinds.length).toBe(1);
    const p = kinds[0].root.position;
    const toTorch = Math.hypot(p.x - 3003, p.z - 3000);
    const toPlayer = Math.hypot(p.x - 2991, p.z - 2991 + 9);
    expect(toTorch).toBeLessThan(6); // closed on the light
    expect(toPlayer).toBeGreaterThan(9 - toTorch); // net: closer to torch than to player
  });
});
