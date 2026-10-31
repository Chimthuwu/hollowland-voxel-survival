import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Avatar } from '../src/avatar';

describe('third person avatar', () => {
  it('tracks the player and is hidden in first person', () => {
    const scene = new THREE.Scene();
    const avatar = new Avatar(scene);
    avatar.update(new THREE.Vector3(2,3,4), .5, false);
    expect(avatar.root.visible).toBe(false);
    expect(avatar.root.position.toArray()).toEqual([2,3,4]);
    avatar.update(new THREE.Vector3(2,3,4), .5, true);
    expect(avatar.root.visible).toBe(true);
    expect(avatar.root.children.length).toBeGreaterThan(0);
  });
});
