import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block } from '../src/world';
import { Pickups } from '../src/pickups';

/** Solid ground everywhere at or below y=4, i.e. a floor whose top is y=5. */
const solidFloor = (x: number, y: number, z: number) => y <= 4;
const STEP = 1 / 60;
const FAR = new THREE.Vector3(50, 6, 50);

describe('pickups (loot loop)', () => {
  it('falls and settles on solid ground instead of freezing mid-air', () => {
    const pickups = new Pickups(new THREE.Scene(), solidFloor);
    pickups.spawn(Block.Morsel, new THREE.Vector3(3, 20, 7), 3);
    for (let i = 0; i < 10 * 60; i++) pickups.update(STEP, FAR);
    expect(pickups.count()).toBe(1);
    const mesh = (pickups as unknown as { items: { mesh: THREE.Mesh }[] }).items[0].mesh;
    // Rendered height includes the resting offset plus a ±0.08 bob.
    expect(Math.abs(mesh.position.y - 5.24)).toBeLessThanOrEqual(0.09);
    expect(mesh.position.x).toBeCloseTo(3, 3);
    expect(mesh.position.z).toBeCloseTo(7, 3);
  });

  it('cannot tunnel through the floor even when dropped from a great height', () => {
    const pickups = new Pickups(new THREE.Scene(), solidFloor);
    pickups.spawn(Block.Skyfruit, new THREE.Vector3(0, 90, 0), 0);
    for (let i = 0; i < 15 * 60; i++) pickups.update(STEP, FAR);
    const mesh = (pickups as unknown as { items: { mesh: THREE.Mesh }[] }).items[0].mesh;
    expect(Math.abs(mesh.position.y - 5.24)).toBeLessThanOrEqual(0.09);
  });

  it('keeps falling when there is no ground beneath', () => {
    const pickups = new Pickups(new THREE.Scene(), () => false);
    pickups.spawn(Block.Morsel, new THREE.Vector3(0, 10, 0), 1);
    for (let i = 0; i < 5 * 60; i++) pickups.update(STEP, FAR);
    const mesh = (pickups as unknown as { items: { mesh: THREE.Mesh }[] }).items[0].mesh;
    expect(mesh.position.y).toBeLessThan(0);
  });

  it('magnetises toward the player, collects and reports the block id', () => {
    const scene = new THREE.Scene();
    const pickups = new Pickups(scene, solidFloor);
    pickups.spawn(Block.Morsel, new THREE.Vector3(3, 5.3, 7));
    for (let i = 0; i < 90; i++) pickups.update(STEP, FAR); // settle + arm
    // Player stands on the same floor tile, one block from the item.
    const player = new THREE.Vector3(2.2, 5, 7);
    expect(pickups.count()).toBe(1);
    let collected: Block[] = [];
    for (let i = 0; i < 240 && collected.length === 0; i++) collected = pickups.update(STEP, player);
    expect(collected).toEqual([Block.Morsel]);
    expect(pickups.count()).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it('drops nothing for air and can be cleared', () => {
    const scene = new THREE.Scene();
    const pickups = new Pickups(scene, solidFloor);
    pickups.spawn(Block.Air, new THREE.Vector3(0, 5.5, 0));
    expect(pickups.count()).toBe(0);
    pickups.spawn(Block.Morsel, new THREE.Vector3(0, 90, 0));
    pickups.spawn(Block.Skyfruit, new THREE.Vector3(9, 90, 0));
    expect(pickups.count()).toBe(2);
    pickups.clear();
    expect(pickups.count()).toBe(0);
    expect(scene.children).toHaveLength(0);
  });
});
