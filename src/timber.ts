import * as THREE from 'three';
import { Block, type World } from './world';
import * as forest from './forest';
import { blockColor } from './world';

/**
 * Tree felling.
 *
 * When a trunk cell is removed and nothing below it supports the column any
 * more, the whole tree — trunk, canopy, fruit — is swept out of the voxel
 * world at once and animated as one lightweight mesh: it creaks, tips with
 * accelerating momentum around a hinge at its base, impacts the ground,
 * bounces, settles, and then releases its wood as loot pickups. The world
 * cells are gone the moment the fall starts, so a felled tree can never be
 * harvested twice.
 */

interface Fall {
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  /** Rotation axis (unit, horizontal) and world-space pivot at the trunk base. */
  axis: THREE.Vector3;
  pivot: THREE.Vector3;
  /** Horizontal direction the tree tips toward. */
  dir: THREE.Vector3;
  theta: number;
  omega: number;
  phase: 'fall' | 'settle' | 'fade';
  fade: number;
  trunkCount: number;
  fruitChance: boolean;
}

const FALL_ACCEL = 3.4;      // rad/s² — gives the tip real momentum
const IMPACT_TIME_SLOP = .05; // impact angle jitter per tree
const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: .82 },
  { n: [-1, 0, 0], v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: .72 },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1 },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: .55 },
  { n: [0, 0, 1], v: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: .9 },
  { n: [0, 0, -1], v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: .65 },
];

export class Timber {
  private readonly falls: Fall[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: Pick<World, 'get' | 'treeAtVoxel' | 'setMany'>,
    private readonly spawnLoot: (id: Block, position: THREE.Vector3) => void,
    private readonly onImpact: () => void,
  ) {}

  /**
   * Call after removing a block that might have been a trunk cell. Returns
   * true when this removal felled a whole tree. Chopping branches or mid-trunk
   * cells that are still supported does nothing.
   */
  notify(x: number, y: number, z: number, awayFrom: THREE.Vector3): boolean {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    const hit = this.world.treeAtVoxel(x, y, z);
    if (!hit || hit.cell.kind !== 'trunk') return false;
    // Support check: any surviving trunk cell below in this column holds the
    // tree up. (Removed cells read as Air through the world's edit map.)
    for (let yy = y - 1; yy >= hit.shape.baseY; yy--) {
      if (this.world.get(x, yy, z) !== Block.Air && forest.isTrunkCell(hit.shape, x, yy, z)) return false;
    }
    this.startFall(hit.shape, awayFrom);
    return true;
  }

  private startFall(shape: forest.TreeShape, awayFrom: THREE.Vector3): void {
    // Collect every surviving cell of the tree (the world may already have
    // eaten a few — those are the player's harvested wood).
    const cells: Array<{ x: number; y: number; z: number; id: Block; kind: 'trunk' | 'leaf' | 'fruit'; accent: boolean }> = [];
    for (let y = shape.baseY; y <= shape.topY + 1; y++) {
      for (let x = shape.tx - 4; x <= shape.tx + 4; x++) {
        for (let z = shape.tz - 4; z <= shape.tz + 4; z++) {
          const cell = forest.cellInTree(shape, x, y, z);
          if (!cell) continue;
          if (this.world.get(x, y, z) === Block.Air) continue; // already harvested
          // Skip cells that the neighbouring-tree ambiguity gave away earlier.
          const treeHit = this.world.treeAtVoxel(x, y, z);
          if (!treeHit || !cellsSameTree(treeHit.shape, shape)) continue;
          cells.push({ x, y, z, id: this.world.get(x, y, z), kind: cell.kind, accent: cell.accent });
        }
      }
    }
    if (!cells.length) return;

    // Sweep them out of the world in one rebuild pass.
    this.world.setMany(cells.map(c => ({ x: c.x, y: c.y, z: c.z })), Block.Air);

    const group = new THREE.Group();
    this.scene.add(group);
    const pivot = new THREE.Vector3(shape.tx + .5, shape.baseY, shape.tz + .5);
    group.position.copy(pivot);

    // Tip away from the point the player chops from (falls toward the camera).
    const dir = new THREE.Vector3(pivot.x - awayFrom.x, 0, pivot.z - awayFrom.z);
    if (dir.lengthSq() < .01) {
      dir.set(Math.random() - .5, 0, Math.random() - .5);
    }
    dir.normalize();
    const axis = new THREE.Vector3(0, 1, 0).cross(dir).normalize();

    const { geometry, material, trunkCount, fruitChance } = buildTreeMesh(cells, shape, pivot);
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);

    this.falls.push({
      group, mesh, material, axis, pivot, dir,
      theta: .045, // starts with a creak tilt, off balance
      omega: 0,
      phase: 'fall',
      fade: 0,
      trunkCount,
      fruitChance,
    });
  }

  update(dt: number): void {
    for (let i = this.falls.length - 1; i >= 0; i--) {
      const f = this.falls[i];
      if (f.phase === 'fall') {
        f.omega += FALL_ACCEL * dt;
        f.theta += f.omega * dt;
        const limit = Math.PI / 2 - IMPACT_TIME_SLOP * .6;
        if (f.theta >= limit) {
          f.theta = limit;
          // Impact: the tree is done falling, warn once, drop the harvest.
          this.onImpact();
          this.dropHarvest(f);
          f.phase = 'settle';
          f.omega = -f.omega * .17; // bounce back up before settling
        }
      } else if (f.phase === 'settle') {
        f.theta += f.omega * dt;
        f.omega *= Math.pow(.02, dt); // heavy damping
        if (Math.abs(f.omega) < .25 && f.theta < Math.PI / 2) {
          f.theta = Math.PI / 2 - IMPACT_TIME_SLOP * .6;
          f.phase = 'fade';
          f.fade = .9;
          f.material.transparent = true;
          f.material.opacity = 1;
        }
      } else {
        f.fade -= dt;
        f.material.opacity = Math.max(0, Math.min(1, f.fade / .9));
        f.group.position.y = f.pivot.y - (1 - Math.max(0, f.fade / .9)) * .3; // sinks as it fades
        if (f.fade <= 0) {
          this.scene.remove(f.group);
          f.mesh.geometry.dispose();
          f.material.dispose();
          this.falls.splice(i, 1);
          continue;
        }
      }
      f.group.quaternion.setFromAxisAngle(f.axis, f.theta);
    }
  }

  /** Wood and fruit released along the fallen trunk. */
  private dropHarvest(f: Fall): void {
    const count = Math.max(3, Math.min(40, Math.round(f.trunkCount * .8)));
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      const along = 1.0 + t * (5 + f.trunkCount * .5);
      const pos = new THREE.Vector3(
        f.pivot.x + f.dir.x * along + (Math.sin(i * 12.9) * .4),
        f.pivot.y + .55,
        f.pivot.z + f.dir.z * along + (Math.cos(i * 7.3) * .4),
      );
      this.spawnLoot(Block.Wood, pos);
    }
    if (f.fruitChance) {
      for (let i = 0; i < 2; i++) {
        const pos = new THREE.Vector3(
          f.pivot.x + f.dir.x * (2.5 + i * 2.2),
          f.pivot.y + .7,
          f.pivot.z + f.dir.z * (2.5 + i * 2.2),
        );
        this.spawnLoot(Block.Skyfruit, pos);
      }
    }
  }

  count(): number { return this.falls.length; }

  clear(): void {
    for (const f of this.falls) {
      this.scene.remove(f.group);
      f.mesh.geometry.dispose();
      f.material.dispose();
    }
    this.falls.length = 0;
  }

  dispose(): void {
    this.clear();
  }
}

function cellsSameTree(a: forest.TreeShape, b: forest.TreeShape): boolean {
  return a.tx === b.tx && a.tz === b.tz && a.baseY === b.baseY;
}

/** Builds one merged, face-culled mesh for the whole tree (trunk + canopy + fruit).
 * Vertices are relative to `pivot` so the rotation happens about the hinge. */
function buildTreeMesh(cells: Array<{ x: number; y: number; z: number; id: Block; kind: 'trunk' | 'leaf' | 'fruit'; accent: boolean }>, shape: forest.TreeShape, pivot: THREE.Vector3): { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; trunkCount: number; fruitChance: boolean } {
  const solid = new Set<string>();
  for (const c of cells) solid.add(`${c.x},${c.y},${c.z}`);

  const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
  let trunkCount = 0, fruitChance = false;
  // Colour lookup mirrors world.buildChunk: species trunk tints, canopy tints.
  for (const c of cells) {
    if (c.kind === 'trunk') trunkCount++;
    else if (c.kind === 'fruit') fruitChance = true;
    const tint: [number, number, number] = c.kind === 'trunk'
      ? forest.trunkTint(shape, c.y)
      : c.kind === 'fruit'
        ? hexToRGB(blockColor(Block.Skyfruit))
        : forest.leafTint(shape, c.x, c.y, c.z, c.accent);
    for (const face of FACES) {
      // Interior faces are hidden by other tree cells; keep only outside faces.
      if (solid.has(`${c.x + face.n[0]},${c.y + face.n[1]},${c.z + face.n[2]}`)) continue;
      const base = positions.length / 3;
      for (const v of face.v) {
        positions.push(c.x + v[0] - pivot.x, c.y + v[1] - pivot.y, c.z + v[2] - pivot.z);
        normals.push(face.n[0], face.n[1], face.n[2]);
        colors.push(tint[0] * face.shade, tint[1] * face.shade, tint[2] * face.shade);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  return { geometry, material, trunkCount, fruitChance };
}

function hexToRGB(hex: number): [number, number, number] {
  return [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
}
