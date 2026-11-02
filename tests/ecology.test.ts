import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Enemies } from '../src/entities';
import { Vector3 } from 'three';
import { Block, type World } from '../src/world';

const world: Pick<World, 'get' | 'surface'> = { get: (_x:number, y:number, _z:number) => y < 0 ? Block.Stone : Block.Air, surface: () => -1 };

/** Runs n 60fps frames; all timings stay under the 5s natural-spawn initial timer. */
function frames(enemies: Enemies, n: number, player: Vector3, opts: { phase?: number; playerLit?: boolean; onDamage?: (n:number)=>void } = {}) {
  for (let i = 0; i < n; i++) enemies.update(1/60, player, 'overcast', opts.onDamage ?? (()=>{}), opts.phase ?? .25, opts.playerLit ?? false);
}
/** Private mobs list, read through an unknown+shape cast so tsc stays strict. */
function mobPositions(enemies: Enemies): Vector3[] {
  return (enemies as unknown as { mobs: Array<{ root: THREE.Object3D }> }).mobs.map(m => m.root.position);
}
function sceneChildren(enemies: Enemies): THREE.Object3D[] {
  return (enemies as unknown as { scene: THREE.Scene }).scene.children;
}

describe('overcast ecology: light- and pack-dependent behaviour', () => {
  it('a lone skitterling bolts and never reaches the player; a pair swarms them', () => {
    let alone = new Enemies(new THREE.Scene(), world);
    alone.spawnKind('skitter', new Vector3(0, 0, -14));
    const player = new Vector3(0, 0, 0);
    let damage = 0;
    frames(alone, 180, player, { onDamage: n => damage += n });
    const p0 = mobPositions(alone)[0];
    expect(Math.hypot(p0.x, p0.z)).toBeGreaterThan(14.2); // kept its distance
    expect(damage).toBe(0);

    let swarm = new Enemies(new THREE.Scene(), world);
    swarm.spawnKind('skitter', new Vector3(0, 0, -14));
    swarm.spawnKind('skitter', new Vector3(1, 0, -14));
    let swarmDamage = 0;
    frames(swarm, 180, player, { onDamage: n => swarmDamage += n });
    expect(mobPositions(swarm)[0].z).toBeGreaterThan(-4); // closed in on the player
    expect(swarmDamage).toBeGreaterThan(0);
  });

  it('thrashers stalk, telegraph, then land a readable lunging hit', () => {
    const enemies = new Enemies(new THREE.Scene(), world);
    enemies.spawnKind('thrasher', new Vector3(0, 0, -4));
    const player = new Vector3(0, 0, 0);
    let damage = 0;
    frames(enemies, 290, player, { onDamage: n => damage += n });
    expect(damage).toBeGreaterThanOrEqual(15);
    expect(damage).toBeLessThanOrEqual(60); // not an unanswerable blender
  });

  it('cresthorns are dinosaur-scale', () => {
    const enemies = new Enemies(new THREE.Scene(), world);
    enemies.spawnKind('cresthorn', new Vector3(0, 0, -11));
    const root = sceneChildren(enemies)[0];
    root.updateMatrixWorld(true);
    const s = new Vector3().setFromMatrixScale(root.matrixWorld);
    expect(s.x).toBeGreaterThan(2);
  });

  it('a kill sprays a short anatomy-tinted gib burst that cleans itself up', () => {
    const scene = new THREE.Scene();
    const enemies = new Enemies(scene, world);
    enemies.spawnKind('thrasher', new Vector3(0, 0, -3));
    // Two solid hits put the 66 hp thrasher down; the kill spawns 7 gibs
    // alongside the still-animating corpse.
    enemies.attack(new Vector3(0, 1, 0), new Vector3(0, 0, -1), 6, 40);
    expect(enemies.attack(new Vector3(0, 1, 0), new Vector3(0, 0, -1), 6, 40, () => {})).toBe(true);
    expect(scene.children).toHaveLength(8); // corpse + 7 gib cubes
    // Gibs fall, tumble and vanish — inside a second nothing is left over.
    for (let i = 0; i < 60; i++) enemies.update(1 / 60, new Vector3(0, 0, 0), 'overcast', () => {});
    expect(scene.children).toHaveLength(0);
  });

  it('saurolisks charge fast: short wind-up, quick committed lunge, brief recovery', () => {
    const enemies = new Enemies(new THREE.Scene(), world);
    enemies.spawnKind('saurolisk', new Vector3(0, 0, -7));
    const player = new Vector3(0, 0, 0);
    let damage = 0;
    frames(enemies, 290, player, { onDamage: n => damage += n });
    expect(damage).toBeGreaterThanOrEqual(10);
    expect(damage).toBeLessThanOrEqual(70);
  });

  it('hoppers bound off the ground toward the player', () => {
    const enemies = new Enemies(new THREE.Scene(), world);
    enemies.spawnKind('hopper', new Vector3(0, 0, -6));
    const player = new Vector3(0, 0, 0);
    let maxY = 0, damage = 0;
    for (let i = 0; i < 180; i++) {
      enemies.update(1 / 60, player, 'overcast', n => damage += n, .25, false);
      for (const p of mobPositions(enemies)) maxY = Math.max(maxY, p.y);
    }
    expect(maxY).toBeGreaterThan(.3);
    expect(damage).toBeGreaterThan(0); // a hopping bug can still reach you
  });

  it('skitterlings and hoppers are drawn to a placed torch', () => {
    // Torch cell (solid only there), ground below y<0, air everywhere else.
    const torchWorld: Pick<World, 'get' | 'surface'> = {
      get: (x: number, y: number, z: number) =>
        x === 6 && y === 1 && z === -11 ? Block.Torch : y < 0 ? Block.Stone : Block.Air,
      surface: () => -1,
    };
    const enemies = new Enemies(new THREE.Scene(), torchWorld);
    enemies.spawnKind('skitter', new Vector3(0, 0, -10));
    const player = new Vector3(0, 0, 0);
    // The torch (≈6.5, 1.5, −10.5) is ~6.5 away; the player is 10 away, so
    // the light wins the magnet contest and the bug drifts across to it.
    frames(enemies, 180, player);
    const pos = mobPositions(enemies)[0];
    expect(pos.x).toBeGreaterThan(2.5);
    expect(pos.z).toBeLessThan(-8);
  });

  it('stalkers hunt at night but leave a bright player alone and recoil from light', () => {
    // Midnight: dark — the long hunt range applies and it closes in.
    const night = new Enemies(new THREE.Scene(), world);
    night.spawnKind('stalker', new Vector3(0, 0, 10));
    const player = new Vector3(0, 0, 0);
    let nightDamage = 0;
    frames(night, 180, player, { phase: .75, onDamage: n => nightDamage += n });
    expect(mobPositions(night)[0].z).toBeLessThan(4);
    expect(nightDamage).toBeGreaterThanOrEqual(10);

    // Midday, unlit player: the stalker holds back instead of shambling in.
    const day = new Enemies(new THREE.Scene(), world);
    day.spawnKind('stalker', new Vector3(0, 0, 12));
    frames(day, 120, player);
    const dayMob = mobPositions(day)[0];
    expect(Math.hypot(dayMob.x, dayMob.z)).toBeGreaterThan(10);

    // A placed light on the player burns them back instead of getting hits.
    const lit = new Enemies(new THREE.Scene(), world);
    lit.spawnKind('stalker', new Vector3(0, 0, 3));
    let litDamage = 0;
    frames(lit, 60, player, { playerLit: true, onDamage: n => litDamage += n });
    expect(mobPositions(lit)[0].z).toBeGreaterThan(3.6);
    expect(litDamage).toBe(0);
  });
});
