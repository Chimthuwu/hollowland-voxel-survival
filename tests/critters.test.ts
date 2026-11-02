import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Critters } from '../src/critters';
import { Block, type World } from '../src/world';

const world: Pick<World, 'get' | 'surface'> = { get: (_x:number,y:number,_z:number) => y < 0 ? Block.Stone : Block.Air, surface: () => -1 };

describe('giant insect critters', () => {
  it('spawns non-hostile insects that never damage the player', () => {
    const scene = new THREE.Scene();
    const critters = new Critters(scene, world);
    critters.spawn('overcast', new THREE.Vector3(0, 0, 0.5));
    const player = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 300; i++) critters.update(1/60, player, 'overcast');
    expect(scene.children.length).toBeGreaterThan(0);
  });

  it('wanders: insects move over time instead of freezing in place', () => {
    const critters = new Critters(new THREE.Scene(), world);
    const origin = new THREE.Vector3(0, 0, 0);
    critters.spawn('overcast', origin.clone());
    const before = critters.positions().map(p => p.clone());
    for (let i = 0; i < 240; i++) critters.update(1/60, new THREE.Vector3(30, 0, 30), 'overcast');
    const after = critters.positions();
    expect(after.length).toBe(1);
    expect(after[0].distanceTo(before[0])).toBeGreaterThan(0.5);
  });

  it('drifts away from a player standing close (skittish, not aggressive)', () => {
    const critters = new Critters(new THREE.Scene(), world);
    critters.spawn('overcast', new THREE.Vector3(1.5, 0, 0));
    const player = new THREE.Vector3(0, 0, 0);
    const start = critters.positions()[0].distanceTo(player);
    for (let i = 0; i < 180; i++) critters.update(1/60, player, 'overcast');
    expect(critters.positions()[0].distanceTo(player)).toBeGreaterThan(start);
  });

  it('despawns when the player is far away and clears on respawn', () => {
    const scene = new THREE.Scene();
    const critters = new Critters(scene, world);
    critters.spawn('overcast', new THREE.Vector3(0, 0, 0));
    for (let i = 0; i < 10; i++) critters.update(1/60, new THREE.Vector3(100, 0, 100), 'overcast');
    expect(critters.positions()).toHaveLength(0);
    critters.spawn('overcast', new THREE.Vector3(0, 0, 0));
    critters.clear();
    expect(scene.children).toHaveLength(0);
  });
});
