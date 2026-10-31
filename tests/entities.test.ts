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
    expect(scene.children).toHaveLength(0);
    expect(enemies.attack(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,-1),5,15)).toBe(false);
  });
  it('cannot attack enemies outside range or behind the player', () => {
    const enemies = new Enemies(new THREE.Scene(), world); enemies.spawn('maw',new THREE.Vector3(0,0,4));
    expect(enemies.attack(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,-1),5,100)).toBe(false);
    expect(enemies.attack(new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1),2,100)).toBe(false);
  });
});
