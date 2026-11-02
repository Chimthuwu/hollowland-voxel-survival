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
  glitch:    { id: 'gravity',    label: 'GRAVITY IS A LIE',     description: 'Physics forgets which way is down, and the ground rearranges itself.' },
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
  sound: 'heartbeat' | 'gust' | 'bubble' | 'squelch' | 'shift' | 'whisper' | null;
  /** Non-zero when a psychosis hallucination fired this tick (1=whisper, 2=apparition). */
  hallucination: number;
  /** One-line HUD message, or null for no change. */
  message: string | null;
  /** Extra sanity drain per second beyond the global rate. */
  sanityDrain: number;
  /** Multiplier applied to the biome's own gravity value. */
  gravityScale: number;
  /** Multiplier applied to base movement speed. */
  speedScale: number;
}

const NO_EFFECTS: HookEffects = { damage: 0, sound: null, message: null, sanityDrain: 0, gravityScale: 1, speedScale: 1, hallucination: 0 };

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
  private swapTimer = 7;
  private hallucinationTimer = 5;
  private lastMessage = '';

  /** Injected for tests; production uses Math.random. */
  constructor(private readonly world: Pick<World, 'get' | 'set'>, private readonly rng: () => number = Math.random) {}

  /** True when the player is standing in/next to a damaging surface block. */
  private surfaceUnder(player: THREE.Vector3): Block {
    return this.world.get(Math.floor(player.x), Math.floor(player.y - .08), Math.floor(player.z));
  }

  tick(biome: Biome, ctx: HookContext): HookEffects {
    switch (biome) {
      case 'overcast': return this.dread(ctx);
      case 'storm': return { ...NO_EFFECTS };
      case 'glitch': return this.glitch(ctx);
      case 'psychosis': return this.psychosis(ctx);
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

  /** Glitch: gravity flips (main.ts) and nearby terrain rearranges itself.
   *  Blocks trade places in a radius around the player — never the player's
   *  own cells, and never special/utility blocks — so the land itself can lie
   *  about where the corridor was. Solid-block count is always preserved. */
  private glitch(ctx: HookContext): HookEffects {
    const effects = { ...NO_EFFECTS };
    this.swapTimer -= ctx.dt;
    if (this.swapTimer > 0) return effects;
    this.swapTimer = 4 + this.rng() * 6;
    const p = ctx.player;
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    const pick = (): [number, number, number] => {
      const rx = Math.floor(this.rng() * 15) - 7;
      const ry = Math.floor(this.rng() * 7) - 3;
      const rz = Math.floor(this.rng() * 15) - 7;
      return [px + rx, py + ry, pz + rz];
    };
    // The player's own occupancy box plus one cell of margin: a swap can never
    // bury, wedge or trap the player, it only reshapes the world around them.
    const playerBox = (x: number, y: number, z: number): boolean =>
      x >= px - 1 && x <= px + 1 && y >= py - 1 && y <= py + 2 && z >= pz - 1 && z <= pz + 1;
    const special = (id: Block): boolean =>
      id === Block.Torch || id === Block.Totem || id === Block.GravityCharm || id === Block.PlatformSeed;
    let moved = 0;
    for (let attempt = 0; attempt < 12 && moved < 3; attempt++) {
      const [sx, sy, sz] = pick();
      const id = this.world.get(sx, sy, sz);
      if (id === Block.Air || special(id) || playerBox(sx, sy, sz)) continue;
      const [tx, ty, tz] = pick();
      if ((tx === sx && ty === sy && tz === sz) || this.world.get(tx, ty, tz) !== Block.Air || playerBox(tx, ty, tz)) continue;
      this.world.set(sx, sy, sz, Block.Air);
      this.world.set(tx, ty, tz, id);
      moved++;
    }
    if (moved > 0) {
      effects.sound = 'shift';
      effects.message = 'REALITY IS REARRANGING';
    }
    return effects;
  }

  /** Psychosis: below 60 sanity the region talks back. Whispers escalate with
   *  dread; near the bottom of sanity it becomes an apparition (main.ts shows
   *  a silhouette). Suppressed entirely by the reduced-intensity setting. */
  private psychosis(ctx: HookContext): HookEffects {
    const effects = { ...NO_EFFECTS };
    if (ctx.sanity >= 60 || !ctx.intense) { this.hallucinationTimer = 6; return effects; }
    this.hallucinationTimer -= ctx.dt;
    if (this.hallucinationTimer > 0) return effects;
    const fear = 1 - ctx.sanity / 60; // 0 at 60 sanity, 1 at collapse
    this.hallucinationTimer = 3 + this.rng() * 6 - fear * 2.5;
    effects.hallucination = ctx.sanity < 28 ? 2 : 1;
    effects.sound = 'whisper';
    effects.message = ctx.sanity < 28
      ? 'IT STANDS WHERE YOU ARE LOOKING'
      : this.rng() < .5 ? 'WHISPERING FROM EVERY WALL' : 'IT WAS NEVER THERE';
    return effects;
  }

  /** Maw: flesh underfoot eats health, and a thin crust with a void below it
   *  is a pit — the flesh there is thinner and hungry. */
  private flesh(ctx: HookContext): HookEffects {
    const effects = { ...NO_EFFECTS };
    const under = this.surfaceUnder(ctx.player);
    if (under !== Block.Flesh) return effects;
    // Crust check: the cell beneath the flesh the player stands on decides if
    // this ground is solid mass or a lid over nothing.
    const pit = this.world.get(Math.floor(ctx.player.x), Math.floor(ctx.player.y - 1.08), Math.floor(ctx.player.z)) === Block.Air;
    effects.damage = (pit ? 15 : 7) * ctx.dt;
    this.squelchTimer -= ctx.dt;
    if (this.squelchTimer <= 0) {
      this.squelchTimer = .5;
      effects.sound = 'squelch';
      effects.message = pit ? 'THE FLESH IS THIN. MIND THE PIT' : 'THE FLESH IS WARM';
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
