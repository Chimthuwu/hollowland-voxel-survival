import { Block, type World } from './world';

export interface PowerUpState {
  hasGravity: boolean;
  hasPlatform: boolean;
}

/** Fixed positions for the two MVP power-ups. Both lie inside entrance shafts
 *  so the player encounters them naturally on the way down. */
// Y must match the actual shaft air columns: at (48,-30) the ramp air is y=5..8,
// at (116,-16) it is y=7..10 (see ENTRANCES ramp carve in world.ts).
const GRAVITY_CHARM_POS: [number, number, number] = [48, 5, -30];
const PLATFORM_SEED_POS: [number, number, number] = [116, 7, -16];

/** Where the gravity multiplier lands when the charm is collected. */
export const REDUCED_GRAVITY = 0.55;

/**
 * Tracks which power-ups the player has picked up and detects newly-entered
 * pickup cells. The power-up blocks themselves are placed by World.get when
 * the player first loads nearby chunks; this class owns the resulting flags.
 */
export class PowerUps {
  hasGravity = false;
  hasPlatform = false;

  /** Place the charm/seed blocks at their fixed positions. Called once on world init. */
  static placeAll(world: World): void {
    const [gx, gy, gz] = GRAVITY_CHARM_POS;
    if (world.get(gx, gy, gz) !== Block.Air) return;
    world.set(gx, gy, gz, Block.GravityCharm);
    const [px, py, pz] = PLATFORM_SEED_POS;
    if (world.get(px, py, pz) !== Block.Air) return;
    world.set(px, py, pz, Block.PlatformSeed);
  }

  /** Returns the names of power-ups newly collected this tick. */
  update(world: World, x: number, y: number, z: number): string[] {
    const events: string[] = [];
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    // Check a 3x2x3 box around the player so we don't miss when sub-cell alignment is off.
    for (let dy = 0; dy < 2; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const block = world.get(fx, fy + dy, fz + dz);
        if (!this.hasGravity && block === Block.GravityCharm) {
          this.hasGravity = true;
          world.set(fx, fy + dy, fz + dz, Block.Air);
          events.push('gravity');
        } else if (!this.hasPlatform && block === Block.PlatformSeed) {
          this.hasPlatform = true;
          world.set(fx, fy + dy, fz + dz, Block.Air);
          events.push('platform');
        }
      }
    }
    return events;
  }

  state(): PowerUpState {
    return { hasGravity: this.hasGravity, hasPlatform: this.hasPlatform };
  }
}

/** Spawns a temporary platform under the player's feet if the cell is air. */
export function trySpawnPlatform(world: World, x: number, y: number, z: number): boolean {
  const fx = Math.floor(x), fy = Math.floor(y - 0.05), fz = Math.floor(z);
  if (world.get(fx, fy, fz) !== Block.Air) return false;
  world.set(fx, fy, fz, Block.Scaffold);
  return true;
}
