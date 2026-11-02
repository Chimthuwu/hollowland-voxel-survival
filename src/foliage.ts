import type { Biome } from './world';

/**
 * Per-biome tree archetypes. Each archetype describes a low-poly procedural
 * tree built from boxes of arbitrary size; the output is appended directly
 * into a chunk's geometry attribute arrays so all trees in a chunk cost one
 * extra draw call (zero new Three.js Mesh objects).
 */
type TreeStyle = 'conifer' | 'windswept' | 'corrupted' | 'weeping' | 'stalk';

interface TreeArchetype {
  style: TreeStyle;
  trunkHeight: number;
  /** Full trunk width at the base and at the top. */
  trunkWidth: [number, number];
  /** Max horizontal lean at the trunk top, in blocks. */
  lean: number;
  trunkColor: [number, number, number];
  canopyColor: [number, number, number];
  accentColor: [number, number, number];
  /** Small fruits hung from the canopy edge (overcast sky-blue fruit). */
  fruitColor?: [number, number, number];
  /** Per-cube color variation amount (0..1). */
  jitter: number;
  /** Shader effect id (0=none, 1=flesh, 2=glitch). */
  effect: number;
}

const ARCHETYPES: Record<Biome, TreeArchetype | null> = {
  // Default biome: gray trunks, lavender leaves, sky-blue fruit — overcast but not monochrome.
  overcast:  { style: 'conifer',   trunkHeight: 6, trunkWidth: [.6, .32], lean: .06, trunkColor: [.40, .40, .42], canopyColor: [.60, .50, .78], accentColor: [.74, .66, .90], fruitColor: [.42, .74, .96], jitter: .05,  effect: 0 },
  storm:     { style: 'windswept', trunkHeight: 4, trunkWidth: [.55, .38], lean: .45, trunkColor: [.17, .14, .115], canopyColor: [.10, .125, .11], accentColor: [.14, .155, .14], jitter: .035, effect: 0 },
  glitch:    { style: 'corrupted', trunkHeight: 3, trunkWidth: [.62, .45], lean: 0,   trunkColor: [.28, .20, .26], canopyColor: [.50, .22, .55], accentColor: [.35, .90, .82], jitter: .05,  effect: 2 },
  psychosis: { style: 'weeping',   trunkHeight: 5, trunkWidth: [.5, .3],   lean: 0,   trunkColor: [.71, .66, .58], canopyColor: [.55, .14, .19], accentColor: [.72, .28, .25], jitter: .04,  effect: 1 },
  maw:       { style: 'stalk',     trunkHeight: 4, trunkWidth: [.72, .46], lean: .08, trunkColor: [.48, .23, .25], canopyColor: [.52, .15, .17], accentColor: [.82, .38, .32], jitter: .05,  effect: 1 },
  // Underground / sky biomes don't grow trees.
  catacombs: null,
  veins:     null,
  sky:       null,
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

/** Deterministic per-cube color jitter so canopies never look flat-shaded uniform. */
function jitterC(c: readonly [number, number, number], amt: number, sx: number, sz: number, y: number): [number, number, number] {
  if (amt <= 0) return [c[0], c[1], c[2]];
  const j = (k: number) => 1 + (hash(sx * 3.1 + k * 7.7 + y * 1.3, sz * 5.3 + k * 3.3 + y * 2.1) - .5) * 2 * amt;
  return [c[0] * j(0), c[1] * j(1), c[2] * j(2)];
}

/** Emits an arbitrarily sized box; vertices are nudged 1e-3 along each face normal so decorations never Z-fight voxel faces. */
function addBox(out: FoliageBuffers, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, r: number, g: number, b: number, effect: number): void {
  const o = 1e-3;
  for (const face of FACES) {
    const base = out.positions.length / 3;
    for (const v of face.v) {
      out.positions.push(cx + (v[0] - .5) * sx + face.n[0] * o, cy + (v[1] - .5) * sy + face.n[1] * o, cz + (v[2] - .5) * sz + face.n[2] * o);
      out.normals.push(face.n[0], face.n[1], face.n[2]);
      out.tint.push(r * face.shade, g * face.shade, b * face.shade);
      out.effects.push(effect);
    }
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** Small root flares at the base so trunks don't look like poles stuck in the ground. */
function emitRootFlare(out: FoliageBuffers, x: number, baseY: number, z: number, a: TreeArchetype, seedX: number, seedZ: number): void {
  for (let r = 0; r < 2; r++) {
    const dir = Math.floor(hash(seedX * 9 + r * 17, seedZ * 7 + r * 29) * 4);
    const dx = dir === 0 ? 1 : dir === 2 ? -1 : 0;
    const dz = dir === 1 ? 1 : dir === 3 ? -1 : 0;
    const c = jitterC(a.trunkColor, .05, seedX + r, seedZ - r, -1);
    addBox(out, x + .5 + dx * .55, baseY + .18, z + .5 + dz * .55, .6, .44, .6, c[0] * .85, c[1] * .85, c[2] * .85, a.effect);
  }
}

/** Overcast: gaunt black spruce — tapered trunk, stacked shrinking canopy layers. */
function emitConifer(out: FoliageBuffers, x: number, baseY: number, z: number, a: TreeArchetype, seedX: number, seedZ: number): void {
  const h = a.trunkHeight;
  for (let i = 0; i < h; i++) {
    const t = h > 1 ? i / (h - 1) : 0;
    const w = a.trunkWidth[0] + (a.trunkWidth[1] - a.trunkWidth[0]) * t;
    const c = jitterC(a.trunkColor, a.jitter, seedX, seedZ, i);
    addBox(out, x + .5, baseY + i + .5, z + .5, w, 1.02, w, c[0], c[1], c[2], a.effect);
  }
  emitRootFlare(out, x, baseY, z, a, seedX, seedZ);
  const layers = 4, start = Math.floor(h * .4);
  for (let l = 0; l < layers; l++) {
    const frac = l / (layers - 1);
    const ly = baseY + start + l;
    const radius = 2.3 - frac * 1.9;
    const fill = .8 - frac * .18;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const wob = (hash(seedX * 3 + dx * 7 + l * 13, seedZ * 5 + dz * 11 + l * 3) - .5) * .9;
      if (Math.hypot(dx, dz) + wob > radius) continue;
      if (hash(seedX + dx * 3 + l * 7, seedZ + dz * 5 - l * 11) > fill) continue;
      const palette = l === layers - 1 ? a.accentColor : a.canopyColor;
      const c = jitterC(palette, a.jitter, seedX + dx, seedZ + dz, l);
      addBox(out, x + .5 + dx, ly + .5, z + .5 + dz, 1.05, 1, 1.05, c[0], c[1], c[2], a.effect);
    }
  }
  // Spire tip above the top layer.
  const tip = jitterC(a.accentColor, a.jitter, seedX, seedZ, 99);
  addBox(out, x + .5, baseY + h + .2, z + .5, .35, 1.6, .35, tip[0], tip[1], tip[2], a.effect);
  // Small fruits hang beneath the lower canopy edge (not every tree is laden).
  if (a.fruitColor) {
    for (let f = 0; f < 4; f++) {
      if (hash(seedX * 4.7 + f * 13, seedZ * 6.1 + f * 7) < .4) continue;
      const ang = hash(seedX + f * 3, seedZ * 5 + f * 11) * Math.PI * 2;
      const rr = 1.1 + hash(seedX * 2 + f, seedZ * 3 + f * 7) * 1.2;
      const fx = Math.round(Math.cos(ang) * rr), fz = Math.round(Math.sin(ang) * rr);
      const c = jitterC(a.fruitColor, a.jitter, seedX + f, seedZ - f, 7);
      addBox(out, x + .5 + fx, baseY + start + .55, z + .5 + fz, .3, .3, .3, c[0], c[1], c[2], 0);
    }
  }
}

/** Storm: windswept stub — accelerating lean, one flat canopy stretched downwind. */
function emitWindswept(out: FoliageBuffers, x: number, baseY: number, z: number, a: TreeArchetype, seedX: number, seedZ: number): void {
  const h = a.trunkHeight;
  const dir = Math.floor(hash(seedX * 1.3 + 5, seedZ * 2.7 + 9) * 4);
  const wx = dir === 0 ? 1 : dir === 2 ? -1 : 0;
  const wz = dir === 1 ? 1 : dir === 3 ? -1 : 0;
  const strength = .5 + hash(seedX * .9, seedZ * 1.7) * .5;
  let tx = x, tz = z;
  for (let i = 0; i < h; i++) {
    const t = (i + 1) / h;
    const shift = Math.round(t * t * h * a.lean * strength * 2);
    tx = x + wx * shift; tz = z + wz * shift;
    const w = a.trunkWidth[0] + (a.trunkWidth[1] - a.trunkWidth[0]) * t;
    const c = jitterC(a.trunkColor, a.jitter, seedX, seedZ, i);
    addBox(out, tx + .5, baseY + i + .5, tz + .5, w, 1.02, w, c[0], c[1], c[2], a.effect);
  }
  emitRootFlare(out, x, baseY, z, a, seedX, seedZ);
  // One stub branch on the windward side.
  const stub = jitterC(a.trunkColor, a.jitter, seedX, seedZ, h);
  addBox(out, x - wx + .5, baseY + Math.floor(h * .6) + .5, z - wz + .5, .8, .28, .8, stub[0] * .9, stub[1] * .9, stub[2] * .9, a.effect);
  // Flat, sheared canopy swept 1.5 cells downwind of the trunk top.
  const topY = baseY + h - 1;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const along = wx !== 0 ? Math.abs(dx) : Math.abs(dz);
    const cross = wx !== 0 ? Math.abs(dz) : Math.abs(dx);
    const wob = (hash(seedX * 3 + dx * 7, seedZ * 5 + dz * 11) - .5) * .8;
    if (Math.hypot(along * .55, cross * .85) + wob > 1.9) continue;
    if (hash(seedX + dx * 3, seedZ + dz * 5) > .62) continue;
    const drop = along >= 2 ? 1 : 0; // trailing edge droops a cell
    const c = jitterC(a.canopyColor, a.jitter, seedX + dx, seedZ + dz, 3);
    addBox(out, tx + .5 + dx + wx * 1.5, topY + .5 - drop, tz + .5 + dz + wz * 1.5, 1.05, 1, 1.05, c[0], c[1], c[2], a.effect);
  }
}

/** Glitch: a tree mid-corruption — jittering trunk, hollow angular frames, floating detached cubes. */
function emitCorrupted(out: FoliageBuffers, x: number, baseY: number, z: number, a: TreeArchetype, seedX: number, seedZ: number): void {
  const h = a.trunkHeight;
  for (let i = 0; i < h; i++) {
    const shift = hash(seedX + i * 3.7, seedZ - i * 2.9) > .6 ? (hash(seedX, seedZ * 3 + i) > .5 ? 1 : -1) : 0;
    const w = a.trunkWidth[0] + (a.trunkWidth[1] - a.trunkWidth[0]) * (i / Math.max(1, h - 1));
    const c = jitterC(a.trunkColor, a.jitter, seedX, seedZ, i);
    addBox(out, x + .5 + shift, baseY + i + .5, z + .5, w, 1.02, w, c[0], c[1], c[2], a.effect);
  }
  const top = baseY + h - 1;
  // Two stacked hollow square frames instead of an organic blob.
  for (let l = 0; l < 2; l++) {
    const r = 2 - l;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
      if (hash(seedX * 2 + dx, seedZ * 2 + dz + l) > .8) continue;
      const c = jitterC(a.canopyColor, a.jitter, seedX + dx, seedZ + dz, l);
      addBox(out, x + .5 + dx, top + l + .5, z + .5 + dz, 1.03, 1, 1.03, c[0], c[1], c[2], a.effect);
    }
  }
  // Detached cubes hovering around the crown.
  for (let f = 0; f < 3; f++) {
    const fx = Math.round((hash(seedX * 7 + f, seedZ + f * 3) - .5) * 4);
    const fy = top + 2 + Math.floor(hash(seedX + f * 11, seedZ * 5 + f) * 3);
    const fz = Math.round((hash(seedX * 3, seedZ * 9 + f * 5) - .5) * 4);
    const palette = hash(seedX + f, seedZ - f) > .5 ? a.accentColor : a.canopyColor;
    const c = jitterC(palette, a.jitter, seedX + f, seedZ + f, fy);
    addBox(out, x + .5 + fx, fy + .5, z + .5 + fz, .5, .5, .5, c[0], c[1], c[2], a.effect);
  }
}

/** Psychosis: pale twisting bone trunk, dense red crown with strands that hang and drip. */
function emitWeeping(out: FoliageBuffers, x: number, baseY: number, z: number, a: TreeArchetype, seedX: number, seedZ: number): void {
  const h = a.trunkHeight;
  let tx = x, tz = z;
  for (let i = 0; i < h; i++) {
    // The trunk corkscrews as it rises.
    tx = x + Math.round(Math.cos(i * 1.15) * .7);
    tz = z + Math.round(Math.sin(i * .95) * .7);
    const w = a.trunkWidth[0] + (a.trunkWidth[1] - a.trunkWidth[0]) * (i / Math.max(1, h - 1));
    const c = jitterC(a.trunkColor, a.jitter, seedX, seedZ, i);
    addBox(out, tx + .5, baseY + i + .5, tz + .5, w, 1.02, w, c[0], c[1], c[2], a.effect);
  }
  emitRootFlare(out, x, baseY, z, a, seedX, seedZ);
  const top = baseY + h - 1;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (hash(seedX + dx * 7, seedZ + dz * 5) > .85) continue;
    const c = jitterC(a.canopyColor, a.jitter, seedX + dx, seedZ + dz, 0);
    addBox(out, tx + .5 + dx, top + .5, tz + .5 + dz, 1.05, 1.05, 1.05, c[0], c[1], c[2], a.effect);
    // Hanging strands of canopy from the crown.
    const hang = Math.floor(1 + hash(seedX * 3 + dx, seedZ * 7 + dz) * 2);
    for (let s = 1; s <= hang; s++) {
      const sc = jitterC(a.accentColor, a.jitter, seedX + dx + s, seedZ + dz, s);
      addBox(out, tx + .5 + dx, top + .5 - s, tz + .5 + dz, .45, 1, .45, sc[0], sc[1], sc[2], a.effect);
    }
  }
}

/** Maw: fleshy stalk with a lumpy bulbous canopy shot through with brighter veins. */
function emitStalk(out: FoliageBuffers, x: number, baseY: number, z: number, a: TreeArchetype, seedX: number, seedZ: number): void {
  const h = a.trunkHeight;
  const leanX = (hash(seedX * 1.7, seedZ) - .5) * 2 * a.lean * h;
  const leanZ = (hash(seedX, seedZ * 2.3) - .5) * 2 * a.lean * h;
  let tx = x, tz = z;
  for (let i = 0; i < h; i++) {
    const t = (i + 1) / h;
    tx = x + Math.round(leanX * t); tz = z + Math.round(leanZ * t);
    const w = a.trunkWidth[0] + (a.trunkWidth[1] - a.trunkWidth[0]) * t;
    const c = jitterC(a.trunkColor, a.jitter, seedX, seedZ, i);
    addBox(out, tx + .5, baseY + i + .5, tz + .5, w, 1.02, w, c[0], c[1], c[2], a.effect);
  }
  emitRootFlare(out, x, baseY, z, a, seedX, seedZ);
  const top = baseY + h;
  for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
    const d = Math.hypot(dx, dy * .9, dz) + (hash(seedX * 3 + dx, seedZ * 5 + dz + dy) - .5) * .9;
    if (d > 2.1) continue;
    if (hash(seedX + dx * 3 + dy, seedZ + dz * 3 - dy) > .68) continue;
    const vein = hash(seedX * 1.1 + dx, seedZ * .7 + dz) > .84;
    const palette = vein ? a.accentColor : a.canopyColor;
    const c = jitterC(palette, a.jitter, seedX + dx, seedZ + dz, dy);
    addBox(out, tx + .5 + dx, top + dy + .5, tz + .5 + dz, 1.02, 1.02, 1.02, c[0], c[1], c[2], a.effect);
  }
}

function emitTree(out: FoliageBuffers, x: number, baseY: number, z: number, a: TreeArchetype, seedX: number, seedZ: number): void {
  // Deterministic per-spot seeds so the same (x,z) always builds the same tree.
  switch (a.style) {
    case 'conifer':   return emitConifer(out, x, baseY, z, a, seedX, seedZ);
    case 'windswept': return emitWindswept(out, x, baseY, z, a, seedX, seedZ);
    case 'corrupted': return emitCorrupted(out, x, baseY, z, a, seedX, seedZ);
    case 'weeping':   return emitWeeping(out, x, baseY, z, a, seedX, seedZ);
    case 'stalk':     return emitStalk(out, x, baseY, z, a, seedX, seedZ);
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
      const baseY = height + 1;
      // Only the chunk containing the trunk base owns the tree; the old
      // height+12 gate let the chunk above emit every tree a second time,
      // doubling vertex cost and causing exact-overlap z-fighting.
      if (baseY < cy * CHUNK_SIZE || baseY >= (cy + 1) * CHUNK_SIZE) continue;
      const biome = biomeOf(x, height, z);
      const arch = ARCHETYPES[biome];
      if (!arch) continue;
      emitTree(out, x, baseY, z, arch, x, z);
    }
  }
}
