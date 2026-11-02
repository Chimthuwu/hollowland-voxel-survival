import type { Biome } from './world';

/**
 * Per-biome tree archetypes. Each archetype describes a low-poly procedural
 * tree built from unit cubes; the output is appended directly into a chunk's
 * geometry attribute arrays so it costs exactly one extra draw call per chunk
 * (zero new Three.js Mesh objects).
 */
interface TreeArchetype {
  trunkHeight: number;
  canopySize: number;     // cube edge length of the canopy cluster
  canopyRadius: number;   // half-extent of canopy voxels around trunk top
  canopyFill: number;     // 0..1, density of canopy voxels
  trunkColor: [number, number, number];
  canopyColor: [number, number, number];
  branches: number;       // 0..4 short horizontal branches partway up
  lean: number;           // max horizontal lean at the trunk top, in blocks
  effect: number;         // shader effect id (0=none, 1=flesh, 2=glitch)
}

const ARCHETYPES: Record<Biome, TreeArchetype> = {
  overcast:  { trunkHeight: 5, canopySize: 3, canopyRadius: 2, canopyFill: .72, trunkColor: [0.29, 0.22, 0.18], canopyColor: [0.10, 0.13, 0.16], branches: 2, lean: .05, effect: 0 },
  storm:     { trunkHeight: 4, canopySize: 2, canopyRadius: 2, canopyFill: .55, trunkColor: [0.18, 0.14, 0.10], canopyColor: [0.08, 0.09, 0.11], branches: 1, lean: .22, effect: 0 },
  glitch:    { trunkHeight: 3, canopySize: 3, canopyRadius: 2, canopyFill: .85, trunkColor: [0.30, 0.22, 0.28], canopyColor: [0.52, 0.24, 0.55], branches: 3, lean: .03, effect: 2 },
  psychosis: { trunkHeight: 5, canopySize: 2, canopyRadius: 2, canopyFill: .60, trunkColor: [0.74, 0.69, 0.61], canopyColor: [0.62, 0.31, 0.35], branches: 2, lean: .06, effect: 1 },
  maw:       { trunkHeight: 4, canopySize: 3, canopyRadius: 2, canopyFill: .68, trunkColor: [0.55, 0.28, 0.30], canopyColor: [0.62, 0.31, 0.35], branches: 3, lean: .05, effect: 1 },
  // Underground / sky biomes don't grow trees.
  catacombs: { trunkHeight: 0, canopySize: 0, canopyRadius: 0, canopyFill: 0, trunkColor: [0, 0, 0], canopyColor: [0, 0, 0], branches: 0, lean: 0, effect: 0 },
  veins:     { trunkHeight: 0, canopySize: 0, canopyRadius: 0, canopyFill: 0, trunkColor: [0, 0, 0], canopyColor: [0, 0, 0], branches: 0, lean: 0, effect: 0 },
  sky:       { trunkHeight: 0, canopySize: 0, canopyRadius: 0, canopyFill: 0, trunkColor: [0, 0, 0], canopyColor: [0, 0, 0], branches: 0, lean: 0, effect: 0 },
};

// Mirrors world.ts face layout so flat shading and effect attributes stay consistent.
const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: .82 },
  { n: [-1, 0, 0], v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: .72 },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1 },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: .55 },
  { n: [0, 0, 1], v: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: .9 },
  { n: [0, 0, -1], v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: .65 },
];

const CHUNK_SIZE = 16;

export interface FoliageBuffers {
  positions: number[];
  normals: number[];
  tint: number[];
  effects: number[];
  indices: number[];
}

const hash = (x: number, z: number): number => {
  const n = Math.sin(x * 127.1 + z * 311.7 + 19.19) * 43758.5453123;
  return n - Math.floor(n);
};

function addCube(out: FoliageBuffers, x: number, y: number, z: number, r: number, g: number, b: number, effect: number): void {
  // Offset slightly off integer so tilted/adjacent cubes don't Z-fight with voxel faces.
  const ox = x + 1e-3, oy = y + 1e-3, oz = z + 1e-3;
  for (const face of FACES) {
    const base = out.positions.length / 3;
    for (const v of face.v) {
      out.positions.push(ox + v[0], oy + v[1], oz + v[2]);
      out.normals.push(face.n[0], face.n[1], face.n[2]);
      out.tint.push(r * face.shade, g * face.shade, b * face.shade);
      out.effects.push(effect);
    }
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function emitTree(out: FoliageBuffers, x: number, baseY: number, z: number, arch: TreeArchetype, seedX: number, seedZ: number): void {
  // Deterministic per-spot seeds so the same (x,z) always builds the same tree.
  const seedA = hash(seedX * 1.7 + 11, seedZ * 1.3 + 7);
  const seedB = hash(seedX * 0.7 + 23, seedZ * 2.1 + 5);
  const seedC = hash(seedX * 2.3 + 5, seedZ * 0.9 + 31);
  const leanDx = (seedA - .5) * 2 * arch.lean * arch.trunkHeight;
  const leanDz = (seedB - .5) * 2 * arch.lean * arch.trunkHeight;

  // Trunk: lean accumulates up the height; round to integer cells so we stay on the voxel grid.
  let tx = x, tz = z;
  for (let i = 0; i < arch.trunkHeight; i++) {
    const t = (i + 1) / arch.trunkHeight;
    tx = x + Math.round(leanDx * t);
    tz = z + Math.round(leanDz * t);
    addCube(out, tx, baseY + i, tz, arch.trunkColor[0], arch.trunkColor[1], arch.trunkColor[2], arch.effect);
  }

  // Short branches partway up the trunk, picking cardinal directions from seedA.
  for (let b = 0; b < arch.branches; b++) {
    const dir = Math.floor(hash(seedX + b * 7, seedZ + b * 13) * 4); // 0..3
    const by = baseY + Math.max(2, Math.floor(arch.trunkHeight * .6)) - 1;
    const dx = dir === 0 ? 1 : dir === 2 ? -1 : 0;
    const dz = dir === 1 ? 1 : dir === 3 ? -1 : 0;
    addCube(out, tx + dx, by, tz + dz, arch.trunkColor[0] * .9, arch.trunkColor[1] * .9, arch.trunkColor[2] * .9, arch.effect);
    addCube(out, tx + dx * 2, by + 1, tz + dz * 2, arch.canopyColor[0], arch.canopyColor[1], arch.canopyColor[2], arch.effect);
  }

  // Canopy: noisy cluster at the top; cheaper than branching leaves and reads better at distance.
  if (arch.canopySize <= 0) return;
  const top = baseY + arch.trunkHeight - 1;
  for (let dy = -1; dy < arch.canopySize - 1; dy++) {
    for (let dx = -arch.canopyRadius; dx <= arch.canopyRadius; dx++) {
      for (let dz = -arch.canopyRadius; dz <= arch.canopyRadius; dz++) {
        // Hollow out the corners and skip below the threshold for an organic silhouette.
        if (Math.abs(dx) === arch.canopyRadius && Math.abs(dz) === arch.canopyRadius) continue;
        if (Math.abs(dx) > arch.canopyRadius || Math.abs(dz) > arch.canopyRadius) continue;
        if (hash(seedX * 3 + dx + 100, seedZ * 5 + dy + 200 + dz) > arch.canopyFill) continue;
        addCube(out, tx + dx, top + dy, tz + dz, arch.canopyColor[0], arch.canopyColor[1], arch.canopyColor[2], arch.effect);
      }
    }
  }
}

/**
 * Appends foliage (trees) into a chunk's geometry buffers. Reads surface and
 * biome via the supplied callbacks so this module stays decoupled from the
 * World class. Cheap no-op for chunks that don't overlap the surface band.
 */
export function appendFoliage(
  out: FoliageBuffers,
  cx: number, cy: number, cz: number,
  surface: (x: number, z: number) => number,
  biomeOf: (x: number, y: number, z: number) => Biome,
): void {
  // Surface lives around y=4..11; only chunks intersecting that band can grow trees.
  if (cy * CHUNK_SIZE > 16 || (cy + 1) * CHUNK_SIZE < 0) return;

  const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const x = x0 + lx, z = z0 + lz;
      if (Math.abs(x) <= 10 && Math.abs(z) <= 10) continue; // protect spawn clarity
      if (hash(x, z) <= .985) continue;
      const height = surface(x, z);
      if (cy * CHUNK_SIZE > height + 12) continue;
      const biome = biomeOf(x, height, z);
      const arch = ARCHETYPES[biome];
      if (!arch || arch.trunkHeight === 0) continue;
      emitTree(out, x, height + 1, z, arch, x, z);
    }
  }
}
