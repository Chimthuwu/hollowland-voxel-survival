# Hollowland

## Direction (agreed 2026-11-02)
Psychedelic 3D Terraria-like: colorful pixel-arcade beauty, cute at times, deeply horrific + gore where applicable. Default biome overcast-but-not-monochrome; wide biome variety; tiered tool/item progression by ore rarity; multiplayer via the SkyJump3D WebSocket-relay pattern; vehicles/weapons ported from SkyJump3D later. Full map: `HOLLOWLAND — Project Map & Roadmap.md` (on the owner's desktop, for the reviewer).

## Hotfixes
- [x] Purple-void deployment: the texture-atlas shader injected `vUv` (doesn't exist on the map path in three r170 — use `vMapUv`) and declared the `vFoliage` varying inside `main()` (illegal GLSL), so the terrain material failed to compile and every chunk mesh was skipped — flat background + entities only. Both fixed, build/tests green, deployed 2026-11-03.
- [x] "Weird and slow" follow-up (2026-11-03): (a) most atlas tiles (water, sand, snow, torch, scaffold, …) were never painted and rendered transparent black — every tile is now base-filled first and sand/snow/water got real tiles; (b) `addNoise`'s `putImageData(0,0)` ignored the canvas translate and stomped tile [0,0]; (c) atlas UVs ignored CanvasTexture flipY so every block sampled the mirrored tile row; (d) tiles painted in block colors got squared by vertex tints — per-tile brightness now normalized to near-white detail; (e) chunk builds were 800–1650 ms each (string-key memo churn, uncached surface/waterBody/terrainKind, ~7× redundant get() per voxel) — memoized with numeric keys + chunk-local block cache, ~23× faster. `window.__dbg` debug hooks removed. 146 tests green, deployed (version eb2b0692).

## Next priorities
- [ ] Finish the art pivot: recolor storm/glitch/psychosis/maw palettes; fruits that drop as pickups; enemy hit flash / death animations / gore / drops; pixel-arcade HUD + item icons.
- [x] Progression core: ore tiers by depth (copper -14..-3, crystal -32..-14, echo gem -52..-32), tool tiers driven by knapping quality (rough=1, good=2, fine=3), bare-hand insta-mining gated to soft blocks, tool durability that drops a tier when it runs out, melee damage and beam DPS scaled by tier, tool tier + durability persisted in the save schema (v1 saves migrate forward). Done 2026-11-02.
- [ ] Multiplayer: port the SkyJump3D `ws` relay (rooms, ≤6 players); sync player state + world edits only (world is deterministic from noise); host-authoritative enemies.
- [x] Investigate the reported death while digging underground. The cause of every death is now shown on the death screen itself (fall / enemy / storm / hazard from `DamageSource`), so no death can be "unexplained" again; the F3 overlay still records source/height/biome per hit. Resolved 2026-11-02.
- [x] Verify the loot/pickup loop: pickups were freezing mid-air (they never queried world solidity) and items at the player's own floor tile sat exactly on the collect-radius boundary and were never collected. Pickups now settle on solid ground with sub-stepped falls and the magnet grip point is at waist height. Regression-tested in `tests/pickups.test.ts`. Done 2026-11-02.

## Playtest feedback (older)
- [x] Improve the aesthetic: biome-keyed procedural trees (`src/foliage.ts`), deliberate enemy silhouettes with walk cycles (`src/entities.ts`). Done 2026-11-02 — then upgraded same day: per-biome tree styles (lavender conifers with sky-blue fruit, windswept, corrupted, weeping, stalks), enemy walk/jaw/orbit animation, beetle/moth/dragonfly remodel, terracotta dirt + per-voxel dither + violet dusk sky, and a fix for trees being emitted into two chunks (z-fighting, doubled vertices). Deployed.

## Progression & traversal (agreed 2026-11-01)
- [x] Build out real cave/cavern systems underground — 3D-noise caverns at all depths with a detail octave, six deterministic walkable staircase entrances (BFS-verified from surface to y=-12), spawn kept shaft-free. Done 2026-11-01.
- [x] Add mineable ore blocks underground. Crystal ore clusters at y -8..-30 (world.ts get()). Done 2026-11-02.
- [x] Beam weapon: craftable from 5 crystal, hold-to-fire continuous beam that mines/chops/fights (src/beam.ts, recipe in src/ui.ts). Done 2026-11-02.
- [x] Power-ups found in caves: gravity-reduction (0.55× gravity on pickup) and platform-spawning (right-click spawns scaffold underfoot). Fixed positions in entrance shafts (src/powerups.ts). Done 2026-11-02.
- [x] Save/load (Ctrl+S/L, auto-load on boot) with a versioned schema that ignores saves from a newer version (src/save.ts). Terrain edits are deliberately **not** persisted — the world regenerates from noise, so only player state, inventory and progression flags round-trip. Done 2026-11-02.
- [x] Settings menu (P): master volume slider and a reduce-visual-intensity toggle that suppresses the glitch/psychosis post-processing. Both persist to localStorage (src/settings.ts). Done 2026-11-02.
- [x] Per-biome hazard hooks — one mechanic + cue each (src/biomeHooks.ts): overcast drains sanity faster in the dark with a heartbeat cue, storm lightning, glitch gravity flips, psychosis control inversion, maw flesh eats health, catacombs torches blow out, veins acid pools burn, sky has reduced gravity and faster movement. Acid blocks added at y < -48. Done 2026-11-02.

## Sky traversal (remaining)
- [ ] Sky traversal: gravity + platforms as the route above the clouds to hidden sky areas and eventually space. Platform spawn and low gravity both exist, but there are no platform chains, no hidden sky content and no guaranteed reachable target above y=64.

## Prototype
- [x] Chunked face-culled voxel terrain, five surface regions, Catacombs and basic sky/veins terrain.
- [x] Movement, mining and placing, enemy pursuit/combat, hotbar, crafting, HUD and respawn.
- [x] Unit tests and production build; browser checks for movement, mining, placement and respawn.
- [x] Deploy browser build and push a private repository.
- [x] Non-hostile giant insects that wander the surface and shy away from the player (src/critters.ts).
- [ ] Human playtest, accessibility pass and real-hardware 60 FPS profiling; fix frame spikes and darkness.
- [ ] Flesh out the extended design: Psychosis shifting terrain and look-away hallucinations; Maw pits/particles; Glitch block swaps; sky eye; richer biome textures and props.
- [ ] Unarmed mining is still instant-break; decide whether the beam should be strictly required for stone and ore.
- [ ] Enemy navigation (mobs path on flat ground only) and third-person camera clipping.
