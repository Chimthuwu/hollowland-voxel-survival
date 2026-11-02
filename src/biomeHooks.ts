import * as THREE from 'three';
import { Block, type Biome, type World } from './world';

export type HookId =
  | 'dread'        // overcast: sanity bleeds faster in the dark
  | 'lightning'    // storm:   periodic lightning strikes (implemented in main.ts)
  | 'gravity'      // glitch:  gravity multiplier flips
  | 'inversion'    // psychosis: control inversion at low sanity (main.ts)
  | 'flesh'        // maw:     flesh underfoot eats your health
  | 'torchout'     // catacombs: nearby torches blow out
  | 'acid'         // veins:   acid pools burn
  | 'lowgravity';  // sky:     reduced gravity and faster movement

export interface HookInfo {
  id: HookId;
  label: string;
  description: string;
}

/** One primary hook per biome. The HUD surfaces the label so each region reads differently. */
export const HOOKS: Record<Biome, HookInfo> = {
  overcast:  { id: 'dread',      label: 'THE DREAD CLOSES IN', description: 'Unlit ground bleeds your sanity faster.' },
  storm:     { id: 'lightning',  label: 'THE STORM HUNTS',     description: 'Lightning strikes whatever stands tallest.' },
  glitch:    { id: 'gravity',    label: 'GRAVITY IS A LIE',     description: 'Physics forgets which way is down.' },
  psychosis: { id: 'inversion',  label: 'YOUR HANDS ARE NOT YOUR OWN', description: 'Low sanity turns your own input against you.' },
  maw:       { id: 'flesh',      label: 'FLESH CONSUMES',      description: 'Living ground drinks your health.' },
  catacombs: { id: 'torchout',   label: 'THE DARK EATS THE LIGHT', description: 'Torches do not stay lit down here.' },
  veins:     { id: 'acid',       label: 'THE VEIN BURNS',       description: 'Acidic pools eat through flesh.' },
  sky:       { id: 'lowgravity', label: 'THE SKY IS LIGHT',     description: 'Thin air lifts you and quickens your step.' },
};

export interface HookEffects {
  /** Health to remove this tick (already scaled by dt by the caller when needed). */
  damage: number;
  /** Audio event to play, if any. */
  sound: 'heartbeat' | 'gust' | 'bubble' | 'squelch' | null;
  /** One-line HUD message, or null for no change. */
  message: string | null;
  /** Extra sanity drain per second beyond the global rate. */
  sanityDrain: number;
  /** Multiplier applied to the biome's own gravity value. */
  gravityScale: number;
  /** Multiplier applied to base movement speed. */
  speedScale: number;
}

const NO_EFFECTS: HookEffects = { damage: 0, sound: null, message: null, sanityDrain: 0, gravityScale: 1, speedScale: 1 };

export interface HookContext {
  world: Pick<World, 'get'>;
  player: THREE.Vector3;
  /** Whether a torch or totem is lighting the player right now. */
  lit: boolean;
  sanity: number;
  health: number;
  dt: number;
  time: number;
  /** Set false by the "reduce visual intensity" accessibility toggle. */
  intense: boolean;
}

/**
 * Per-biome hooks. Pure logic over world queries so every rule is unit
 * testable without a renderer. Hooks that need to mutate the world (torch
 * blowouts) do so through the same World interface the game already uses.
 */
export class BiomeHooks {
  private heartbeatTimer = 0;
  private torchoutTimer = 6;
  private bubbleTimer = 0;
  private squelchTimer = 0;
  private lastMessage = '';

  constructor(private readonly world: Pick<World, 'get' | 'set'>) {}

  /** True when the player is standing in/next to a damaging surface block. */
  private surfaceUnder(player: THREE.Vector3): Block {
    return this.world.get(Math.floor(player.x), Math.floor(player.y - .08), Math.floor(player.z));
  }

  tick(biome: Biome, ctx: HookContext): HookEffects {
    switch (biome) {
      case 'overcast': return this.dread(ctx);
      case 'storm': return { ...NO_EFFECTS };
      case 'glitch': return { ...NO_EFFECTS };
      case 'psychosis': return { ...NO_EFFECTS };
      case 'maw': return this.flesh(ctx);
      case 'catacombs': return this.torchout(ctx);
      case 'veins': return this.acid(ctx);
      case 'sky': return { ...NO_EFFECTS, gravityScale: .65, speedScale: 1.15 };
    }
  }

  /** Overcast: unlit ground accelerates sanity loss, with a heartbeat cue. */
  private dread(ctx: HookContext): HookEffects {
    const effects = { ...NO_EFFECTS };
    if (ctx.lit) { this.heartbeatTimer = 0; return effects; }
    effects.sanityDrain = 1.2;
    this.heartbeatTimer -= ctx.dt;
    if (this.heartbeatTimer <= 0) {
      this.heartbeatTimer = ctx.sanity < 30 ? .55 : 1.2;
      effects.sound = 'heartbeat';
      effects.message = ctx.sanity < 30 ? 'YOUR HEART IS LOUD ENOUGH TO HEAR' : 'SOMETHING IS LISTENING';
    }
    return effects;
  }

  /** Maw: flesh underfoot eats health. */
  private flesh(ctx: HookContext): HookEffects {
    const effects = { ...NO_EFFECTS };
    if (this.surfaceUnder(ctx.player) !== Block.Flesh) return effects;
    effects.damage = 7 * ctx.dt;
    this.squelchTimer -= ctx.dt;
    if (this.squelchTimer <= 0) {
      this.squelchTimer = .5;
      effects.sound = 'squelch';
      effects.message = 'THE FLESH IS WARM';
    }
    return effects;
  }

  /** Catacombs: nearby torches blow out on a timer, deepening the dark. */
  private torchout(ctx: HookContext): HookEffects {
    const effects = { ...NO_EFFECTS };
    this.torchoutTimer -= ctx.dt;
    if (this.torchoutTimer > 0) return effects;
    this.torchoutTimer = 9 + Math.random() * 7;
    const px = Math.floor(ctx.player.x), py = Math.floor(ctx.player.y), pz = Math.floor(ctx.player.z);
    let blown = 0;
    for (let dx = -6; dx <= 6; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dz = -6; dz <= 6; dz++) {
          if (this.world.get(px + dx, py + dy, pz + dz) === Block.Torch) {
            this.world.set(px + dx, py + dy, pz + dz, Block.Air);
            blown++;
          }
        }
      }
    }
    if (blown > 0) {
      effects.sound = 'gust';
      effects.message = 'THE DARK EATS THE LIGHT';
    }
    return effects;
  }

  /** Veins: acid pools burn. */
  private acid(ctx: HookContext): HookEffects {
    const effects = { ...NO_EFFECTS };
    const under = this.surfaceUnder(ctx.player);
    const inAcid = under === Block.Acid;
    if (!inAcid) return effects;
    effects.damage = 11 * ctx.dt;
    this.bubbleTimer -= ctx.dt;
    if (this.bubbleTimer <= 0) {
      this.bubbleTimer = .65;
      effects.sound = 'bubble';
      effects.message = 'THE VEIN BURNS';
    }
    return effects;
  }

  /** Last non-null hook message, for HUD display. */
  message(): string {
    return this.lastMessage;
  }

  setMessage(value: string): void {
    this.lastMessage = value;
  }
}
