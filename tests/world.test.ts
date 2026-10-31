import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Block, biomeAt, World } from '../src/world';

describe('voxel world', () => {
  it('does not create free sanity totems as natural biome decorations', () => {
    const world = new World(new THREE.Scene());
    for (let x = 290; x < 420; x++) for (let z = 0; z < 30; z++) {
      const y = world.surface(x, z);
      expect(world.get(x, y + 1, z)).not.toBe(Block.Totem);
    }
  });
  it('generates deterministic solid spawn terrain with clear headroom', () => {
    const a = new World(new THREE.Scene());
    const b = new World(new THREE.Scene());
    const top = a.surface(0, 0);
    expect(b.surface(0, 0)).toBe(top);
    expect(a.get(0, top, 0)).not.toBe(Block.Air);
    expect(a.get(0, top + 1, 0)).toBe(Block.Air);
    expect(b.get(0, top, 0)).toBe(a.get(0, top, 0));
  });

  it('assigns surface strips and vertical biomes', () => {
    expect([0, 100, 200, 300, 400].map(x => biomeAt(x, 5, 0))).toEqual(['overcast', 'storm', 'glitch', 'psychosis', 'maw']);
    expect(biomeAt(0, -1, 0)).toBe('catacombs');
    expect(biomeAt(0, -49, 0)).toBe('veins');
    expect(biomeAt(0, 65, 0)).toBe('sky');
  });

  it('preserves edits including air, even at negative coordinates', () => {
    const world = new World(new THREE.Scene());
    world.set(-1, -2, -3, Block.Totem);
    expect(world.get(-1, -2, -3)).toBe(Block.Totem);
    world.set(-1, -2, -3, Block.Air);
    expect(world.get(-1, -2, -3)).toBe(Block.Air);
    world.update(new THREE.Vector3(1000, 100, 1000), 0);
    expect(world.get(-1, -2, -3)).toBe(Block.Air);
  });

  it('raycasts through voxels to the nearest block and returns its previous cell', () => {
    const world = new World(new THREE.Scene());
    world.set(-1, 100, 0, Block.Bone);
    const hit = world.raycast(new THREE.Vector3(2.5, 100.5, .5), new THREE.Vector3(-2, 0, 0), 4);
    expect(hit).toEqual({ x: -1, y: 100, z: 0, previous: { x: 0, y: 100, z: 0 }, id: Block.Bone, distance: 2.5 });
    expect(world.raycast(new THREE.Vector3(2.5, 100.5, .5), new THREE.Vector3(-1, 0, 0), 2)).toBeNull();
    expect(world.raycast(new THREE.Vector3(2.5, 100.5, .5), new THREE.Vector3(), 4)).toBeNull();
  });

  it('culls shared faces and disposes replaced and unloaded geometry', () => {
    const scene = new THREE.Scene();
    const world = new World(scene);
    world.set(0, 100, 0, Block.Bone);
    world.set(1, 100, 0, Block.Bone);
    world.update(new THREE.Vector3(.5, 100.5, .5), 0);
    expect(scene.children.length).toBeLessThanOrEqual(2);
    const mesh = scene.children.find(item => (item as THREE.Mesh).geometry?.getAttribute('position')?.count > 0) as THREE.Mesh;
    expect(mesh.geometry.index?.count).toBe(60);
    let disposed = false;
    mesh.geometry.addEventListener('dispose', () => { disposed = true; });
    world.set(1, 100, 0, Block.Air);
    expect(disposed).toBe(true);
    const replacement = scene.children.find(item => (item as THREE.Mesh).geometry?.index?.count === 36) as THREE.Mesh;
    expect(replacement).toBeDefined();
    let unloaded = false;
    replacement.geometry.addEventListener('dispose', () => { unloaded = true; });
    world.update(new THREE.Vector3(1000, 100, 1000), 1);
    expect(unloaded).toBe(true);
    expect(world.get(1, 100, 0)).toBe(Block.Air);
    world.update(new THREE.Vector3(.5, 100.5, .5), 2);
    expect(scene.children.some(item => (item as THREE.Mesh).geometry?.index?.count === 36)).toBe(true);
    world.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('rebuilds both sides of a chunk boundary when a neighbor changes', () => {
    const scene = new THREE.Scene();
    const world = new World(scene);
    world.set(15, 100, 0, Block.Bone);
    world.set(16, 100, 0, Block.Bone);
    const center = new THREE.Vector3(15.5, 100.5, .5);
    for (let i = 0; i < 8; i++) world.update(center, i);
    const counts = () => scene.children.map(item => (item as THREE.Mesh).geometry.index?.count ?? 0).filter(n => n > 0);
    expect(counts().sort()).toEqual([30, 30]);
    world.set(16, 100, 0, Block.Air);
    expect(counts()).toEqual([36]);
    world.dispose();
  });

  it('generates subterranean caverns and floating sky islands', () => {
    const world = new World(new THREE.Scene());
    let caveAir = 0, caveSolid = 0, skySolid = 0;
    for (let x = 0; x < 64; x += 4) for (let z = 0; z < 64; z += 4) {
      const cave = world.get(x, -12, z);
      if (cave === Block.Air) caveAir++; else caveSolid++;
      for (let y = 72; y < 79; y++) if (world.get(x, y, z) !== Block.Air) skySolid++;
    }
    expect(caveAir).toBeGreaterThan(0);
    expect(caveSolid).toBeGreaterThan(0);
    expect(skySolid).toBeGreaterThan(0);
  });
});
