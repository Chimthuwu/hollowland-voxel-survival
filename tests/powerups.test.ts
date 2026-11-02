import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, World } from '../src/world';
import { PowerUps, REDUCED_GRAVITY, trySpawnPlatform } from '../src/powerups';

describe('power-ups', () => {
  it('places gravity charm and platform seed in fixed underground cells', () => {
    const world = new World(new THREE.Scene());
    PowerUps.placeAll(world);
    let gravityFound = 0, platformFound = 0;
    for (let x = 0; x < 200; x++) for (let z = -50; z < 50; z++) {
      for (let y = -10; y <= 10; y++) {
        const id = world.get(x, y, z);
        if (id === Block.GravityCharm) gravityFound++;
        if (id === Block.PlatformSeed) platformFound++;
      }
    }
    expect(gravityFound).toBe(1);
    expect(platformFound).toBe(1);
    world.dispose();
  });

  it('picks up the gravity charm when the player walks into its cell', () => {
    const world = new World(new THREE.Scene());
    PowerUps.placeAll(world);
    const powerups = new PowerUps();
    // Charm sits at (48, 4, -30); player at the centre of that cell.
    const events = powerups.update(world, 48.5, 4.5, -29.5);
    expect(events).toContain('gravity');
    expect(powerups.hasGravity).toBe(true);
    expect(world.get(48, 5, -30)).toBe(Block.Air);
    world.dispose();
  });

  it('picks up the platform seed only once', () => {
    const world = new World(new THREE.Scene());
    PowerUps.placeAll(world);
    const powerups = new PowerUps();
    powerups.update(world, 116.5, 7.5, -15.5);
    expect(powerups.hasPlatform).toBe(true);
    const second = powerups.update(world, 116.5, 7.5, -15.5);
    expect(second).not.toContain('platform');
    world.dispose();
  });

  it('trySpawnPlatform places a scaffold underfoot if air, otherwise no-ops', () => {
    const world = new World(new THREE.Scene());
    // Player above the surface so the cell below feet is air.
    expect(trySpawnPlatform(world, 0.5, 8, 0.5)).toBe(true);
    expect(world.get(0, 7, 0)).toBe(Block.Scaffold);
    // Second call into the same solid cell must be a no-op.
    expect(trySpawnPlatform(world, 0.5, 8, 0.5)).toBe(false);
    world.dispose();
  });

  it('exports a sane reduced-gravity constant', () => {
    expect(REDUCED_GRAVITY).toBeGreaterThan(0);
    expect(REDUCED_GRAVITY).toBeLessThan(1);
  });
});
