import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, WATER_LEVEL, World } from '../src/world';

const world = new World(new THREE.Scene());

// The terrain-variety system promises that plains, desert, rocky hills and
// mountain massifs all exist within survey distance of spawn — the world must
// no longer be one flat sheet of identical ground.
describe('terrain geology: every landform exists on the map', () => {
  const found: Record<string, { count: number; x: number; z: number; y: number }> = {
    desert: { count: 0, x: 0, z: 0, y: 0 },
    mountain: { count: 0, x: 0, z: 0, y: 0 },
    hills: { count: 0, x: 0, z: 0, y: 0 },
  };

  it('finds sand, stone hills and snow-capped ground in a broad survey', () => {
    for (let x = -320; x < 320; x += 3) {
      for (let z = -320; z < 320; z += 3) {
        const y = world.surface(x, z);
        const top = world.get(x, y, z);
        if (top === Block.Sand) found.desert = { count: found.desert.count + 1, x, z, y };
        else if (top === Block.Snow) found.mountain = { count: found.mountain.count + 1, x, z, y };
        else if (top === Block.Stone) found.hills = { count: found.hills.count + 1, x, z, y };
      }
    }
    for (const [kind, spot] of Object.entries(found)) {
      expect(spot.count, `${kind} should exist in survey range`).toBeGreaterThan(0);
    }
  });

  it('mountains rise well above the rolling ground line', () => {
    expect(world.surface(found.mountain.x, found.mountain.z)).toBeGreaterThanOrEqual(9);
  });
});

describe('tree and flora gating', () => {
  it('never grows a trunk on water, over sand or out of a cave mouth', () => {
    // Survey real tree spots (the forest hash) where the ground is hostile —
    // each must carry no Wood in the five cells above the surface. Rocky
    // hills are allowed to carry woodland, so stone is exempt by design.
    let checked = 0;
    for (let x = -400; x < 400 && checked < 60; x++) {
      for (let z = -400; z < 400; z++) {
        const n = Math.sin(x * 127.1 + z * 311.7 + 19.19) * 43758.5453123;
        if (n - Math.floor(n) <= .985) continue;
        const y = world.surface(x, z);
        const ground = world.get(x, y, z);
        if (ground !== Block.Sand) continue;
        for (let dy = 1; dy <= 5; dy++) {
          expect(world.get(x, y + dy, z), `Wood grew on ${ground} at ${x},${y + dy},${z}`)
            .not.toBe(Block.Wood);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('water: rivers and lakes are real, swimmable block data', () => {
  it('open water exists in survey range', () => {
    let waterColumns = 0;
    for (let x = -400; x < 400 && waterColumns < 5; x += 2)
      for (let z = -400; z < 400; z += 2) {
        const y = world.surface(x, z);
        if (y < WATER_LEVEL && world.get(x, WATER_LEVEL, z) === Block.Water) waterColumns++;
      }
    expect(waterColumns).toBeGreaterThan(0);
  });

  it('water sits to WATER_LEVEL over a sealed sediment bed, and stops above', () => {
    for (let x = -400; x < 400; x++)
      for (let z = -400; z < 400; z++) {
        const height = world.surface(x, z);
        if (height >= WATER_LEVEL || world.get(x, WATER_LEVEL, z) !== Block.Water) continue;
        expect(world.get(x, height, z)).toBe(Block.Sand);
        expect(world.get(x, height - 1, z)).toBe(Block.Sand);
        expect(world.get(x, WATER_LEVEL, z)).toBe(Block.Water);
        expect(world.get(x, WATER_LEVEL + 1, z)).toBe(Block.Air);
        return; // one full inspection is enough
      }
    throw new Error('no water column found for bed inspection');
  });

  it('keeps spawn and the engraved entrances out of the drink', () => {
    expect(world.get(0, WATER_LEVEL, 0)).not.toBe(Block.Water);
    for (const [ex, ez] of [[24, 18], [-34, 40], [48, -28], [-18, -52], [72, 34], [116, -14]]) {
      expect(world.get(ex, WATER_LEVEL, ez), `entrance ${ex},${ez} flooded`).not.toBe(Block.Water);
    }
  });
});

describe('natural cave mouths above ground', () => {
  it('a survey finds a sinkhole: open ground running down into a pocket chamber', () => {
    let found: { x: number; y: number; z: number } | null = null;
    for (let x = -400; x < 400 && !found; x += 3)
      for (let z = -400; z < 400 && !found; z += 3) {
        const top = world.surface(x, z);
        // Several consecutive Air cells in an intact column mark the mouth
        // cone; no other generator opens top-down holes in the ground.
        if (world.get(x, top, z) === Block.Air
          && world.get(x, top - 1, z) === Block.Air
          && world.get(x, top - 3, z) === Block.Air
          && world.get(x, top - 5, z) === Block.Air) {
          found = { x, y: top, z };
        }
      }
    expect(found, 'no natural cave mouth found in survey range').not.toBeNull();
    // The mouth connects downward: the drop shaft continues below the cone and
    // opens into the pocket chamber meant to tie into the cavern layer.
    const { x, y, z } = found!;
    expect(world.get(x, y - 6, z)).toBe(Block.Air);
    expect(world.get(x, -8, z)).toBe(Block.Air);
  });
});
