import { describe, it, expect } from 'vitest';
import { Player } from '../src/player';

const floor = (_x: number, y: number, _z: number) => y < 0;

describe('player physics', () => {
  it('lands on a voxel floor instead of falling through it', () => {
    const player = new Player(0.5, 4, 0.5);
    for (let i = 0; i < 180; i++) player.step(1 / 60, { forward: 0, strafe: 0, jump: false, yaw: 0 }, floor, 1, 0);
    expect(player.position.y).toBeCloseTo(0, 2);
    expect(player.grounded).toBe(true);
  });
  it('stops against walls while preserving movement along the wall', () => {
    const solid = (x: number, y: number, z: number) => floor(x,y,z) || (x === 1 && y < 3);
    const player = new Player(0.5, 0, 0.5);
    for (let i = 0; i < 120; i++) player.step(1 / 60, { forward: 0, strafe: 1, jump: false, yaw: 0 }, solid, 1, 0);
    expect(player.position.x).toBeLessThanOrEqual(0.71);
  });
  it('jump rises above the floor', () => {
    const player = new Player(0.5, 0, 0.5);
    player.grounded = true;
    player.step(1/60, { forward: 0, strafe: 0, jump: true, yaw: 0 }, floor, 1, 0);
    expect(player.position.y).toBeGreaterThan(0);
  });
});
