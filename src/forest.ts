import type { Biome } from './world';

/**
 * Deterministic voxel trees.
 *
 * Trees are plain voxel data: trunk cells (Wood/Glitch/Bone/Flesh by biome),
 * wide Leaf canopies and — in the default biome — hanging Skyfruit blocks.
 * Because canopy cells come from world.get(), leaves are solid, mineable and
 * collidable for free, and the felling system can animate the exact same cell
 * set that chunk meshing renders.
 *
 * This module is pure and dependency-free: it never imports world at runtime
 * (type-only import), so a World instance decides WHEN to ask about trees.
 */

export type TreeCell = { kind: 'trunk' | 'leaf' | 'fruit'; accent: boolean };

export interface TreeShape {
  tx: number;
  tz: number;
  /** Ground level under the trunk; the first trunk cell is baseY + 1 — no wait: baseY IS the first trunk row. */
  baseY: number;
  biome: Biome;
  /** Trunk rows. Top row is baseY + height - 1; canopy starts before the top. */
  height: number;
  /** Trunk radius at the base and just under the canopy. */
  rBase: number;
  rTop: number;
  /** Canopy parameters per species. */
  leanSeed: number;
  dropSeed: number;
  /** Total y extent (canopy tip), for bounds checks. */
  topY: number;
}

const hash = (x: number, z: number): number => {
  const n = Math.sin(x * 127.1 + z * 311.7 + 19.19) * 43758.5453123;
  return n - Math.floor(n);
};
const hash3 = (x: number, y: number, z: number): number => {
  const n = Math.sin(x * 127.1 + y * 269.5 + z * 311.7 + 74.7) * 43758.5453123;
  return n - Math.floor(n);
};

export type TreeStyle = 'great-conifer' | 'windswept-oak' | 'corrupted' | 'weeping' | 'flesh-stalk';

const HEIGHTS: Record<Biome, [number, number]> = {
  overcast: [10, 14],
  storm:    [7, 10],
  glitch:   [6, 9],
  psychosis:[8, 12],
  maw:      [7, 11],
  catacombs: [0, 0], veins: [0, 0], sky: [0, 0],
};

/** Trunk material ids, resolved by World (forest stays block-agnostic). */
export function treeGrowsIn(biome: Biome): boolean {
  return HEIGHTS[biome][1] > 0;
}

/** Builds the deterministic shape of the tree rooted at (tx,tz). */
export function makeTree(tx: number, tz: number, baseY: number, biome: Biome): TreeShape {
  const h0 = hash(tx * 1.71, tz * 2.33);
  const h1 = hash(tx * 3.17, tz * 4.73);
  const h2 = hash(tx * 5.29, tz * 6.11);
  const [lo, hi] = HEIGHTS[biome];
  const height = lo + Math.floor(h0 * (hi - lo + 1));
  // Substantial trunks: every species has a 3–5 cell base disc, tapered upward.
  const rBase = biome === 'maw' ? 1.35 : biome === 'storm' ? 1.25 : 1.15;
  const rTop = rBase * .55;
  return {
    tx, tz, baseY, biome, height,
    rBase, rTop,
    leanSeed: h1,
    dropSeed: h2,
    topY: baseY + height + 2,
  };
}

/** Local trunk offset per row (only the weeping species corkscrews). */
function shiftAt(tree: TreeShape, ly: number): number {
  if (tree.biome !== 'psychosis') return 0;
  return Math.round(Math.cos(tree.leanSeed * 6 + ly * .8) * .7);
}

/** Windward lean offset at the canopy rows (windswept species). */
function windDir(tree: TreeShape): [number, number] {
  const d = Math.floor(hash(tree.tx * 1.3 + 5, tree.tz * 2.7 + 9) * 4);
  const wx = d === 0 ? 1 : d === 2 ? -1 : 0;
  const wz = d === 1 ? 1 : d === 3 ? -1 : 0;
  return [wx, wz];
}

/** Trunk radius at row ly, with a hashed flare at the bottom rows. */
function trunkRadiusAt(tree: TreeShape, ly: number, dy: number, dz: number): number {
  const t = Math.min(1, Math.max(0, ly / Math.max(1, tree.height - 1)));
  let r = tree.rBase + (tree.rTop - tree.rBase) * t;
  if (ly <= 1) r += .55 + hash(tree.tx * 2.1 + dy, tree.tz * 1.9 + dz) * .35; // root flare
  return r;
}

/** Whether (x,y,z) is a trunk cell of `tree`. */
export function isTrunkCell(tree: TreeShape, x: number, y: number, z: number): boolean {
  const ly = y - tree.baseY;
  if (ly < 0 || ly >= tree.height) return false;
  const dx = x - tree.tx - shiftAt(tree, ly);
  const dz = z - tree.tz;
  const r = trunkRadiusAt(tree, ly, dx, dz);
  // Quantised edge wobble keeps trunk silhouettes organic instead of round blobs.
  const wob = (hash3(tree.tx + dx, y, tree.tz + dz) - .5) * .34;
  return dx * dx + dz * dz <= r * r + wob;
}

/**
 * Whether (x,y,z) belongs to the canopy (or a hanging fruit) of `tree`.
 * `dx`/`dz`/`ly` are the caller-computed offsets relative to the trunk axis.
 */
function canopyInfo(tree: TreeShape, x: number, y: number, z: number, dxRaw: number, dzRaw: number, ly: number): TreeCell | null {
  const style = tree.biome;
  const lTop = ly - tree.height;      // negative below the canopy
  const dx = dxRaw, dz = dzRaw;
  const edge = hash3(x * 1.7, y * 2.3, z * 3.1);

  if (style === 'overcast') {
    // Layered spire: a clear exposed trunk, canopy from ~55% of the trunk height
    // up to 2 rows above the trunk top.
    const y0 = Math.floor(tree.height * .52);
    if (ly < y0 || ly > tree.height + 1) {
      // Hanging skyfruit just under the lowest canopy ring.
      if (ly === y0 - 1 && edge < .11 && Math.abs(dx) <= 2 && Math.abs(dz) <= 2) return { kind: 'fruit', accent: false };
      return null;
    }
    const t = (ly - y0) / (tree.height + 1.2 - y0);
    const r = 3.0 - 2.3 * t;
    if (ly === tree.height + 1) return dx === 0 && dz === 0 ? { kind: 'leaf', accent: true } : null;
    if (dx * dx + dz * dz > r * r + (edge - .5) * 1.1) return null;
    if (hash3(x + y * .5, y * 1.3, z - y * .7) < .1 + t * .12) return null;
    return { kind: 'leaf', accent: t > .72 };
  }

  if (style === 'storm') {
    // One broad sheared dome swept downwind, from ~60% of the trunk height up.
    if (ly < Math.floor(tree.height * .6) || ly > tree.height + 1) return null;
    const [wx, wz] = windDir(tree);
    const sweep = 2;
    const dxs = dx - wx * sweep, dzs = dz - wz * sweep;
    const along = wx !== 0 ? Math.abs(dxs) : Math.abs(dzs);
    const cross = wx !== 0 ? Math.abs(dzs) : Math.abs(dxs);
    if (Math.hypot(along * .8, cross * 1.15, (ly - tree.height) * 1.3) > 2.9 + (edge - .5) * .8) return null;
    if (hash3(x * 1.1, y * 2.7, z * .9) < .3) return null;
    return { kind: 'leaf', accent: along >= 2 };
  }

  if (style === 'glitch') {
    // Hollow angular rings plus detached floating cubes.
    if (ly === tree.height - 1 || ly === tree.height) {
      const r = ly === tree.height - 1 ? 2 : 1;
      if (Math.abs(dx) === r && Math.abs(dz) === r && hash3(x, y * 3, z) < .8) return { kind: 'leaf', accent: false };
      if (Math.abs(dx) !== r && Math.abs(dz) === r && hash3(x * 1.3, y, z) < .5) return { kind: 'leaf', accent: true };
      if (Math.abs(dz) !== r && Math.abs(dx) === r && hash3(x, y, z * 1.7) < .5) return { kind: 'leaf', accent: true };
      return null;
    }
    // Floating corrupted cubes above the crown.
    const fx = Math.floor((hash(tree.tx * 7 + 1, tree.tz + 2) - .5) * 4);
    const fz = Math.floor((hash(tree.tx * 3 + 4, tree.tz * 9 + 6) - .5) * 4);
    for (let f = 0; f < 4; f++) {
      const cy = tree.baseY + tree.height + 1 + f;
      const cxo = Math.floor((hash(tree.tx + f * 5, tree.tz - f * 3) - .5) * 5);
      const czo = Math.floor((hash(tree.tx - f * 7, tree.tz + f * 11) - .5) * 5);
      if (y === cy && x === tree.tx + cxo && z === tree.tz + czo) return { kind: 'leaf', accent: f % 2 === 0 };
    }
    return null;
  }

  if (style === 'psychosis') {
    // Dense red dome with hanging drip strands at the edge.
    const domeStart = Math.floor(tree.height * .72);
    if (ly < domeStart - 3) return null;
    const sh = shiftAt(tree, Math.max(tree.height, ly));
    if (ly >= tree.height - 1 && ly <= tree.height + 1) {
      const t = (ly - (tree.height - 1)) / 2;
      const r = 2.8 - t * .9;
      if (dx * dx + dz * dz > r * r + (edge - .5)) return null;
      if (hash3(x * .9, y * 1.4, z * 1.6) < .18) return null;
      return { kind: 'leaf', accent: false };
    }
    // Strands hang from canopy-edge columns.
    const strandLen = 1 + Math.floor(hash(x * 1.9, z * 2.3) * 3);
    if (ly >= tree.height - strandLen && ly < tree.height - 1) {
      if (dx * dx + dz * dz <= 1.3 * 1.3 || dx * dx + dz * dz > 2.8 * 2.8) return null;
      if (hash3(x, tree.baseY, z) < .3) return null;
      return { kind: 'leaf', accent: true };
    }
    return null;
  }

  void lTop;
  // maw flesh-stalk: lumpy bulb shot through with veins.
  if (ly < Math.floor(tree.height * .68) || ly > tree.height + 2) return null;
  const d = Math.hypot(dx, (ly - (tree.height + .3)) * 1.05, dz) + (edge - .5) * 1.2;
  if (d > 2.45) return null;
  if (hash3(x * 1.2, y * 2.2, z * .7) < .26) return null;
  return { kind: 'leaf', accent: hash3(x * .7, y, z * 1.9) > .84 };
}

/**
 * The cell of `tree` at (x,y,z), or null when the voxel belongs to another
 * feature. Order matters: trunk wins over canopy so canopies never carve the
 * trunk away, and fruits win over nothing (they replace air below the canopy).
 */
export function cellInTree(tree: TreeShape, x: number, y: number, z: number): TreeCell | null {
  const ly = y - tree.baseY;
  if (ly < 0 || ly > tree.height + 4) return null;
  const dx = x - tree.tx - shiftAt(tree, ly);
  const dz = z - tree.tz;
  if (Math.abs(dx) > 4 || Math.abs(dz) > 4) return null;
  if (isTrunkCell(tree, x, y, z)) return { kind: 'trunk', accent: false };
  return canopyInfo(tree, x, y, z, dx, dz, ly);
}

/**
 * Collects the tree bases whose canopy/roots can reach any cell of the given
 * x-range. Pure: the caller (World) owns the region cache. `isProtected`
 * excludes spawn/entrance cells; surface+biome come from callbacks so this
 * module never imports terrain logic.
 */
export function collectTrees(
  x0: number, x1: number, z0: number, z1: number,
  surface: (x: number, z: number) => number,
  biomeOf: (x: number, y: number, z: number) => Biome,
  isProtected: (x: number, z: number) => boolean,
): TreeShape[] {
  const trees: TreeShape[] = [];
  const G = 6; // base grid cell; one tree at most per grid cell (+ sparse second layer)
  const gx0 = Math.floor(x0 / G) - 1, gx1 = Math.floor(x1 / G) + 1;
  const gz0 = Math.floor(z0 / G) - 1, gz1 = Math.floor(z1 / G) + 1;
  for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
    // Open woodland: one tree per ~2.5% of ground columns, well-spaced so
    // trunks stay visible between canopy discs.
    if (hash(gx * 1.13, gz * 3.71) > .45) continue;
    const tx = gx * G + Math.floor(hash(gx * 7.31, gz * 5.17) * G);
    const tz = gz * G + Math.floor(hash(gx * 2.93, gz * 8.77) * G);
    if (isProtected(tx, tz)) continue;
    const h = surface(tx, tz);
    const biome = biomeOf(tx, h, tz);
    if (!treeGrowsIn(biome)) continue;
    trees.push(makeTree(tx, tz, h + 1, biome));
    // Sparse irregular second tree overhanging the same grid cell.
    if (hash(gx * 4.17, gz * 1.93) < .08) {
      const jx = tx + Math.floor(hash(gx * 9.1, gz * 2.2) * 3) - 1;
      const jz = tz + Math.floor(hash(gx * 3.3, gz * 7.7) * 3) - 1;
      if (!isProtected(jx, jz)) {
        const h2 = surface(jx, jz);
        const b2 = biomeOf(jx, h2, jz);
        if (treeGrowsIn(b2)) trees.push(makeTree(jx, jz, h2 + 1, b2));
      }
    }
  }
  return trees;
}

// --- Tinting ----------------------------------------------------------------

const LEAF_COLORS: Record<Biome, { base: [number, number, number]; accent: [number, number, number] }> = {
  overcast:  { base: [.60, .50, .78], accent: [.74, .66, .90] },
  storm:     { base: [.10, .13, .11], accent: [.14, .16, .14] },
  glitch:    { base: [.50, .22, .55], accent: [.35, .90, .82] },
  psychosis: { base: [.55, .14, .19], accent: [.72, .28, .25] },
  maw:       { base: [.52, .15, .17], accent: [.82, .38, .32] },
  catacombs:  { base: [.5, .5, .5], accent: [.5, .5, .5] },
  veins:      { base: [.5, .5, .5], accent: [.5, .5, .5] },
  sky:        { base: [.5, .5, .5], accent: [.5, .5, .5] },
};

const TRUNK_COLORS: Record<Biome, [number, number, number]> = {
  overcast:  [.40, .40, .42],
  storm:     [.17, .14, .115],
  glitch:    [.28, .20, .26],
  psychosis: [.71, .66, .58],
  maw:       [.48, .23, .25],
  catacombs:  [.5, .5, .5], veins: [.5, .5, .5], sky: [.5, .5, .5],
};

/** Per-cell foliage colour (chunk mesher and the felling mesh share this). */
export function leafTint(tree: TreeShape, x: number, y: number, z: number, accent = false): [number, number, number] {
  const c = accent ? LEAF_COLORS[tree.biome].accent : LEAF_COLORS[tree.biome].base;
  const j = .94 + hash3(x + 11, y + 7, z + 3) * .12;
  return [c[0] * j, c[1] * j, c[2] * j];
}

/** Per-cell trunk colour. */
export function trunkTint(tree: TreeShape, y: number): [number, number, number] {
  const c = TRUNK_COLORS[tree.biome];
  const j = .95 + hash3(tree.tx, y, tree.tz) * .1;
  return [c[0] * j, c[1] * j, c[2] * j];
}
