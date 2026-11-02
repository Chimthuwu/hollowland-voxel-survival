import type { Vector3 } from 'three';
import { Block, type Biome, type World } from './world';

interface LightSource { x: number; y: number; z: number }

/**
 * Finds the nearest placed light (torch or totem) to a point, returning the
 * centre of its cell, or null when none is near. Creature AI uses this to
 * make certain wildlife drift toward placed lights — a drawn moth, furious
 * wasps — while light-fearing kinds recoil instead.
 */
export function lightSourceNear(world: Pick<World, 'get'>, p: { x: number; y: number; z: number }, radius = 9): LightSource | null {
  const fx = Math.floor(p.x), fy = Math.floor(p.y), fz = Math.floor(p.z);
  let best: LightSource | null = null, bestD = Infinity;
  for (let x = fx - radius; x <= fx + radius; x++)
    for (let y = Math.max(fy - 3, fy - radius); y <= fy + 3; y++)
      for (let z = fz - radius; z <= fz + radius; z++) {
        const block = world.get(x, y, z);
        if (block !== Block.Torch && block !== Block.Totem) continue;
        const cx = x + .5, cy = y + .5, cz = z + .5;
        const d = (cx - p.x) ** 2 + (cy - p.y) ** 2 + (cz - p.z) ** 2;
        if (d < bestD) { bestD = d; best = { x: cx, y: cy, z: cz }; }
      }
  return best;
}

export function nearbyLight(world: Pick<World, 'get'>, p: Vector3, biome: Biome): { lit: boolean; restore: boolean } {
  let lit = false, restore = false;
  for (let x = Math.floor(p.x)-4; x <= Math.floor(p.x)+4; x++)
    for (let y = Math.floor(p.y)-3; y <= Math.floor(p.y)+3; y++)
      for (let z = Math.floor(p.z)-4; z <= Math.floor(p.z)+4; z++) {
        if ((x-p.x)**2+(y-p.y)**2+(z-p.z)**2 > 20) continue;
        const block = world.get(x,y,z);
        if (block === Block.Torch || block === Block.Totem) lit = true;
        if (block === Block.Totem || (block === Block.Torch && biome === 'overcast')) restore = true;
      }
  return { lit, restore };
}

// ---------------------------------------------------------------------------
// Day-night cycle and local light bands.
//
// The world clock drives one full day: 0 is dawn, .25 midday, .5 dusk, .75
// midnight. `daylightLevel` turns that into a 0..1 brightness factor with soft
// dawn/dusk shoulders and a night floor so the world never turns pitch black.
// `shadeAt` classifies a position as locally dark (roofed, foliage-covered or
// underground), which creature ecology uses to decide who belongs where.
// ---------------------------------------------------------------------------

/** Seconds for one full day cycle (8 minutes: 2h day, 2h dusk, 2.5h night... compress). */
export const DAY_LENGTH = 480;

/** Normalised phase 0..1 of the day; wraps. 0=dawn, .25=midday, .5=dusk, .75=midnight. */
export function dayPhase(time: number): number {
  const raw = time / DAY_LENGTH;
  return raw - Math.floor(raw);
}

/** Smooth daylight brightness 0..12% darkness floor .. 100% full sun. */
export function daylightLevel(phase: number): number {
  const wave = Math.cos((phase - .25) * Math.PI * 2); // 1 at midday, -1 at midnight
  const day = Math.max(0, (wave + .25) / 1.25);
  return Math.min(1, .12 + .88 * day * day);
}

/** Readable label for HUD / debugging. */
export function timeOfDayLabel(phase: number): 'DAWN' | 'DAY' | 'DUSK' | 'NIGHT' {
  if (phase < .06 || phase >= .94) return 'DAWN';
  if (phase < .44) return 'DAY';
  if (phase < .56) return 'DUSK';
  return 'NIGHT';
}

/** Optional extra occluders above (e.g. leaf voxels owned by the foliage system). */
export type CanopyQuery = (x: number, y: number, z: number) => boolean;

/**
 * Exposure thresholds shared by creature ecology. Deep shade below
 * `stalkerHide` is where light-fearing creatures can exist in daylight; above
 * `stalkerHunt` the world reads as openly bright to them.
 */
export const MOB_LIGHT = { stalkerHide: .38, stalkerHunt: .72 } as const;

/**
 * True when a position is genuinely shaded: underground, under a solid roof,
 * or under foliage within a few blocks above the ground.
 */
export function shadeAt(
  world: Pick<World, 'get' | 'surface'>,
  x: number, y: number, z: number,
  canopy?: CanopyQuery,
): boolean {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  // Anything below the surface top block is inside terrain — caves and mines.
  if (fy <= world.surface(fx, fz) - 1) return true;
  for (let k = 1; k <= 7; k++) {
    if (world.get(fx, fy + k, fz) !== Block.Air) return true;
    if (canopy?.(fx, fy + k, fz)) return true;
  }
  return false;
}

/**
 * How exposed to light a position is, 0..1. Daylight, a cover overhead and
 * placed lights (torch/totem) all feed it, so creature ecology can use light
 * bands: >.7 bright, .35..7 partial, <.35 deep shade.
 */
export function exposureAt(
  world: Pick<World, 'get' | 'surface'>,
  x: number, y: number, z: number,
  phase: number,
  canopy?: CanopyQuery,
  litByPlacedLight?: boolean,
): number {
  const daylight = daylightLevel(phase);
  let exposure = daylight * (shadeAt(world, x, y, z, canopy) ? .32 : 1);
  if (litByPlacedLight) exposure = Math.max(.92, exposure);
  return Math.min(1, exposure);
}
