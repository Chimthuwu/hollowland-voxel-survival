import type * as THREE from 'three';

/** The part of `World` the third-person camera needs (keeps this helper pure). */
export interface CameraWorld {
  raycast(origin: THREE.Vector3, direction: THREE.Vector3, max: number): { distance: number } | null;
}

/**
 * Pull the third-person camera in before its boom passes through terrain.
 * The boom runs from the player's eye toward the desired camera position; a
 * voxel hit clamps it just short of that surface. A small minimum keeps the
 * camera from landing inside the player's own head.
 */
export function cameraBoomLength(
  world: CameraWorld, eye: THREE.Vector3, direction: THREE.Vector3,
  desired: number, minimum = .55,
): number {
  if (!(desired > 0)) return 0;
  const length = direction.length();
  if (length < 1e-6) return minimum;
  const hit = world.raycast(eye, direction, desired);
  if (!hit) return desired;
  return Math.max(Math.min(minimum, desired), Math.min(desired, hit.distance - .2));
}
