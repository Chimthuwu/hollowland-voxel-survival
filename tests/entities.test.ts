import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Enemies } from '../src/entities';
import { Block, type World } from '../src/world';

const world: Pick<World, 'get' | 'surface'> = { get: (_x:number,y:number,_z:number) => y < 0 ? Block.Stone : Block.Air, surface: () => -1 };
describe('enemies', () => {
  it('chases a player within aggro range and deals contact damage with cooldown', () => {
    const enemies = new Enemies(new THREE.Scene(), world);
    enemies.spawn('overcast', new THREE.Vector3(0, 0, 3));
    const player = new THREE.Vector3(0, 0, 0); let damage = 0;
    for (let i=0; i<120; i++) enemies.update(1/60,player,'overcast', n => damage += n);
    expect(damage).toBeGreaterThanOrEqual(10);
    expect(damage).toBeLessThanOrEqual(20);
  });
  it('can be attacked and removed after its health reaches zero', () => {
    const scene = new THREE.Scene(); const enemies = new Enemies(scene, world);
    enemies.spawn('overcast', new THREE.Vector3(0,0,-3));
    expect(enemies.attack(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,-1),5,15)).toBe(true);
    expect(enemies.attack(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,-1),5,15)).toBe(true);
    // The mob now plays a short death animation before it is removed.
    expect(scene.children).toHaveLength(1);
    for (let i = 0; i < 60; i++) enemies.update(1/60, new THREE.Vector3(0,0,0), 'overcast', () => {});
    expect(scene.children).toHaveLength(0);
    expect(enemies.attack(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,-1),5,15)).toBe(false);
  });

  it('reports a kill so the caller can drop loot', () => {
    const scene = new THREE.Scene(); const enemies = new Enemies(scene, world);
    enemies.spawn('overcast', new THREE.Vector3(0,0,-3));
    const kills: THREE.Vector3[] = [];
    enemies.attack(new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,-1), 5, 15);
    enemies.attack(new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,-1), 5, 15, pos => kills.push(pos));
    expect(kills).toHaveLength(1);
    // The mob is knocked back slightly by the first hit, so allow for that.
    expect(kills[0].z).toBeGreaterThan(-3.5);
    expect(kills[0].z).toBeLessThan(-2.5);
  });

  it('flashes a mob white when it is hit', () => {
    const scene = new THREE.Scene(); const enemies = new Enemies(scene, world);
    enemies.spawn('overcast', new THREE.Vector3(0,0,-3));
    const mob = scene.children[0];
    const materialOf = () => { let found: THREE.Material | undefined; mob.traverse(o => { if (o instanceof THREE.Mesh && !found) found = o.material; }); return found; };
    const before = materialOf();
    enemies.attack(new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,-1), 5, 5);
    expect(materialOf()).not.toBe(before);
    // The flash is short lived and the normal material comes back.
    for (let i = 0; i < 30; i++) enemies.update(1/60, new THREE.Vector3(0,0,0), 'overcast', () => {});
    expect(materialOf()).toBe(before);
  });
  it('cannot attack enemies outside range or behind the player', () => {
    const enemies = new Enemies(new THREE.Scene(), world); enemies.spawn('maw',new THREE.Vector3(0,0,4));
    expect(enemies.attack(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,-1),5,100)).toBe(false);
    expect(enemies.attack(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1),2,100)).toBe(false);
  });
});
