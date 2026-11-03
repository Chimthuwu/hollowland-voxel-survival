import * as THREE from 'three';
import { Block } from './world';
import { miningSpec } from './tools';

/**
 * Progressive, position-keyed block damage shared by every mining path
 * (hand tools, the PEW PEW shots and the crystal beam).
 *
 * State is keyed "x,y,z" so several blocks can be damaged at once and the
 * state follows the block, not the chunk. It survives look-aways and chunk
 * unload/reload — the world regenerates from noise, so an overlay left behind
 * on an unloaded chunk is harmless: it only reappears if the same cell still
 * holds the same block id when it is hit again (see `activeAt`), otherwise the
 * entry is dropped on first use.
 *
 * Rendering: one shared unit-cube geometry and per-family tinted materials,
 * drawn as a slightly oversized transparent shell around the damaged block.
 * Overlays never touch the chunk meshes, so terrain generation stays
 * deterministic and there are no full-chunk rebuilds on a hit.
 */

/** Material families that get a distinct damage read. */
export type DamageFamily = 'stone' | 'dirt' | 'wood' | 'crystal' | 'flesh' | 'metal';

/** How many visible damage stages an entry walks through before breaking. */
export const DAMAGE_STAGES = 4;

/** Family tint of the damage shell: cracks, chips, splinters or fractures. */
export const FAMILY_COLOR: Record<DamageFamily, number> = {
  stone: 0x0b0b0e,   // near-black fractures
  dirt: 0x3a2c1c,    // dry crumbling earth
  wood: 0x4a3018,    // warm splinter brown
  crystal: 0x9fffe8, // glowing fracture veins
  flesh: 0x661122,   // organic bruising
  metal: 0x8a8f96,   // cold dents / scratches
};

/** Which family a block belongs to, for damage feedback. */
export function familyFor(id: Block): DamageFamily {
  switch (id) {
    case Block.Stone:
    case Block.Bone:
    case Block.Glitch:
    case Block.Totem:
    case Block.CopperOre:
    case Block.EchoGem:
      return 'stone';
    case Block.Crystal:
      return 'crystal';
    case Block.Dirt:
    case Block.Grass:
    case Block.Sand:
    case Block.Snow:
    case Block.Mud:
    case Block.Scorched:
      return 'dirt';
    case Block.Wood:
    case Block.Scaffold:
    case Block.Torch:
    case Block.Leaf:
    case Block.Skyfruit:
    case Block.Morsel:
      return 'wood';
    case Block.Flesh:
    case Block.Acid:
      return 'flesh';
    default:
      return 'stone';
  }
}

interface DamageEntry {
  id: Block;
  hp: number;
  damage: number;
  stage: number;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  lastHit: number;
}

/** Seconds an untouched entry stays visible before its overlay fades out. */
const ENTRY_TTL = 30;

export class BlockDamage {
  private readonly entries = new Map<string, DamageEntry>();
  private readonly geometry = new THREE.BoxGeometry(1.006, 1.006, 1.006);
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>();
  /** Lazily-allocated pool so a long session never grows unbounded. */
  private readonly pool: DamageEntry[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  private materialFor(family: DamageFamily): THREE.MeshBasicMaterial {
    let material = this.materials.get(family);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        color: FAMILY_COLOR[family],
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      this.materials.set(family, material);
    }
    return material;
  }

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  private acquire(family: DamageFamily, now: number): DamageEntry {
    const pooled = this.pool.pop();
    if (pooled) {
      pooled.material = this.materialFor(family);
      pooled.mesh.material = pooled.material;
      pooled.lastHit = now;
      return pooled;
    }
    const material = this.materialFor(family);
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.visible = false;
    this.scene.add(mesh);
    return { id: Block.Air, hp: 1, damage: 0, stage: 0, mesh, material, lastHit: now };
  }

  /** Applies `amount` damage to the block at (x,y,z). Returns stage ratio and whether it broke. */
  hit(x: number, y: number, z: number, id: Block, amount: number, now: number): { ratio: number; stage: number; broken: boolean } {
    const key = this.key(x, y, z);
    let entry = this.entries.get(key);
    if (entry && entry.id !== id) {
      // The block was replaced since the last hit; the old state is stale.
      this.release(key, entry);
      entry = undefined;
    }
    if (!entry) {
      entry = this.acquire(familyFor(id), now);
      entry.id = id;
      entry.hp = miningSpec(id).hardness;
      entry.damage = 0;
      entry.stage = 0;
      this.entries.set(key, entry);
    }
    entry.damage += amount;
    entry.lastHit = now;
    const broken = entry.damage >= entry.hp;
    if (broken) {
      this.release(key, entry);
      return { ratio: 1, stage: DAMAGE_STAGES, broken: true };
    }
    const ratio = entry.damage / entry.hp;
    const stage = Math.min(DAMAGE_STAGES - 1, Math.floor(ratio * DAMAGE_STAGES));
    if (stage !== entry.stage) {
      entry.stage = stage;
    }
    entry.mesh.visible = true;
    entry.mesh.position.set(x + .5, y + .5, z + .5);
    entry.material.opacity = 0.18 + 0.62 * (stage / (DAMAGE_STAGES - 1));
    return { ratio, stage, broken: false };
  }

  /** True when the cell still holds the same block id as the tracked damage. */
  activeAt(x: number, y: number, z: number, id: Block): boolean {
    const entry = this.entries.get(this.key(x, y, z));
    return entry !== undefined && entry.id === id;
  }

  /** Current damage ratio for an intact tracked block (used by beam visuals). */
  ratioAt(x: number, y: number, z: number): number {
    const entry = this.entries.get(this.key(x, y, z));
    if (!entry) return 0;
    return Math.min(1, entry.damage / entry.hp);
  }

  /** Clears an entry when its block is destroyed or replaced. */
  reset(x: number, y: number, z: number): void {
    const key = this.key(x, y, z);
    const entry = this.entries.get(key);
    if (entry) this.release(key, entry);
  }

  private release(key: string, entry: DamageEntry): void {
    entry.mesh.visible = false;
    entry.material.opacity = 0;
    this.entries.delete(key);
    if (this.pool.length < 64) this.pool.push(entry);
  }

  /** Hides overlays of entries that have not been hit for a while. */
  update(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.lastHit > ENTRY_TTL) {
        this.release(key, entry);
      }
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.entries.clear();
    this.pool.length = 0;
  }
}
