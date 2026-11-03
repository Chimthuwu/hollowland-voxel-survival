import * as THREE from 'three';
import { Block, type World } from './world';
import { canBreak } from './tools';
import { BlockDamage, familyFor, FAMILY_COLOR, DAMAGE_STAGES } from './blockDamage';

/**
 * The starter PEW PEW: a chunky retro-futuristic ray blaster the player
 * spawns with. One central targeting path resolves what the aim ray meets —
 * a creature, a minable block, or forageable vegetation — and dispatches the
 * right interaction. Everything the crystal beam can do later, the PEW PEW
 * can do first, just slower and with a heat budget.
 *
 * Game feel: hold-to-fire shots with a cooldown, a heat meter that locks the
 * gun when it overheats, a first-person viewmodel with recoil and muzzle
 * flash, a short tracer, family-tinted impact particles, and a crosshair
 * highlight that main.ts already draws for the current target.
 */

export interface PewPewConfig {
  /** Combat damage per shot against creatures. */
  shotDamage: number;
  /** Damage dealt to a block per shot. */
  blockDamage: number;
  /** Seconds between shots. */
  cooldown: number;
  /** Heat added per shot (0..1 scale). */
  heatPerShot: number;
  /** Heat removed per second while not firing. */
  coolRate: number;
  /** Heat at which the gun locks until it cools to `unlockAt`. */
  overheatAt: number;
  unlockAt: number;
  /** Aim ray reach in blocks. */
  range: number;
}

export const PEWPEW_DEFAULTS: PewPewConfig = {
  shotDamage: 12,
  blockDamage: 16,
  cooldown: 0.18,
  heatPerShot: 0.11,
  coolRate: 0.45,
  overheatAt: 1,
  unlockAt: 0.35,
  range: 6,
};

/** What the last shot actually met, for HUD/feedback. */
export type ShotResult =
  | { kind: 'none' }
  | { kind: 'cooldown' }
  | { kind: 'heatlock' }
  | { kind: 'enemy'; killed: boolean }
  | { kind: 'block'; gate: string | null; broken: boolean }
  | { kind: 'forage'; label: string }
  | { kind: 'air' };

/** Everything the gun needs from the outside world, injected so tests can fake it. */
export interface PewPewHooks {
  raycast(origin: THREE.Vector3, direction: THREE.Vector3, reach: number):
    { x: number; y: number; z: number; id: Block; distance: number; previous?: { x: number; y: number; z: number } } | null;
  /** Tries to hit a creature along the ray. Returns false when nothing is hit. */
  attackEnemy(origin: THREE.Vector3, direction: THREE.Vector3, range: number, damage: number, onKill: (position: THREE.Vector3, kind: string) => void): boolean;
  /** Forage check: returns the flora kind if the hit cell has harvestable vegetation. */
  forage(hit: { x: number; y: number; z: number }): { kind: string; y: number } | null;
  /** Called when a block actually breaks: destroy, drops, sounds, tool wear. */
  onBlockBreak(id: Block, x: number, y: number, z: number): void;
  /** Called on any material impact, for sounds keyed by family. */
  onImpact(family: string, broken: boolean): void;
}

const VIEW_POS = new THREE.Vector3(0.34, -0.28, -0.55);

export class PewPew {
  readonly config: PewPewConfig;
  /** 0..1 heat; at `overheatAt` the gun locks until it cools to `unlockAt`. */
  heat = 0;
  overheated = false;
  private cooldownTimer = 0;
  /** Recoil kick 0..1 for the viewmodel/camera. */
  recoil = 0;
  private lastShot: ShotResult = { kind: 'none' };

  private readonly view: THREE.Group;
  private readonly coil: THREE.Mesh;
  private readonly coilMaterial: THREE.MeshBasicMaterial;
  private readonly flash: THREE.Mesh;
  private readonly flashLight: THREE.PointLight;
  private readonly tracer: THREE.Mesh;
  private readonly tracerMaterial: THREE.MeshBasicMaterial;
  private flashTimer = 0;
  private tracerTimer = 0;

  // Impact particle pool.
  private readonly particles: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number; life: number }> = [];
  private readonly particleGeometry = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  private readonly particleMaterials = new Map<string, THREE.MeshBasicMaterial>();

  constructor(
    private readonly blockDamage: BlockDamage,
    private readonly hooks: PewPewHooks,
    readonly camera: THREE.Camera,
    config: Partial<PewPewConfig> = {},
  ) {
    this.config = { ...PEWPEW_DEFAULTS, ...config };

    // First-person viewmodel: chunky body, barrel, grip and a heat coil that
    // glows brighter as the gun runs hot.
    this.view = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4258, roughness: .6, metalness: .3 });
    const gripMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2634, roughness: .9 });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(.09, .09, .34), bodyMaterial);
    barrel.position.set(0, 0.02, -0.2);
    const body = new THREE.Mesh(new THREE.BoxGeometry(.14, .17, .22), bodyMaterial);
    body.position.set(0, -0.04, -0.02);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(.09, .16, .1), gripMaterial);
    grip.position.set(0, -0.15, 0.06);
    grip.rotation.x = 0.3;
    this.coilMaterial = new THREE.MeshBasicMaterial({ color: 0x8fffe0 });
    this.coil = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .05), this.coilMaterial);
    this.coil.position.set(0, 0.02, -0.36);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(.03, .05, .03), gripMaterial);
    sight.position.set(0, 0.11, -0.1);
    this.view.add(barrel, body, grip, this.coil, sight);
    this.view.position.copy(VIEW_POS);
    this.view.renderOrder = 999;
    camera.add(this.view);

    // Muzzle flash: small glowing quad at the barrel tip + a brief light.
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xdffcf0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.flash.position.set(0, 0.02, -0.4);
    this.view.add(this.flash);
    this.flashLight = new THREE.PointLight(0xbfffe9, 0, 5);
    this.flashLight.position.set(0, 0.02, -0.5);
    this.view.add(this.flashLight);

    // Tracer: one shared cylinder from muzzle to impact, fading fast.
    const tracerGeometry = new THREE.CylinderGeometry(0.014, 0.014, 1, 5, 1, true);
    tracerGeometry.translate(0, 0.5, 0);
    this.tracerMaterial = new THREE.MeshBasicMaterial({ color: 0xa8ffe8, transparent: true, opacity: 0, depthWrite: false });
    this.tracer = new THREE.Mesh(tracerGeometry, this.tracerMaterial);
    this.tracer.frustumCulled = false;
    this.tracer.visible = false;
  }

  private scene: THREE.Scene | null = null;
  /** Main adds the pewpew to the scene so its tracer/particles render. */
  attachScene(scene: THREE.Scene): void {
    this.scene = scene;
    scene.add(this.tracer);
  }

  /** Current weapon state for the HUD. */
  hudState(): { label: string; heat: number; overheated: boolean; recoil: number } {
    return { label: 'PEW PEW', heat: this.heat, overheated: this.overheated, recoil: this.recoil };
  }

  /** Attempts one shot. Returns what happened, for feedback and tests. */
  fire(origin: THREE.Vector3, direction: THREE.Vector3): ShotResult {
    if (this.overheated) return { kind: 'heatlock' };
    if (this.cooldownTimer > 0) return { kind: 'cooldown' };

    const dir = direction.clone().normalize();
    this.cooldownTimer = this.config.cooldown;
    this.heat = Math.min(1.2, this.heat + this.config.heatPerShot);
    if (this.heat >= this.config.overheatAt) this.overheated = true;
    this.recoil = Math.min(1, this.recoil + 0.55);
    this.flashTimer = 0.07;
    this.tracerTimer = 0.09;

    // 1) Creatures first: a body along the ray takes the shot.
    const enemyHit = this.hooks.attackEnemy(
      origin, dir, this.config.range, this.config.shotDamage,
      (pos, kind) => this.spawnParticles(pos, 'flesh', true),
    );
    if (enemyHit) {
      this.lastShot = { kind: 'enemy', killed: false };
      this.drawTracer(origin, dir, this.config.range * 0.6);
      this.onImpactFired('flesh', false);
      return this.lastShot;
    }

    // 2) Terrain: the raycast decides what block we are pointing at.
    const hit = this.hooks.raycast(origin, dir, this.config.range);
    if (!hit) {
      this.lastShot = { kind: 'air' };
      this.drawTracer(origin, dir, this.config.range);
      return this.lastShot;
    }

    // 3) Forage wins over mining: clicking the plant gathers it.
    const flora = this.hooks.forage(hit);
    if (flora) {
      this.lastShot = { kind: 'forage', label: flora.kind };
      this.onImpactFired('wood', false);
      return this.lastShot;
    }

    // 4) Tier gate: tougher blocks refuse a weaker tool, with a HUD reason.
    const gate = canBreak(hit.id, this.effectiveTier());
    if (!gate.ok) {
      this.lastShot = { kind: 'block', gate: gate.reason, broken: false };
      this.drawTracer(origin, dir, hit.distance);
      this.onImpactFired(familyFor(hit.id), false);
      return this.lastShot;
    }

    // 5) Progressive damage: staged per-family shells, shared with hand mining.
    const result = this.blockDamage.hit(hit.x, hit.y, hit.z, hit.id, this.config.blockDamage, this.clock());
    this.spawnParticles(new THREE.Vector3(hit.x + .5, hit.y + .5, hit.z + .5), familyFor(hit.id), result.broken);
    if (result.broken) {
      this.hooks.onBlockBreak(hit.id, hit.x, hit.y, hit.z);
    }
    this.drawTracer(origin, dir, hit.distance);
    this.lastShot = { kind: 'block', gate: null, broken: result.broken };
    this.onImpactFired(familyFor(hit.id), result.broken);
    return this.lastShot;
  }

  /** Tool tier the gun mines at. Raised by weapon upgrades (main sets it). */
  tier = 1;
  private effectiveTier(): number {
    return this.tier;
  }

  private onImpactFired(family: string, broken: boolean): void {
    this.hooks.onImpact(family, broken);
    this.lastImpact = family;
  }

  private lastImpact = '';

  /** Family of the most recent impact (for HUD/tests). */
  lastImpactFamily(): string {
    return this.lastImpact;
  }

  /** Last shot result (for HUD/tests). */
  lastResult(): ShotResult {
    return this.lastShot;
  }

  /** Sets the damage stage a block shows on a shared mining path. */
  applyBlockDamage(x: number, y: number, z: number, id: Block, amount: number): { ratio: number; stage: number; broken: boolean } {
    return this.blockDamage.hit(x, y, z, id, amount, this.clock());
  }

  private clock(): number {
    return performance.now() / 1000;
  }

  /** Frames the viewmodel, heat, cooldown, tracer, flash and particles. */
  update(dt: number): void {
    this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
    if (!this.overheated || this.heat <= this.config.unlockAt) {
      this.heat = Math.max(0, this.heat - this.config.coolRate * dt);
    }
    if (this.overheated && this.heat <= this.config.unlockAt) this.overheated = false;

    this.recoil = Math.max(0, this.recoil - dt * 4.5);
    // Viewmodel kick: pull back and tilt up, then ease home.
    const kick = this.recoil * this.recoil;
    this.view.position.set(VIEW_POS.x, VIEW_POS.y + kick * 0.035, VIEW_POS.z + kick * 0.09);
    this.view.rotation.x = -kick * 0.22;
    // Idle sway keeps the gun alive.
    const t = performance.now() / 1000;
    this.view.rotation.z = Math.sin(t * 1.7) * 0.012;
    this.view.rotation.y = Math.sin(t * 1.1) * 0.015;

    // Heat coil glow tracks the heat budget; pulse while overheated.
    const glow = this.overheated
      ? 0.5 + 0.5 * Math.abs(Math.sin(t * 12))
      : 0.25 + this.heat * 0.75;
    this.coilMaterial.color.setHSL(0.45 - this.heat * 0.45, 0.9, 0.35 + glow * 0.35);

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const m = this.flash.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, this.flashTimer / 0.07) * 0.9;
      this.flash.rotation.z += dt * 40;
      this.flashLight.intensity = Math.max(0, this.flashTimer / 0.07) * 3.5;
      if (this.flashTimer <= 0) {
        m.opacity = 0;
        this.flashLight.intensity = 0;
      }
    }

    if (this.tracerTimer > 0) {
      this.tracerTimer -= dt;
      this.tracerMaterial.opacity = Math.max(0, this.tracerTimer / 0.09) * 0.8;
      if (this.tracerTimer <= 0) this.tracer.visible = false;
    }

    // Particles: simple ballistic cubes fading out.
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vy -= 9 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.scale.setScalar(Math.max(0.05, p.life * 1.6));
      if (p.life <= 0) {
        this.scene?.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }
  }

  private drawTracer(origin: THREE.Vector3, dir: THREE.Vector3, length: number): void {
    this.tracer.visible = true;
    this.tracer.position.copy(origin);
    this.tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.tracer.scale.set(1, Math.max(0.05, length), 1);
    this.tracerMaterial.opacity = 0.8;
    this.tracerTimer = 0.09;
  }

  private spawnParticles(at: THREE.Vector3, family: string, big: boolean): void {
    if (!this.scene) return;
    const n = big ? 14 : 7;
    for (let i = 0; i < n; i++) {
      if (this.particles.length > 120) break;
      const material = this.particleMaterialFor(family);
      const mesh = new THREE.Mesh(this.particleGeometry, material);
      mesh.position.copy(at);
      mesh.scale.setScalar(0.2 + Math.random() * 0.25);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        vx: (Math.random() - 0.5) * 2.4,
        vy: Math.random() * 2.6 + 0.4,
        vz: (Math.random() - 0.5) * 2.4,
        life: big ? 0.5 : 0.35,
      });
    }
  }

  private particleMaterialFor(family: string): THREE.MeshBasicMaterial {
    let material = this.particleMaterials.get(family);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color: (FAMILY_COLOR as Record<string, number>)[family] ?? 0xffffff });
      this.particleMaterials.set(family, material);
    }
    return material;
  }

  dispose(): void {
    this.camera.remove(this.view);
    this.view.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    if (this.scene) {
      this.scene.remove(this.tracer);
      this.tracer.geometry.dispose();
    }
    this.tracerMaterial.dispose();
    this.particleGeometry.dispose();
    for (const material of this.particleMaterials.values()) material.dispose();
    this.particleMaterials.clear();
  }
}

export { DAMAGE_STAGES };
