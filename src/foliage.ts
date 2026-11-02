import type { Biome } from './world';

/**
 * Forest floor decorations (NO trees — trees are voxel data in forest.ts and
 * come out of world.get()). Everything emitted here is purely visual: the
 * player walks/falls through it without collision, by design.
 *
 * Per-biome profiles compose occasionally: mushroom clusters are rare and
 * varied, and are joined by ferns, grass tufts, flowers, moss carpets, rocks,
 * fallen branches, leaf litter and the occasional mossy fallen log.
 */

// Mirrors world.ts face layout so flat shading and effect attributes stay consistent.
const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: .82 },
  { n: [-1, 0, 0], v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: .72 },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1 },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: .55 },
  { n: [0, 0, 1], v: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: .9 },
  { n: [0, 0, -1], v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: .65 },
];
const CHUNK_SIZE = 16;

const hash = (x: number, z: number): number => {
  const n = Math.sin(x * 127.1 + z * 311.7 + 19.19) * 43758.5453123;
  return n - Math.floor(n);
};

/** Deterministic per-box color jitter so nothing looks flat-shaded uniform. */
function jitterC(c: readonly [number, number, number], amt: number, sx: number, sz: number, y: number): [number, number, number] {
  if (amt <= 0) return [c[0], c[1], c[2]];
  const j = (k: number) => 1 + (hash(sx * 3.1 + k * 7.7 + y * 1.3, sz * 5.3 + k * 3.3 + y * 2.1) - .5) * 2 * amt;
  return [c[0] * j(0), c[1] * j(1), c[2] * j(2)];
}

export interface FoliageBuffers {
  positions: number[];
  normals: number[];
  tint: number[];
  effects: number[];
  /** 1 for swaying leaves/blossoms, 0 for trunks and ground. */
  foliage?: number[];
  indices: number[];
}

/** Emits an arbitrarily sized box; vertices nudged 1e-3 along normals so decorations never Z-fight voxel faces. */
function addBox(out: FoliageBuffers, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, r: number, g: number, b: number, effect: number, foliage = 0): void {
  const o = 1e-3;
  for (const face of FACES) {
    const base = out.positions.length / 3;
    for (const v of face.v) {
      out.positions.push(cx + (v[0] - .5) * sx + face.n[0] * o, cy + (v[1] - .5) * sy + face.n[1] * o, cz + (v[2] - .5) * sz + face.n[2] * o);
      out.normals.push(face.n[0], face.n[1], face.n[2]);
      out.tint.push(r * face.shade, g * face.shade, b * face.shade);
      out.effects.push(effect);
      out.foliage?.push(foliage);
    }
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// --- Mushrooms: four distinct species, capped sizes, clustered placement ---

interface ShroomStyle {
  stemH: [number, number];
  stemW: number;
  capR: [number, number];
  capH: number;
  domed: boolean;
  caps: Array<[number, number, number]>;
}

/** Distinct archetypes: button, taper stalk, wide plate, and a stacked cluster look. */
const SHROOMS: Array<{ style: ShroomStyle; weight: number }> = [
  // Tiny button — small cream cap on a stub stem.
  { weight: 3, style: { stemH: [.14, .22], stemW: .11, capR: [.24, .34], capH: .12, domed: true, caps: [[.82, .42, .38], [.88, .82, .74], [.72, .58, .50]] } },
  // Tall taper — narrow shot-glass stem, shallow bronze cap.
  { weight: 2, style: { stemH: [.45, .7], stemW: .13, capR: [.3, .42], capH: .14, domed: false, caps: [[.74, .60, .35], [.62, .48, .44], [.80, .72, .55]] } },
  // Wide plate — low flat toadstool table.
  { weight: 2, style: { stemH: [.2, .32], stemW: .16, capR: [.5, .68], capH: .09, domed: false, caps: [[.68, .40, .34], [.55, .60, .42], [.84, .78, .68]] } },
  // Club — squat, thick, almost no stem.
  { weight: 1.5, style: { stemH: [.1, .16], stemW: .2, capR: [.36, .5], capH: .2, domed: true, caps: [[.60, .34, .52], [.76, .66, .46]] } },
];

function emitShroom(out: FoliageBuffers, x: number, baseY: number, z: number, variant: number, scale: number, tilt: number, seedX: number, seedZ: number): void {
  const pick = SHROOMS[variant % SHROOMS.length];
  const s = pick.style;
  const cap: [number, number, number] = s.caps[Math.floor(hash(seedX * 2.9 + variant * 13.7, seedZ * 4.1) * s.caps.length) % s.caps.length];
  const stemC: [number, number, number] = [.87, .83, .74];
  const h = s.stemH[0] + (s.stemH[1] - s.stemH[0]) * hash(seedX * 5.5, seedZ * 3.3);
  const capR = (s.capR[0] + (s.capR[1] - s.capR[0]) * hash(seedX * 7.7, seedZ * 9.1)) * scale;
  const stemW = s.stemW * scale, capH = s.capH * scale, height = h * scale;
  const side = Math.floor(hash(seedX + tilt * 31, seedZ - tilt * 17) * 4);
  const ox = side === 0 ? tilt : side === 2 ? -tilt : 0;
  const oz = side === 1 ? tilt : side === 3 ? -tilt : 0;
  // Stem (slightly narrower at the top so it tapers).
  addBox(out, x + .5 + ox * .3, baseY + height * .5, z + .5 + oz * .3, stemW, height, stemW, stemC[0], stemC[1], stemC[2], 0);
  // Cap: main slab plus a shallower highlight on top; domed caps get a mid step.
  const capY = baseY + height + capH * .5;
  addBox(out, x + .5 + ox, capY, z + .5 + oz, capR, capH, capR, cap[0], cap[1], cap[2], 0);
  addBox(out, x + .5 + ox * 1.3, capY + capH * .55, z + .5 + oz * 1.3, capR * (s.domed ? .62 : .8), capH * .5, capR * (s.domed ? .62 : .8), Math.min(1, cap[0] * 1.12), Math.min(1, cap[1] * 1.12), Math.min(1, cap[2] * 1.12), 0);
  if (s.domed) addBox(out, x + .5 + ox * 1.5, capY + capH * .95, z + .5 + oz * 1.5, capR * .3, capH * .4, capR * .3, Math.min(1, cap[0] * 1.2), Math.min(1, cap[1] * 1.2), Math.min(1, cap[2] * 1.2), 0);
}

// --- Other ground flora -----------------------------------------------------

/**
 * Appends forest-floor decoration into a chunk's geometry buffers. Reads
 * surface and biome via callbacks so this module stays decoupled from World.
 * Cheap no-op for chunks that don't overlap the surface band.
 */
export function appendUndergrowth(
  out: FoliageBuffers,
  cx: number, cy: number, cz: number,
  surface: (x: number, z: number) => number,
  biomeOf: (x: number, y: number, z: number) => Biome,
): void {
  // Surface lives around y=4..11; only chunks intersecting that band carry flora.
  if (cy * CHUNK_SIZE > 24 || (cy + 1) * CHUNK_SIZE < 4) return;

  const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const x = x0 + lx, z = z0 + lz;
      const height = surface(x, z);
      const baseY = height + 1;
      // Only the chunk containing the floor emits the decoration.
      if (baseY < cy * CHUNK_SIZE || baseY >= (cy + 1) * CHUNK_SIZE) continue;
      const biome = biomeOf(x, height, z);
      const r = hash(x * 1.61, z * 2.09);
      const r2 = hash(x * 3.71 + 41, z * 4.93 - 17);

      // Rare mushroom clusters: one in ~14 columns of ground, then only inside
      // clustered patches — never an even carpet.
      const clusterCol = Math.floor(x / 5), clusterRow = Math.floor(z / 5);
      if (hash(clusterCol * 4.31, clusterRow * 7.9) < .32) {
        const jx = clusterCol * 5 + Math.floor(hash(clusterCol * 3.7, clusterRow * 1.3) * 5);
        const jz = clusterRow * 5 + Math.floor(hash(clusterCol * 8.3, clusterRow * 5.9) * 5);
        if (Math.abs(x - jx) + Math.abs(z - jz) <= 1 && r < .5) {
          const variant = Math.floor(hash(clusterCol * 2.3, clusterRow * 9.7) * SHROOMS.length * 7) % SHROOMS.length;
          const scale = .75 + hash(x * 1.9, z * 2.9) * .6;
          emitShroom(out, x, baseY, z, variant + (r2 < .35 ? 1 : 0), scale, .04 + r2 * .08, x, z);
        }
      }

      // Litter and moss carpets: quiet flat detail layered over the ground.
      if (biome === 'overcast' || biome === 'storm') {
        if (r > .965) {
          const lit = jitterC([.42, .30, .32], .15, x, z, 2);
          addBox(out, x + .47, baseY + .012, z + .43, .55, .02, .5, lit[0], lit[1], lit[2], 0);
          if (r2 > .7) addBox(out, x + .55, baseY + .024, z + .55, .34, .02, .3, lit[0] * 1.15, lit[1] * .95, lit[2] * 1.1, 0);
        } else if (r > .955) {
          // Moss carpet: soft green pad hugging the ground.
          addBox(out, x + .5, baseY + .012, z + .5, .85, .025, .85, .33, .46, .32, 0);
        }
      }

      // Ferns: splayed fronds of stacked shrinking leaves.
      if ((biome === 'overcast' && r < .014) || (biome === 'psychosis' && r < .01)) {
        const fronds = 3 + Math.floor(r2 * 3);
        for (let f = 0; f < fronds; f++) {
          const a = (f / fronds + r * 5) * Math.PI * 2;
          const fx = Math.cos(a), fz = Math.sin(a);
          const len = .35 + hash(x * 7.1 + f, z * 5.3) * .25;
          const c = jitterC([.30, .55, .40], .08, x + f, z, f);
          for (let s = 0; s < 4; s++) {
            const t = s / 4;
            addBox(out, x + .5 + fx * t * .5, baseY + .08 + t * len, z + .5 + fz * t * .5,
              .16 - t * .1, .05, .16 - t * .1, c[0], c[1], c[2], 0, 1);
          }
        }
        continue;
      }

      // Rocks and stones: one or two wedge-ish grey boxes, occasionally stacked.
      if (r > .987 && r2 > .35) {
        const g = .40 + hash(x * 9.7, z * 8.1) * .12;
        const w = .3 + r2 * .3;
        addBox(out, x + .5, baseY + w * .3, z + .45, w, w * .6, w * .8, g, g * .99, g * 1.02, 0);
        if (r2 > .75) addBox(out, x + .56, baseY + w * .62, z + .56, w * .6, w * .35, w * .6, g * 1.08, g * 1.06, g * 1.1, 0);
      }

      // Fallen branches: a lying bark bar with one twig stub.
      else if (r > .9835 && r <= .987) {
        const along = r2 > .5;
        const b = jitterC([.32, .25, .21], .1, x, z, 3);
        const len = .7 + (r2 - .5) * .6;
        if (along) {
          addBox(out, x + .5, baseY + .07, z + .5, len, .12, .12, b[0], b[1], b[2], 0);
          if (r2 > .8) addBox(out, x + .5 + (r2 - .8) * len, baseY + .16, z + .5, .1, .16, .1, b[0] * .9, b[1] * .9, b[2] * .9, 0);
        } else {
          addBox(out, x + .5, baseY + .07, z + .5, .12, .12, len, b[0], b[1], b[2], 0);
          if (r2 > .8) addBox(out, x + .5, baseY + .16, z + .5 + (r2 - .8) * len, .1, .16, .1, b[0] * .9, b[1] * .9, b[2] * .9, 0);
        }
      }

      // Fallen log, occasional and always mossy-topped.
      else if (r < .0022) {
        const along = r2 > .5;
        const len = 3 + Math.floor(r2 * 4);
        const bark = jitterC([.30, .235, .20], .07, x, z, 1);
        if (along) {
          addBox(out, x + .5 + len * .25, baseY + .3, z + .5, len, .6, .68, bark[0], bark[1], bark[2], 0);
          addBox(out, x + .5 + len * .25, baseY + .62, z + .5, len * .7, .06, .5, .36, .5, .33, 0);
          addBox(out, x + .5 - len * .25, baseY + .3, z + .5, .12, .48, .5, .78, .72, .58, 0);
        } else {
          addBox(out, x + .5, baseY + .3, z + .5 + len * .25, .68, .6, len, bark[0], bark[1], bark[2], 0);
          addBox(out, x + .5, baseY + .62, z + .5 + len * .25, .5, .06, len * .7, .36, .5, .33, 0);
          addBox(out, x + .5, baseY + .3, z + .5 - len * .25, .5, .48, .12, .78, .72, .58, 0);
        }
      }

      // Grass tufts and flowers — the previous carpet is now rare.
      else if (biome === 'overcast' || biome === 'storm' || biome === 'glitch') {
        if (r > .945) {
          const blades = 3;
          for (let b = 0; b < blades; b++) {
            const bh = .22 + hash(x * 3.3 + b * 7, z * 4.4 + b * 3) * .2;
            const c = jitterC([.47, .66, .40], .1, x + b, z, b);
            addBox(out, x + .38 + b * .13, baseY + bh * .5, z + .44 + b * .07, .08, bh, .08, c[0], c[1], c[2], 0, 1);
          }
        } else if (r > .935) {
          const FLORA: Record<string, Array<[number, number, number]>> = {
            overcast: [[.91, .63, .78], [.62, .91, .88], [.95, .85, .54]],
            storm: [[.66, .74, .92]],
            glitch: [[.95, .45, .95], [.45, .95, .88]],
            psychosis: [[.85, .30, .38]],
            maw: [[.80, .40, .34]],
          };
          const palette = FLORA[biome];
          if (palette) {
            const head = palette[Math.floor(hash(x * 7.3 + 3, z * 5.1 - 6) * palette.length) % palette.length];
            addBox(out, x + .5, baseY + .22, z + .5, .12, .45, .12, .38, .55, .34, 0);
            const c = jitterC(head, .06, x, z, 1);
            addBox(out, x + .5, baseY + .52, z + .5, .3, .26, .3, c[0], c[1], c[2], 0, 1);
          }
        }
      }

      // Biome-specific corruption details.
      if (biome === 'glitch' && r2 > .96) {
        // Floating, pulsing debris shards.
        const c = jitterC([.35, .90, .82], .2, x, z, 5);
        addBox(out, x + .5, baseY + .3 + r * .3, z + .42, .22 + r * .2, .1, .22, c[0], c[1], c[2], 2, 1);
      } else if (biome === 'psychosis' && r2 > .965 && r <= .965) {
        // Bleached bone shards half-sunk into the ground.
        const c = jitterC([.72, .70, .62], .08, x, z, 6);
        addBox(out, x + .5, baseY + .08, z + .5, .3 + r * .2, .16, .18, c[0], c[1], c[2], 0);
      } else if (biome === 'maw' && r2 > .955 && r <= .955) {
        // Pulsing flesh polyps — the maw never fully heals.
        const c = jitterC([.62, .2, .22], .12, x, z, 7);
        addBox(out, x + .5, baseY + .12, z + .5, .34 + r * .22, .24, .3, c[0], c[1], c[2], 1, 0);
      }
    }
  }
}
