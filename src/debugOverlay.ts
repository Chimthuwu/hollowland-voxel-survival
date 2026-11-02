import type { Biome } from './world';

export type DamageSource = 'fall' | 'enemy' | 'lightning' | 'hazard' | 'unknown';

export interface DamageEvent {
  /** Seconds since the page loaded. */
  t: number;
  source: DamageSource;
  amount: number;
  /** Player Y at the moment the damage was applied. */
  y: number;
  biome: Biome;
}

/**
 * F3-toggled corner HUD that shows live state and the last few damage events.
 * Hidden by default. The class is intentionally tiny: a single fixed <div>,
 * one keyboard listener, no canvas, throttled to 10Hz when visible.
 */
export class DebugOverlay {
  private readonly root: HTMLDivElement;
  private readonly content: HTMLPreElement;
  private visible = false;
  private readonly events: DamageEvent[] = [];
  private readonly MAX_EVENTS = 8;
  private lastRender = -1;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private readonly onKey: (e: KeyboardEvent) => void;

  constructor() {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:9999;background:rgba(0,0,0,0.78);' +
      'color:#b1e0ff;font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;' +
      'padding:8px 10px;border:1px solid #2a3a4a;border-radius:4px;' +
      'pointer-events:none;white-space:pre;min-width:240px;text-shadow:0 0 4px #000;' +
      'display:none;';
    this.content = document.createElement('pre');
    this.content.style.cssText = 'margin:0;';
    this.root.append(this.content);
    document.body.append(this.root);

    this.onKey = (e: KeyboardEvent) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    };
    // Capture so the toggle works regardless of focus, even before the player presses Start.
    document.addEventListener('keydown', this.onKey, { capture: true });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Records a damage event and mirrors it to console for offline capture. */
  recordDamage(event: DamageEvent): void {
    this.events.unshift(event);
    if (this.events.length > this.MAX_EVENTS) this.events.pop();
    // eslint-disable-next-line no-console
    console.log(
      '[HL damage]',
      event.source,
      '-',
      event.amount,
      '@y=',
      event.y.toFixed(1),
      '[',
      event.biome,
      ']',
    );
  }

  /** Call every frame so FPS stays current. Cheap. */
  recordFrame(dt: number): void {
    this.fpsFrames += 1;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsTime = 0;
      this.fpsFrames = 0;
    }
  }

  /**
   * Cheap re-render at 10Hz. Always cheap when hidden (early-returns).
   * `impact` is the most recent player step impact velocity (used to flag
   * near-fall-damage moments even before damage lands).
   */
  render(now: number, state: {
    x: number; y: number; z: number;
    vy: number;
    biome: Biome;
    health: number; sanity: number; stamina: number;
    gravity: number;
    impact: number;
  }): void {
    if (!this.visible) return;
    if (now - this.lastRender < 0.1) return;
    this.lastRender = now;
    const lines: string[] = [
      `FPS        ${this.fps}`,
      `POS        ${state.x.toFixed(2)}  ${state.y.toFixed(2)}  ${state.z.toFixed(2)}`,
      `VY         ${state.vy.toFixed(2)}`,
      `BIOME      ${state.biome}`,
      `HEALTH     ${state.health.toFixed(0)}`,
      `SANITY     ${state.sanity.toFixed(0)}`,
      `STAMINA    ${state.stamina.toFixed(0)}`,
      `GRAVITY    ${state.gravity.toFixed(2)}x`,
      `IMPACT     ${state.impact.toFixed(2)}`,
      '',
      'LAST DAMAGE (most recent first)',
    ];
    if (this.events.length === 0) lines.push('  (none yet)');
    else {
      for (const e of this.events) {
        lines.push(
          `  t=${e.t.toFixed(1)}s  ${e.source.padEnd(8)}  -${e.amount.toString().padStart(3)}  @y=${e.y.toFixed(1)} [${e.biome}]`,
        );
      }
    }
    this.content.textContent = lines.join('\n');
  }

  /** Read-only snapshot for E2E tests via window.__hollowland. */
  eventsSnapshot(): readonly DamageEvent[] {
    return this.events;
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKey, { capture: true });
    this.root.remove();
  }
}
