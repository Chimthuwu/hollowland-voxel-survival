import { describe, expect, it } from 'vitest';
import {
  createKnappingPlan,
  isComplete,
  knappingQuality,
  knappingScore,
  removeFlake,
  toolHeadBlock,
  type KnapTool,
  type KnappingPlan,
} from '../src/knappingCore';

const TOOLS: KnapTool[] = ['pick', 'axe', 'blade'];

function chipAllRequired(plan: KnappingPlan): void {
  for (const c of plan.cells) {
    if (c.required) removeFlake(plan, c.x, c.y);
  }
}

function requiredSet(plan: KnappingPlan): string {
  return plan.cells
    .filter(c => c.required)
    .map(c => `${c.x},${c.y}`)
    .sort()
    .join('|');
}

describe('createKnappingPlan', () => {
  it('produces a 6x6 plan with requiredCount in 4..6 for every tool', () => {
    for (const tool of TOOLS) {
      const plan = createKnappingPlan(tool);
      expect(plan.gridSize).toBe(6);
      expect(plan.cells).toHaveLength(36);
      expect(plan.requiredCount).toBeGreaterThanOrEqual(4);
      expect(plan.requiredCount).toBeLessThanOrEqual(6);
      expect(plan.tool).toBe(tool);
      expect(plan.headName.length).toBeGreaterThan(0);
    }
  });

  it('marks every required cell as solid (required is a strict subset of solid)', () => {
    for (const tool of TOOLS) {
      const plan = createKnappingPlan(tool);
      for (const cell of plan.cells) {
        if (cell.required) {
          expect(cell.solid).toBe(true);
        }
      }
    }
  });

  it('keeps every cell present: true on construction', () => {
    for (const tool of TOOLS) {
      const plan = createKnappingPlan(tool);
      for (const cell of plan.cells) {
        expect(cell.present).toBe(true);
      }
    }
  });

  it('is deterministic — same tool produces identical layouts', () => {
    for (const tool of TOOLS) {
      const a = createKnappingPlan(tool);
      const b = createKnappingPlan(tool);
      expect(JSON.stringify(a.cells)).toBe(JSON.stringify(b.cells));
      expect(a.requiredCount).toBe(b.requiredCount);
      expect(a.headName).toBe(b.headName);
    }
  });

  it('keeps every cell coordinate within 0..gridSize-1', () => {
    for (const tool of TOOLS) {
      const plan = createKnappingPlan(tool);
      for (const cell of plan.cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(plan.gridSize);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeLessThan(plan.gridSize);
      }
    }
  });
});

describe('removeFlake', () => {
  it('returns "ok" for a required flake and marks it removed', () => {
    const plan = createKnappingPlan('pick');
    const required = plan.cells.find(c => c.required);
    expect(required).toBeDefined();
    if (!required) return;

    expect(removeFlake(plan, required.x, required.y)).toBe('ok');
    const after = plan.cells.find(c => c.x === required.x && c.y === required.y);
    expect(after?.present).toBe(false);
  });

  it('returns "already" for an empty cell (not solid)', () => {
    const plan = createKnappingPlan('pick');
    const empty = plan.cells.find(c => !c.solid);
    expect(empty).toBeDefined();
    if (!empty) return;
    expect(removeFlake(plan, empty.x, empty.y)).toBe('already');
    const after = plan.cells.find(c => c.x === empty.x && c.y === empty.y);
    expect(after?.present).toBe(true);
  });

  it('returns "already" on a second click of the same flake', () => {
    const plan = createKnappingPlan('pick');
    const required = plan.cells.find(c => c.required);
    if (!required) return;
    expect(removeFlake(plan, required.x, required.y)).toBe('ok');
    expect(removeFlake(plan, required.x, required.y)).toBe('already');
  });

  it('returns "wrong" for a solid-but-not-required flake and removes it', () => {
    const plan = createKnappingPlan('pick');
    const distractor = plan.cells.find(c => c.solid && !c.required);
    expect(distractor).toBeDefined();
    if (!distractor) return;
    expect(removeFlake(plan, distractor.x, distractor.y)).toBe('wrong');
    const after = plan.cells.find(c => c.x === distractor.x && c.y === distractor.y);
    expect(after?.present).toBe(false);
  });

  it('returns "already" for out-of-bounds coordinates', () => {
    const plan = createKnappingPlan('pick');
    expect(removeFlake(plan, -1, 0)).toBe('already');
    expect(removeFlake(plan, 0, -1)).toBe('already');
    expect(removeFlake(plan, 99, 99)).toBe('already');
  });

  it('wrong clicks lower the score relative to perfect play', () => {
    const perfect = createKnappingPlan('axe');
    chipAllRequired(perfect);
    const perfectScore = knappingScore(perfect, 0);

    const flawed = createKnappingPlan('axe');
    // Remove a distractor first (1 wrong click), then all required.
    const distractor = flawed.cells.find(c => c.solid && !c.required);
    if (!distractor) throw new Error('expected distractor');
    expect(removeFlake(flawed, distractor.x, distractor.y)).toBe('wrong');
    chipAllRequired(flawed);

    const flawedScore = knappingScore(flawed, 1);
    expect(flawedScore).toBeLessThan(perfectScore);
  });
});

describe('isComplete', () => {
  it('is false until every required flake is gone, then true', () => {
    const plan = createKnappingPlan('pick');
    expect(isComplete(plan)).toBe(false);

    const required = plan.cells.filter(c => c.required);
    for (let i = 0; i < required.length - 1; i++) {
      expect(removeFlake(plan, required[i].x, required[i].y)).toBe('ok');
      expect(isComplete(plan)).toBe(false);
    }
    const last = required[required.length - 1];
    expect(removeFlake(plan, last.x, last.y)).toBe('ok');
    expect(isComplete(plan)).toBe(true);
  });
});

describe('knappingScore and knappingQuality', () => {
  it('perfect play yields score 1 and quality "fine"', () => {
    const plan = createKnappingPlan('pick');
    chipAllRequired(plan);
    expect(isComplete(plan)).toBe(true);
    expect(knappingScore(plan, 0)).toBe(1);
    expect(knappingQuality(knappingScore(plan, 0))).toBe('fine');
  });

  it('quality cascades from fine → good → rough → broken with more wrong clicks', () => {
    const plan = createKnappingPlan('axe');
    chipAllRequired(plan);

    expect(knappingQuality(knappingScore(plan, 0))).toBe('fine');    // 1.00
    expect(knappingQuality(knappingScore(plan, 1))).toBe('good');   // 0.78
    expect(knappingQuality(knappingScore(plan, 2))).toBe('rough');  // 0.56
    expect(knappingQuality(knappingScore(plan, 3))).toBe('broken'); // 0.34
    expect(knappingQuality(knappingScore(plan, 5))).toBe('broken'); // 0 (floored)
  });

  it('incomplete plans still score proportionally to progress minus penalties', () => {
    const plan = createKnappingPlan('pick');
    const required = plan.cells.filter(c => c.required);
    // Remove half the required flakes (no wrong clicks).
    const half = Math.floor(required.length / 2);
    for (let i = 0; i < half; i++) removeFlake(plan, required[i].x, required[i].y);
    const expectedProgress = half / plan.requiredCount;
    expect(knappingScore(plan, 0)).toBeCloseTo(expectedProgress);
    expect(knappingScore(plan, 0)).toBeGreaterThan(0);
    expect(isComplete(plan)).toBe(false);
  });

  it('clamps the score to [0, 1] for extreme inputs', () => {
    const plan = createKnappingPlan('blade');
    chipAllRequired(plan);
    expect(knappingScore(plan, 0)).toBe(1);
    expect(knappingScore(plan, 1000)).toBe(0);
    // Incomplete with negative wrongClicks shouldn't go below 0.
    expect(knappingScore(plan, -5)).toBeGreaterThanOrEqual(0);
    expect(knappingScore(plan, -5)).toBeLessThanOrEqual(1);
  });
});

describe('toolHeadBlock', () => {
  it('returns the matching head name for each tool', () => {
    expect(toolHeadBlock('pick', 'fine')).toBe('Pick Head');
    expect(toolHeadBlock('axe', 'good')).toBe('Axe Head');
    expect(toolHeadBlock('blade', 'rough')).toBe('Blade Head');
    expect(toolHeadBlock('blade', 'broken')).toBe('Blade Head');
  });
});

describe('tool silhouettes', () => {
  it('three tools produce different required-cell sets', () => {
    const sets = TOOLS.map(t => requiredSet(createKnappingPlan(t)));
    expect(sets[0]).not.toBe(sets[1]);
    expect(sets[1]).not.toBe(sets[2]);
    expect(sets[0]).not.toBe(sets[2]);
  });

  it('each tool has a recognisable silhouette (pick: bar+point, axe: wedge, blade: diagonal)', () => {
    const pick = requiredSet(createKnappingPlan('pick')).split('|');
    const axe = requiredSet(createKnappingPlan('axe')).split('|');
    const blade = requiredSet(createKnappingPlan('blade')).split('|');

    // Pick: should contain (1,2), (2,2), (3,2), (4,2) — a 4-cell horizontal bar
    for (const key of ['1,2', '2,2', '3,2', '4,2']) {
      expect(pick).toContain(key);
    }
    // Pick: should also have a downward point at col 4
    expect(pick).toContain('4,3');
    expect(pick).toContain('4,4');

    // Axe: wedge at top row 2 + wider row 3
    expect(axe).toContain('2,2');
    expect(axe).toContain('3,2');
    expect(axe).toContain('2,3');
    expect(axe).toContain('3,3');
    expect(axe).toContain('4,3');

    // Blade: diagonal staircase
    expect(blade).toContain('1,2');
    expect(blade).toContain('2,2');
    expect(blade).toContain('2,3');
    expect(blade).toContain('3,3');
    expect(blade).toContain('3,4');
  });
});
