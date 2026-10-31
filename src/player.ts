import { Vector3 } from 'three';

export type Solid = (x: number, y: number, z: number) => boolean;
export interface MotionInput { forward: number; strafe: number; jump: boolean; yaw: number }

/** Axis-separated, sub-stepped AABB movement. Position is at the player's feet. */
export class Player {
  readonly position: Vector3;
  verticalVelocity = 0;
  grounded = false;
  readonly radius = 0.29;
  readonly height = 1.75;
  constructor(x: number, y: number, z: number) { this.position = new Vector3(x, y, z); }
  collides(x: number, y: number, z: number, solid: Solid): boolean {
    const e = 1e-5;
    for (let bx = Math.floor(x - this.radius + e); bx <= Math.floor(x + this.radius - e); bx++)
      for (let by = Math.floor(y + e); by <= Math.floor(y + this.height - e); by++)
        for (let bz = Math.floor(z - this.radius + e); bz <= Math.floor(z + this.radius - e); bz++)
          if (solid(bx, by, bz)) return true;
    return false;
  }
  step(dt: number, input: MotionInput, solid: Solid, gravityMultiplier: number, wind: number, speedMultiplier = 1): number {
    dt = Math.min(dt, 0.05);
    const norm = Math.max(1, Math.hypot(input.forward, input.strafe));
    const f = input.forward / norm, s = input.strafe / norm;
    const speed = 4.5 * speedMultiplier;
    const dx = (Math.cos(input.yaw) * s - Math.sin(input.yaw) * f) * speed + wind;
    const dz = (-Math.sin(input.yaw) * s - Math.cos(input.yaw) * f) * speed;
    if (input.jump && this.grounded) { this.verticalVelocity = 7.5; this.grounded = false; }
    this.verticalVelocity = Math.max(-35, this.verticalVelocity - 20 * gravityMultiplier * dt);
    const dy = this.verticalVelocity * dt;
    let impact = 0;
    const moveAxis = (axis: 'x' | 'y' | 'z', amount: number) => {
      const steps = Math.max(1, Math.ceil(Math.abs(amount) / 0.1));
      const step = amount / steps;
      for (let i = 0; i < steps; i++) {
        const p = this.position.clone(); p[axis] += step;
        if (this.collides(p.x, p.y, p.z, solid)) {
          if (axis === 'y') { if (step < 0) { impact = Math.max(impact, -this.verticalVelocity); this.grounded = true; } this.verticalVelocity = 0; }
          break;
        }
        this.position[axis] += step;
      }
    };
    moveAxis('x', dx * dt); moveAxis('z', dz * dt);
    this.grounded = false; moveAxis('y', dy);
    // Probe a tiny distance underfoot, even if horizontal movement occupied a frame.
    if (!this.grounded && this.verticalVelocity <= 0) this.grounded = this.collides(this.position.x, this.position.y - 0.025, this.position.z, solid);
    return impact;
  }
}
