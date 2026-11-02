# Hollowland

## Next priorities (playtest feedback)
- [x] Improve the aesthetic: biome-keyed procedural trees with lean, branches and canopies merged into the chunk mesh (`src/foliage.ts`), plus deliberate enemy silhouettes with shared materials and a breathing idle (`src/entities.ts`). Done 2026-11-02.
- [ ] Investigate the reported death while digging underground. A debug overlay now exists (F3) showing position, velocity, biome, vitals, last fall impact and the last 8 damage events tagged by source (fall / enemy / lightning / hazard / unknown). **No cause confirmed yet** — the overlay was added to gather evidence, not to fix it.

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
