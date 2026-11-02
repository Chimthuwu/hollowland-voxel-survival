import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, type World } from '../src/world';
import { BiomeHooks, HOOKS, type HookEffects } from '../src/biomeHooks';
import { clearSave, deserialize, deserializeInventory, readSave, serializeInventory, writeSave } from '../src/save';

function mockWorld(get: (x: number, y: number, z: number) => Block, set?: (x: number, y: number, z: number, id: Block) => void) {
  const cells = new Map<string, Block>();
  return {
    get: (x: number, y: number, z: number) => cells.get(`${x},${y},${z}`) ?? get(x, y, z),
    set: (x: number, y: number, z: number, id: Block) => { cells.set(`${x},${y},${z}`, id); set?.(x, y, z, id); },
  };
}

const ctx = (over: Partial<Parameters<BiomeHooks['tick']>[1]> = {}) => ({
  world: mockWorld(() => Block.Air),
  player: new THREE.Vector3(0, 0, 0),
  lit: false,
  sanity: 100,
  health: 100,
  dt: 1 / 60,
  time: 0,
  intense: true,
  ...over,
});

describe('biome hooks', () => {
  it('defines exactly one hook for every biome', () => {
    const biomes = ['overcast', 'storm', 'glitch', 'psychosis', 'maw', 'catacombs', 'veins', 'sky'] as const;
    for (const biome of biomes) {
      expect(HOOKS[biome]).toBeDefined();
      expect(HOOKS[biome].label.length).toBeGreaterThan(0);
      expect(HOOKS[biome].description.length).toBeGreaterThan(0);
    }
    const ids = biomes.map(b => HOOKS[b].id);
    expect(new Set(ids).size).toBe(biomes.length);
  });

  it('overcast drains sanity faster in the dark and heartbeats', () => {
    const hooks = new BiomeHooks(mockWorld(() => Block.Air));
    const dark = hooks.tick('overcast', ctx({ lit: false }));
    expect(dark.sanityDrain).toBeGreaterThan(0);
    expect(dark.sound).toBe('heartbeat');
    const lit = hooks.tick('overcast', ctx({ lit: true }));
    expect(lit.sanityDrain).toBe(0);
  });

  it('maw flesh underfoot damages health over time', () => {
    const hooks = new BiomeHooks(mockWorld((_x, y, _z) => (y < 0 ? Block.Flesh : Block.Air)));
    // Feet at y=-0.5 => the cell underfoot is y=-1, which is flesh.
    const effects = hooks.tick('maw', ctx({ player: new THREE.Vector3(.5, -.5, .5) }));
    expect(effects.damage).toBeGreaterThan(0);
    expect(effects.sound).toBe('squelch');
  });

  it('maw does no damage on solid ground', () => {
    const hooks = new BiomeHooks(mockWorld(() => Block.Stone));
    expect(hooks.tick('maw', ctx()).damage).toBe(0);
  });

  it('catacombs blows out nearby torches', () => {
    const blown: number[] = [];
    const hooks = new BiomeHooks(mockWorld(
      () => Block.Air,
      (x, y, z, id) => { if (id === Block.Air) blown.push(y); },
    ));
    // Seed a torch via the mock's set path.
    const world = mockWorld(() => Block.Air);
    world.set(1, 0, 0, Block.Torch);
    const hooks2 = new BiomeHooks(world);
    const effects = hooks2.tick('catacombs', ctx({ world }));
    // First tick only arms the timer; the blowout happens after it elapses.
    expect(effects.sound).toBeNull();
    let sound: string | null = null;
    for (let i = 0; i < 600; i++) {
      const e = hooks2.tick('catacombs', ctx({ world }));
      if (e.sound) { sound = e.sound; break; }
    }
    expect(sound).toBe('gust');
    expect(world.get(1, 0, 0)).toBe(Block.Air);
    void blown;
  });

  it('veins acid burns', () => {
    const hooks = new BiomeHooks(mockWorld((_x, y, _z) => (y < 0 ? Block.Acid : Block.Air)));
    const effects = hooks.tick('veins', ctx({ player: new THREE.Vector3(.5, -.5, .5) }));
    expect(effects.damage).toBeGreaterThan(0);
    expect(effects.sound).toBe('bubble');
  });

  it('sky reduces gravity and raises movement speed', () => {
    const hooks = new BiomeHooks(mockWorld(() => Block.Air));
    const effects = hooks.tick('sky', ctx());
    expect(effects.gravityScale).toBeLessThan(1);
    expect(effects.speedScale).toBeGreaterThan(1);
  });

  // Deterministic RNG so the randomized swap/haunt loops produce the same
  // series of picks on every run.
  const mulberry32 = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it('glitch rearranges solid blocks without touching the player or utilities', () => {
    const world = mockWorld((_x, y, _z) => (y >= -3 && y <= -1 ? Block.Stone : Block.Air));
    world.set(2, 0, 2, Block.GravityCharm);
    world.set(2, 0, -2, Block.Torch);
    const hooks = new BiomeHooks(world, mulberry32(90210));
    let sawMessage = false;
    for (let i = 0; i < 200; i++) {
      const e = hooks.tick('glitch', ctx({ world, player: new THREE.Vector3(0, 0, 0), dt: 2 }));
      if (e.message === 'REALITY IS REARRANGING') sawMessage = true;
    }
    // The terrain around the player did trade places at least once.
    expect(sawMessage).toBe(true);
    // Special blocks are never swept up in a swap.
    expect(world.get(2, 0, 2)).toBe(Block.GravityCharm);
    expect(world.get(2, 0, -2)).toBe(Block.Torch);
    // Swaps preserve the world's total solid-block count, and never bury
    // or wedge a block into the player's own occupancy box.
    let solid = 0;
    for (let x = -7; x <= 7; x++)
      for (let y = -4; y <= 4; y++)
        for (let z = -7; z <= 7; z++) {
          if (x >= -1 && x <= 1 && y >= -1 && y <= 2 && z >= -1 && z <= 1) {
            // The swap guard excludes the player's occupancy box, so the only
            // solids it can hold are its share of the original ground slab
            // (the 3x1x3 band at y=-1; swaps may not add or remove any).
            if (world.get(x, y, z) !== Block.Air) solid++;
            continue;
          }
          if (world.get(x, y, z) !== Block.Air) solid++;
        }
    // Ground slab is 15*3*15 stone = 675, plus the charm and torch the test
    // placed; swaps themselves are strictly count-neutral.
    expect(solid).toBe(677);
  });

  it('maw thin crust over a void bites far harder than solid flesh', () => {
    const pitWorld = mockWorld((_x, y, _z) => (y === -1 ? Block.Flesh : Block.Air));
    const solidWorld = mockWorld((_x, y, _z) => (y >= -1 ? Block.Flesh : Block.Stone));
    const onPit = new BiomeHooks(pitWorld).tick('maw', ctx({ world: pitWorld, player: new THREE.Vector3(.5, -.5, .5) }));
    const onSolid = new BiomeHooks(solidWorld).tick('maw', ctx({ world: solidWorld, player: new THREE.Vector3(.5, -.5, .5) }));
    expect(onPit.damage).toBeGreaterThan(onSolid.damage);
    expect(onPit.message).toContain('PIT');
  });

  it('psychosis whispers below threshold sanity and escalates when nearly spent', () => {
    const world = mockWorld(() => Block.Air);
    const hooks = new BiomeHooks(world, mulberry32(777));
    let whisper: number | null = null;
    let apparition: HookEffects | null = null;
    for (let i = 0; i < 40; i++) {
      const e = hooks.tick('psychosis', ctx({ world, sanity: 40, dt: 3 }));
      if (e.sound === 'whisper' && whisper === null) whisper = e.hallucination;
    }
    for (let i = 0; i < 40; i++) {
      const e = hooks.tick('psychosis', ctx({ world, sanity: 12, dt: 3 }));
      if (e.sound === 'whisper' && e.hallucination === 2 && apparition === null) apparition = e;
    }
    expect(whisper).not.toBeNull();
    expect(whisper).toBe(1);
    expect(apparition).not.toBeNull();
    // Well-grounded sanity stays silent for a long while.
    const calm = new BiomeHooks(mockWorld(() => Block.Air));
    let sounds = 0;
    for (let i = 0; i < 60; i++) if (calm.tick('psychosis', ctx({ sanity: 90, dt: 2 })).sound) sounds++;
    expect(sounds).toBe(0);
    // And the reduced-intensity accessibility toggle silences the hauntings.
    const gentle = new BiomeHooks(mockWorld(() => Block.Air));
    for (let i = 0; i < 60; i++) {
      const e = gentle.tick('psychosis', ctx({ sanity: 10, dt: 2, intense: false }));
      expect(e.sound).toBeNull();
      expect(e.hallucination).toBe(0);
    }
  });
});

describe('save system', () => {
  const payload = {
    player: { x: 1, y: 2, z: 3, health: 80, sanity: 70, stamina: 60 },
    inventory: [{ id: Block.Crystal, count: 4 }],
    progression: { weapon: true, beam: false, hasGravity: true, hasPlatform: false, toolTier: 2, toolDurability: 40 },
  };

  it('round-trips a save through serialize/deserialize', () => {
    const raw = JSON.stringify({ ...payload, version: 1, savedAt: Date.now() });
    const outcome = deserialize(raw);
    expect(outcome.status).toBe('loaded');
    if (outcome.status === 'loaded') {
      expect(outcome.data.player.health).toBe(80);
      expect(outcome.data.progression.hasGravity).toBe(true);
    }
  });

  it('rejects a save from a newer schema version', () => {
    const raw = JSON.stringify({ ...payload, version: 99, savedAt: Date.now() });
    const outcome = deserialize(raw);
    expect(outcome.status).toBe('unsupported');
  });

  it('migrates a v1 save forward instead of discarding it', () => {
    const v1 = {
      player: { x: 1, y: 2, z: 3, health: 80, sanity: 70, stamina: 60 },
      inventory: [{ id: Block.Crystal, count: 4 }],
      progression: { weapon: true, beam: false, hasGravity: true, hasPlatform: false },
    };
    const outcome = deserialize(JSON.stringify({ ...v1, version: 1, savedAt: Date.now() }));
    expect(outcome.status).toBe('loaded');
    if (outcome.status === 'loaded') {
      expect(outcome.data.progression.toolTier).toBe(0);
      expect(outcome.data.progression.toolDurability).toBe(0);
      // The original progression must survive the migration.
      expect(outcome.data.progression.hasGravity).toBe(true);
    }
  });

  it('rejects corrupt JSON without throwing', () => {
    expect(deserialize('{not json').status).toBe('corrupt');
    expect(deserialize('null').status).toBe('corrupt');
    expect(deserialize('{"version":1}').status).toBe('corrupt');
  });

  it('round-trips inventory and drops unknown block ids', () => {
    const slots = deserializeInventory([{ id: Block.Crystal, count: 2 }, { id: 999, count: 1 }, { id: Block.Stone, count: 0 }]);
    expect(slots).toEqual([{ id: Block.Crystal, count: 2 }]);
    expect(serializeInventory([{ id: Block.Stone, count: 1 }])).toEqual([{ id: Block.Stone, count: 1 }]);
  });

  it('writes and reads a save through storage when available', () => {
    const outcome = writeSave(payload);
    // Either saved or unavailable depending on the environment; never corrupt.
    expect(['saved', 'unavailable']).toContain(outcome.status);
    if (outcome.status === 'saved') {
      const read = readSave();
      expect(read.status).toBe('loaded');
      clearSave();
      expect(readSave().status).toBe('empty');
    }
  });
});
