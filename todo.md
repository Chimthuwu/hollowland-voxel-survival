# Hollowland

## Next priorities (playtest feedback)
- [ ] Improve the aesthetic, especially the cheap-looking tree silhouettes and enemy models; preserve the working voxel world and build a more distinctive horror art direction.
- [ ] Investigate the reported death while digging underground: reproduce, capture health/damage and descent details, and distinguish fall damage, enemy damage or a collision bug. No cause is confirmed yet.

## Progression & traversal (agreed 2026-11-01)
- [x] Build out real cave/cavern systems underground — 3D-noise caverns at all depths with a detail octave, six deterministic walkable staircase entrances (BFS-verified from surface to y=-12), spawn kept shaft-free. Done 2026-11-01; ores/power-ups still open.
- [ ] Add mineable ore blocks underground.
- [ ] Beam weapon: one gun, craftable from mined ores, firing a continuous beam used to chop trees, mine rock/ore and fight. Replaces instant-break mining with real progression feel.
- [ ] Power-ups found in caves: gravity-reduction (higher jumps via lower gravity threshold) and platform-spawning (spawns sky platforms to jump between).
- [ ] Sky traversal: low-gravity + spawned platforms as the route above the clouds to hidden sky areas and eventually space.

## Prototype
- [x] Chunked face-culled voxel terrain, five surface regions, Catacombs and basic sky/veins terrain.
- [x] Movement, mining and placing, enemy pursuit/combat, hotbar, crafting, HUD and respawn.
- [x] Unit tests and production build; browser checks for movement, mining, placement and respawn.
- [x] Deploy browser build and push a private repository.
- [ ] Human playtest, accessibility pass and real-hardware 60 FPS profiling; fix frame spikes and darkness.
- [ ] Flesh out the extended design: Psychosis shifting terrain and look-away hallucinations; Maw acid/pits/particles; Glitch block swaps; sky eye; Catacombs torch blowouts; richer biome textures and props.
- [ ] Improve mining progression (currently instant), enemy navigation and third-person camera clipping.
