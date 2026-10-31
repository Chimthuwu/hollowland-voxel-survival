import type { Vector3 } from 'three';
import { Block, type Biome, type World } from './world';

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
