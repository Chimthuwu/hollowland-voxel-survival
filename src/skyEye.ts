import { Block, type World } from './world';

export interface EyePoint { x: number; y: number; z: number }

export interface SkyEyeLayout {
  center: EyePoint;
  radius: number;
  /** Pixel-arcade sclera: a square ring of glowing crystal. */
  sclera: EyePoint[];
  /** Inner iris: echo gem, the rarest ore, glinting from the sky. */
  iris: EyePoint[];
  /** One dark scorched pixel as the pupil. */
  pupil: EyePoint;
}

/**
 * A wholly decorative landmark hanging above the sky beacon: the eye that
 * watches the climb. Pure and deterministic from the beacon coordinates, so a
 * seeded world rebuilds it identically; it deals no damage and drops nothing.
 */
export function skyEyeLayout(beacon: { x: number; y: number; z: number; w: number; d: number }): SkyEyeLayout {
  const center = {
    x: beacon.x + Math.floor(beacon.w / 2),
    y: beacon.y + 9,
    z: beacon.z + Math.floor(beacon.d / 2),
  };
  const radius = 3;
  const sclera: EyePoint[] = [], iris: EyePoint[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const p = { x: center.x + dx, y: center.y, z: center.z + dz };
      const edge = Math.max(Math.abs(dx), Math.abs(dz));
      if (edge === radius) sclera.push(p);
      else if (edge <= 1) iris.push(p);
    }
  }
  const pupil = { ...center };
  return { center, radius, sclera, iris: iris.filter(p => p.x !== pupil.x || p.z !== pupil.z), pupil };
}

/** Places the eye into the world. Uses only existing blocks; no new entity. */
export function placeSkyEye(world: World, beacon: { x: number; y: number; z: number; w: number; d: number }): SkyEyeLayout {
  const layout = skyEyeLayout(beacon);
  world.setMany(layout.sclera, Block.Crystal);
  world.setMany(layout.iris, Block.EchoGem);
  world.set(layout.pupil.x, layout.pupil.y, layout.pupil.z, Block.Scorched);
  return layout;
}
