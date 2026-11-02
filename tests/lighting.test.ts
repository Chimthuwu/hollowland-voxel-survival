import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { Block, type World } from '../src/world';
import { nearbyLight, dayPhase, daylightLevel, DAY_LENGTH, timeOfDayLabel, shadeAt, exposureAt, lightSourceNear, MOB_LIGHT } from '../src/lighting';

describe('placed light and sanity wards', () => {
  const at = new Vector3(.5, 2, .5);
  const worldWith = (block: Block): Pick<World, 'get'> => ({get:(x:number,y:number,z:number) => x===1&&y===2&&z===0 ? block : Block.Air});
  it('illuminates underground torches without restoring sanity there', () => {
    expect(nearbyLight(worldWith(Block.Torch),at,'catacombs')).toEqual({lit:true, restore:false});
  });
  it('restores sanity from torches in the overcast', () => {
    expect(nearbyLight(worldWith(Block.Torch),at,'overcast')).toEqual({lit:true, restore:true});
  });
  it('restores sanity from a totem in a hostile biome', () => {
    expect(nearbyLight(worldWith(Block.Totem),at,'maw')).toEqual({lit:true, restore:true});
  });
  it('does not illuminate or restore without a source', () => {
    expect(nearbyLight(worldWith(Block.Air),at,'overcast')).toEqual({lit:false, restore:false});
  });
});

describe('day-night cycle', () => {
  it('wraps phase into [0, 1)', () => {
    expect(dayPhase(0)).toBe(0);
    expect(dayPhase(DAY_LENGTH)).toBe(0);
    expect(dayPhase(DAY_LENGTH * 1.37)).toBeCloseTo(.37, 5);
  });

  it('is brightest at midday and near-dark at midnight', () => {
    expect(daylightLevel(.25)).toBe(1);
    expect(daylightLevel(.75)).toBeLessThan(.2);
    expect(daylightLevel(.75)).toBeGreaterThan(0);
    // Midpoints of dawn and dusk land between the extremes.
    const dawnish = daylightLevel(.1);
    expect(dawnish).toBeGreaterThan(daylightLevel(.75));
    expect(dawnish).toBeLessThan(1);
  });

  it('labels readable time-of-day periods for the HUD', () => {
    expect(timeOfDayLabel(.25)).toBe('DAY');
    expect(timeOfDayLabel(.03)).toBe('DAWN');
    expect(timeOfDayLabel(.94)).toBe('DAWN'); // wrapping past midnight
    expect(timeOfDayLabel(.48)).toBe('DUSK');
    expect(timeOfDayLabel(.76)).toBe('NIGHT');
  });
});

describe('shade, exposure and mob light thresholds', () => {
  const openWorld: Pick<World, 'get' | 'surface'> = { get: () => Block.Air, surface: () => 5 };
  const roofWorld: Pick<World, 'get' | 'surface'> = { get: (_x:number,y:number,_z:number) => y === 10 ? Block.Stone : Block.Air, surface: () => 5 };

  it('detects deep shade under cover (e.g. a dense tree canopy) but not open sky', () => {
    expect(shadeAt(openWorld, 0, 6, 0)).toBe(false);
    expect(shadeAt(roofWorld, 0, 6, 0)).toBe(true);
    // Below ground height counts as shade too.
    expect(shadeAt(openWorld, 0, 4, 0)).toBe(true);
  });

  it('scales exposure from daylight level, shade and the night-light bonus', () => {
    const dayBright = exposureAt(openWorld, 0, 6, 0, .25);
    expect(dayBright).toBe(1);
    expect(exposureAt(roofWorld, 0, 6, 0, .25)).toBeLessThan(.5);
    expect(exposureAt(openWorld, 0, 6, 0, .75)).toBeGreaterThan(0);
    expect(exposureAt(openWorld, 0, 6, 0, .75)).toBeLessThan(.2);
    // A lit player or torch near the mob lifts the local exposure at night.
    expect(exposureAt(openWorld, 0, 6, 0, .75, undefined, true)).toBeGreaterThan(.5);
  });

  it('exposes the light-band thresholds mob AI uses', () => {
    expect(MOB_LIGHT.stalkerHide).toBeLessThan(MOB_LIGHT.stalkerHunt);
    expect(MOB_LIGHT.stalkerHide).toBeGreaterThan(0.3);
    expect(MOB_LIGHT.stalkerHunt).toBeLessThan(0.8);
  });

  it('finds the nearest placed light for attraction AI, or none', () => {
    const torchAt = (x: number, y: number, z: number): Pick<World, 'get'> => ({
      get: (bx: number, by: number, bz: number) => (bx === x && by === y && bz === z ? Block.Torch : Block.Air),
    });
    const found = lightSourceNear(torchAt(4, 1, 4), { x: .5, y: 1, z: .5 });
    expect(found).toEqual({ x: 4.5, y: 1.5, z: 4.5 });
    // Two lights: the nearer one wins.
    const twoLights: Pick<World, 'get'> = {
      get: (x, y, z) => ((x === 2 && y === 1 && z === 0) || (x === 5 && y === 1 && z === 0) ? Block.Torch : Block.Air),
    };
    const nearer = lightSourceNear(twoLights, { x: .5, y: 1, z: .5 });
    expect(nearer?.x).toBe(2.5);
    expect(lightSourceNear(torchAt(4, 1, 4), { x: .5, y: 1, z: .5 }, 2)).toBeNull(); // out of the scan radius
  });
});
