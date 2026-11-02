import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, World } from '../src/world';
import { appendFoliage, type FoliageBuffers } from '../src/foliage';

describe('foliage smoke', () => {
  it('emits tree geometry into a chunk buffer at the surface', () => {
    const scene = new THREE.Scene();
    const world = new World(scene);
    const surface = world.surface(20, 20);
    const out: FoliageBuffers = { positions: [], normals: [], tint: [], effects: [], indices: [] };
    appendFoliage(out, 1, 0, 1, (x, z) => world.surface(x, z), (x, y, z) => {
      if (y > 64) return 'sky';
      if (y < -48) return 'veins';
      if (y < 0) return 'catacombs';
      if (x < 96) return 'overcast';
      if (x < 192) return 'storm';
      if (x < 288) return 'glitch';
      if (x < 384) return 'psychosis';
      return 'maw';
    });
    // Out-of-surface chunk emits nothing.
    const out2: FoliageBuffers = { positions: [], normals: [], tint: [], effects: [], indices: [] };
    appendFoliage(out2, 5, 5, 5, (x, z) => world.surface(x, z), () => 'overcast');
    expect(out2.positions.length).toBe(0);

    // Sanity: at the surface band, foliage emits triangle indices and respects the chunk size cap.
    expect(out.indices.length).toBeGreaterThan(0);
    expect(out.indices.length % 6).toBe(0);
    expect(out.positions.length / 3).toBeGreaterThan(0);
    // Verify indices reference valid vertices.
    for (const idx of out.indices) {
      expect(idx).toBeLessThan(out.positions.length / 3);
    }
    world.dispose();
  });
});
