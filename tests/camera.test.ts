import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cameraBoomLength, type CameraWorld } from '../src/camera';

const eye = new THREE.Vector3(0, 0, 0);
const back = new THREE.Vector3(0, 0, 1);
const worldAt = (distance: number | null): CameraWorld => ({
  raycast: () => distance === null ? null : { distance },
});

describe('third-person camera boom', () => {
  it('uses the full boom when nothing is behind the player', () => {
    expect(cameraBoomLength(worldAt(null), eye, back, 3.5)).toBe(3.5);
  });

  it('pulls in just short of a wall instead of ending inside it', () => {
    expect(cameraBoomLength(worldAt(2), eye, back, 3.5)).toBeCloseTo(1.8);
  });

  it('never pushes the camera through the player when the wall is adjacent', () => {
    expect(cameraBoomLength(worldAt(.1), eye, back, 3.5)).toBe(.55);
  });

  it('tolerates a zero-length aim vector', () => {
    expect(cameraBoomLength(worldAt(null), eye, new THREE.Vector3(), 3.5)).toBe(.55);
  });
});
