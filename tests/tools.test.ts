import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, World } from '../src/world';
import {
  BEAM_TIER, TIER_DURABILITY, beamDps, canBreak, canBreakBareHanded,
  effectiveTier, meleeDamage, requiredTier,
} from '../src/tools';
import { Inventory } from '../src/ui';

describe('mining tiers', () => {
  it('gates bare hands off everything but soft blocks', () => {
    expect(canBreakBareHanded(Block.Dirt)).toBe(true);
    expect(canBreakBareHanded(Block.Wood)).toBe(true);
    expect(canBreakBareHanded(Block.Stone)).toBe(false);
    expect(canBreakBareHanded(Block.CopperOre)).toBe(false);
    expect(canBreakBareHanded(Block.Crystal)).toBe(false);

    const refused = canBreak(Block.Stone, 0);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('TOOL');
  });

  it('orders ore tiers so each needs a better tool than the last', () => {
    expect(requiredTier(Block.Stone)).toBe(1);
    expect(requiredTier(Block.CopperOre)).toBe(1);
    expect(requiredTier(Block.Crystal)).toBe(2);
    expect(requiredTier(Block.EchoGem)).toBe(3);
    expect(requiredTier(Block.Crystal)).toBeGreaterThan(requiredTier(Block.CopperOre));
    expect(requiredTier(Block.EchoGem)).toBeGreaterThan(requiredTier(Block.Crystal));
  });

  it('lets a tier-N tool break its tier and nothing above', () => {
    expect(canBreak(Block.Stone, 1).ok).toBe(true);
    expect(canBreak(Block.CopperOre, 1).ok).toBe(true);
    expect(canBreak(Block.Crystal, 1).ok).toBe(false);
    expect(canBreak(Block.Crystal, 2).ok).toBe(true);
    expect(canBreak(Block.EchoGem, 2).ok).toBe(false);
    expect(canBreak(Block.EchoGem, 3).ok).toBe(true);
  });

  it('counts the beam weapon as a tier-3 tool', () => {
    expect(BEAM_TIER).toBe(3);
    expect(effectiveTier(0, false)).toBe(0);
    expect(effectiveTier(0, true)).toBe(3);
    expect(effectiveTier(2, true)).toBe(3);
    expect(effectiveTier(3, false)).toBe(3);
  });

  it('scales melee damage and beam dps with the tool tier', () => {
    expect(meleeDamage(0, 12)).toBe(12);
    expect(meleeDamage(3, 12)).toBeGreaterThan(meleeDamage(1, 12));
    expect(beamDps(3)).toBeGreaterThan(beamDps(0));
    expect(beamDps(0)).toBe(80);
  });
});

describe('tool durability', () => {
  it('wears down and drops a tier when the tool runs out', () => {
    const inventory = new Inventory();
    expect(inventory.wearTool()).toBe('none'); // no tool yet
    inventory.recordToolTier('good'); // tier 2
    expect(inventory.toolTier).toBe(2);
    expect(inventory.toolDurability).toBe(TIER_DURABILITY[2]);

    let result: string = 'worn';
    for (let i = 0; i < TIER_DURABILITY[2]; i++) result = inventory.wearTool();
    expect(result).toBe('broken');
    expect(inventory.toolTier).toBe(1);
    expect(inventory.toolDurability).toBe(TIER_DURABILITY[1]);
  });

  it('only ever raises the tier, never lowers it on a better knap', () => {
    const inventory = new Inventory();
    inventory.recordToolTier('rough');
    expect(inventory.toolTier).toBe(1);
    inventory.recordToolTier('broken');
    expect(inventory.toolTier).toBe(1);
    inventory.recordToolTier('fine');
    expect(inventory.toolTier).toBe(3);
  });
});

describe('ore placement', () => {
  it('places copper shallow, crystal mid and echo gems deep', () => {
    const world = new World(new THREE.Scene());
    const count = (id: Block, yMin: number, yMax: number) => {
      let n = 0;
      for (let x = -48; x < 48; x += 2) for (let z = -48; z < 48; z += 2)
        for (let y = yMax; y >= yMin; y -= 2) if (world.get(x, y, z) === id) n++;
      return n;
    };
    expect(count(Block.CopperOre, -14, -3)).toBeGreaterThan(0);
    expect(count(Block.Crystal, -32, -14)).toBeGreaterThan(0);
    expect(count(Block.EchoGem, -52, -32)).toBeGreaterThan(0);
    // Copper must not appear in the deep layer, and echo gems not near the surface.
    expect(count(Block.CopperOre, -32, -20)).toBe(0);
    expect(count(Block.EchoGem, -12, -3)).toBe(0);
    world.dispose();
  });
});
