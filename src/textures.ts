import * as THREE from 'three';

/**
 * Procedural texture atlas for Hollowland.
 *
 * Generates every block texture from canvas noise so the world has
 * detailed, Vintage Story-style surfaces (bark grain, stone speckle,
 * ore flecks, leaf mottle) without any external image assets.
 *
 * Atlas layout: COLS x ROWS grid of TILE x TILE textures.
 */

const TILE = 64;
const COLS = 8;
const ROWS = 8;
const ATLAS = TILE * COLS;

// Block id -> atlas tile coordinate [x, y]
const LAYOUT: Record<number, [number, number] | null> = {
  [0]: null, // Air
  [1]: [1, 0],  // Dirt
  [2]: [4, 0],  // Stone
  [3]: [5, 0],  // Wood
  [4]: [2, 1],  // Mud
  [5]: [6, 1],  // Glitch
  [6]: [7, 1],  // Flesh
  [7]: [0, 2],  // Bone
  [8]: [1, 2],  // Torch
  [9]: [2, 2],  // Scaffold
  [10]: [3, 2], // Totem
  [11]: [4, 2], // Scorched
  [12]: [5, 2], // Crystal
  [13]: [6, 2], // GravityCharm
  [14]: [7, 2], // PlatformSeed
  [15]: [0, 3], // Acid
  [16]: [2, 0], // Grass
  [17]: [1, 3], // Skyfruit
  [18]: [2, 3], // Morsel
  [19]: [3, 3], // Chisel
  [20]: [4, 3], // PickHead
  [21]: [5, 3], // AxeHead
  [22]: [6, 3], // BladeHead
  [23]: [7, 3], // CopperOre
  [24]: [0, 4], // EchoGem
  [25]: [3, 0], // Leaf
  [26]: [1, 4], // Chitin
  [27]: [2, 4], // Silk
  [28]: [3, 4], // Hide
  [29]: [4, 4], // Claw
  [30]: [5, 4], // Bandage
  [31]: [6, 4], // Sand
  [32]: [7, 4], // Snow
  [33]: [0, 5], // Water
  [34]: [1, 5], // CopperBar
  [35]: [2, 5], // CrystalBar
  [36]: [3, 5], // EchoBar
};

function drawTile(ctx: CanvasRenderingContext2D, tx: number, ty: number, draw: (c: CanvasRenderingContext2D) => void): void {
  const x = tx * TILE;
  const y = ty * TILE;
  ctx.save();
  ctx.translate(x, y);
  draw(ctx);
  ctx.restore();
}

function fillTile(ctx: CanvasRenderingContext2D, tx: number, ty: number, color: string): void {
  drawTile(ctx, tx, ty, (c) => {
    c.fillStyle = color;
    c.fillRect(0, 0, TILE, TILE);
  });
}

function addNoise(ctx: CanvasRenderingContext2D, r: number, g: number, b: number, amount: number): void {
  const img = ctx.getImageData(0, 0, TILE, TILE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.min(255, Math.max(0, r + n));
    d[i + 1] = Math.min(255, Math.max(0, g + n));
    d[i + 2] = Math.min(255, Math.max(0, b + n));
  }
  ctx.putImageData(img, 0, 0);
}

function speckles(ctx: CanvasRenderingContext2D, color: string, count: number, maxSize: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = Math.random() * TILE;
    const y = Math.random() * TILE;
    const s = Math.random() * maxSize;
    ctx.fillRect(x, y, s, s);
  }
}

function grainLines(ctx: CanvasRenderingContext2D, color: string, count: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = (i / count) * TILE + (Math.random() - 0.5) * 6;
    const w = 1 + Math.random() * 3;
    ctx.fillRect(x, 0, w, TILE);
  }
}

function leafMottle(ctx: CanvasRenderingContext2D): void {
  // Mottled lighter/darker patches for leaf depth.
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * TILE;
    const y = Math.random() * TILE;
    const r = 6 + Math.random() * 14;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.15)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

export function buildAtlas(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS;
  canvas.height = ATLAS;
  const ctx = canvas.getContext('2d')!;

  // ---- Dirt [1,0] ----
  fillTile(ctx, 1, 0, '#8a5a4e');
  addNoise(ctx, 0x8a, 0x5a, 0x4e, 30);
  speckles(ctx, '#5d3a2e', 45, 2);
  speckles(ctx, '#a67c62', 35, 2);

  // ---- Grass top [2,0] ----
  fillTile(ctx, 2, 0, '#7fa668');
  addNoise(ctx, 0x7f, 0xa6, 0x68, 35);
  speckles(ctx, '#5d7a46', 55, 2);
  speckles(ctx, '#9cc688', 45, 2);

  // ---- Stone [4,0] ----
  fillTile(ctx, 4, 0, '#555761');
  addNoise(ctx, 0x55, 0x57, 0x61, 22);
  speckles(ctx, '#3a3c44', 70, 3);
  speckles(ctx, '#7e7e8a', 55, 2);

  // ---- Wood [5,0] ----
  fillTile(ctx, 5, 0, '#6b5448');
  addNoise(ctx, 0x6b, 0x54, 0x48, 18);
  grainLines(ctx, '#4a3935', 8);
  speckles(ctx, '#3d2e25', 25, 4); // knots

  // ---- Leaves [3,0] ----
  fillTile(ctx, 3, 0, '#9980c6');
  addNoise(ctx, 0x99, 0x80, 0xc6, 40);
  speckles(ctx, '#6a5a8a', 45, 2);
  speckles(ctx, '#c0aee0', 35, 2);
  leafMottle(ctx);

  // ---- Mud [2,1] ----
  fillTile(ctx, 2, 1, '#373a3c');
  addNoise(ctx, 0x37, 0x3a, 0x3c, 28);
  speckles(ctx, '#25282a', 40, 2);

  // ---- Glitch [6,1] ----
  fillTile(ctx, 6, 1, '#c02dd4');
  addNoise(ctx, 0xc0, 0x2d, 0xd4, 25);
  speckles(ctx, '#ffffff', 35, 2);

  // ---- Flesh [7,1] ----
  fillTile(ctx, 7, 1, '#c4545f');
  addNoise(ctx, 0xc4, 0x54, 0x5f, 22);
  speckles(ctx, '#8a3a42', 35, 2);

  // ---- Bone [0,2] ----
  fillTile(ctx, 0, 2, '#beb09b');
  addNoise(ctx, 0xbe, 0xb0, 0x9b, 18);
  speckles(ctx, '#a0907f', 40, 2);

  // ---- Grass side / dirt fallback [1,1] ----
  fillTile(ctx, 1, 1, '#7a5342');
  addNoise(ctx, 0x7a, 0x53, 0x42, 25);

  // ---- Copper ore [7,3] ----
  fillTile(ctx, 7, 3, '#555761');
  speckles(ctx, '#b87333', 55, 3);
  addNoise(ctx, 0x55, 0x57, 0x61, 15);

  // ---- Crystal ore [5,2] ----
  fillTile(ctx, 5, 2, '#6fe0d0');
  addNoise(ctx, 0x6f, 0xe0, 0xd0, 28);
  speckles(ctx, '#ffffff', 35, 2);

  // ---- Echo gem [0,4] ----
  fillTile(ctx, 0, 4, '#c7b3ff');
  addNoise(ctx, 0xc7, 0xb3, 0xff, 30);
  speckles(ctx, '#ffffff', 35, 2);

  // ---- Copper bar [1,5] ----
  fillTile(ctx, 1, 5, '#b87333');
  addNoise(ctx, 0xb8, 0x73, 0x33, 22);
  speckles(ctx, '#8c5418', 30, 2);
  grainLines(ctx, '#8c5418', 5);

  // ---- Crystal bar [2,5] ----
  fillTile(ctx, 2, 5, '#6fe0d0');
  addNoise(ctx, 0x6f, 0xe0, 0xd0, 18);
  speckles(ctx, '#ffffff', 25, 2);

  // ---- Echo bar [3,5] ----
  fillTile(ctx, 3, 5, '#c7b3ff');
  addNoise(ctx, 0xc7, 0xb3, 0xff, 18);
  speckles(ctx, '#ffffff', 25, 2);

  // Fill every unused tile with a neutral stone fallback so the atlas has no holes.
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      const used = Object.values(LAYOUT).some((v) => v && v[0] === tx && v[1] === ty);
      if (!used) {
        fillTile(ctx, tx, ty, '#555761');
        addNoise(ctx, 0x55, 0x57, 0x61, 20);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Atlas tile UV rect [u, v, width, height] for a block id, or null. */
export function atlasUV(id: number): [number, number, number, number] | null {
  const t = LAYOUT[id];
  if (!t) return null;
  const [x, y] = t;
  return [x / COLS, y / ROWS, 1 / COLS, 1 / ROWS];
}
