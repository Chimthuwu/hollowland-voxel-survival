import * as THREE from 'three';
import { Block, type World } from './world';
import {
  applyShape, createProfile, microCellFromHit,
  MICRO_COLUMN_SIZE, MICRO_LEVEL_SIZE, MICRO_LEVELS,
  SHAPE_KINDS, SHAPE_LABELS, type MicroProfile, type ShapeKind,
} from './micro';

/**
 * The chisel: carves decorative detail into placed blocks.
 *
 * Vintage Story makes you hold a chisel in one hand and a hammer in the other
 * and edit a 16x16x16 grid in a modal UI. That is a lot of ceremony for a
 * first-time player, so Hollowland does it the friendly way:
 *
 *   - ONE tool. The chisel does everything. (No off-hand hammer.)
 *   - LEFT CLICK  -> shave off the exact sub-cell you are pointing at.
 *   - RIGHT CLICK -> stamp a whole decorative shape onto the block.
 *   - Press G     -> cycle the shape (window, arch, pillar, slab, cross, column).
 *
 * You always see the block you are carving, the target cell is highlighted in
 * the HUD, and nothing is ever lost: right-clicking the same cell again puts
 * the material back.
 */

export type ChiselMode = 'carve' | 'stamp';

export interface ChiselResult {
  /** What the player did this click. */
  action: 'carved' | 'restored' | 'stamped' | 'missed';
  x: number;
  y: number;
  z: number;
  /** Human-readable label for the HUD toast. */
  label: string;
}

/** Blocks that make no sense to carve (functional / decorative markers). */
const UNCARVABLE = new Set<Block>([Block.Air, Block.Torch, Block.Totem, Block.GravityCharm, Block.PlatformSeed]);

export class Chisel {
  /** Currently selected shape, cycled with the shape key. */
  shape: ShapeKind = 'window';
  /** Set while the pointer is over a carvable block; drives the HUD hint. */
  target: { x: number; y: number; z: number } | null = null;

  constructor(private readonly world: World) {}

  /** Advances to the next stamp shape and returns its label. */
  cycleShape(): string {
    const i = SHAPE_KINDS.indexOf(this.shape);
    this.shape = SHAPE_KINDS[(i + 1) % SHAPE_KINDS.length];
    return SHAPE_LABELS[this.shape];
  }

  /** The label of the current stamp shape. */
  get shapeLabel(): string { return SHAPE_LABELS[this.shape]; }

  /**
   * Resolves the sub-cell under the crosshair for the given ray hit.
   * Returns null when the block cannot be carved.
   */
  private resolve(hit: { x: number; y: number; z: number; previous: { x: number; y: number; z: number } }) {
    const id = this.world.get(hit.x, hit.y, hit.z);
    if (UNCARVABLE.has(id)) return null;
    // Which face did the ray enter through? The normal points from the
    // previous cell towards the hit cell.
    const normal = {
      x: Math.sign(hit.x - hit.previous.x),
      y: Math.sign(hit.y - hit.previous.y),
      z: Math.sign(hit.z - hit.previous.z),
    };
    // The exact point on the face, derived from the fractional cell coordinates.
    const point = {
      x: hit.x + (normal.x ? (normal.x > 0 ? 1 : 0) : .5),
      y: hit.y + (normal.y ? (normal.y > 0 ? 1 : 0) : .5),
      z: hit.z + (normal.z ? (normal.z > 0 ? 1 : 0) : .5),
    };
    const cell = microCellFromHit(hit.x, hit.y, hit.z, point, normal);
    return { id, normal, cell };
  }

  /** The profile for a cell, creating a full one the first time it is carved. */
  private profileFor(x: number, y: number, z: number): MicroProfile {
    return this.world.microAt(x, y, z) ?? createProfile();
  }

  /**
   * The world-space centre and size of the sub-cell the chisel would remove,
   * so the UI can outline exactly the piece under the crosshair.
   */
  preview(hit: { x: number; y: number; z: number; previous: { x: number; y: number; z: number } }): { x: number; y: number; z: number; sx: number; sy: number; sz: number } | null {
    const resolved = this.resolve(hit);
    if (!resolved) return null;
    const { cell } = resolved;
    return {
      x: hit.x + (cell.ci + .5) * MICRO_COLUMN_SIZE,
      y: hit.y + (cell.level + .5) * MICRO_LEVEL_SIZE,
      z: hit.z + (cell.cj + .5) * MICRO_COLUMN_SIZE,
      sx: MICRO_COLUMN_SIZE * .96,
      sy: MICRO_LEVEL_SIZE * .96,
      sz: MICRO_COLUMN_SIZE * .96,
    };
  }

  /** Left click: shave one sub-cell off the pointed column, or restore it if
   *  that cell was already removed. Never destructive beyond one 1/8 x 1/8 x 1/16
   *  sliver, so a misclick is always undoable with one more click. */
  carve(hit: { x: number; y: number; z: number; previous: { x: number; y: number; z: number } }): ChiselResult {
    const resolved = this.resolve(hit);
    if (!resolved) return { action: 'missed', x: hit.x, y: hit.y, z: hit.z, label: 'Nothing to carve here.' };
    const { cell } = resolved;
    const profile = this.profileFor(hit.x, hit.y, hit.z);
    const column = profile.column(cell.ci, cell.cj);
    const bit = 1 << cell.level;
    const wasSolid = (column & bit) !== 0;
    const next = wasSolid ? (column & ~bit) & 0xffff : (column | bit) & 0xffff;
    profile.setColumn(cell.ci, cell.cj, next);
    this.world.setMicro(hit.x, hit.y, hit.z, profile);
    return {
      action: wasSolid ? 'carved' : 'restored',
      x: hit.x, y: hit.y, z: hit.z,
      label: wasSolid ? 'Chipped away.' : 'Put back.',
    };
  }

  /** Right click: stamp the current decorative shape onto the whole block. */
  stamp(hit: { x: number; y: number; z: number; previous: { x: number; y: number; z: number } }): ChiselResult {
    const resolved = this.resolve(hit);
    if (!resolved) return { action: 'missed', x: hit.x, y: hit.y, z: hit.z, label: 'Nothing to carve here.' };
    const profile = createProfile();
    applyShape(profile, this.shape);
    this.world.setMicro(hit.x, hit.y, hit.z, profile);
    return {
      action: 'stamped',
      x: hit.x, y: hit.y, z: hit.z,
      label: `${SHAPE_LABELS[this.shape]} cut.`,
    };
  }

  /** Removes all carving from a cell (used when the block is mined away). */
  clear(x: number, y: number, z: number): void {
    this.world.clearMicro(x, y, z);
  }

  /**
   * The world-space size of one carved cell, for the HUD crosshair preview.
   */
  static get cellSize(): { x: number; y: number; z: number } {
    return { x: MICRO_COLUMN_SIZE, y: MICRO_LEVEL_SIZE, z: MICRO_COLUMN_SIZE };
  }

  /** The number of vertical steps a carved column has. */
  static get levels(): number { return MICRO_LEVELS; }
}
