import * as THREE from 'three';
import { Block, type World } from './world';

/** Damage per second the beam deals to the targeted block. */
const BEAM_DPS = 80;

/** Per-block durability (HP). Higher = the beam holds it longer. */
const DURABILITY: Partial<Record<Block, number>> = {
  [Block.Dirt]:    15,
  [Block.Wood]:    18,
  [Block.Stone]:   60,
  [Block.Mud]:     22,
  [Block.Glitch]:  55,
  [Block.Flesh]:   30,
  [Block.Bone]:    50,
  [Block.Torch]:   8,
  [Block.Scaffold]:16,
  [Block.Totem]:   50,
  [Block.Scorched]:30,
  [Block.Crystal]: 100,
};

function durability(id: Block): number {
  return DURABILITY[id] ?? 30;
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

    this.lineMaterial = new THREE.MeshBasicMaterial({ color: 0xb6f3ff, transparent: true, opacity: 0, depthWrite: false });
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

  setMouse(down: boolean): void {
    this.mouseDown = down;
    if (!down) {
      this.target = null;
      this.line.visible = false;
      this.lineMaterial.opacity = 0;
    }
  }

  /** Update once per frame. Returns the block that was broken this tick (if any). */
  update(dt: number, origin: THREE.Vector3, direction: THREE.Vector3, maxRange: number, onBreak: (id: Block, x: number, y: number, z: number) => void): Block | null {
    if (!this.mouseDown) return null;

    const hit = this.world.raycast(origin, direction, maxRange);
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
      this.target.health -= BEAM_DPS * dt;
      if (this.target.health <= 0) {
        broken = this.target.id;
        this.world.set(this.target.x, this.target.y, this.target.z, Block.Air);
        onBreak(this.target.id, this.target.x, this.target.y, this.target.z);
        this.target = null;
      }
    }

    // Render the beam visual.
    const end = this.currentHit ?? origin.clone().add(direction.clone().multiplyScalar(maxRange));
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
