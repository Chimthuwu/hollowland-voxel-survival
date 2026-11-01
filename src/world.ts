import * as THREE from 'three';

export enum Block { Air = 0, Dirt, Stone, Wood, Mud, Glitch, Flesh, Bone, Torch, Scaffold, Totem, Scorched }
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
  [Block.Dirt]: 0x555047, [Block.Stone]: 0x555761, [Block.Wood]: 0x4a3935,
  [Block.Mud]: 0x373a3c, [Block.Glitch]: 0x843c8b, [Block.Flesh]: 0x9f4e59,
  [Block.Bone]: 0xbeb09b, [Block.Torch]: 0xf7a44b, [Block.Scaffold]: 0x6e6355,
  [Block.Totem]: 0x7b423e, [Block.Scorched]: 0x28252a,
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

export class World {
  private readonly edits = new Map<string, Block>();
  private readonly chunks = new Map<string, Chunk>();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly clock = { value: 0 };

  constructor(private readonly scene: THREE.Scene) {
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const clock = this.clock;
    this.material.onBeforeCompile = shader => {
      shader.uniforms.worldTime = clock;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float effect;\nuniform float worldTime;');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float pulse = sin(worldTime * 2.3 + position.x * .38 + position.y * .42 + position.z * .31) * .055;
        if (effect > .5 && effect < 1.5) transformed += normal * pulse;
        if (effect > 1.5) transformed.x += step(.91, fract(sin(floor(worldTime * 8.0) + floor(position.y) * 17.0) * 43758.5453)) * .12;
      `);
    };
    this.material.customProgramCacheKey = () => 'hollowland-voxel-effects-v1';
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
      // Sparse silhouettes away from spawn, with no nondeterministic RNG.
      if ((Math.abs(x) > 10 || Math.abs(z) > 10) && hash(x, z) > .985 && y <= height + 3) {
        const b = biomeAt(x, height, z);
        return b === 'glitch' ? Block.Glitch : b === 'psychosis' ? Block.Bone : b === 'maw' ? Block.Flesh : Block.Wood;
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
      return y < -24 && noise(x / 13, z / 13 + y / 17) > .66 ? Block.Bone : Block.Stone;
    }
    const biome = biomeAt(x, height, z);
    if (y < height - 3) return Block.Stone;
    switch (biome) {
      case 'storm': return Block.Mud;
      case 'glitch': return y === height || noise(x / 5, z / 5) > .67 ? Block.Glitch : Block.Stone;
      case 'psychosis': return y === height ? Block.Flesh : Block.Bone;
      case 'maw': return y === height ? Block.Scorched : Block.Flesh;
      default: return Block.Dirt;
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
    const positions: number[] = [], normals: number[] = [], tint: number[] = [], effects: number[] = [], indices: number[] = [];
    const color = new THREE.Color();
    for (let lx = 0; lx < SIZE; lx++) for (let lz = 0; lz < SIZE; lz++) for (let ly = 0; ly < SIZE; ly++) {
      const x = cx * SIZE + lx, y = cy * SIZE + ly, z = cz * SIZE + lz;
      const id = this.get(x, y, z);
      if (id === Block.Air) continue;
      color.setHex(colors[id] ?? 0xff00ff);
      for (const face of faces) {
        if (this.get(x + face.n[0], y + face.n[1], z + face.n[2]) !== Block.Air) continue;
        const base = positions.length / 3;
        for (const v of face.v) {
          positions.push(x + v[0], y + v[1], z + v[2]);
          normals.push(...face.n);
          tint.push(color.r * face.shade, color.g * face.shade, color.b * face.shade);
          effects.push(id === Block.Flesh ? 1 : id === Block.Glitch ? 2 : 0);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(tint, 3));
    geometry.setAttribute('effect', new THREE.Float32BufferAttribute(effects, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    const id = key(cx, cy, cz), old = this.chunks.get(id);
    if (old) { this.scene.remove(old.mesh); old.mesh.geometry.dispose(); }
    this.chunks.set(id, { mesh }); this.scene.add(mesh);
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
    this.chunks.clear(); this.material.dispose();
  }
}
