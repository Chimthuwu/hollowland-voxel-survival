# Hollowland

A first-person voxel survival horror prototype: explore strange biomes, mine and build, craft supplies, and fend off things that follow you.

[Play the deployed prototype](https://hollowland-voxel-survival.chimske.workers.dev/)

## Run

Install Node.js 20 or newer, then in this folder:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The game runs in a modern desktop browser with WebGL. Sound starts after clicking **Enter Hollowland**.

## Controls

- **WASD** move, **mouse** look, **Space** jump, **Shift** sprint
- **Left click** mine / attack, **right click** place selected block
- **1–9** or **mouse wheel** select hotbar slot
- **E** inventory, **C** craft, **P** settings, **V** first/third person
- **F3** debug overlay (position, velocity, biome, vitals, recent damage sources)
- **Ctrl+S** save, **Ctrl+L** load
- **Esc** releases the mouse; click the game to capture it again

Travel east (+X) to encounter different surface biomes; dig below Y=0 for the Catacombs or build above Y=64 to reach the sky. Torches and totems help restore sanity. Inventory and world edits last only until the page is reloaded.

Crafting: Torch = 1 wood + 1 stone; Stone Weapon = 2 wood + 3 stone; Scaffold = 2 wood; Sanity Totem = 3 stone + 2 flesh/glitch; Beam Weapon = 5 crystal.

Progression: mine crystal ore in the deep stone layer, craft the beam weapon, then find the gravity charm and platform seed in the cave entrances. The beam is a hold-to-fire tool; the platform seed spawns a scaffold underfoot on right-click.

This is an early prototype, not a finished survival game. Performance, accessibility, and game balance need further playtesting.

## Co-op rooms (experimental)

Start the relay with `npm run relay` (Node 20+, listens on port 8787, override with `PORT`). Then open the game with `?room=name&id=yourname` in each browser — for a relay on another host add `&relay=wss://relay.example`. Rooms hold at most six players. The world is regenerated from its seed on every client, so only player transforms, block edits and host-authored enemy snapshots cross the wire. `GET /health` on the relay returns `ok`.
