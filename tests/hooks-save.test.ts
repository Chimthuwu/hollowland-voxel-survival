import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, type World } from '../src/world';
import { BiomeHooks, HOOKS } from '../src/biomeHooks';
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
    const effects = hooks.tick('maw', ctx({ player: new THREE.Vector3(.5, .5, .5) }));
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
    const effects = hooks.tick('veins', ctx({ player: new THREE.Vector3(.5, .5, .5) }));
    expect(effects.damage).toBeGreaterThan(0);
    expect(effects.sound).toBe('bubble');
  });

  it('sky reduces gravity and raises movement speed', () => {
    const hooks = new BiomeHooks(mockWorld(() => Block.Air));
    const effects = hooks.tick('sky', ctx());
    expect(effects.gravityScale).toBeLessThan(1);
    expect(effects.speedScale).toBeGreaterThan(1);
  });
});

describe('save system', () => {
  const payload = {
    player: { x: 1, y: 2, z: 3, health: 80, sanity: 70, stamina: 60 },
    inventory: [{ id: Block.Crystal, count: 4 }],
    progression: { weapon: true, beam: false, hasGravity: true, hasPlatform: false },
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
