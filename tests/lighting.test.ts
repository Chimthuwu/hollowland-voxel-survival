import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { Block, type World } from '../src/world';
import { nearbyLight } from '../src/lighting';

describe('placed light and sanity wards', () => {
  const at = new Vector3(.5, 2, .5);
  const worldWith = (block: Block): Pick<World, 'get'> => ({get:(x,y,z) => x===1&&y===2&&z===0 ? block : Block.Air});
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
