import { describe, expect, it } from 'vitest';
import { detourDirection } from '../src/navigation';

/** A wall everywhere except a one-block-wide gap at z = 2. */
const wall = (x: number, y: number, z: number) => x > 0 && z !== 2;

describe('mob navigation', () => {
  it('keeps the direct heading when the way ahead is clear', () => {
    const dir = detourDirection(() => false, 0, 0, 0, 1, 0);
    expect(dir.x).toBeCloseTo(1);
    expect(dir.z).toBeCloseTo(0);
  });

  it('skirts a wall instead of grinding into it', () => {
    const dir = detourDirection(wall, 0, 0, 0, 1, 0);
    expect(dir.x).toBeLessThan(1);
    expect(Math.abs(dir.z)).toBeGreaterThan(.5);
    // The chosen cell really is open at the mob's body height.
    expect(wall(0 + dir.x, .3, 0 + dir.z)).toBe(false);
  });

  it('returns zero when fully boxed in, so a mob never phases through terrain', () => {
    const dir = detourDirection(() => true, 0, 0, 0, 1, 0);
    expect(dir).toEqual({ x: 0, z: 0 });
  });

  it('handles a zero-length request without dividing by zero', () => {
    expect(detourDirection(() => false, 0, 0, 0, 0, 0)).toEqual({ x: 0, z: 0 });
  });
});
