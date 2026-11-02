import { Block } from './world';

/**
 * Mining tiers and the block mining table.
 *
 * Tier 0 is bare hands. Tier 1..3 come from knapping quality (rough / good /
 * fine) and are recorded on the inventory as `toolTier`. The beam weapon is a
 * tier-3 tool: it is crafted from crystal, which is tier-2 ore.
 *
 * A block whose required tier exceeds the player's effective tier cannot be
 * broken at all. That is the gate that makes ore tiers matter.
 */

/** The beam weapon counts as a tier-3 tool. */
export const BEAM_TIER = 3;

/** How a block behaves when mined. */
export interface MiningSpec {
  /** Hit points. The beam drains this at BEAM_DPS. */
  hardness: number;
  /** Minimum tool tier needed to break it at all. */
  tier: number;
  /** Bare hands can break these instantly. */
  soft?: boolean;
}

const M = (hardness: number, tier: number, soft = false): MiningSpec => ({ hardness, tier, soft });

export const MINING: Partial<Record<Block, MiningSpec>> = {
  [Block.Dirt]:      M(15, 0, true),
  [Block.Grass]:     M(15, 0, true),
  [Block.Sand]:      M(12, 0, true),
  [Block.Snow]:      M(10, 0, true),
  // Water is not mineable: any tier still refuses it below the soft floor.
  [Block.Water]:     M(9999, 99),
  [Block.Wood]:      M(18, 0, true),
  [Block.Mud]:       M(22, 0, true),
  [Block.Scaffold]:  M(16, 0, true),
  [Block.Torch]:     M(8,  0, true),
  [Block.Leaf]:      M(6,  0, true),
  [Block.Skyfruit]:  M(8,  0, true),
  [Block.Morsel]:    M(8,  0, true),
  [Block.Scorched]:  M(30, 0, true),

  [Block.Stone]:     M(60, 1),
  [Block.Bone]:      M(50, 1),
  [Block.Flesh]:     M(30, 1),
  [Block.Glitch]:    M(55, 1),
  [Block.Acid]:      M(25, 1),
  [Block.Totem]:     M(50, 1),
  [Block.CopperOre]: M(70, 1),

  [Block.Crystal]:   M(100, 2),
  [Block.EchoGem]:   M(140, 3),
};

export function miningSpec(id: Block): MiningSpec {
  return MINING[id] ?? M(30, 0, true);
}

/** The minimum tool tier needed to break a block. */
export function requiredTier(id: Block): number {
  return miningSpec(id).tier;
}

/** Bare hands can only break soft blocks; everything else needs a tool. */
export function canBreakBareHanded(id: Block): boolean {
  return miningSpec(id).soft === true;
}

/**
 * The tier the player can actually mine at: the best knapped tool, or the
 * beam weapon if they have one.
 */
export function effectiveTier(toolTier: number, hasBeam: boolean): number {
  return hasBeam ? Math.max(toolTier, BEAM_TIER) : toolTier;
}

/**
 * Whether a block can be broken at all. Returns a reason when it cannot, so
 * the HUD can tell the player what they are missing.
 */
export function canBreak(id: Block, tier: number): { ok: true } | { ok: false; reason: string } {
  if (id === Block.Water) return { ok: false, reason: 'WATER CANNOT BE MINED' };
  const spec = miningSpec(id);
  if (tier >= spec.tier) return { ok: true };
  if (tier === 0) return { ok: false, reason: 'YOU NEED A TOOL FOR THAT' };
  return { ok: false, reason: `YOUR TOOL IS TOO WEAK (NEEDS TIER ${spec.tier})` };
}

/** Melee damage for a swung tool. Bare hands are the floor. */
export function meleeDamage(tier: number, base: number, bonus = 0): number {
  const scale = [1, 1.35, 1.8, 2.4][Math.min(3, Math.max(0, tier))];
  return Math.round(base * scale) + bonus;
}

/** Uses a tier-N tool lasts before it needs re-knapping. */
export const TIER_DURABILITY: Record<number, number> = { 0: 0, 1: 60, 2: 120, 3: 200 };

/**
 * Beam damage per second. A better knapped focus makes the beam bite harder,
 * so the knapping minigame keeps paying off after the beam is crafted.
 */
export function beamDps(toolTier: number): number {
  return Math.round(80 * (1 + 0.2 * Math.min(3, Math.max(0, toolTier))));
}
