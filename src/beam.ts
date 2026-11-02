import * as THREE from 'three';
import { Block, type World } from './world';
import { beamDps, miningSpec } from './tools';

/** Damage per second the beam deals to the targeted block. */
const BEAM_DPS = 80;

/** Per-block durability comes from the shared mining table. */
function durability(id: Block): number {
  return miningSpec(id).hardness;
}

interface BeamTarget {
  x: number;
  y: number;
  z: number;
  id: Block;
  health: number;
}

/**
 * Hold-to-fire continuous mining beam. Survives across frames; the caller
 * invokes setMouse(true/false) from pointer events and update() once per frame.
 *
 * Visual: a thin emissive cylinder from the camera origin to the impact point
 * (or from origin to max range if no hit). One shared mesh, scaled per frame.
 */
export class BeamWeapon {
  private readonly scene: THREE.Scene;
  private readonly world: World;
  private readonly camera: THREE.Camera;
  private readonly lineMaterial: THREE.MeshBasicMaterial;
  private readonly line: THREE.Mesh;
  private mouseDown = false;
  private target: BeamTarget | null = null;
  private currentHit: THREE.Vector3 | null = null;

  constructor(scene: THREE.Scene, world: World, camera: THREE.Camera) {
    this.scene = scene;
    this.world = world;
    this.camera = camera;

    this.lineMaterial = new THREE.MeshBasicMaterial({ color: 0x8fffe0, transparent: true, opacity: 0, depthWrite: false });
    // Unit cylinder along +Y; we scale it to span camera->hit per frame.
    const geo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    this.line = new THREE.Mesh(geo, this.lineMaterial);
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);
  }

  /** Whether the beam is currently held down. */
  isActive(): boolean { return this.mouseDown; }

  /** The block currently being melted by the beam, or null. Used for damage
   *  visualization (cracks) on the targeted block. */
  targeted(): BeamTarget | null { return this.target; }

  setMouse(down: boolean): void {
    this.mouseDown = down;
    if (!down) {
      this.target = null;
      this.line.visible = false;
      this.lineMaterial.opacity = 0;
    }
  }

  /** Update once per frame. Returns the block that was broken this tick (if any).
   *  `rangeLimit` is an optional effective max reach for exactly this frame —
   *  main.ts passes a struck creature's distance so the beam visually stops at
   *  the body and its DPS applies to flesh instead of the stone behind it. */
  update(dt: number, origin: THREE.Vector3, direction: THREE.Vector3, maxRange: number, onBreak: (id: Block, x: number, y: number, z: number) => void, toolTier = 0, level = 1, rangeLimit = Infinity): Block | null {
    if (!this.mouseDown) return null;

    const reach = Math.min(maxRange, rangeLimit);
    const hit = this.world.raycast(origin, direction, reach);
    this.currentHit = hit ? new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5) : null;

    // Target continuity: if the player looks at a different block, restart damage on the new one.
    if (this.target && hit && (hit.x !== this.target.x || hit.y !== this.target.y || hit.z !== this.target.z)) {
      this.target = null;
    }
    if (!this.target && hit) {
      this.target = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, health: durability(hit.id) };
    }

    let broken: Block | null = null;
    if (this.target) {
      this.target.health -= beamDps(toolTier, level) * dt;
      if (this.target.health <= 0) {
        broken = this.target.id;
        this.world.set(this.target.x, this.target.y, this.target.z, Block.Air);
        onBreak(this.target.id, this.target.x, this.target.y, this.target.z);
        this.target = null;
      }
    }

    // Render the beam visual: to the impact point, or to the clamped reach
    // (a body cut short of any block) when the ray meets nothing.
    const end = this.currentHit ?? origin.clone().add(direction.clone().multiplyScalar(reach));
    this.drawBeam(origin, end);
    return broken;
  }

  private drawBeam(origin: THREE.Vector3, end: THREE.Vector3): void {
    this.line.visible = true;
    this.lineMaterial.opacity = 0.55;
    const mid = origin.clone().add(end).multiplyScalar(0.5);
    this.line.position.copy(origin);
    const delta = end.clone().sub(origin);
    const length = Math.max(0.01, delta.length());
    this.line.scale.set(1, length, 1);
    // Align cylinder +Y to delta.
    const up = new THREE.Vector3(0, 1, 0);
    const dir = delta.clone().normalize();
    this.line.quaternion.setFromUnitVectors(up, dir);
    // Suppress unused-var lint for mid.
    void mid;
  }

  dispose(): void {
    this.scene.remove(this.line);
    this.line.geometry.dispose();
    this.lineMaterial.dispose();
  }
}
