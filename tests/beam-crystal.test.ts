import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, World } from '../src/world';
import { BeamWeapon } from '../src/beam';
import { BlockDamage } from '../src/blockDamage';
import { Inventory } from '../src/ui';

describe('crystal ore + beam weapon', () => {
  it('places crystal ore in the deep stone layer', () => {
    const world = new World(new THREE.Scene());
    let crystalCount = 0;
    for (let x = -32; x < 32; x += 2) for (let z = -32; z < 32; z += 2) {
      for (let y = -8; y >= -30; y -= 2) {
        if (world.get(x, y, z) === Block.Crystal) crystalCount++;
      }
    }
    expect(crystalCount).toBeGreaterThan(0);
    world.dispose();
  });

  it('does not place crystal ore near the surface', () => {
    const world = new World(new THREE.Scene());
    let surfaceCrystal = 0;
    for (let x = -32; x < 32; x += 2) for (let z = -32; z < 32; z += 2) {
      for (let y = -2; y >= -7; y -= 2) {
        if (world.get(x, y, z) === Block.Crystal) surfaceCrystal++;
      }
    }
    expect(surfaceCrystal).toBe(0);
    world.dispose();
  });

  it('crafts the beam weapon from five crystals and is one-shot', () => {
    const inventory = new Inventory();
    inventory.add(Block.Crystal, 5);
    expect(inventory.craft('beam')).toBe(true);
    expect(inventory.beam).toBe(true);
    inventory.add(Block.Crystal, 5);
    expect(inventory.craft('beam')).toBe(false);
  });

  it('beam weapon breaks a block after sustained fire', () => {
    const scene = new THREE.Scene();
    const world = new World(scene);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    camera.position.set(0.5, 100.5, 0.5);
    camera.lookAt(0, 100, -5);
    const beam = new BeamWeapon(scene, world, camera, new BlockDamage(scene));
    world.set(0, 100, -1, Block.Stone);
    beam.setMouse(true);
    const origin = new THREE.Vector3(0.5, 100.5, 0.5);
    const dir = new THREE.Vector3(0, 0, -1);
    const broken: Block[] = [];
    // 80 dps vs 60 hp stone = 0.75s. Tick 1s in 16ms steps.
    for (let i = 0; i < 80; i++) {
      const id = beam.update(1 / 60, origin, dir, 6, (bid) => broken.push(bid), 3, 1);
      if (id !== null) break;
    }
    expect(broken).toContain(Block.Stone);
    expect(world.get(0, 100, -1)).toBe(Block.Air);
    beam.dispose();
    world.dispose();
  });
});
