import * as THREE from 'three';
import { Block, blockColor } from './world';

interface Pickup {
  mesh: THREE.Mesh;
  id: Block;
  x: number;
  y: number;
  z: number;
  vy: number;
  /** Bob phase so a scatter of pickups does not pulse in unison. */
  phase: number;
  /** Seconds before the pickup may be collected (lets it pop out of the mob). */
  armTimer: number;
  age: number;
}

const GRAVITY = 18;
const RADIUS = 0.9;
/** How far a pickup drifts toward the player before it is grabbed. */
const MAGNET_RANGE = 1.6;
/** Vertical offset of the item's centre above the voxel top it rests on. */
const REST_OFFSET = .24;
/** True when the thread at (x,y,z) is solid ground the item can rest on. */
export type SolidPredicate = (x: number, y: number, z: number) => boolean;

/**
 * Floating item pickups. A dropped item bobs, is magnetised toward the player
 * once it has settled, and is collected on contact. One shared geometry and one
 * shared material per block type keeps the cost negligible.
 */
export class Pickups {
  private readonly items: Pickup[] = [];
  private readonly geometry = new THREE.BoxGeometry(.34, .34, .34);
  private readonly materials = new Map<Block, THREE.MeshStandardMaterial>();

  constructor(private readonly scene: THREE.Scene, private readonly solid: SolidPredicate = () => false) {}

  spawn(id: Block, position: THREE.Vector3, impulse = 1): void {
    if (id === Block.Air) return;
    let material = this.materials.get(id);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: blockColor(id),
        roughness: .6,
        emissive: blockColor(id),
        emissiveIntensity: .25,
      });
      this.materials.set(id, material);
    }
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.items.push({
      mesh, id,
      x: position.x, y: position.y, z: position.z,
      vy: 2.4 * impulse,
      phase: Math.random() * Math.PI * 2,
      armTimer: 0.35,
      age: 0,
    });
  }

  /**
   * Updates all pickups. Returns the ids collected this tick.
   * The optional `accept` predicate decides whether an item is actually
   * taken: when it returns false the pickup is left in the world (re-armed
   * briefly so it does not hammer a full inventory every frame) instead of
   * silently vanishing. This is the inventory-full safety valve.
   */
  update(dt: number, player: THREE.Vector3, accept: (id: Block) => boolean = () => true): Block[] {
    const collected: Block[] = [];
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.age += dt;
      p.armTimer = Math.max(0, p.armTimer - dt);

      p.vy -= GRAVITY * dt;

      // Fall and settle on solid ground. The fall is sub-stepped so a fast
      // item cannot skip through a floor cell in one frame.
      {
        const total = p.vy * dt;
        const steps = Math.max(1, Math.ceil(Math.abs(total) / .4));
        const step = total / steps;
        for (let s = 0; s < steps && p.vy !== 0; s++) {
          p.y += step;
          const floorCell = Math.floor(p.y - REST_OFFSET);
          if (this.solid(Math.floor(p.x), floorCell, Math.floor(p.z))) {
            p.y = floorCell + 1 + REST_OFFSET;
            p.vy = 0;
          }
        }
      }

      // Magnetise and collect. The grip point is at waist height (half a
      // metre above the feet): an item resting on the player's own floor tile
      // must sit inside the collect radius, not exactly on its boundary.
      if (p.armTimer === 0) {
        const dx = player.x - p.x, dy = player.y + 0.5 - p.y, dz = player.z - p.z;
        let dist = Math.hypot(dx, dy, dz);
        if (p.vy === 0 && dist < MAGNET_RANGE && dist > 0.001) {
          const pull = 4.5 * dt;
          p.x += dx / dist * pull;
          p.y += dy / dist * pull;
          p.z += dz / dist * pull;
          dist = Math.hypot(player.x - p.x, player.y + 0.5 - p.y, player.z - p.z);
        }
        if (dist < RADIUS) {
          // Inventory-full safety: only consume the pickup when the caller
          // accepts it. A refused item stays in the world and re-arms so it
          // can be collected later instead of silently vanishing.
          if (!accept(p.id)) {
            p.armTimer = 0.9;
            continue;
          }
          collected.push(p.id);
          this.scene.remove(p.mesh);
          this.items.splice(i, 1);
          continue;
        }
      }

      const bob = Math.sin(p.age * 2.4 + p.phase) * 0.08;
      p.mesh.position.set(p.x, p.y + bob, p.z);
      p.mesh.rotation.y += dt * 1.6;
      p.mesh.rotation.x += dt * 0.7;
    }
    return collected;
  }

  count(): number { return this.items.length; }

  clear(): void {
    for (const p of this.items) this.scene.remove(p.mesh);
    this.items.length = 0;
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }
}
