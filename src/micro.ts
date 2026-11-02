/**
 * Microblock / chisel system.
 *
 * Vintage Story's signature building mechanic: a normal block can be carved
 * into a fine sub-grid so players can make architectural detail instead of
 * living with big cubes. Here a block is divided into
 *
 *   MICRO_COLUMNS x MICRO_COLUMNS columns  (8 x 8 across the block face)
 *   MICRO_LEVELS    vertical levels         (16 sub-steps tall)
 *
 * Every column stores a 16-bit mask: bit L set means the 1/16-tall slab at
 * level L is solid. That single mask expresses slabs, steps, slopes, arches,
 * window openings and free-form sculpture alike, and it meshes cheaply:
 * a column is a vertical run of solid levels with the exposed faces only.
 *
 * The learning curve is deliberately gentler than Vintage Story:
 *  - one tool (no off-hand hammer, no mode menus)
 *  - left click shaves the exact sub-cell you are pointing at
 *  - right click stamps a whole shape onto the block (window, arch, pillar...)
 *  - one key cycles the shape
 */

export const MICRO_COLUMNS = 8;
export const MICRO_LEVELS = 16;
export const MICRO_COLUMN_SIZE = 1 / MICRO_COLUMNS;
export const MICRO_LEVEL_SIZE = 1 / MICRO_LEVELS;

/** The decorative shapes a chisel can stamp onto a block. */
export type ShapeKind = 'window' | 'arch' | 'pillar' | 'slab' | 'cross' | 'column';

export const SHAPE_KINDS: readonly ShapeKind[] = ['window', 'arch', 'pillar', 'slab', 'cross', 'column'];

/** Human-readable names for the HUD hint line. */
export const SHAPE_LABELS: Record<ShapeKind, string> = {
  window: 'Window',
  arch: 'Arch',
  pillar: 'Pillar',
  slab: 'Slab',
  cross: 'Cross',
  column: 'Column',
};

/** Per-column solid mask for one block. */
export class MicroProfile {
  readonly mask: Uint16Array;

  constructor(fill = 0xffff) {
    this.mask = new Uint16Array(MICRO_COLUMNS * MICRO_COLUMNS).fill(fill & 0xffff);
  }

  column(ci: number, cj: number): number {
    return this.mask[cj * MICRO_COLUMNS + ci];
  }

  setColumn(ci: number, cj: number, value: number): void {
    this.mask[cj * MICRO_COLUMNS + ci] = value & 0xffff;
  }

  /** True when nothing at all is left of this block. */
  isEmpty(): boolean {
    for (let i = 0; i < this.mask.length; i++) if (this.mask[i] !== 0) return false;
    return true;
  }

  clone(): MicroProfile {
    const copy = new MicroProfile(0);
    copy.mask.set(this.mask);
    return copy;
  }
}

/** A brand new, fully solid profile. */
export function createProfile(): MicroProfile {
  return new MicroProfile(0xffff);
}

/** Splits a 16-bit mask into vertical runs of consecutive set bits. */
export function runs(mask: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  for (let level = 0; level <= MICRO_LEVELS; level++) {
    const solid = level < MICRO_LEVELS && (mask & (1 << level)) !== 0;
    if (solid && start < 0) start = level;
    else if (!solid && start >= 0) { out.push([start, level]); start = -1; }
  }
  return out;
}

/**
 * Rewrites a profile into one of the decorative shapes. Each shape keeps the
 * surrounding material so the result reads as carved detail, not a random blob.
 */
export function applyShape(profile: MicroProfile, shape: ShapeKind): void {
  const full = 0xffff;
  for (let cj = 0; cj < MICRO_COLUMNS; cj++) {
    for (let ci = 0; ci < MICRO_COLUMNS; ci++) {
      let mask = 0;
      switch (shape) {
        case 'window': {
          // A square opening through the middle of the block.
          const hole = ci >= 2 && ci <= 5 && cj >= 2 && cj <= 5;
          mask = hole ? (0x000f | 0xf000) : full;
          break;
        }
        case 'arch': {
          // A doorway with a solid lintel above it.
          const opening = (ci === 3 || ci === 4) && cj >= 3 && cj <= 4;
          mask = opening ? 0xfc00 : full;
          break;
        }
        case 'pillar': {
          // A free-standing column in the middle of the block.
          const centre = ci >= 2 && ci <= 5 && cj >= 2 && cj <= 5;
          mask = centre ? full : 0;
          break;
        }
        case 'slab': {
          // Bottom half only.
          mask = 0x00ff;
          break;
        }
        case 'cross': {
          // A plus sign with two-wide arms.
          const arm = (cj >= 3 && cj <= 4) || (ci >= 3 && ci <= 4);
          mask = arm ? full : 0;
          break;
        }
        case 'column': {
          // One single full-height column.
          mask = ci === 4 && cj === 4 ? full : 0;
          break;
        }
      }
      profile.setColumn(ci, cj, mask);
    }
  }
}

export interface MicroHit {
  /** Column index across X (0..MICRO_COLUMNS-1). */
  ci: number;
  /** Column index across Z (0..MICRO_COLUMNS-1). */
  cj: number;
  /** Vertical level (0..MICRO_LEVELS-1). */
  level: number;
}

/**
 * Converts a ray hit on a block face into the sub-cell the player is pointing
 * at, so the chisel removes exactly the piece under the crosshair.
 */
export function microCellFromHit(
  blockX: number, blockY: number, blockZ: number,
  point: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
): MicroHit {
  const clampCol = (v: number) => Math.max(0, Math.min(MICRO_COLUMNS - 1, Math.floor(v * MICRO_COLUMNS)));
  const clampLevel = (v: number) => Math.max(0, Math.min(MICRO_LEVELS - 1, Math.floor(v * MICRO_LEVELS)));
  const lx = point.x - blockX, ly = point.y - blockY, lz = point.z - blockZ;
  if (normal.x > 0) return { ci: MICRO_COLUMNS - 1, cj: clampCol(lz), level: clampLevel(ly) };
  if (normal.x < 0) return { ci: 0, cj: clampCol(lz), level: clampLevel(ly) };
  if (normal.z > 0) return { ci: clampCol(lx), cj: MICRO_COLUMNS - 1, level: clampLevel(ly) };
  if (normal.z < 0) return { ci: clampCol(lx), cj: 0, level: clampLevel(ly) };
  if (normal.y > 0) return { ci: clampCol(lx), cj: clampCol(lz), level: MICRO_LEVELS - 1 };
  return { ci: clampCol(lx), cj: clampCol(lz), level: 0 };
}

export interface MicroBuffers {
  positions: number[];
  normals: number[];
  tint: number[];
  effects: number[];
  indices: number[];
}

/**
 * Emits the geometry of one carved block into the shared chunk buffers.
 * `columnMaskAt` resolves the 16-level mask of a neighbouring column so
 * interior faces between columns and across block borders are culled.
 * Returns the number of vertices emitted.
 */
export function appendMicroGeometry(
  out: MicroBuffers,
  bx: number, by: number, bz: number,
  profile: MicroProfile,
  rgb: [number, number, number],
  columnMaskAt: (x: number, y: number, z: number, ci: number, cj: number) => number,
): number {
  const [r, g, b] = rgb;
  const rough = .85;
  const quad = (
    p0: [number, number, number], p1: [number, number, number],
    p2: [number, number, number], p3: [number, number, number],
    n: [number, number, number], shade: number,
  ) => {
    const base = out.positions.length / 3;
    for (const p of [p0, p1, p2, p3]) {
      out.positions.push(p[0], p[1], p[2]);
      out.normals.push(n[0], n[1], n[2]);
      out.tint.push(r * shade, g * shade, b * shade);
      out.effects.push(0);
    }
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const start = out.positions.length / 3;

  for (let cj = 0; cj < MICRO_COLUMNS; cj++) {
    for (let ci = 0; ci < MICRO_COLUMNS; ci++) {
      const own = profile.column(ci, cj);
      if (own === 0) continue;
      const x0 = bx + ci * MICRO_COLUMN_SIZE, x1 = x0 + MICRO_COLUMN_SIZE;
      const z0 = bz + cj * MICRO_COLUMN_SIZE, z1 = z0 + MICRO_COLUMN_SIZE;

      // Vertical neighbours decide whether the top/bottom of this column shows.
      const above = columnMaskAt(bx, by + 1, bz, ci, cj);
      const below = columnMaskAt(bx, by - 1, bz, ci, cj);

      // A level is a "top" when the level ABOVE it is empty, and a "bottom"
      // when the level BELOW it is empty. (own>>1 tests the level above.)
      let topMask = own & ~((own >> 1) & 0xffff);
      if (above & 1) topMask &= ~(1 << (MICRO_LEVELS - 1));
      let bottomMask = own & ~((own << 1) & 0xffff);
      if (below & 0x8000) bottomMask &= ~1;

      for (let level = 0; level < MICRO_LEVELS; level++) {
        const bit = 1 << level;
        if (topMask & bit) {
          const y = by + (level + 1) * MICRO_LEVEL_SIZE;
          quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], 1);
        }
        if (bottomMask & bit) {
          const y = by + level * MICRO_LEVEL_SIZE;
          quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], .55);
        }
      }

      // Side faces where the neighbouring column does not cover this one.
      const left = ci === 0
        ? columnMaskAt(bx - 1, by, bz, MICRO_COLUMNS - 1, cj)
        : profile.column(ci - 1, cj);
      const right = ci === MICRO_COLUMNS - 1
        ? columnMaskAt(bx + 1, by, bz, 0, cj)
        : profile.column(ci + 1, cj);
      const back = cj === 0
        ? columnMaskAt(bx, by, bz - 1, ci, MICRO_COLUMNS - 1)
        : profile.column(ci, cj - 1);
      const front = cj === MICRO_COLUMNS - 1
        ? columnMaskAt(bx, by, bz + 1, ci, 0)
        : profile.column(ci, cj + 1);

      const side = (exposed: number, plane: number, axis: 'x' | 'z', sign: number) => {
        for (const [l0, l1] of runs(exposed & 0xffff)) {
          const y0 = by + l0 * MICRO_LEVEL_SIZE, y1 = by + l1 * MICRO_LEVEL_SIZE;
          if (axis === 'x') {
            const shade = sign > 0 ? .82 : .72;
            if (sign > 0) quad([plane, y0, z0], [plane, y1, z0], [plane, y1, z1], [plane, y0, z1], [1, 0, 0], shade);
            else quad([plane, y0, z1], [plane, y1, z1], [plane, y1, z0], [plane, y0, z0], [-1, 0, 0], shade);
          } else {
            const shade = sign > 0 ? .9 : .65;
            if (sign > 0) quad([x1, y0, plane], [x1, y1, plane], [x0, y1, plane], [x0, y0, plane], [0, 0, 1], shade);
            else quad([x0, y0, plane], [x0, y1, plane], [x1, y1, plane], [x1, y0, plane], [0, 0, -1], shade);
          }
        }
      };
      side(own & ~right, x1, 'x', 1);
      side(own & ~left, x0, 'x', -1);
      side(own & ~front, z1, 'z', 1);
      side(own & ~back, z0, 'z', -1);
    }
  }
  return out.positions.length / 3 - start;
}
