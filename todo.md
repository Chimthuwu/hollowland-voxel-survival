# Hollowland

## Direction (agreed 2026-11-02)
Psychedelic 3D Terraria-like: colorful pixel-arcade beauty, cute at times, deeply horrific + gore where applicable. Default biome overcast-but-not-monochrome; wide biome variety; tiered tool/item progression by ore rarity; multiplayer via the SkyJump3D WebSocket-relay pattern; vehicles/weapons ported from SkyJump3D later. Full map: `HOLLOWLAND — Project Map & Roadmap.md` (on the owner's desktop, for the reviewer).

## Next priorities
- [ ] Finish the art pivot: recolor storm/glitch/psychosis/maw palettes; fruits that drop as pickups; enemy hit flash / death animations / gore / drops; pixel-arcade HUD + item icons.
- [ ] Progression core (top priority): ore tiers by depth/biome, tool tiers (pick + blade per material, speed/damage scaling), tool durability, gate bare-hand insta-mining, flavorful item names (borrow Euclydia's registry or new — low priority either way).
- [ ] Multiplayer: port the SkyJump3D `ws` relay (rooms, ≤6 players); sync player state + world edits only (world is deterministic from noise); host-authoritative enemies.
- [ ] Investigate the reported death while digging underground. The debug overlay (F3) records damage source/height/biome for every hit — diagnose the next occurrence. No cause confirmed yet.

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
