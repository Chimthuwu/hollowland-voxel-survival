import { it } from 'vitest';
import * as THREE from 'three';
import { Block, WATER_LEVEL, World } from '../src/world';

const world = new World(new THREE.Scene());

it('survey balance', () => {
  // --- Cave mouths: density over a 600x600 area ---
  const R = 300, STEP = 2;
  let mouthCols = 0, cols = 0;
  const mouthSpots: Array<[number, number]> = [];
  for (let x = -R; x < R; x += STEP) for (let z = -R; z < R; z += STEP) {
    cols++;
    const top = world.surface(x, z);
    if (world.get(x, top, z) === Block.Air && world.get(x, top - 3, z) === Block.Air
      && world.get(x, top - 5, z) === Block.Air) { mouthCols++; mouthSpots.push([x, z]); }
  }
  const area = (2 * R) ** 2;
  const perCol = mouthCols / cols;
  console.log(`MOUTHS: ${mouthCols} mouth columns / ${cols} surveyed = ${(perCol * 100).toFixed(2)}% of columns`);
  // spacing: one mouth per N columns -> sqrt(N) blocks apart
  const colsPerMouth = 1 / Math.max(perCol / 9, 1e-9); // 9 cols per sample (STEP2)
  console.log(`  approx 1 mouth per ${(Math.sqrt(colsPerMouth)).toFixed(0)} blocks of walking (sampled)`);

  // --- Water: coverage, river width, trench depth ---
  let wet = 0;
  const widths = new Map<number, number[]>(); // per x: contiguous wet runs in z
  const trench: number[] = [];
  for (let x = -R; x < R; x += 3) {
    let run = 0;
    for (let z = -R; z < R; z++) {
      if (world.get(x, WATER_LEVEL, z) === Block.Water) { wet++; run++; }
      else if (run > 0) { (widths.get(x) ?? widths.set(x, []).get(x)!).push(run); run = 0; }
    }
    if (run > 0) (widths.get(x) ?? widths.set(x, []).get(x)!).push(run);
  }
  const allRuns = [...widths.values()].flat();
  const avgW = allRuns.reduce((a, b) => a + b, 0) / Math.max(1, allRuns.length);
  console.log(`WATER: ${wet} wet columns at y=${WATER_LEVEL}; avg width ${avgW.toFixed(1)} blocks; max ${Math.max(0, ...allRuns)}; runs ${allRuns.length}`);

  // Trench depth: for wet columns, bank height minus bed.
  let bedSum = 0, n = 0, maxStep = 0, steps2plus = 0;
  for (let x = -R; x < R; x += 5) for (let z = -R; z < R; z += 5) {
    if (world.get(x, WATER_LEVEL, z) !== Block.Water) continue;
    const bed = world.surface(x, z);
    bedSum += bed; n++;
    for (const [ox, oz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
      const bank = world.surface(x + ox, z + oz);
      const step = (bank + 1) - (bed + 1);
      if (step > maxStep) maxStep = step;
      if (step >= 2) steps2plus++;
    }
  }
  console.log(`TRENCH: avg bed ${n ? (bedSum / n).toFixed(1) : '-'}; worst bank step ${maxStep} blocks; ${steps2plus} of ${n * 4} bank probes need >1-block jump`);

  // --- Where are the rivers? latitudinal spread ---
  const riverZs: number[] = [];
  for (let x = -R; x < R; x += 7) for (let z = -R; z < R; z++) {
    if (world.get(x, WATER_LEVEL, z) === Block.Water) { riverZs.push(z); break; }
  }
  console.log(`RIVER SPREAD: wet z sampled from ${Math.min(...riverZs)} to ${Math.max(...riverZs)} (survey span ${-R}..${R})`);
}, 60000);
