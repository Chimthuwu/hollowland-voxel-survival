/**
 * Pure logic for the knapping minigame. No DOM access — safe to import from
 * Node-side tests.
 */

export type KnapTool = 'pick' | 'axe' | 'blade';
export type KnapQuality = 'fine' | 'good' | 'rough' | 'broken';

export interface FlakeCell {
  /** Grid column, 0..GRID-1 */
  x: number;
  /** Grid row, 0..GRID-1 */
  y: number;
  /** True when this flake belongs to the core rock (as opposed to empty space). */
  solid: boolean;
  /** True when knapping this cell is required to reveal the target tool shape. */
  required: boolean;
  /** False once the player has chipped this flake away. */
  present: boolean;
}

export interface KnappingPlan {
  tool: KnapTool;
  gridSize: number;
  cells: FlakeCell[];
  /** Total cells that must be removed to complete the tool head. */
  requiredCount: number;
  /** Human-readable name of the resulting head, e.g. 'Flint Pick Head'. */
  headName: string;
}

/** Score threshold to quality mapping. */
const QUALITY_FINE = 0.95;
const QUALITY_GOOD = 0.75;
const QUALITY_ROUGH = 0.45;
/** Penalty per wrong click. */
const WRONG_PENALTY = 0.22;
/** Grid is fixed 6x6 — three rows of breathing room around a small silhouette. */
const GRID_SIZE = 6;

/**
 * Layouts are encoded as tuples [x, y, required]. Only solid cells are listed;
 * empty cells are inferred. Required cells are always a strict subset of solid
 * cells (enforced at construction time).
 */

// ─── Pick head: horizontal bar with a downward point on the right side ───
const PICK_REQUIRED: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [2, 2], [3, 2], [4, 2],
  [4, 3],
  [4, 4],
];
const PICK_SOLID: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [2, 1], [3, 1], [4, 1],
  [5, 2],
  [0, 3], [1, 3], [5, 3],
  [0, 4], [1, 4], [5, 4],
  [2, 5], [3, 5],
  ...PICK_REQUIRED,
];

// ─── Axe head: wedge wider at the base, like a chopping blade ───
const AXE_REQUIRED: ReadonlyArray<readonly [number, number]> = [
  [2, 2], [3, 2],
  [2, 3], [3, 3], [4, 3],
];
const AXE_SOLID: ReadonlyArray<readonly [number, number]> = [
  [2, 1], [3, 1],
  [1, 2], [4, 2],
  [1, 3], [5, 3],
  [2, 4], [3, 4], [4, 4],
  ...AXE_REQUIRED,
];

// ─── Blade head: a diagonal staircase that reads as a cutting edge ───
const BLADE_REQUIRED: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [2, 2],
  [2, 3], [3, 3],
  [3, 4],
];
const BLADE_SOLID: ReadonlyArray<readonly [number, number]> = [
  [2, 1], [3, 1],
  [3, 2],
  [1, 3], [4, 3],
  [2, 4],
  [1, 5], [2, 5],
  ...BLADE_REQUIRED,
];

interface ToolLayout {
  readonly headName: string;
  readonly solid: ReadonlySet<string>;
  readonly required: ReadonlySet<string>;
}

function toSet(cells: ReadonlyArray<readonly [number, number]>): Set<string> {
  const set = new Set<string>();
  for (const [x, y] of cells) set.add(`${x},${y}`);
  return set;
}

const LAYOUTS: Record<KnapTool, ToolLayout> = {
  pick: { headName: 'Flint Pick Head', solid: toSet(PICK_SOLID), required: toSet(PICK_REQUIRED) },
  axe: { headName: 'Stone Axe Head', solid: toSet(AXE_SOLID), required: toSet(AXE_REQUIRED) },
  blade: { headName: 'Flint Blade Head', solid: toSet(BLADE_SOLID), required: toSet(BLADE_REQUIRED) },
};

/**
 * Build a fresh plan for the given tool. The plan mutates as the player
 * chips flakes — never share a plan across players.
 */
export function createKnappingPlan(tool: KnapTool): KnappingPlan {
  const layout = LAYOUTS[tool];
  const cells: FlakeCell[] = [];
  let requiredCount = 0;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const key = `${x},${y}`;
      const solid = layout.solid.has(key);
      const required = solid && layout.required.has(key);
      if (required) requiredCount++;
      cells.push({ x, y, solid, required, present: true });
    }
  }
  return { tool, gridSize: GRID_SIZE, cells, requiredCount, headName: layout.headName };
}

/**
 * Attempt to chip the flake at (x, y). Mutates the plan in place.
 *   'ok'      — a required flake, chipped successfully
 *   'wrong'   — a solid flake but NOT required (mistake, also chipped)
 *   'already' — empty space, or already chipped
 */
export function removeFlake(plan: KnappingPlan, x: number, y: number): 'ok' | 'wrong' | 'already' {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'already';
  if (x < 0 || y < 0 || x >= plan.gridSize || y >= plan.gridSize) return 'already';
  const cell = plan.cells.find(c => c.x === x && c.y === y);
  if (!cell) return 'already';
  if (!cell.solid || !cell.present) return 'already';
  cell.present = false;
  return cell.required ? 'ok' : 'wrong';
}

/** True once every required flake has been chipped away. */
export function isComplete(plan: KnappingPlan): boolean {
  for (const cell of plan.cells) {
    if (cell.required && cell.present) return false;
  }
  return true;
}

/**
 * 0..1. A perfect run is 1.0; each wrong click costs WRONG_PENALTY. An
 * incomplete plan scores proportionally to progress (required removed /
 * required total) minus the wrong-click penalty (floor 0).
 */
export function knappingScore(plan: KnappingPlan, wrongClicks: number): number {
  if (plan.requiredCount === 0) return 1;
  let requiredRemoved = 0;
  for (const cell of plan.cells) {
    if (cell.required && !cell.present) requiredRemoved++;
  }
  const progress = requiredRemoved / plan.requiredCount;
  const penalty = Math.max(0, wrongClicks) * WRONG_PENALTY;
  const raw = progress - penalty;
  return Math.max(0, Math.min(1, raw));
}

/** Map a 0..1 score to a quality bucket. */
export function knappingQuality(score: number): KnapQuality {
  if (score >= QUALITY_FINE) return 'fine';
  if (score >= QUALITY_GOOD) return 'good';
  if (score >= QUALITY_ROUGH) return 'rough';
  return 'broken';
}

/** Display name of the resulting head block for the given tool. */
export function toolHeadBlock(tool: KnapTool, _quality: KnapQuality): 'Pick Head' | 'Axe Head' | 'Blade Head' {
  switch (tool) {
    case 'pick': return 'Pick Head';
    case 'axe': return 'Axe Head';
    case 'blade': return 'Blade Head';
  }
}
