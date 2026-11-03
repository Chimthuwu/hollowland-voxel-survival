import { Block } from './world';

/**
 * HOLLOWLAND landmark framework — deterministic, seed-driven world features.
 *
 * Design rules (Milestone 2):
 *  - Every placement is a pure function of (seed, grid cell). No Math.random,
 *    no mutable state, no chunk-traversal order: any chunk of the world can be
 *    generated first and the landmarks come out identical.
 *  - Voxel answers are pure functions of (landmark, x, y, z), so cross-chunk
 *    structures stamp correctly no matter which chunk builds first.
 *  - `landmarkAtVoxel` never consults the block grid or player edits; the
 *    World checks player edits first, so regeneration never overwrites them.
 *  - Placement is bounded by generation version: bump GENERATION_VERSION when
 *    the layout changes so old saves ignore the shift instead of desyncing.
 */

/** Bump when terrain or landmark layout changes meaningfully. */
export const GENERATION_VERSION = 2;

/** Side length of one landmark-placement grid cell, in blocks. */
export const LANDMARK_GRID = 48;

export type LandmarkKind = 'ruin' | 'petrified' | 'cathedral' | 'shrine';

export interface Landmark {
  kind: LandmarkKind;
  /** Anchor column (integers) and its surface height at anchor. */
  cx: number;
  cz: number;
  base: number;
  /** Stable per-landmark variant bits [0,1). */
  variant: number;
}

/** Deterministic seeded hash in [0,1). Mirrors world.ts's hash style. */
function seedHash(a: number, b: number, c: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7 + c * 74.7 + 19.19) * 43758.5453123;
  return n - Math.floor(n);
}

const key2 = (x: number, z: number) => (x + 32768) * 65536 + (z + 32768);

// --- Placement context (injected by world.ts to avoid a circular dep) ------
// Surface and guard queries are the same ones the terrain uses; landmarks
// never call world.get(), so the framework stays order-independent.

export interface PlacementContext {
  surface(x: number, z: number): number;
  /** 0 dry, 1 river, 2 lake. */
  waterBodyAt(x: number, z: number): 0 | 1 | 2;
  terrainKindAt(x: number, z: number): 'plains' | 'desert' | 'hills' | 'mountain';
  biomeAt(x: number, y: number, z: number): string;
}

let context: PlacementContext | null = null;
let worldSeed = 1;

/** Injected by world.ts once the seed and query hooks are ready. */
export function setLandmarkContext(seed: number, ctx: PlacementContext): void {
  worldSeed = seed >>> 0 || 1;
  context = ctx;
  placementCache.clear();
}

/** The active world seed (for saves and dev hooks). */
export function currentSeed(): number {
  return worldSeed;
}

// --- Site selection ---------------------------------------------------------

/** Per-kind build radius in blocks (how far a landmark's blocks may reach). */
const REACH: Record<LandmarkKind, number> = { ruin: 8, petrified: 5, cathedral: 14, shrine: 5 };

/** Which grid cell a coordinate falls in, scaled per kind for density. */
const CELL_PER_KIND: Record<LandmarkKind, number> = { ruin: 1, petrified: 1, cathedral: 1, shrine: 2 };

/** Which kind a cell hosts — decided by the cell hash, weighted per biome. */
function kindForCell(gx: number, gz: number): LandmarkKind | null {
  const roll = seedHash(gx, gz, worldSeed % 977);
  // Cathedrals are underground: they fit everywhere but are rarer.
  if (roll > 0.86) return 'cathedral';
  if (roll > 0.74) return 'ruin';
  if (roll > 0.62) return 'petrified';
  if (roll > 0.56) return 'shrine';
  return null;
}

/** Shared generation-space site guards. */
function siteAllowed(kind: LandmarkKind, cx: number, cz: number): boolean {
  const ctx = context;
  if (!ctx) return false;
  // Spawn clarity: nothing anchors within 30 blocks of the origin.
  if (Math.hypot(cx, cz) < 30) return false;
  if (kind === 'cathedral') {
    // Underground: dry land above so the cavern isn't flooded.
    return ctx.waterBodyAt(cx, cz) === 0;
  }
  if (ctx.waterBodyAt(cx, cz) !== 0) return false;
  const kind0 = ctx.terrainKindAt(cx, cz);
  // Ruins and shrines want walkable open country; petrified trees root
  // anywhere dry. Cathedrals were handled above.
  if (kind === 'shrine') {
    const top = ctx.surface(cx, cz);
    // The slab must sit on level ground: all 4 corners within one block.
    const corners = [ctx.surface(cx - 3, cz - 3), ctx.surface(cx + 3, cz - 3), ctx.surface(cx - 3, cz + 3), ctx.surface(cx + 3, cz + 3)];
    return kind0 !== 'desert' && Math.max(...corners) - Math.min(...corners) <= 1 && top >= 3 && top <= 16;
  }
  if (kind === 'ruin') {
    const top = ctx.surface(cx, cz);
    return kind0 !== 'desert' && kind0 !== 'mountain' && top >= 3 && top <= 14;
  }
  // Petrified trees avoid the dead desert.
  return kind0 !== 'desert';
}

const placementCache = new Map<number, Landmark | null>();

/** The landmark (if any) anchored by one grid cell for the given kind family. */
export function landmarkForCell(gx: number, gz: number): Landmark | null {
  const k = key2(gx, gz);
  const hit = placementCache.get(k);
  if (hit !== undefined) return hit;
  let out: Landmark | null = null;
  const kind = kindForCell(gx, gz);
  if (kind) {
    // Jitter the anchor inside the cell, keeping it clear of the edges.
    const span = LANDMARK_GRID / CELL_PER_KIND[kind];
    const jx = Math.floor(seedHash(gx * 3 + 11, gz * 7 + 5, worldSeed % 131) * (span - 20)) + 10;
    const jz = Math.floor(seedHash(gx * 5 + 71, gz * 3 + 43, worldSeed % 197) * (span - 20)) + 10;
    const cx = gx * span + jx, cz = gz * span + jz;
    if (siteAllowed(kind, cx, cz)) {
      out = { kind, cx, cz, base: context!.surface(cx, cz), variant: seedHash(cx, cz, worldSeed % 313) };
    }
  }
  placementCache.set(k, out);
  return out;
}

/**
 * True when (x, z) sits inside any landmark's build footprint — used by the
 * terrain to keep trees and flora off landmark sites.
 */
export function isLandmarkSite(x: number, z: number): boolean {
  // Cathedrals reach deepest, so check the widest cell neighbourhood.
  for (const kind of Object.keys(REACH) as LandmarkKind[]) {
    const span = LANDMARK_GRID / CELL_PER_KIND[kind];
    const gx = Math.floor(x / span), gz = Math.floor(z / span);
    for (let ax = gx - 1; ax <= gx + 1; ax++) for (let az = gz - 1; az <= gz + 1; az++) {
      // Only one kind family anchors per (span-adjusted) cell; re-derive it.
      const cellKind = kindForCell(Math.floor(ax * span / LANDMARK_GRID), Math.floor(az * span / LANDMARK_GRID));
      if (cellKind !== kind) continue;
      const lm = landmarkForCell(Math.floor(ax * span / LANDMARK_GRID), Math.floor(az * span / LANDMARK_GRID));
      if (!lm || lm.kind !== kind) continue;
      const reach = REACH[kind] + 2;
      if (Math.hypot(x - lm.cx, z - lm.cz) <= reach) return true;
    }
  }
  return false;
}

// --- Voxel composition ------------------------------------------------------

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The landmark block occupying (x, y, z), or undefined when the landmark has
 * no opinion (the terrain answers as usual). Returning Block.Air carves.
 */
export function landmarkAtVoxel(x: number, y: number, z: number): Block | undefined {
  const ctx = context;
  if (!ctx) return undefined;
  // A voxel can be touched by the landmark of any nearby grid cell; ask the
  // cells whose span could host a landmark reaching this far.
  for (const kind of Object.keys(REACH) as LandmarkKind[]) {
    const span = LANDMARK_GRID / CELL_PER_KIND[kind];
    const gx0 = Math.floor(x / span), gz0 = Math.floor(z / span);
    for (let ax = gx0 - 1; ax <= gx0 + 1; ax++) for (let az = gz0 - 1; az <= gz0 + 1; az++) {
      const lm = landmarkForCell(ax, az);
      if (!lm || lm.kind !== kind) continue;
      const block = compose(lm, x, y, z, ctx);
      if (block !== undefined) return block;
    }
  }
  return undefined;
}

/** One landmark's voxel answer for a coordinate. */
function compose(lm: Landmark, x: number, y: number, z: number, ctx: PlacementContext): Block | undefined {
  switch (lm.kind) {
    case 'ruin': return ruin(lm, x, y, z);
    case 'petrified': return petrified(lm, x, y, z, ctx);
    case 'cathedral': return cathedral(lm, x, y, z, ctx);
    case 'shrine': return shrine(lm, x, y, z);
  }
}

/**
 * RUIN — a broken circular compound: a ring wall of stone and scaffold with
 * collapsed stretches, one gate gap, a totem at the heart and a hidden cache
 * of refined metal under it (the rare reward).
 */
function ruin(lm: Landmark, x: number, y: number, z: number): Block | undefined {
  const dx = x - lm.cx, dz = z - lm.cz;
  const r = 4 + Math.floor(lm.variant * 3); // 4..6
  const d = Math.hypot(dx, dz);
  if (d > r + 0.5) return undefined;
  const top = lm.base;
  if (y > top + 3 || y < top - 2) return undefined;
  // The heart of the ruin: a totem standing on a stone plinth, with a hidden
  // cache of refined metal beneath it (the rare reward). The totem column is
  // exempt from the tumbled-wall gates so it always stands.
  if (dx === 0 && dz === 0) {
    if (y === top + 1) return Block.Totem;
    if (y === top) return Block.Stone;
    if (y === top - 1) return lm.variant > .5 ? Block.CopperBar : Block.CrystalBar;
    if (y === top - 2) return Block.Crystal;
  }
  // The ring wall stands only in open air above the terrain, so it follows
  // slopes instead of burying or floating.
  if (y < top) return undefined;
  // Gate: a 3-wide gap on the variant-chosen side.
  const angle = Math.atan2(dz, dx);
  const gateAngle = (lm.variant - .5) * Math.PI * 2;
  const angleGap = Math.abs(((angle - gateAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  if (angleGap < 0.35 && y <= top + 2) return undefined;
  // Broken stretches: 30% of wall cells are missing (per-cell stable hash).
  if (seedHash(x * 3, y, z * 5 + lm.cx) < 0.30) return undefined;
  // Wall height decays around the ring for a tumbled silhouette.
  const h = 1 + Math.floor(seedHash(x * 7, z * 11 + lm.cz, y) * 3);
  if (y > top + h) return undefined;
  // Wall body: scaffold courses between stone.
  if (Math.abs(dx) > r - 1.6 || Math.abs(dz) > r - 1.6 || d > r - 0.6) {
    return (x + z) % 2 === 0 ? Block.Stone : Block.Scaffold;
  }
  // Courtyard interior is natural ground (no opinion).
  return undefined;
}

/**
 * GIANT PETRIFIED TREE — a huge stone trunk with a hollow core, root flares
 * and a petrified heart of crystal. The hollow has a ground-level entrance
 * so the interior (and its rare deposits) is reachable.
 */
function petrified(lm: Landmark, x: number, y: number, z: number, ctx: PlacementContext): Block | undefined {
  const dx = x - lm.cx, dz = z - lm.cz;
  const d = Math.hypot(dx, dz);
  const trunkR = 2.6 + lm.variant * 1.2; // ~2.6..3.8
  const height = 18 + Math.floor(lm.variant * 8); // 18..25
  const top = lm.base;
  if (y < top - 2 || y > top + height + 4) return undefined;
  // Root flares: five buttress ramps flowing out of the trunk base.
  const rootCount = 5;
  for (let i = 0; i < rootCount; i++) {
    const a = (i / rootCount) * Math.PI * 2 + lm.variant * 6;
    const rx = Math.round(Math.cos(a) * (trunkR + 2.2)), rz = Math.round(Math.sin(a) * (trunkR + 2.2));
    const steps = 4;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = lm.cx + Math.round(lerp(0, rx, t)), pz = lm.cz + Math.round(lerp(0, rz, t));
      const py = top - 1 + Math.round(t * 2);
      if (x === px && z === pz && (y === py || y === py + 1)) {
        // Petrified bark, with a rare gem tucked into one root tip.
        if (y === py + 1 && s === steps && lm.variant > .6) return Block.EchoGem;
        return Block.Stone;
      }
    }
  }
  // Trunk body.
  if (d <= trunkR && y <= top + height) {
    // Hollow core: a 1-wide chimney from an entrance up through the trunk.
    const hollowR = trunkR - 1.6;
    const entranceA = lm.variant * Math.PI * 2;
    const atEntrance = Math.abs(((Math.atan2(dz, dx) - entranceA + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.6;
    const inHollow = d < hollowR || (atEntrance && y <= top + 3 && d < trunkR);
    if (inHollow && y >= top + 3 && y <= top + height - 3) {
      // The petrified heart: rare crystal suspended in the hollow.
      if (dx === 0 && dz === 0 && y === top + Math.floor(height / 2)) return Block.Crystal;
      if (dx === 0 && dz === 0 && y === top + Math.floor(height / 2) + 1) return Block.EchoGem;
      return Block.Air;
    }
    // Solid bark: stone with bone marbling.
    return seedHash(x * 5, y * 3, z * 7 + lm.cz) > .78 ? Block.Bone : Block.Stone;
  }
  // Canopy: a few stone boughs at the top, purely silhouette.
  if (y > top + height && d <= trunkR + 1.5 && seedHash(x * 11, y, z * 13 + lm.cx) > .55) return Block.Stone;
  void ctx;
  return undefined;
}

/**
 * UNDERGROUND CRYSTAL CATHEDRAL — a large cavern dome under the surface with
 * crystal pillars, glowing floor clusters and rare deep deposits.
 */
function cathedral(lm: Landmark, x: number, y: number, z: number, ctx: PlacementContext): Block | undefined {
  const dx = x - lm.cx, dz = z - lm.cz;
  const floor = lm.base - 22 - Math.floor(lm.variant * 6); // well below the surface
  if (y < floor - 8 || y > lm.base - 4) return undefined;
  // Two overlapping dome blobs form the chamber.
  const off = lm.variant * 6 - 3;
  const d1 = Math.hypot(dx, dz, (y - floor - 6) * 1.1);
  const d2 = Math.hypot(dx - off, dz - off, (y - floor - 4) * 1.2);
  const R = 7 + lm.variant * 3;
  const inside = d1 < R || d2 < R * 0.8;
  if (!inside) return undefined;
  // Pillars: crystal columns from floor toward the ceiling at fixed spots.
  const pillarCount = 5;
  for (let i = 0; i < pillarCount; i++) {
    const a = (i / pillarCount) * Math.PI * 2 + lm.variant * 4;
    const pr = R * (0.35 + (i % 2) * 0.3);
    const px = Math.round(Math.cos(a) * pr), pz = Math.round(Math.sin(a) * pr);
    if (x === lm.cx + px && z === lm.cz + pz) {
      const pillarTop = floor + 4 + Math.floor(seedHash(lm.cx + px, i, lm.cz + pz) * 6);
      if (y <= pillarTop) return i % 2 === 0 ? Block.Crystal : Block.Stone;
    }
  }
  // Floor detail: glowing clusters and one rare echo-gem core.
  if (y === floor) {
    if (dx === 0 && dz === 0) return Block.EchoGem;
    const cl = seedHash(x * 13, z * 17, lm.cx + lm.cz);
    if (cl > 0.72) return Block.Crystal;
  }
  // The cavern is carved air.
  return Block.Air;
  void ctx;
}

/**
 * SHRINE — a small stone platform with corner torch posts, a central totem
 * and a buried echo gem. A quiet reward spot, readable from a distance by
 * its torchlight.
 */
function shrine(lm: Landmark, x: number, y: number, z: number): Block | undefined {
  const dx = x - lm.cx, dz = z - lm.cz;
  const top = lm.base;
  if (y < top - 1 || y > top + 3) return undefined;
  if (Math.abs(dx) <= 3 && Math.abs(dz) <= 3) {
    // Slab: level the platform by filling one block above the natural surface.
    if (y === top && (Math.abs(dx) === 3 || Math.abs(dz) === 3)) return Block.Stone;
    if (y === top) return Block.Stone;
    // Corner torch posts.
    if (Math.abs(dx) === 2 && Math.abs(dz) === 2) {
      if (y === top + 1) return Block.Scaffold;
      if (y === top + 2) return Block.Torch;
    }
    // Central totem, and the buried gem directly beneath it.
    if (dx === 0 && dz === 0) {
      if (y === top + 1) return Block.Totem;
      if (y === top - 1) return Block.EchoGem;
    }
  }
  return undefined;
}
