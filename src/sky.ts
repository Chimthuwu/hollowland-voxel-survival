import { Block, type World } from './world';

/**
 * Sky traversal.
 *
 * A deterministic, winding chain of scaffold platforms climbs from a landing
 * near spawn up through the clouds to a crystal beacon above y=64 — the
 * guaranteed sky target. Every hop is a one-gap, one-up jump, so nothing in
 * the route depends on the platform seed; the seed just makes improvising
 * your own routes possible. Along the way the chain hides caches (hung
 * crystal under some slabs), grows skyfruit on others and sets torches as
 * waymarks that read from the ground far below.
 */

export interface SkySlab {
  /** Min corner and extent of the scaffold slab, one voxel thick. */
  x: number; y: number; z: number; w: number; d: number;
  /** A torch stands on one corner of this slab. */
  torch: boolean;
  /** A skyfruit grows from the centre of this slab. */
  fruit: boolean;
  /** A crystal hangs hidden under this slab. */
  cache: boolean;
}

export interface SkyBeacon {
  x: number; y: number; z: number; w: number; d: number;
  totem: { x: number; y: number; z: number };
  crystals: Array<{ x: number; y: number; z: number }>;
  gems: Array<{ x: number; y: number; z: number }>;
}

export interface SkyLayout {
  start: SkySlab;
  slabs: SkySlab[];
  beacon: SkyBeacon;
}

/**
 * Pure layout builder: the same surface function always yields the same
 * chain, so regenerating the world on load rebuilds the identical route.
 */
export function skyLayout(surface: (x: number, z: number) => number, startX = 10, startZ = 5): SkyLayout {
  const slabs: SkySlab[] = [];
  let x = startX, z = startZ, y = Math.max(4, surface(startX, startZ));
  slabs.push({ x, y, z, w: 3, d: 3, torch: true, fruit: false, cache: false });
  // Alternate axis hops, drifting back and forth so the chain corkscrews
  // upward instead of ruling a straight line across the sky.
  const dzs = [0, 4, 0, 4, 0, -4, 0, -4];
  let step = 0;
  while (y < 63) {
    step++;
    const dz = dzs[(step - 1) % dzs.length];
    if (step % 2 === 1) x += 4; else z += dz;
    y += 1;
    slabs.push({
      x, y, z, w: 3, d: 3,
      torch: step % 6 === 0,
      fruit: step % 5 === 3,
      cache: step % 8 === 4,
    });
  }
  // The beacon: a 7x7 landing one step up from the last slab, crowned with a
  // totem-and-crystal light column, and echo gems set right into its floor —
  // the rarest tier of ore, reachable by nothing but the climb itself.
  const last = slabs[slabs.length - 1];
  const by = last.y + 1;
  const totem = { x: last.x + 3, y: by, z: last.z + 3 };
  return {
    start: slabs[0],
    slabs,
    beacon: {
      x: last.x, y: by, z: last.z, w: 7, d: 7,
      totem,
      crystals: [{ x: totem.x, y: by + 1, z: totem.z }, { x: totem.x, y: by + 2, z: totem.z }],
      gems: [
        { x: last.x + 1, y: by, z: last.z + 1 },
        { x: last.x + 5, y: by, z: last.z + 5 },
        { x: last.x + 1, y: by, z: last.z + 5 },
      ],
    },
  };
}

/** Carves nothing and builds only upward: applies the chain to the world. */
export function placeSky(world: World): SkyLayout {
  const layout = skyLayout((x, z) => world.surface(x, z));
  const cells: Array<{ x: number; y: number; z: number }> = [];
  const special = new Set<string>();
  const mark = (x: number, y: number, z: number) => { cells.push({ x, y, z }); special.add(`${x},${y},${z}`); };
  for (const slab of layout.slabs)
    for (let dx = 0; dx < slab.w; dx++)
      for (let dz = 0; dz < slab.d; dz++)
        mark(slab.x + dx, slab.y, slab.z + dz);
  const beacon = layout.beacon;
  for (let dx = 0; dx < beacon.w; dx++)
    for (let dz = 0; dz < beacon.d; dz++)
      mark(beacon.x + dx, beacon.y, beacon.z + dz);
  world.setMany(cells, Block.Scaffold);

  // Waymark torches, hanging caches, growing fruit.
  for (const slab of layout.slabs) {
    if (slab.torch) world.set(slab.x, slab.y + 1, slab.z, Block.Torch);
    if (slab.fruit) world.set(slab.x + 1, slab.y + 1, slab.z + 1, Block.Skyfruit);
    if (slab.cache) world.set(slab.x + 1, slab.y - 1, slab.z + 1, Block.Crystal);
  }
  // The beacon itself: totem base, crystal column, echo gems in the floor.
  for (const gem of beacon.gems) world.set(gem.x, gem.y, gem.z, Block.EchoGem);
  world.set(beacon.totem.x, beacon.totem.y, beacon.totem.z, Block.Totem);
  for (const crystal of beacon.crystals) world.set(crystal.x, crystal.y, crystal.z, Block.Crystal);
  return layout;
}
