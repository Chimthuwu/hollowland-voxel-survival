# Hollowland

## Direction (agreed 2026-11-02)
Psychedelic 3D Terraria-like: colorful pixel-arcade beauty, cute at times, deeply horrific + gore where applicable. Default biome overcast-but-not-monochrome; wide biome variety; tiered tool/item progression by ore rarity; multiplayer via the SkyJump3D WebSocket-relay pattern; vehicles/weapons ported from SkyJump3D later. Full map: `HOLLOWLAND — Project Map & Roadmap.md` (on the owner's desktop, for the reviewer).

## Hotfixes
- [x] Purple-void deployment: the texture-atlas shader injected `vUv` (doesn't exist on the map path in three r170 — use `vMapUv`) and declared the `vFoliage` varying inside `main()` (illegal GLSL), so the terrain material failed to compile and every chunk mesh was skipped — flat background + entities only. Both fixed, build/tests green, deployed 2026-11-03.
- [x] "Weird and slow" follow-up (2026-11-03): (a) most atlas tiles (water, sand, snow, torch, scaffold, …) were never painted and rendered transparent black — every tile is now base-filled first and sand/snow/water got real tiles; (b) `addNoise`'s `putImageData(0,0)` ignored the canvas translate and stomped tile [0,0]; (c) atlas UVs ignored CanvasTexture flipY so every block sampled the mirrored tile row; (d) tiles painted in block colors got squared by vertex tints — per-tile brightness now normalized to near-white detail; (e) chunk builds were 800–1650 ms each (string-key memo churn, uncached surface/waterBody/terrainKind, ~7× redundant get() per voxel) — memoized with numeric keys + chunk-local block cache, ~23× faster. `window.__dbg` debug hooks removed. 146 tests green, deployed (version eb2b0692).

## Next priorities
- [x] M1 PEW PEW gadget: second weapon (rapid blaster, heat/overheat, staged block damage shared with the crystal beam via src/blockDamage.ts), Q to swap, pixel-hearts + weapon HUD + interaction prompts, audio, inventory-full safety. Done 2026-11-03.
- [x] M2 seeded worlds + landmarks: deterministic seed in every generation hash (src/world.ts reseed), pure landmark framework (src/landmarks.ts: ruins, giant petrified trees, underground crystal cathedrals, shrines — rare deposits inside), seed + generationVersion round-trip in saves, custom text seeds on the start menu (FNV-1a). Done 2026-11-03.
- [x] M3a light ecology: stalker spawns denied near placed torches/totems in daylight (night pierces), species light-response table (burn/attract/neutral), stalkers burn while recoiling from a held light (light kills drop no loot), light attraction species-keyed. Done 2026-11-03.
- [x] Finish the art pivot (2026-11-25): vivid biome palettes (storm teal / glitch magenta / psychosis mauve / maw gore), skyfruit drops from felled trees and punched trunks, enemy hit flash + shrink-sink death animation + gore chunks + per-species loot, pixel hearts/weapon HUD now actually receive biome tint classes (`hudBiomeClass` + tests), and pixel item-icon colours for all 36 item blocks including sand/snow/water and smelted bars.
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
- [x] Sky traversal (verified 2026-11-25): deterministic scaffold chain climbs one block per hop from a ground landing to a beacon above y=64, with skyfruit, torch waymarks, hidden crystal caches and echo gems; added a BFS reachability regression test and removed a dead set in `placeSky`.

## Prototype
- [x] Chunked face-culled voxel terrain, five surface regions, Catacombs and basic sky/veins terrain.
- [x] Movement, mining and placing, enemy pursuit/combat, hotbar, crafting, HUD and respawn.
- [x] Unit tests and production build; browser checks for movement, mining, placement and respawn.
- [x] Deploy browser build and push a private repository.
- [x] Non-hostile giant insects that wander the surface and shy away from the player (src/critters.ts).
- [x] Accessibility pass + static perf pass (2026-11-25): OS `prefers-reduced-motion` now suppresses HUD pulses/transitions, keyboard focus rings added, and the per-frame camera path reuses vectors instead of allocating (GC spikes). Headless smoke of the deployed build: 121 rAF frames in 2 s (~60 fps), zero console errors, terrain/sky/HUD clearly visible (not excessively dark).
- [!] Human playtest and real-hardware 60 FPS profiling need a human at a physical machine; an AFK agent cannot do subjective feel testing or GPU profiling (headless smoke above is the bounded substitute).
- [ ] Flesh out the extended design: Psychosis shifting terrain and look-away hallucinations; Maw pits/particles; Glitch block swaps; sky eye; richer biome textures and props.
- [x] Unarmed mining: decided to keep the tiered tool progression (bare hands = soft blocks only; stone/copper = tier 1, crystal = tier 2, echo gem = tier 3; beam counts as tier 3). The todo premise was stale — `tests/tools.test.ts` already proves bare hands cannot break stone/ore. DECISION checkpoint `0918978` (2026-11-25). No gameplay change required.
- [x] Enemy navigation + third-person camera clipping (2026-11-25): mobs now try 90°/45° detours when a wall blocks their chase (pure `detourDirection` in src/navigation.ts, 4 tests) instead of grinding into it; the third-person boom is raycast-clamped short of terrain with a minimum head distance (`cameraBoomLength` in src/camera.ts, 4 tests). Complex long-range maze pathfinding is recorded in Inbox.

## Decisions made (review me)
- 2026-11-25 — Question: should the beam be strictly required for stone/ore? Choice: no, keep tiered tools (current tested behavior); checkpoint `0918978332a0885c2972c2f677b960dcd4065490`. Reason: beam-only would remove working progression and strand pre-beam players.
