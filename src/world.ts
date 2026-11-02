import * as THREE from 'three';
import { appendUndergrowth, type FoliageBuffers } from './foliage';
import * as forest from './forest';
import type { TreeShape, TreeCell } from './forest';
import { appendMicroGeometry, type MicroBuffers, type MicroProfile } from './micro';

export enum Block { Air = 0, Dirt, Stone, Wood, Mud, Glitch, Flesh, Bone, Torch, Scaffold, Totem, Scorched, Crystal, GravityCharm, PlatformSeed, Acid, Grass, Skyfruit, Morsel, Chisel, PickHead, AxeHead, BladeHead, CopperOre, EchoGem, Leaf }

/** The display colour of a block type, used by pickups and other decorations. */
export function blockColor(id: Block): number {
  return colors[id] ?? 0xff00ff;
}
export type Biome = 'overcast' | 'storm' | 'glitch' | 'psychosis' | 'maw' | 'catacombs' | 'veins' | 'sky';

/** The surface regions form strips along +X; negative X remains the spawn region. */
export function biomeAt(x: number, y: number, _z: number): Biome {
  if (y > 64) return 'sky';
  if (y < -48) return 'veins';
  if (y < 0) return 'catacombs';
  if (x < 96) return 'overcast';
  if (x < 192) return 'storm';
  if (x < 288) return 'glitch';
  if (x < 384) return 'psychosis';
  return 'maw';
}

const SIZE = 16;
const RADIUS = 2;
const VERTICAL_RADIUS = 1;
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const chunkCoord = (v: number) => Math.floor(v / SIZE);
const hash = (x: number, z: number) => {
  const n = Math.sin(x * 127.1 + z * 311.7 + 19.19) * 43758.5453123;
  return n - Math.floor(n);
};
function noise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz) * (1 - sx) + hash(ix + 1, iz) * sx;
  const b = hash(ix, iz + 1) * (1 - sx) + hash(ix + 1, iz + 1) * sx;
  return a * (1 - sz) + b * sz;
}

const hash3 = (x: number, y: number, z: number) => {
  const n = Math.sin(x * 127.1 + y * 269.5 + z * 311.7 + 74.7) * 43758.5453123;
  return n - Math.floor(n);
};
/** Trilinear 3D value noise in [0,1). */
function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c000 = hash3(ix, iy, iz), c100 = hash3(ix + 1, iy, iz), c010 = hash3(ix, iy + 1, iz), c110 = hash3(ix + 1, iy + 1, iz);
  const c001 = hash3(ix, iy, iz + 1), c101 = hash3(ix + 1, iy, iz + 1), c011 = hash3(ix, iy + 1, iz + 1), c111 = hash3(ix + 1, iy + 1, iz + 1);
  return lerp(
    lerp(lerp(c000, c100, sx), lerp(c010, c110, sx), sy),
    lerp(lerp(c001, c101, sx), lerp(c011, c111, sx), sy), sz);
}

/**
 * Deterministic surface cave entrances: each carves a walkable 2-wide staircase
 * from the surface down into the cavern layer. Kept away from spawn.
 */
export const ENTRANCES: ReadonlyArray<readonly [number, number, number, number]> = [
  // [x, z, dirX, dirZ] — direction of the descending ramp
  [24, 18, 1, 0], [-34, 40, 0, 1], [48, -28, 0, -1],
  [-18, -52, -1, 0], [72, 34, 1, 1], [116, -14, 0, -1],
];

const colors: Record<number, number> = {
  [Block.Dirt]: 0x8a5a4e, [Block.Stone]: 0x555761, [Block.Wood]: 0x4a3935,
  [Block.Mud]: 0x373a3c, [Block.Glitch]: 0x843c8b, [Block.Flesh]: 0x9f4e59,
  [Block.Bone]: 0xbeb09b, [Block.Torch]: 0xf7a44b, [Block.Scaffold]: 0x6e6355,
  [Block.Totem]: 0x7b423e, [Block.Scorched]: 0x28252a,
  [Block.Crystal]: 0x6fe0d0,
  [Block.GravityCharm]: 0xc7b3ff,
  [Block.PlatformSeed]: 0x8fe6c0,
  [Block.Acid]: 0x9fd23a,
  [Block.Grass]: 0x7fa668,
  [Block.Skyfruit]: 0x6fc4ff,
  [Block.Morsel]: 0xd88f7a,
  [Block.Chisel]: 0x9aa3b0,
  [Block.PickHead]: 0x8c93a3,
  [Block.CopperOre]: 0xb87333,
  [Block.EchoGem]: 0xc7b3ff,
  [Block.AxeHead]: 0x9a8f80,
  [Block.BladeHead]: 0x9fb4c4,
  // Fallback leaf colour; per-cell canopy tints come from forest.leafTint.
  [Block.Leaf]: 0x9980c6,
};
// Each face is counter-clockwise as seen from outside the block.
const faces = [
  { n: [1, 0, 0], v: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], shade: .82 },
  { n: [-1, 0, 0], v: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]], shade: .72 },
  { n: [0, 1, 0], v: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], shade: 1 },
  { n: [0, -1, 0], v: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], shade: .55 },
  { n: [0, 0, 1], v: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]], shade: .9 },
  { n: [0, 0, -1], v: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]], shade: .65 },
];
interface Chunk { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; }
export interface VoxelHit { x: number; y: number; z: number; previous: { x: number; y: number; z: number }; id: Block; distance: number }

/**
 * Seasonal foliage tints (RGB multipliers). The palette stays in the game's
 * lavender/teal family but swings warm and cold across the year.
 */
const SEASON_TINTS: ReadonlyArray<[number, number, number]> = [
  [1.06, 1.00, .98],  // spring: fresh, slightly pink
  [1.00, 1.02, 1.06],  // summer: cool and bright
  [1.12, .96, .86],   // autumn: warm amber
  [.92, .96, 1.10],   // winter: pale and blue
];

export class World {
  private readonly edits = new Map<string, Block>();
  private readonly chunks = new Map<string, Chunk>();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly clock = { value: 0 };
  /** Carved detail per cell. A cell without a profile is a plain full block. */
  private readonly micros = new Map<string, MicroProfile>();
  /** Current seasonal foliage tint, driven by the clock in update(). */
  private readonly seasonTint = { value: new THREE.Color(1, 1, 1) };

  constructor(private readonly scene: THREE.Scene) {
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const clock = this.clock;
    const seasonTint = this.seasonTint;
    this.material.onBeforeCompile = shader => {
      shader.uniforms.worldTime = clock;
      shader.uniforms.uSeasonTint = seasonTint;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float effect;\nattribute float foliage;\nuniform float worldTime;\nuniform vec3 uSeasonTint;');
      shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
        vColor.rgb *= mix(vec3(1.0), uSeasonTint, foliage);
      `);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float pulse = sin(worldTime * 2.3 + position.x * .38 + position.y * .42 + position.z * .31) * .055;
        if (effect > .5 && effect < 1.5) transformed += normal * pulse;
        if (effect > 1.5) transformed.x += step(.91, fract(sin(floor(worldTime * 8.0) + floor(position.y) * 17.0) * 43758.5453)) * .12;
        // Leaves and blossoms sway gently; trunks stay put.
        if (foliage > .5) {
          float sway = sin(worldTime * 1.4 + position.x * .8 + position.z * .6) * .035
                     + sin(worldTime * 2.7 + position.x * 1.9) * .015;
          transformed.x += sway;
          transformed.z += sway * .6;
        }
      `);
    };
    this.material.customProgramCacheKey = () => 'hollowland-voxel-effects-v2';
  }

  /**
   * The 16-level solid mask of one column of a neighbouring cell: 0 for air,
   * the carved profile's mask when the cell has been chiselled, otherwise a
   * solid 0xffff.
   */
  microColumnMask(x: number, y: number, z: number, ci: number, cj: number): number {
    const id = this.get(x, y, z);
    if (id === Block.Air) return 0;
    const profile = this.micros.get(key(x, y, z));
    return profile ? profile.column(ci, cj) : 0xffff;
  }

  /** The carved profile of a cell, or undefined when the cell is a plain block. */
  microAt(x: number, y: number, z: number): MicroProfile | undefined {
    return this.micros.get(key(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  /** Stores a carved profile for a cell and rebuilds the affected chunk. */
  setMicro(x: number, y: number, z: number, profile: MicroProfile): void {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    this.micros.set(key(x, y, z), profile);
    const cx = chunkCoord(x), cy = chunkCoord(y), cz = chunkCoord(z);
    const targets = [[cx, cy, cz]];
    if (x % SIZE === 0) targets.push([cx - 1, cy, cz]);
    if ((x + 1) % SIZE === 0) targets.push([cx + 1, cy, cz]);
    if (y % SIZE === 0) targets.push([cx, cy - 1, cz]);
    if ((y + 1) % SIZE === 0) targets.push([cx, cy + 1, cz]);
    if (z % SIZE === 0) targets.push([cx, cy, cz - 1]);
    if ((z + 1) % SIZE === 0) targets.push([cx, cy, cz + 1]);
    for (const [a, b, c] of targets) if (this.chunks.has(key(a, b, c))) this.buildChunk(a, b, c);
  }

  /** Clears any carved detail on a cell (used when the block is broken). */
  clearMicro(x: number, y: number, z: number): void {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (!this.micros.delete(key(x, y, z))) return;
    const cx = chunkCoord(x), cy = chunkCoord(y), cz = chunkCoord(z);
    if (this.chunks.has(key(cx, cy, cz))) this.buildChunk(cx, cy, cz);
  }

  surface(x: number, z: number): number {
    x = Math.floor(x); z = Math.floor(z);
    // Keep the immediate spawn gently level and deterministic.
    if (Math.abs(x) < 6 && Math.abs(z) < 6) return 5;
    return Math.floor(4 + noise(x / 30, z / 30) * 5 + noise(x / 9, z / 9) * 2);
  }

  private shaftCells: Set<string> | null = null;
  /** Lazily rasterizes the walkable staircase shafts from each surface entrance into the caves. */
  private getShaftCells(): Set<string> {
    if (this.shaftCells) return this.shaftCells;
    const cells = new Set<string>();
    for (const [ex, ez, dx, dz] of ENTRANCES) {
      // Ramp: two horizontal steps per vertical step, 2x2 cross-section with 3 of headroom.
      let cx = ex, cz = ez, cy = this.surface(ex, ez);
      for (let i = 0; i < 44 && cy > -20; i++) {
        for (let ox = 0; ox < 2; ox++) for (let oz = 0; oz < 2; oz++) for (let oy = 0; oy < 4; oy++)
          cells.add(key(cx + ox, cy + oy, cz + oz));
        cx += dx; cz += dz;
        if (i % 2 === 1) cy--;
      }
    }
    this.shaftCells = cells;
    return cells;
  }

  get(x: number, y: number, z: number): Block {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    const edit = this.edits.get(key(x, y, z));
    if (edit !== undefined) return edit;
    const height = this.surface(x, z);
    if (y > 64) {
      const island = noise(x / 22, z / 22);
      const islandTop = 72 + Math.floor(island * 6);
      return island > .62 && y <= islandTop && y >= islandTop - 3 ? Block.Stone : Block.Air;
    }
    if (y > height) {
      // Trees are voxel data: trunks (Wood/Glitch/Bone/Flesh by biome), wide
      // collidable Leaf canopies and hanging Skyfruit — all mineable.
      const tree = this.treeAtVoxel(x, y, z);
      if (tree) {
        if (tree.cell.kind === 'trunk') {
          switch (tree.shape.biome) {
            case 'glitch': return Block.Glitch;
            case 'psychosis': return Block.Bone;
            case 'maw': return Block.Flesh;
            default: return Block.Wood;
          }
        }
        if (tree.cell.kind === 'fruit') return Block.Skyfruit;
        return Block.Leaf;
      }
      return Block.Air;
    }
    // Surface entrances carve walkable shafts through anything below them.
    if (y <= height && this.getShaftCells().has(key(x, y, z))) return Block.Air;
    if (y < -3) {
      // Keep the ground beneath spawn solid so the player never falls in at the start.
      const spawnDist = Math.hypot(x, z);
      if (spawnDist > 10) {
        // Swiss-cheese caverns: low-frequency 3D noise field with a detail octave.
        const cavern = noise3(x / 22, y / 16, z / 22) + (noise3(x / 7 + 40, y / 6 + 40, z / 7 + 40) - .5) * .22;
        if (cavern > .645) return Block.Air;
      }
      if (y < -48 && noise(x / 8 + y / 20, z / 8) > .62) return Block.Flesh;
      // Acid pools: rare bright-green pockets in the Abyssal Veins layer.
      if (y < -48 && noise3(x / 7 + 11, y / 5 + 3, z / 7 + 7) > .82) return Block.Acid;
      // Ore tiers by depth: copper is shallow and common, crystal sits in the
      // middle stone layer, echo gems are rare and only in the deep veins.
      if (y >= -32 && y <= -14) {
        const ore = noise3(x / 9, y / 9, z / 9);
        if (ore > .78) return Block.Crystal;
      }
      if (y >= -14 && y <= -3) {
        const ore = noise3(x / 7 + 31, y / 6 + 17, z / 7 + 5);
        if (ore > .74) return Block.CopperOre;
      }
      if (y <= -32 && y >= -52) {
        const ore = noise3(x / 11 + 5, y / 9 + 23, z / 11 + 13);
        if (ore > .80) return Block.EchoGem;
      }
      return y < -24 && noise(x / 13, z / 13 + y / 17) > .66 ? Block.Bone : Block.Stone;
    }
    const biome = biomeAt(x, height, z);
    if (y < height - 3) return Block.Stone;
    switch (biome) {
      case 'storm': return Block.Mud;
      case 'glitch': return y === height || noise(x / 5, z / 5) > .67 ? Block.Glitch : Block.Stone;
      case 'psychosis': return y === height ? Block.Flesh : Block.Bone;
      case 'maw': return y === height ? Block.Scorched : Block.Flesh;
      // The default biome wears sage grass over warm dirt.
      default: return y === height ? Block.Grass : Block.Dirt;
    }
  }

  // --- Trees: deterministic voxel shapes -----------------------------------

  /** Tree shapes cached per XZ chunk region, built lazily on first query. */
  private readonly treesByRegion = new Map<number, TreeShape[]>();

  /** Spawn clarity, cave-entrance mouths and entrance ramps stay tree-free. */
  private isProtectedSpot(x: number, z: number): boolean {
    if (Math.abs(x) <= 10 && Math.abs(z) <= 10) return true;
    for (const [ex, ez] of ENTRANCES) if (Math.max(Math.abs(x - ex), Math.abs(z - ez)) <= 2) return true;
    return false;
  }

  /** Lazily builds (and caches) the trees that touch one XZ chunk region. */
  private treesForRegion(tcx: number, tcz: number): TreeShape[] {
    const rk = (tcx + 32768) * 65536 + (tcz + 32768);
    const cached = this.treesByRegion.get(rk);
    if (cached) return cached;
    const x0 = tcx * SIZE, z0 = tcz * SIZE;
    // Canopy reach: a tree rooted up to 4 cells outside can touch this region.
    const all = forest.collectTrees(x0 - 4, x0 + SIZE + 3, z0 - 4, z0 + SIZE + 3,
      (x, z) => this.surface(x, z), biomeAt, (x, z) => this.isProtectedSpot(x, z));
    const rx0 = x0, rx1 = x0 + SIZE - 1, rz0 = z0, rz1 = z0 + SIZE - 1;
    const list = all.filter(t => Math.max(t.tx - 4, rx0) <= Math.min(t.tx + 4, rx1)
      && Math.max(t.tz - 4, rz0) <= Math.min(t.tz + 4, rz1));
    this.treesByRegion.set(rk, list);
    return list;
  }

  /** The tree and cell occupying a voxel, or null for non-tree voxels. */
  treeAtVoxel(x: number, y: number, z: number): { shape: TreeShape; cell: TreeCell } | null {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y <= this.surface(x, z)) return null; // trees live above ground
    for (const shape of this.treesForRegion(Math.floor(x / SIZE), Math.floor(z / SIZE))) {
      const cell = forest.cellInTree(shape, x, y, z);
      if (cell) return { shape, cell };
    }
    return null;
  }

  /** True if (x,y,z) is one of the mineable trunk cells of a procedural tree. */
  isTreeTrunk(x: number, y: number, z: number): boolean {
    const hit = this.treeAtVoxel(x, y, z);
    return hit !== null && hit.cell.kind === 'trunk';
  }

  /** Sets many cells at once and rebuilds each affected chunk a single time. */
  setMany(cells: ReadonlyArray<{ x: number; y: number; z: number }>, id: Block): void {
    const rebuild = new Set<string>();
    for (const c of cells) {
      const k = key(c.x, c.y, c.z);
      this.edits.set(k, id);
      this.micros.delete(k);
    }
    // Deduplicate the chunk set: a cell rebuilds its own chunk plus any
    // adjacent chunk it shares a border with (neighbour face visibility).
    for (const c of cells) {
      const cx = Math.floor(c.x / SIZE), cy = Math.floor(c.y / SIZE), cz = Math.floor(c.z / SIZE);
      const lx = c.x - cx * SIZE, ly = c.y - cy * SIZE, lz = c.z - cz * SIZE;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        const nx = cx + ox, ny = cy + oy, nz = cz + oz;
        // Only border-trimmed offsets matter; neighbouring chunks exist when in range.
        rebuild.add(key(cx, cy, cz));
        if (lx === 0 && ox === -1) rebuild.add(key(nx, cy, cz));
        if (lx === SIZE - 1 && ox === 1) rebuild.add(key(nx, cy, cz));
        if (ly === 0 && oy === -1) rebuild.add(key(cx, ny, cz));
        if (ly === SIZE - 1 && oy === 1) rebuild.add(key(cx, ny, cz));
        if (lz === 0 && oz === -1) rebuild.add(key(cx, cy, nz));
        if (lz === SIZE - 1 && oz === 1) rebuild.add(key(cx, cy, nz));
      }
    }
    for (const ck of rebuild) {
      const [a, b, c] = ck.split(',').map(Number);
      if (this.chunks.has(ck)) this.buildChunk(a, b, c);
    }
  }

  set(x: number, y: number, z: number, id: Block): void {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    this.edits.set(key(x, y, z), id);
    const cx = chunkCoord(x), cy = chunkCoord(y), cz = chunkCoord(z);
    const targets = [[cx, cy, cz]];
    if (x % SIZE === 0) targets.push([cx - 1, cy, cz]);
    if ((x + 1) % SIZE === 0) targets.push([cx + 1, cy, cz]);
    if (y % SIZE === 0) targets.push([cx, cy - 1, cz]);
    if ((y + 1) % SIZE === 0) targets.push([cx, cy + 1, cz]);
    if (z % SIZE === 0) targets.push([cx, cy, cz - 1]);
    if ((z + 1) % SIZE === 0) targets.push([cx, cy, cz + 1]);
    for (const [a, b, c] of targets) if (this.chunks.has(key(a, b, c))) this.buildChunk(a, b, c);
  }

  update(position: THREE.Vector3, time: number): void {
    this.clock.value = time;
    // Seasons drift slowly through the year: a long, gentle cycle that shifts
    // the foliage hue so the same forest reads differently over a session.
    const YEAR = 240; // seconds per full seasonal cycle
    const phase = (time / YEAR) % 1;
    const season = phase * 4; // 0..4 across four seasons
    const idx = Math.floor(season) % 4;
    const next = (idx + 1) % 4;
    const blend = season - Math.floor(season);
    const smooth = blend * blend * (3 - 2 * blend);
    const a = SEASON_TINTS[idx], b = SEASON_TINTS[next];
    this.seasonTint.value.setRGB(
      a[0] + (b[0] - a[0]) * smooth,
      a[1] + (b[1] - a[1]) * smooth,
      a[2] + (b[2] - a[2]) * smooth,
    );
    const cx = chunkCoord(position.x), cy = chunkCoord(position.y), cz = chunkCoord(position.z);
    const wanted: Array<{x: number; y: number; z: number; score: number}> = [];
    for (let dx = -RADIUS; dx <= RADIUS; dx++) for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
      for (let dy = -VERTICAL_RADIUS; dy <= VERTICAL_RADIUS; dy++) wanted.push({ x: cx + dx, y: cy + dy, z: cz + dz, score: dx * dx + dz * dz + Math.abs(dy) * .6 });
    }
    const keep = new Set(wanted.map(c => key(c.x, c.y, c.z)));
    for (const [id, chunk] of this.chunks) if (!keep.has(id)) {
      this.scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); this.chunks.delete(id);
    }
    wanted.sort((a, b) => a.score - b.score);
    // Build only two chunks per frame; fog never controls generation distance.
    let budget = 2;
    for (const c of wanted) if (!this.chunks.has(key(c.x, c.y, c.z))) {
      this.buildChunk(c.x, c.y, c.z);
      if (--budget === 0) break;
    }
  }

  private buildChunk(cx: number, cy: number, cz: number): void {
    const positions: number[] = [], normals: number[] = [], tint: number[] = [], effects: number[] = [], foliage: number[] = [], indices: number[] = [];
    const color = new THREE.Color();
    // Solid-cell lookup used by the ambient occlusion pass.
    const solidAt = (x: number, y: number, z: number): boolean => this.get(x, y, z) !== Block.Air;
    for (let lx = 0; lx < SIZE; lx++) for (let lz = 0; lz < SIZE; lz++) for (let ly = 0; ly < SIZE; ly++) {
      const x = cx * SIZE + lx, y = cy * SIZE + ly, z = cz * SIZE + lz;
      const id = this.get(x, y, z);
      if (id === Block.Air) continue;
      color.setHex(colors[id] ?? 0xff00ff);
      // Trees carry their own per-cell palette (species trunk, canopy tints);
      // canopy cells also sway and inherit their biome's shader effect.
      let effect = id === Block.Flesh ? 1 : id === Block.Glitch ? 2 : 0;
      let foli = 0;
      const inTreeBand = id === Block.Leaf || id === Block.Skyfruit
        || ((id === Block.Wood || id === Block.Glitch || id === Block.Bone || id === Block.Flesh) && y > this.surface(x, z));
      const treeHit = inTreeBand ? this.treeAtVoxel(x, y, z) : null;
      if (treeHit) {
        if (treeHit.cell.kind === 'trunk') {
          const t = forest.trunkTint(treeHit.shape, y);
          color.setRGB(t[0], t[1], t[2]);
        } else {
          const t = forest.leafTint(treeHit.shape, x, y, z, treeHit.cell.accent);
          color.setRGB(t[0], t[1], t[2]);
          foli = 1;
          effect = treeHit.shape.biome === 'glitch' ? 2 : (treeHit.shape.biome === 'psychosis' || treeHit.shape.biome === 'maw') ? 1 : 0;
        }
      } else if (id === Block.Leaf) {
        foli = 1; // hand-placed leaves still sway with the canopy
      }
      // Mossy patches break up the sage grass with irregular greener ground.
      if (id === Block.Grass && noise(x / 7, z / 7) > .63) color.setRGB(color.r * .7 + .08, color.g * .95 + .07, color.b * .55 + .05);
      const profile = this.micros.get(key(x, y, z));
      if (profile) {
        // Carved block: emit its sub-voxel geometry instead of a plain cube.
        const micro: MicroBuffers = { positions, normals, tint, effects, indices };
        const verts = appendMicroGeometry(micro, x, y, z, profile, [color.r, color.g, color.b],
          (nx, ny, nz, ci, cj) => this.microColumnMask(nx, ny, nz, ci, cj));
        for (let i = 0; i < verts; i++) foliage.push(0);
        continue;
      }
      // Per-voxel brightness variation gives the ground a dithered pixel-art
      // texture instead of one flat color per block type.
      const vary = .92 + hash3(x, y, z) * .16;
      for (const face of faces) {
        // Skip faces that are hidden behind a solid neighbour.
        if (solidAt(x + face.n[0], y + face.n[1], z + face.n[2])) continue;
        const base = positions.length / 3;
        for (let vi = 0; vi < 4; vi++) {
          const v = face.v[vi];
          positions.push(x + v[0], y + v[1], z + v[2]);
          normals.push(...face.n);
          // Ambient occlusion: darken vertices that sit in a concave corner.
          const ao = this.vertexOcclusion(x, y, z, face, vi, solidAt);
          tint.push(color.r * face.shade * vary * ao, color.g * face.shade * vary * ao, color.b * face.shade * vary * ao);
          effects.push(effect);
          foliage.push(foli);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    // Append trees into the same chunk geometry so we pay one extra draw call per chunk, not per tree.
    // Append ground flora (no trees — those are voxel data now) into the same
    // chunk geometry so we pay one extra draw call per chunk, not per bush.
    const foliageBuffers: FoliageBuffers = { positions, normals, tint, effects, foliage, indices };
    appendUndergrowth(foliageBuffers, cx, cy, cz, (x, z) => this.surface(x, z), biomeAt);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(tint, 3));
    geometry.setAttribute('effect', new THREE.Float32BufferAttribute(effects, 1));
    geometry.setAttribute('foliage', new THREE.Float32BufferAttribute(foliage, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    const id = key(cx, cy, cz), old = this.chunks.get(id);
    if (old) { this.scene.remove(old.mesh); old.mesh.geometry.dispose(); }
    this.chunks.set(id, { mesh }); this.scene.add(mesh);
  }

  /**
   * Classic voxel ambient occlusion: for each face vertex, look at the two
   * edge neighbours and the corner neighbour just outside the face and darken
   * the vertex when they are solid. Gives every block a soft, readable form.
   */
  private vertexOcclusion(
    x: number, y: number, z: number,
    face: { n: number[]; v: number[][] },
    vi: number,
    solidAt: (x: number, y: number, z: number) => boolean,
  ): number {
    const n = face.n;
    // The face's local tangent axes are the two axes that aren't the normal.
    const axes: number[] = [];
    for (let a = 0; a < 3; a++) if (n[a] === 0) axes.push(a);
    const v = face.v[vi];
    // For each tangent axis, the vertex sits on the low or high side of the block.
    const sides = axes.map(a => (v[a] === 1 ? 1 : -1));
    let occluded = 0;
    for (let i = 0; i < 2; i++) {
      const a = axes[i];
      const nx = x + n[0], ny = y + n[1], nz = z + n[2];
      const px = nx + (a === 0 ? sides[i] : 0);
      const py = ny + (a === 1 ? sides[i] : 0);
      const pz = nz + (a === 2 ? sides[i] : 0);
      if (solidAt(px, py, pz)) occluded++;
    }
    return 1 - occluded * .14;
  }

  raycast(origin: THREE.Vector3, direction: THREE.Vector3, max: number): VoxelHit | null {
    if (max < 0 || direction.lengthSq() === 0 || !Number.isFinite(max)) return null;
    const dir = direction.clone().normalize();
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    let previous = { x, y, z };
    const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
    const dx = sx ? Math.abs(1 / dir.x) : Infinity, dy = sy ? Math.abs(1 / dir.y) : Infinity, dz = sz ? Math.abs(1 / dir.z) : Infinity;
    let tx = sx ? ((sx > 0 ? x + 1 : x) - origin.x) / dir.x : Infinity;
    let ty = sy ? ((sy > 0 ? y + 1 : y) - origin.y) / dir.y : Infinity;
    let tz = sz ? ((sz > 0 ? z + 1 : z) - origin.z) / dir.z : Infinity;
    let distance = 0;
    while (distance <= max) {
      const id = this.get(x, y, z);
      if (id !== Block.Air) return { x, y, z, previous, id, distance };
      previous = { x, y, z };
      if (tx <= ty && tx <= tz) { x += sx; distance = tx; tx += dx; }
      else if (ty <= tz) { y += sy; distance = ty; ty += dy; }
      else { z += sz; distance = tz; tz += dz; }
    }
    return null;
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) { this.scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); }
    this.chunks.clear(); this.treesByRegion.clear(); this.material.dispose();
  }
}
