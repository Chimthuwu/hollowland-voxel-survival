import { Block } from './world';

/** One smelting recipe: refine an ore into its bar, consuming wood fuel. */
export interface SmeltRecipe {
  input: Block;
  output: Block;
  /** Wood fuel consumed per smelt. */
  fuel: number;
  /** XP awarded to the player for the refinement. */
  xp: number;
}

/** Ore -> bar refinements. Bars are the refined ingredient used in
 *  higher-tier crafting and give XP toward the player level. */
export const SMELTING: ReadonlyArray<SmeltRecipe> = [
  { input: Block.CopperOre, output: Block.CopperBar, fuel: 1, xp: 8 },
  { input: Block.Crystal,   output: Block.CrystalBar,   fuel: 2, xp: 20 },
  { input: Block.EchoGem,   output: Block.EchoBar,   fuel: 3, xp: 40 },
];

export function smeltRecipeFor(input: Block): SmeltRecipe | undefined {
  return SMELTING.find(r => r.input === input);
}

/** XP awarded for completing each crafting recipe. */
export const CRAFT_XP: Record<string, number> = {
  torch: 2, weapon: 6, scaffold: 2, totem: 8, beam: 30, chisel: 4,
  knapPick: 8, knapAxe: 8, knapBlade: 8,
  plate: 14, clawShiv: 10, hideGuard: 12, bandage: 2,
  smeltCopper: 8, smeltCrystal: 20, smeltEcho: 40,
};

/** Total XP required to reach a given 1-based level. Grows quadratically so
 *  each new level costs meaningfully more than the last. */
export function xpForLevel(level: number): number {
  return Math.round(25 * level * (level - 1));
}
