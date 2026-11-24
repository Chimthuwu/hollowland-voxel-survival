/** Pure steering helper: find a direction around a solid obstacle.
 *
 * Mobs used to stop dead whenever the cell ahead was solid and a jump was not
 * possible (low ceiling, mid-air, tall wall). Trying the perpendicular and
 * diagonal directions lets them skirt ordinary cover instead of grinding into
 * it. The caller still owns gravity, jumping and the actual step distance.
 */
export type SolidAt = (x: number, y: number, z: number) => boolean;

export interface Direction { x: number; z: number }

/**
 * Returns a unit-ish direction that is clear at (x, y, z), preferring the
 * requested direction, then the two 90° turns, then the diagonals. `{x:0,z:0}`
 * means every option is blocked — the mob should wait rather than phase into
 * terrain.
 */
export function detourDirection(
  solid: SolidAt, x: number, y: number, z: number, dx: number, dz: number,
): Direction {
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return { x: 0, z: 0 };
  const ux = dx / length, uz = dz / length;
  const probeY = y + .3;
  if (!solid(x + ux, probeY, z + uz)) return { x: ux, z: uz };
  // sin/cos of ±45°, ±90° and ±135° relative to the desired heading.
  for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4]) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const tx = ux * c - uz * s, tz = ux * s + uz * c;
    if (!solid(x + tx, probeY, z + tz)) return { x: tx, z: tz };
  }
  return { x: 0, z: 0 };
}
